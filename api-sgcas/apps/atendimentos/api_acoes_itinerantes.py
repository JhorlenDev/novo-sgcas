"""Ações itinerantes: o atendimento em campo, do cadastro da ação ao balanço."""
from __future__ import annotations

import uuid

from django.db import models
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos.models import (
    AcaoItinerante,
)
from apps.atendimentos.serializers import (
    AcaoItineranteSerializer,
    NovaAcaoItineranteSerializer,
)
from apps.contas.escopo import pode_acessar_unidade, resolver_filtro
from apps.contas.permissoes import EquipeDeAtendimento


# O que uma ação em campo pode declarar atender: bem acima do real, bem abaixo do que o banco aceita.
LIMITE_DOS_NUMEROS_DA_ACAO = 1_000_000


@api_view(['GET', 'POST'])
@permission_classes([EquipeDeAtendimento])
def acoes_itinerantes(request):
    """Ações em campo da unidade — listar e criar."""
    if request.method == 'GET':
        escopo = resolver_filtro(request.user, request.query_params.get('unidade'))
        consulta = AcaoItinerante.vigentes.filter(**escopo)
        if request.query_params.get('compacto') == '1':
            return Response(list(consulta.order_by('-data').values('id', 'titulo', 'local', 'data')))
        consulta = consulta.select_related('unidade', 'responsavel')
        return Response(AcaoItineranteSerializer(consulta, many=True).data)

    if request.user.unidade_id is None:
        return Response({'detalhe': 'Seu usuário não tem unidade de lotação definida.'},
                        status=status.HTTP_409_CONFLICT)

    dados = NovaAcaoItineranteSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    agora = timezone.now()

    acao = AcaoItinerante(
        id=str(uuid.uuid4()), **dados.validated_data,
        responsavel=request.user, unidade_id=request.user.unidade_id,
        criada_em=agora, atualizada_em=agora,
    )
    acao.save(force_insert=True)
    return Response(AcaoItineranteSerializer(acao).data, status=status.HTTP_201_CREATED)


@api_view(['PATCH'])
@permission_classes([EquipeDeAtendimento])
def concluir_acao_itinerante(request, acao_id):
    """Conclui uma ação itinerante registrando métricas finais."""
    try:
        acao = AcaoItinerante.vigentes.get(id=acao_id)
    except AcaoItinerante.DoesNotExist:
        return Response({'detalhe': 'Ação não encontrada.'}, status=status.HTTP_404_NOT_FOUND)

    if not pode_acessar_unidade(request.user, str(acao.unidade_id)):
        return Response({'detalhe': 'Sem permissão para alterar ação de outra unidade.'},
                        status=status.HTTP_403_FORBIDDEN)

    cidadaos = request.data.get('cidadaos_atendidos')
    participantes = request.data.get('participantes', 0)
    beneficios = request.data.get('beneficios_concedidos', 0)
    casos = request.data.get('casos_abertos', 0)

    if cidadaos is None:
        return Response({'detalhe': 'Informe o número de cidadãos atendidos.'},
                        status=status.HTTP_400_BAD_REQUEST)

    try:
        cidadaos = int(cidadaos)
        participantes = int(participantes)
        beneficios = int(beneficios)
        casos = int(casos)
    except (TypeError, ValueError):
        return Response({'detalhe': 'Valores inválidos.'},
                        status=status.HTTP_400_BAD_REQUEST)
    # Negativo não existe, e um número enorme estouraria a coluna (erro 500 no banco).
    if not all(0 <= valor <= LIMITE_DOS_NUMEROS_DA_ACAO for valor in (cidadaos, participantes, beneficios, casos)):
        return Response({'detalhe': f'Informe números de 0 a {LIMITE_DOS_NUMEROS_DA_ACAO}.'},
                        status=status.HTTP_400_BAD_REQUEST)

    acao.cidadaos_atendidos = cidadaos
    acao.participantes = participantes
    acao.beneficios_concedidos = beneficios
    acao.casos_abertos = casos
    acao.concluida = True
    acao.atualizada_em = timezone.now()
    acao.save(update_fields=[
        'cidadaos_atendidos', 'participantes', 'beneficios_concedidos',
        'casos_abertos', 'concluida', 'atualizada_em',
    ])

    return Response(AcaoItineranteSerializer(acao).data)


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def balanco_acao_itinerante(request, acao_id):
    """Dashboard de uma ação com métricas e vínculos."""
    try:
        acao = AcaoItinerante.vigentes.select_related('unidade', 'responsavel').get(id=acao_id)
    except AcaoItinerante.DoesNotExist:
        return Response({'detalhe': 'Ação não encontrada.'}, status=status.HTTP_404_NOT_FOUND)

    if not pode_acessar_unidade(request.user, str(acao.unidade_id)):
        return Response({'detalhe': 'Sem permissão para acessar ação de outra unidade.'},
                        status=status.HTTP_403_FORBIDDEN)

    dados = AcaoItineranteSerializer(acao).data
    dados['balanco'] = acao.balanco()
    return Response(dados)


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def resumo_acoes_itinerantes(request):
    """Totais acumulados de todas as ações para o card de balanço."""
    escopo = resolver_filtro(request.user, request.query_params.get('unidade'))
    acoes = AcaoItinerante.vigentes.filter(**escopo)
    totais = acoes.aggregate(
        total_cidadaos=models.Sum('cidadaos_atendidos', default=0),
        total_casos=models.Sum('casos_abertos', default=0),
        total_beneficios=models.Sum('beneficios_concedidos', default=0),
    )
    total_acoes = acoes.count()
    total_concluidas = acoes.filter(concluida=True).count()

    return Response({
        'total_cidadaos': totais['total_cidadaos'],
        'total_casos': totais['total_casos'],
        'total_beneficios': totais['total_beneficios'],
        'total_acoes': total_acoes,
        'total_concluidas': total_concluidas,
    })


@api_view(['DELETE'])
@permission_classes([EquipeDeAtendimento])
def excluir_acao_itinerante(request, acao_id):
    """Exclui (soft delete) uma ação itinerante."""
    try:
        acao = AcaoItinerante.vigentes.get(id=acao_id)
    except AcaoItinerante.DoesNotExist:
        return Response({'detalhe': 'Ação não encontrada.'}, status=status.HTTP_404_NOT_FOUND)

    if not pode_acessar_unidade(request.user, str(acao.unidade_id)):
        return Response({'detalhe': 'Sem permissão para excluir ação de outra unidade.'},
                        status=status.HTTP_403_FORBIDDEN)

    acao.excluida_em = timezone.now()
    acao.save(update_fields=['excluida_em'])

    return Response(status=status.HTTP_204_NO_CONTENT)
