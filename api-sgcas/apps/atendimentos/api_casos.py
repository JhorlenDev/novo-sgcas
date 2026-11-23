"""Casos: consulta, observação, encaminhamento e conclusão do atendimento."""
from __future__ import annotations


from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos import encaminhamentos
from apps.atendimentos.relato import acrescentar_ao_relato as _acrescentar_ao_relato
from apps.atendimentos.models import (
    Caso,
    SenhaDaFila,
)
from apps.atendimentos.serializers import (
    CasoSerializer,
    ConclusaoSerializer,
    EncaminhamentoSerializer,
    NovoEncaminhamentoSerializer,
    ObservacaoDoCasoSerializer,
)
from apps.institucional.models import Unidade
from apps.contas.escopo import pode_acessar_unidade, resolver_filtro
from apps.contas.permissoes import EquipeDeAtendimento, PodeConsultar


def _caso_encerrado(caso):
    """Resposta 409 se o caso já foi encerrado; `None` se ainda pode mudar de estado."""
    if caso.situacao not in Caso.ENCERRADAS:
        return None
    rotulo = dict(Caso.Situacao.choices).get(caso.situacao, caso.situacao)
    return Response(
        {'detalhe': f'Este caso já foi encerrado ({rotulo}).'},
        status=status.HTTP_409_CONFLICT,
    )


@api_view(['GET'])
@permission_classes([PodeConsultar])
def casos(request):
    escopo = resolver_filtro(request.user, request.query_params.get('unidade'))
    consulta = Caso.vigentes.filter(**escopo).select_related('cidadao', 'unidade', 'tecnico', 'servico')

    situacao = request.query_params.get('situacao')
    if situacao:
        consulta = consulta.filter(situacao=situacao)

    origem = request.query_params.get('origem')
    if origem == 'sede':
        consulta = consulta.filter(acao_itinerante__isnull=True)
    elif origem == 'itinerante':
        consulta = consulta.filter(acao_itinerante__isnull=False)

    acao_itinerante = request.query_params.get('acao_itinerante')
    if acao_itinerante:
        consulta = consulta.filter(acao_itinerante_id=acao_itinerante)

    cidadao = request.query_params.get('cidadao')
    if cidadao:
        consulta = consulta.filter(cidadao_id=cidadao)

    return Response(CasoSerializer(consulta[:100], many=True).data)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def encaminhar(request, caso_id: str):
    """
    Encaminha o caso, com a ficha, para outra unidade da rede ou para um serviço
    externo.

    Encaminhar para dentro da rede muda a unidade do caso e avisa a unidade de
    destino: sem isso o encaminhamento seria um bilhete que ninguém do outro lado
    leria — que é o problema que ele deveria resolver. A ficha leva o que a
    origem sabia (o que a pessoa pediu, o que recebeu, o relato) e o que o
    técnico acrescentou. Ver `apps.atendimentos.encaminhamentos`.
    """
    dados = NovoEncaminhamentoSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    d = dados.validated_data

    # Trava a linha: o estado é lido e depois alterado, e duas requisições
    # simultâneas leriam o mesmo estado.
    caso = Caso.vigentes.select_for_update().filter(id=caso_id).first()
    if caso is None:
        return Response({'detalhe': 'Caso não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    if not pode_acessar_unidade(request.user, caso.unidade_id):
        return Response({'detalhe': 'Caso de outra unidade'}, status=status.HTTP_403_FORBIDDEN)
    if (encerrado := _caso_encerrado(caso)) is not None:
        return encerrado

    destino_id = (d.get('unidade_destino_id') or '').strip() or None
    destino = Unidade.ativas.filter(id=destino_id).first() if destino_id else None
    if destino_id and destino is None:
        return Response({'unidade_destino_id': 'Unidade não encontrada'},
                        status=status.HTTP_400_BAD_REQUEST)

    agora = timezone.now()
    try:
        encaminhamento = encaminhamentos.criar(
            caso=caso, operador=request.user, destino=destino,
            destino_externo=(d.get('destino_externo') or '').strip(), dados=d, agora=agora,
        )
    except encaminhamentos.EncaminhamentoInvalido as erro:
        return Response(erro.corpo, status=erro.status)

    SenhaDaFila.objects.filter(
        cidadao_id=caso.cidadao_id,
        atendido_por=request.user,
        situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO,
    ).update(situacao=SenhaDaFila.Situacao.ATENDIDO, finalizado_em=agora, atualizado_em=agora)

    return Response(EncaminhamentoSerializer(encaminhamento).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def anotar_caso(request, caso_id: str):
    """Registra observação de atendimento sem encerrar o caso."""
    dados = ObservacaoDoCasoSerializer(data=request.data)
    dados.is_valid(raise_exception=True)

    caso = Caso.vigentes.filter(id=caso_id).first()
    if caso is None:
        return Response({'detalhe': 'Caso não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    if not pode_acessar_unidade(request.user, caso.unidade_id):
        return Response({'detalhe': 'Caso de outra unidade'}, status=status.HTTP_403_FORBIDDEN)

    observacao = dados.validated_data['observacao'].strip()
    agora = timezone.now()
    _acrescentar_ao_relato(caso, request.user, agora, observacao)
    caso.tecnico = request.user
    caso.atualizado_em = agora
    caso.save(update_fields=['descricao', 'tecnico', 'atualizado_em'])

    return Response(CasoSerializer(caso).data)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def concluir(request, caso_id: str):
    """
    Encerra o atendimento e libera a senha da fila.

    Fechar o caso sem fechar a senha deixaria a pessoa marcada como "em
    atendimento" para sempre, e a fila do dia seguinte começaria suja.
    """
    dados = ConclusaoSerializer(data=request.data)
    dados.is_valid(raise_exception=True)

    # Trava a linha: sem isso duas conclusões simultâneas passam pela checagem
    # de estado juntas e as duas concluem.
    caso = Caso.vigentes.select_for_update().filter(id=caso_id).first()
    if caso is None:
        return Response({'detalhe': 'Caso não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    if not pode_acessar_unidade(request.user, caso.unidade_id):
        return Response({'detalhe': 'Caso de outra unidade'}, status=status.HTTP_403_FORBIDDEN)
    # Reconcluir reescreveria o fechamento, duplicaria a conclusão no relato e
    # liberaria a senha EM_ATENDIMENTO que a mesma pessoa tenha hoje na unidade.
    if (encerrado := _caso_encerrado(caso)) is not None:
        return encerrado

    agora = timezone.now()
    caso.situacao = dados.validated_data['situacao']
    # O relato final entra no histórico, não no lugar dele: substituir apagava a
    # observação da recepção e toda a evolução anotada durante o atendimento.
    _acrescentar_ao_relato(
        caso, request.user, agora,
        f'{Caso.Situacao(caso.situacao).label}. {dados.validated_data["relato"]}',
    )
    caso.tecnico = request.user
    caso.fechado_em = agora
    caso.atualizado_em = agora
    caso.save(update_fields=['situacao', 'descricao', 'tecnico', 'fechado_em', 'atualizado_em'])

    SenhaDaFila.objects.filter(
        cidadao_id=caso.cidadao_id, unidade_id=caso.unidade_id,
        situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO,
    ).update(situacao=SenhaDaFila.Situacao.ATENDIDO, finalizado_em=agora, atualizado_em=agora)

    # Se este caso chegou por encaminhamento, ele termina com o caso — e a unidade
    # que o enviou é avisada.
    encaminhamentos.ao_concluir_caso(caso, request.user, dados.validated_data['relato'], agora)

    return Response(CasoSerializer(caso).data)
