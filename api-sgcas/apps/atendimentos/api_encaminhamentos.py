"""Caixas de encaminhamentos, resposta ao encaminhamento e avisos entre unidades."""
from __future__ import annotations

from django.db import models, transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos import encaminhamentos
from apps.atendimentos.avisos import AvisoSerializer
from apps.atendimentos.models import Aviso, Caso, Encaminhamento
from apps.atendimentos.serializers import (
    EncaminhamentoDetalheSerializer, EncaminhamentoResumoSerializer, EncaminhamentoSerializer,
)
from apps.contas.escopo import SEM_UNIDADE
from apps.contas.permissoes import ComunicacaoEntreUnidades, EquipeDeAtendimento, ve_o_relato

LIMITE_PADRAO = 100
LIMITE_MAXIMO = 200


class _Motivo(serializers.Serializer):
    motivo = serializers.CharField()


class _Resultado(serializers.Serializer):
    resultado = serializers.CharField()


class _Observacao(serializers.Serializer):
    observacao = serializers.CharField(required=False, allow_blank=True, allow_null=True)


def _serializador(operador, detalhe: bool = False):
    """Técnicos: a ficha inteira. Recepção: só o resumo."""
    if not ve_o_relato(operador):
        return EncaminhamentoResumoSerializer
    return EncaminhamentoDetalheSerializer if detalhe else EncaminhamentoSerializer


def _limite(request) -> int:
    try:
        pedido = int(request.query_params.get('limite', LIMITE_PADRAO))
    except ValueError:
        pedido = LIMITE_PADRAO
    return max(1, min(pedido, LIMITE_MAXIMO))


def _da_unidade(operador, campo: str) -> dict:
    """Filtro pela unidade de quem pergunta. O ADMIN vê todas; sem unidade, nenhuma."""
    if operador.ve_todas_as_unidades:
        return {}
    return {campo: operador.unidade_id or SEM_UNIDADE}


def _ordem_de_urgencia():
    return models.Case(
        models.When(urgencia=Caso.Prioridade.URGENTE, then=models.Value(0)),
        models.When(urgencia=Caso.Prioridade.ALTA, then=models.Value(1)),
        models.When(urgencia=Caso.Prioridade.NORMAL, then=models.Value(2)),
        default=models.Value(3),
        output_field=models.IntegerField(),
    )


def _caixa(request, campo_da_unidade: str, mais_urgente_primeiro: bool):
    situacao = request.query_params.get('situacao', 'abertos')
    consulta = Encaminhamento.objects.filter(**_da_unidade(request.user, campo_da_unidade)).select_related(
        'caso__cidadao', 'unidade_origem', 'unidade_destino', 'encaminhado_por', 'respondido_por',
    )
    if situacao == 'abertos':
        consulta = consulta.filter(situacao__in=encaminhamentos.ABERTOS)
    elif situacao in Encaminhamento.Situacao.values:
        consulta = consulta.filter(situacao=situacao)
    elif situacao != 'todos':
        return Response({'situacao': 'Use abertos, todos ou uma situação válida.'}, status=status.HTTP_400_BAD_REQUEST)

    if cidadao := request.query_params.get('cidadao'):
        consulta = consulta.filter(caso__cidadao_id=cidadao)

    if mais_urgente_primeiro:
        # Fila de trabalho: o mais urgente primeiro e, entre iguais, o que espera há mais tempo.
        consulta = consulta.annotate(ordem=_ordem_de_urgencia()).order_by('ordem', 'criado_em')
    else:
        consulta = consulta.order_by('-criado_em')

    serializador = _serializador(request.user)
    return Response(serializador(consulta[:_limite(request)], many=True).data)


@api_view(['GET'])
@permission_classes([ComunicacaoEntreUnidades])
def recebidos(request):
    """Encaminhamentos para a unidade de quem pergunta."""
    return _caixa(request, 'unidade_destino_id', mais_urgente_primeiro=True)


@api_view(['GET'])
@permission_classes([ComunicacaoEntreUnidades])
def enviados(request):
    """Encaminhamentos que a unidade de quem pergunta enviou, e em que pé estão."""
    return _caixa(request, 'unidade_origem_id', mais_urgente_primeiro=False)


def _participa(operador, enc: Encaminhamento, como: tuple[str, ...]) -> bool:
    if operador.ve_todas_as_unidades:
        return True
    return bool(operador.unidade_id) and (
        ('origem' in como and operador.unidade_id == enc.unidade_origem_id)
        or ('destino' in como and operador.unidade_id == enc.unidade_destino_id)
    )


def _recusa_de_acesso():
    return Response({'detalhe': 'Este encaminhamento não é da sua unidade.'}, status=status.HTTP_403_FORBIDDEN)


def _nao_encontrado():
    return Response({'detalhe': 'Encaminhamento não encontrado'}, status=status.HTTP_404_NOT_FOUND)


@api_view(['GET'])
@permission_classes([ComunicacaoEntreUnidades])
def detalhar(request, encaminhamento_id: str):
    enc = Encaminhamento.objects.select_related(
        'caso__cidadao', 'unidade_origem', 'unidade_destino', 'encaminhado_por', 'respondido_por',
    ).filter(id=encaminhamento_id).first()
    if enc is None:
        return _nao_encontrado()
    if not _participa(request.user, enc, ('origem', 'destino')):
        return _recusa_de_acesso()
    return Response(_serializador(request.user, detalhe=True)(enc).data)


def _travar(encaminhamento_id: str):
    return Encaminhamento.objects.select_for_update().filter(id=encaminhamento_id).first()


def _resposta(request, enc_id: str):
    enc = Encaminhamento.objects.select_related(
        'caso__cidadao', 'unidade_origem', 'unidade_destino', 'encaminhado_por', 'respondido_por',
    ).get(pk=enc_id)
    return Response(EncaminhamentoDetalheSerializer(enc).data)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def aceitar(request, encaminhamento_id: str):
    enc = _travar(encaminhamento_id)
    if enc is None:
        return _nao_encontrado()
    if not _participa(request.user, enc, ('destino',)):
        return _recusa_de_acesso()

    dados = _Observacao(data=request.data)
    dados.is_valid(raise_exception=True)
    try:
        encaminhamentos.aceitar(enc, request.user, dados.validated_data.get('observacao'), timezone.now())
    except encaminhamentos.EncaminhamentoInvalido as erro:
        return Response(erro.corpo, status=erro.status)
    return _resposta(request, enc.pk)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def recusar(request, encaminhamento_id: str):
    enc = _travar(encaminhamento_id)
    if enc is None:
        return _nao_encontrado()
    if not _participa(request.user, enc, ('destino',)):
        return _recusa_de_acesso()

    dados = _Motivo(data=request.data)
    dados.is_valid(raise_exception=True)
    try:
        encaminhamentos.recusar(enc, request.user, dados.validated_data['motivo'], timezone.now())
    except encaminhamentos.EncaminhamentoInvalido as erro:
        return Response(erro.corpo, status=erro.status)
    return _resposta(request, enc.pk)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def concluir(request, encaminhamento_id: str):
    """Registra o retorno de um encaminhamento EXTERNO. O interno conclui com o caso."""
    enc = _travar(encaminhamento_id)
    if enc is None:
        return _nao_encontrado()
    if not _participa(request.user, enc, ('origem', 'destino')):
        return _recusa_de_acesso()
    # Quem tenta concluir o interno recebe o caminho certo, não um "sem permissão".
    if enc.unidade_destino_id:
        return Response(
            {'detalhe': 'Este encaminhamento é concluído pela unidade de destino, ao concluir o caso.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not _participa(request.user, enc, ('origem',)):
        return _recusa_de_acesso()

    dados = _Resultado(data=request.data)
    dados.is_valid(raise_exception=True)
    try:
        encaminhamentos.concluir_externo(enc, request.user, dados.validated_data['resultado'], timezone.now())
    except encaminhamentos.EncaminhamentoInvalido as erro:
        return Response(erro.corpo, status=erro.status)
    return _resposta(request, enc.pk)


# ─── avisos ────────────────────────────────────────────────────────────────

def _avisos_da_unidade(operador):
    """Os avisos são da unidade. Sem unidade, não há de quem."""
    return Aviso.objects.filter(unidade_id=operador.unidade_id or SEM_UNIDADE)


@api_view(['GET'])
@permission_classes([ComunicacaoEntreUnidades])
def avisos(request):
    consulta = _avisos_da_unidade(request.user).select_related('cidadao')
    if request.query_params.get('nao_lidos') == '1':
        consulta = consulta.filter(lido_em__isnull=True)
    return Response(AvisoSerializer(consulta.order_by('-criado_em')[:_limite(request)], many=True).data)


@api_view(['GET'])
@permission_classes([ComunicacaoEntreUnidades])
def resumo_dos_avisos(request):
    """Os números do menu: o que a unidade ainda não leu e o que aguarda resposta."""
    unidade = request.user.unidade_id or SEM_UNIDADE
    return Response({
        'avisos_nao_lidos': Aviso.objects.filter(unidade_id=unidade, lido_em__isnull=True).count(),
        'encaminhamentos_pendentes': Encaminhamento.objects.filter(
            unidade_destino_id=unidade, situacao=Encaminhamento.Situacao.PENDENTE,
        ).count(),
    })


@api_view(['POST'])
@permission_classes([ComunicacaoEntreUnidades])
def marcar_como_lido(request, aviso_id: str):
    aviso = _avisos_da_unidade(request.user).filter(id=aviso_id).first()
    if aviso is None:
        return Response({'detalhe': 'Aviso não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    if aviso.lido_em is None:
        aviso.lido_em = timezone.now()
        aviso.lido_por = request.user
        aviso.save(update_fields=['lido_em', 'lido_por'])
    return Response({'id': aviso.id, 'lido': True})


@api_view(['POST'])
@permission_classes([ComunicacaoEntreUnidades])
def marcar_todos_como_lidos(request):
    marcados = _avisos_da_unidade(request.user).filter(lido_em__isnull=True).update(
        lido_em=timezone.now(), lido_por=request.user,
    )
    return Response({'marcados': marcados})
