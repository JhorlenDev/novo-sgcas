"""Fila e atendimento: quem aguarda, o painel do atendente, chamar o próximo e o não comparecimento."""
from __future__ import annotations


from django.db import models, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos import encaminhamentos, historico
from apps.atendimentos.relato import acrescentar_ao_relato as _acrescentar_ao_relato
from apps.atendimentos.models import (
    Caso,
    Encaminhamento,
    SenhaDaFila,
)
from apps.atendimentos.serializers import (
    CasoSerializer,
    EncaminhamentoDetalheSerializer,
    NaoCompareceuSerializer,
    SenhaSerializer,
)
from apps.cidadaos.serializers import CidadaoSerializer, EntradaDoHistoricoSerializer
from apps.contas.models import Operador
from apps.contas.escopo import resolver_filtro
from apps.contas.permissoes import EquipeDeAtendimento, Recepcao


def _ordem_de_prioridade():
    return models.Case(
        models.When(prioridade=Caso.Prioridade.URGENTE, then=models.Value(0)),
        models.When(prioridade=Caso.Prioridade.ALTA, then=models.Value(1)),
        models.When(prioridade=Caso.Prioridade.NORMAL, then=models.Value(2)),
        models.When(prioridade=Caso.Prioridade.BAIXA, then=models.Value(3)),
        default=models.Value(4),
        output_field=models.IntegerField(),
    )


def _caso_da_senha(senha):
    """
    O caso que esta senha atende.

    A senha sabe o seu caso. Sem isso (senhas anteriores a este vínculo) vale o
    caso aberto mais recente da pessoa na unidade — que, com um caso encaminhado
    de outra unidade, errava: o mais antigo perdia para qualquer caso novo.
    """
    if senha.caso_id:
        caso = Caso.vigentes.filter(pk=senha.caso_id).exclude(situacao__in=Caso.ENCERRADAS).first()
        if caso is not None and caso.unidade_id == senha.unidade_id:
            return caso
    return (
        Caso.vigentes.filter(cidadao_id=senha.cidadao_id, unidade_id=senha.unidade_id)
        .exclude(situacao__in=Caso.ENCERRADAS)
        .order_by('-aberto_em')
        .first()
    )


@api_view(['GET'])
@permission_classes([Recepcao])
def fila(request):
    """Quem está aguardando na unidade. Estritamente operacional, por unidade."""
    escopo = resolver_filtro(request.user, request.query_params.get('unidade'))
    aguardando = (
        SenhaDaFila.objects.filter(situacao=SenhaDaFila.Situacao.AGUARDANDO, **escopo)
        .select_related('cidadao')
        .annotate(ordem_prioridade=_ordem_de_prioridade())
        .order_by('ordem_prioridade', 'criado_em')
    )
    return Response(SenhaSerializer(aguardando, many=True).data)


def _grupos_do_painel(operador):
    hoje = timezone.localtime(timezone.now()).date()
    unidade_id = operador.unidade_id
    fila = SenhaDaFila.objects.filter(unidade_id=unidade_id) if unidade_id else SenhaDaFila.objects.none()
    casos = Caso.vigentes.filter(unidade_id=unidade_id) if unidade_id else Caso.vigentes.none()
    return {
        'atendidos_hoje': fila.filter(atendido_por=operador, situacao=SenhaDaFila.Situacao.ATENDIDO, finalizado_em__date=hoje),
        'aguardando_na_fila': fila.filter(situacao=SenhaDaFila.Situacao.AGUARDANDO),
        'em_atendimento': fila.filter(situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO),
        'finalizados_hoje': casos.filter(tecnico=operador, fechado_em__date=hoje, situacao__in=[Caso.Situacao.CONCLUIDO, Caso.Situacao.ENCAMINHADO]),
        'casos_em_acompanhamento': casos.exclude(situacao__in=Caso.ENCERRADAS),
    }


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def painel_da_fila(request):
    grupos = _grupos_do_painel(request.user)
    ultimos = Caso.vigentes.filter(unidade_id=request.user.unidade_id, tecnico=request.user) if request.user.unidade_id else Caso.vigentes.none()
    ultimos = ultimos.select_related('cidadao', 'unidade', 'tecnico', 'servico').order_by('-atualizado_em')[:8]
    return Response({
        **{nome: registros.count() for nome, registros in grupos.items()},
        'ultimos_atendimentos': CasoSerializer(ultimos, many=True).data,
    })


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def detalhes_do_painel(request, grupo):
    registros = _grupos_do_painel(request.user).get(grupo)
    if registros is None:
        return Response({'detalhe': 'Indicador não encontrado.'}, status=status.HTTP_404_NOT_FOUND)
    if grupo in ('finalizados_hoje', 'casos_em_acompanhamento'):
        registros = registros.select_related('cidadao', 'unidade', 'tecnico', 'servico').order_by('-atualizado_em', 'id')
        return Response({'tipo': 'casos', 'registros': CasoSerializer(registros, many=True).data})
    registros = registros.select_related('cidadao').annotate(ordem_prioridade=_ordem_de_prioridade()).order_by('ordem_prioridade', 'criado_em', 'id')
    return Response({'tipo': 'senhas', 'registros': SenhaSerializer(registros, many=True).data})


def _senha_atual(operador):
    return (
        SenhaDaFila.objects.filter(
            atendido_por=operador,
            unidade_id=operador.unidade_id,
            situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO,
        )
        .order_by('chamado_em', 'criado_em', 'id')
        .first()
    )


def _encaminhamento_recebido(caso, operador):
    """
    O encaminhamento que trouxe este caso a esta unidade, com a ficha.

    É o que o técnico do destino precisa ter diante dos olhos ao chamar a pessoa:
    de onde veio, por quê, o que já recebeu. É o encaminhamento *deste caso* para
    esta unidade: o recusado devolveu o caso à origem e não é mais o que a pessoa
    trouxe.
    """
    if caso is None or operador.unidade_id is None:
        return None
    return (
        Encaminhamento.objects
        .filter(caso=caso, unidade_destino_id=operador.unidade_id)
        .exclude(situacao=Encaminhamento.Situacao.RECUSADO)
        .select_related('caso__cidadao', 'unidade_origem', 'unidade_destino', 'encaminhado_por', 'respondido_por')
        .order_by('-criado_em').first()
    )


def _montar_atendimento(senha, operador):
    cidadao = senha.cidadao
    caso = _caso_da_senha(senha)
    recebido = _encaminhamento_recebido(caso, operador)
    return {
        'senha': SenhaSerializer(senha).data,
        'cidadao': CidadaoSerializer(cidadao).data,
        'caso': CasoSerializer(caso).data if caso else None,
        'encaminhamento_recebido': EncaminhamentoDetalheSerializer(recebido).data if recebido else None,
        'historico': EntradaDoHistoricoSerializer(
            historico.do_cidadao(cidadao, operador), many=True
        ).data,
    }


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def atendimentos_abertos(request):
    senhas = (
        SenhaDaFila.objects.filter(
            unidade_id=request.user.unidade_id,
            situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO,
        ).select_related('cidadao', 'atendido_por')
        .order_by('chamado_em', 'criado_em', 'id')
    ) if request.user.unidade_id else []
    return Response([
        {
            **SenhaSerializer(senha).data,
            'operador_nome': senha.atendido_por.nome if senha.atendido_por else None,
            'pode_retomar': senha.atendido_por_id == request.user.pk,
        }
        for senha in senhas
    ])


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def recuperar_atendimento(request, senha_id):
    senha = SenhaDaFila.objects.filter(
        pk=senha_id,
        unidade_id=request.user.unidade_id,
        atendido_por=request.user,
        situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO,
    ).first()
    if senha is None:
        return Response(
            {'detalhe': 'Este atendimento foi finalizado ou não pertence a você nesta unidade.'},
            status=status.HTTP_404_NOT_FOUND,
        )
    return Response(_montar_atendimento(senha, request.user))


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def atendimento_atual(request):
    """Recupera a senha aberta do próprio operador, sem chamar outra pessoa."""
    senha = _senha_atual(request.user)
    return Response(_montar_atendimento(senha, request.user) if senha else None)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def chamar_proximo(request):
    """
    Chama o próximo e devolve o atendimento já montado.

    É a mudança central do fluxo novo: antes, chamar apenas mudava o estado da
    senha, e quem atendia procurava a pessoa de novo em outra tela. Aqui volta
    tudo o que se precisa para atender — quem é, por que veio, o que já
    aconteceu — sem uma segunda busca.
    """
    operador = request.user
    if operador.unidade_id is None:
        return Response(
            {'detalhe': 'Seu usuário não tem unidade de lotação definida.'},
            status=status.HTTP_409_CONFLICT,
        )

    # Serializa chamadas do mesmo operador, inclusive em abas diferentes.
    Operador.objects.select_for_update().get(pk=operador.pk)
    atual = _senha_atual(operador)
    if atual:
        return Response(_montar_atendimento(atual, operador))

    proxima = (
        SenhaDaFila.objects.select_for_update(skip_locked=True)
        .filter(situacao=SenhaDaFila.Situacao.AGUARDANDO, unidade_id=operador.unidade_id)
        .annotate(ordem_prioridade=_ordem_de_prioridade())
        .order_by('ordem_prioridade', 'criado_em')
        .first()
    )
    if proxima is None:
        return Response({'detalhe': 'Não há ninguém aguardando'}, status=status.HTTP_404_NOT_FOUND)

    agora = timezone.now()
    proxima.situacao = SenhaDaFila.Situacao.EM_ATENDIMENTO
    proxima.atendido_por = operador
    proxima.chamado_em = agora
    proxima.atualizado_em = agora
    proxima.save(update_fields=['situacao', 'atendido_por', 'chamado_em', 'atualizado_em'])

    caso = _caso_da_senha(proxima)
    if caso:
        caso.situacao = Caso.Situacao.EM_ATENDIMENTO
        caso.tecnico = operador
        caso.atualizado_em = agora
        caso.save(update_fields=['situacao', 'tecnico', 'atualizado_em'])

    return Response(_montar_atendimento(proxima, operador))


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def nao_compareceu(request, senha_id: str):
    """Marca a senha chamada como desistência/não comparecimento."""
    dados = NaoCompareceuSerializer(data=request.data)
    dados.is_valid(raise_exception=True)

    senha = SenhaDaFila.objects.select_for_update().filter(
        id=senha_id,
        atendido_por=request.user,
        situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO,
    ).first()
    if senha is None:
        return Response(
            {'detalhe': 'Senha em atendimento não encontrada para este operador.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    agora = timezone.now()
    motivo = (dados.validated_data.get('motivo') or '').strip()
    texto = motivo or 'Cidadão chamado, mas não compareceu ao atendimento.'

    senha.situacao = SenhaDaFila.Situacao.DESISTIU
    senha.finalizado_em = agora
    senha.atualizado_em = agora
    senha.save(update_fields=['situacao', 'finalizado_em', 'atualizado_em'])

    caso = (
        Caso.vigentes.filter(
            cidadao=senha.cidadao,
            unidade=senha.unidade,
            tecnico=request.user,
            situacao=Caso.Situacao.EM_ATENDIMENTO,
        )
        .order_by('-aberto_em')
        .first()
    )
    if caso:
        _acrescentar_ao_relato(caso, request.user, agora, f'Não compareceu. {texto}')
        caso.situacao = Caso.Situacao.CANCELADO
        caso.fechado_em = agora
        caso.atualizado_em = agora
        caso.save(update_fields=['descricao', 'situacao', 'fechado_em', 'atualizado_em'])
        encaminhamentos.ao_cancelar_caso(caso, request.user, agora)

    return Response({
        'senha': SenhaSerializer(senha).data,
        'caso': CasoSerializer(caso).data if caso else None,
    })
