"""Endpoints de conta, sessão e fila de acesso."""
from __future__ import annotations

import uuid

from django.db import models, transaction
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.contas import keycloak
from apps.contas.models import Operador, PedidoDeAcesso
from apps.contas.papeis import PRECEDENCIA
from apps.contas.permissoes import SomenteAdmin, Supervisao
from apps.contas.serializers import (
    AlterarPerfilOperadorSerializer,
    AtualizarOperadorSerializer,
    DecisaoDeAcessoSerializer,
    OperadorNaListaSerializer,
    OperadorSerializer,
    PedidoDeAcessoSerializer,
)
from apps.contas.servicos import ContaEmConflito, localizar_operador
from apps.institucional.models import Unidade


@ensure_csrf_cookie
@api_view(['GET'])
@permission_classes([IsAuthenticated])
def eu(request):
    """
    Quem está na sessão. É o que o front consulta ao carregar.

    Também entrega o cookie `csrftoken`: o front o devolve em `X-CSRFToken` nas
    rotas de sessão (sair), que o Django protege. Nada mais o emitiria.
    """
    return Response(OperadorSerializer(request.user).data)


@api_view(['GET'])
@permission_classes([SomenteAdmin])
def pedidos_pendentes(request):
    fila = PedidoDeAcesso.objects.filter(situacao=PedidoDeAcesso.Situacao.PENDENTE)
    return Response(PedidoDeAcessoSerializer(fila, many=True).data)


@api_view(['GET'])
@permission_classes([SomenteAdmin])
def historico_de_pedidos(request):
    """
    Inclui os recusados.

    Recusar tira da fila, mas não apaga: pedir acesso a um sistema com dados de
    pessoas em situação de vulnerabilidade é evento que merece rastro, e quem
    foi recusado uma vez pode voltar a pedir.
    """
    pedidos = PedidoDeAcesso.objects.select_related('decidido_por')[:200]
    return Response(PedidoDeAcessoSerializer(pedidos, many=True).data)


@api_view(['POST'])
@permission_classes([SomenteAdmin])
@transaction.atomic
def aprovar(request, pedido_id: str):
    """
    Concede o papel no Tefé Cidadão e cria o operador local.

    O papel vai primeiro para o realm. Se essa parte falhar, nada é gravado
    aqui — o contrário deixaria um operador ativo no SGCAS que seria barrado no
    próximo acesso por não ter papel, e quem aprovou veria uma aprovação que
    "não pegou", sem explicação.
    """
    dados = DecisaoDeAcessoSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    papel = dados.validated_data['papel']
    unidade_id = dados.validated_data.get('unidade_id') or None

    if papel not in PRECEDENCIA:
        raise ValidationError({'papel': f'Papel desconhecido: {papel}'})
    # Antes de tocar no realm: uma unidade que não existe estouraria só ao gravar o
    # operador, com o papel já concedido no Tefé Cidadão e a aprovação desfeita aqui.
    if unidade_id and not Unidade.ativas.filter(id=unidade_id).exists():
        raise ValidationError({'unidade_id': 'Unidade não encontrada'})

    pedido = PedidoDeAcesso.objects.filter(id=pedido_id).first()
    if pedido is None:
        return Response({'detalhe': 'Pedido não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    if pedido.situacao != PedidoDeAcesso.Situacao.PENDENTE:
        raise ValidationError({'situacao': 'Este pedido já foi decidido'})

    # Antes de tocar no realm: um conflito detectado depois deixaria o papel
    # concedido no Tefé Cidadão com a aprovação negada aqui. Quem aprova é o
    # administrador, que pode adotar uma conta antiga sem vínculo pelo e-mail;
    # o que nunca se faz é tomar a conta ligada a outra identidade.
    try:
        operador = localizar_operador(pedido.keycloak_id, pedido.email, email_confirmado=True)
    except ContaEmConflito:
        return Response(
            {'detalhe': 'Já existe um operador com este e-mail ligado a outra conta do '
                        'Tefé Cidadão. Resolva a duplicidade antes de aprovar.'},
            status=status.HTTP_409_CONFLICT,
        )

    keycloak.definir_papel(pedido.keycloak_id, papel)

    agora = timezone.now()
    if operador is None:
        operador = Operador(
            id=str(uuid.uuid4()), email=pedido.email, nome=pedido.nome,
            criado_em=agora, atualizado_em=agora,
        )
    operador.papel = papel
    operador.unidade_id = unidade_id
    operador.ativo = True
    operador.keycloak_id = pedido.keycloak_id
    operador.excluido_em = None
    operador.atualizado_em = agora
    operador.save()

    pedido.situacao = PedidoDeAcesso.Situacao.APROVADO
    pedido.decidido_em = agora
    pedido.decidido_por = request.user
    pedido.papel_concedido = papel
    pedido.unidade_concedida = unidade_id
    pedido.save()

    return Response(PedidoDeAcessoSerializer(pedido).data)


@api_view(['POST'])
@permission_classes([SomenteAdmin])
def recusar(request, pedido_id: str):
    pedido = PedidoDeAcesso.objects.filter(id=pedido_id).first()
    if pedido is None:
        return Response({'detalhe': 'Pedido não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    if pedido.situacao != PedidoDeAcesso.Situacao.PENDENTE:
        raise ValidationError({'situacao': 'Este pedido já foi decidido'})

    pedido.situacao = PedidoDeAcesso.Situacao.RECUSADO
    pedido.decidido_em = timezone.now()
    pedido.decidido_por = request.user
    pedido.save()
    return Response(PedidoDeAcessoSerializer(pedido).data)


@api_view(['GET'])
@permission_classes([Supervisao])
def listar_operadores(request):
    """
    Operadores do sistema.

    Quem enxerga só a própria unidade vê apenas a equipe dela; o ADMIN vê todos.
    A lista traz quem está sem lotação — é o caso de quem acabou de entrar pelo
    SSO, e é a partir daqui que a unidade é atribuída.
    """
    consulta = Operador.objects.filter(excluido_em__isnull=True).select_related('unidade')

    if not request.user.ve_todas_as_unidades:
        consulta = consulta.filter(
            models.Q(unidade_id=request.user.unidade_id) | models.Q(unidade__isnull=True)
        )

    if request.query_params.get('sem_unidade') == 'true':
        consulta = consulta.filter(unidade__isnull=True)

    return Response(OperadorNaListaSerializer(consulta, many=True).data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def detalhar_operador(request, operador_id: str):
    """
    O ADMIN vê qualquer um; o coordenador, a equipe da própria unidade e quem ainda
    não tem unidade (o mesmo recorte da lista); os demais, apenas a própria conta.
    """
    if not (request.user.ve_quem_atendeu or request.user.id == operador_id):
        return Response({'detalhe': 'Acesso negado'}, status=status.HTTP_403_FORBIDDEN)

    operador = Operador.objects.select_related('unidade').filter(
        id=operador_id, excluido_em__isnull=True
    ).first()
    if operador is None:
        return Response({'detalhe': 'Operador não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    # A lista já esconde a equipe de outras unidades; o detalhe não pode ser a porta dos fundos.
    if (
        operador.id != request.user.id
        and not request.user.ve_todas_as_unidades
        and operador.unidade_id not in (None, request.user.unidade_id)
    ):
        return Response({'detalhe': 'Acesso negado'}, status=status.HTTP_403_FORBIDDEN)

    return Response(OperadorNaListaSerializer(operador).data)


@api_view(['PUT'])
@permission_classes([SomenteAdmin])
@transaction.atomic
def atualizar_operador(request, operador_id: str):
    """
    Define a lotação e o estado da conta.

    Desativar aqui **retira o papel no Tefé Cidadão** — e nessa ordem. Mexer só
    no registro local duraria até o próximo acesso: o papel continuaria no
    realm, a entrada o leria de volta e a pessoa reapareceria ativa, como se
    alguém a tivesse aprovado. Retirar lá primeiro garante que, se o SSO estiver
    fora do ar, nada muda aqui e o erro aparece na tela.
    """
    dados = AtualizarOperadorSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    d = dados.validated_data

    operador = Operador.objects.filter(id=operador_id, excluido_em__isnull=True).first()
    if operador is None:
        return Response({'detalhe': 'Operador não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    if 'unidade_id' in d:
        unidade_id = (d['unidade_id'] or '').strip() or None
        if unidade_id and not Unidade.ativas.filter(id=unidade_id).exists():
            return Response({'unidade_id': 'Unidade não encontrada'},
                            status=status.HTTP_400_BAD_REQUEST)
        operador.unidade_id = unidade_id

    desativando = d.get('ativo') is False and operador.ativo
    if desativando and operador.id == request.user.id:
        # Retiraria o próprio papel no realm: o último administrador se trancaria para fora.
        return Response({'detalhe': 'Você não pode desativar a própria conta.'},
                        status=status.HTTP_400_BAD_REQUEST)
    if desativando and operador.keycloak_id:
        keycloak.remover_papeis(operador.keycloak_id)

    for campo in ('nome', 'cpf', 'ativo'):
        if campo in d:
            setattr(operador, campo, d[campo])

    operador.atualizado_em = timezone.now()
    operador.save()

    return Response(OperadorNaListaSerializer(operador).data)


@api_view(['PUT'])
@permission_classes([SomenteAdmin])
@transaction.atomic
def alterar_perfil(request, operador_id: str):
    """
    Altera o privilégio do operador.

    A troca acontece primeiro no Keycloak, porque ele é a fonte da verdade.
    Depois o papel local é atualizado para a tela refletir a decisão na hora.
    """
    dados = AlterarPerfilOperadorSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    papel = dados.validated_data['papel']

    if papel not in PRECEDENCIA:
        raise ValidationError({'papel': f'Papel desconhecido: {papel}'})

    operador = Operador.objects.filter(id=operador_id, excluido_em__isnull=True).first()
    if operador is None:
        return Response({'detalhe': 'Operador não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    if operador.id == request.user.id and papel != request.user.papel:
        return Response({'detalhe': 'Você não pode alterar o próprio perfil.'},
                        status=status.HTTP_400_BAD_REQUEST)
    if not operador.keycloak_id:
        return Response({'detalhe': 'Operador sem vínculo com Keycloak.'},
                        status=status.HTTP_409_CONFLICT)

    keycloak.definir_papel(operador.keycloak_id, papel)

    operador.papel = papel
    operador.ativo = True
    operador.atualizado_em = timezone.now()
    operador.save(update_fields=['papel', 'ativo', 'atualizado_em'])

    return Response(OperadorNaListaSerializer(operador).data)


@api_view(['DELETE'])
@permission_classes([SomenteAdmin])
@transaction.atomic
def desligar_operador(request, operador_id: str):
    """Desliga o acesso. Mesma regra da desativação: o realm primeiro."""
    operador = Operador.objects.filter(id=operador_id, excluido_em__isnull=True).first()
    if operador is None:
        return Response({'detalhe': 'Operador não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    if operador.id == request.user.id:
        return Response({'detalhe': 'Você não pode desligar a própria conta'},
                        status=status.HTTP_400_BAD_REQUEST)

    if operador.keycloak_id:
        keycloak.remover_papeis(operador.keycloak_id)

    agora = timezone.now()
    operador.ativo = False
    operador.excluido_em = agora
    operador.atualizado_em = agora
    operador.save(update_fields=['ativo', 'excluido_em', 'atualizado_em'])

    return Response(status=status.HTTP_204_NO_CONTENT)
