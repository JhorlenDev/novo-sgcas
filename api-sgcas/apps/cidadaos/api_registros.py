"""Registros feitos no prontuário: benefício eventual concedido e encaminhamento."""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos.models import (
    BeneficioEventual,
    Caso,
)
from apps.atendimentos.serializers import (
    BeneficioEventualSerializer,
    EncaminhamentoSerializer,
    NovoBeneficioEventualSerializer,
    NovoEncaminhamentoDoCidadaoSerializer,
)
from apps.atendimentos import duplicidade, encaminhamentos
from apps.cidadaos.models import Cidadao
import uuid

from django.db import transaction
from django.utils import timezone

from apps.contas.permissoes import (
    EquipeDeAtendimento,
)
from apps.contas.escopo import pode_acessar_unidade
from apps.institucional.models import Unidade
from apps.cidadaos.api_comum import _registrar_auditoria


def _protocolo_do_prontuario():
    agora = timezone.localtime()
    return f'PR-{agora:%Y%m%d}-{uuid.uuid4().hex[:6].upper()}'


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def registrar_beneficio(request, cidadao_id: str):
    """Registra benefício eventual diretamente no prontuário do cidadão."""
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    dados = NovoBeneficioEventualSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    d = dados.validated_data
    agora = timezone.now()

    # Uma pessoa por vez: dois registros simultâneos conferiam a repetição antes
    # de qualquer um gravar, e os dois passavam.
    Cidadao.objects.select_for_update().filter(pk=cidadao.pk).first()
    tipo_outro = (d.get('tipo_outro') or '').strip() or None
    alertas = duplicidade.alertas_de_beneficio(cidadao, d['tipo'], tipo_outro)
    if (recusa := duplicidade.exigir_justificativa(alertas, d.get('justificativa_duplicidade'))) is not None:
        return recusa

    beneficio = BeneficioEventual(
        id=str(uuid.uuid4()),
        cidadao=cidadao,
        nome_da_pessoa=(d.get('nome_da_pessoa') or cidadao.nome).strip(),
        tipo=d['tipo'],
        tipo_outro=tipo_outro,
        descricao=(d.get('descricao') or '').strip() or None,
        justificativa_duplicidade=duplicidade.justificativa_a_gravar(alertas, d.get('justificativa_duplicidade')),
        registrado_por=request.user,
        unidade=getattr(request.user, 'unidade', None),
        criado_em=agora,
        atualizado_em=agora,
    )
    beneficio.save(force_insert=True)
    if alertas and beneficio.unidade_id:
        duplicidade.avisar_as_outras_unidades(
            alertas, beneficio.unidade, tipo_outro or dict(BeneficioEventual.Tipo.choices)[d['tipo']], cidadao, agora,
        )

    _registrar_auditoria(
        request,
        'CRIAR',
        'BeneficioEventual',
        beneficio.id,
        dados_novos=BeneficioEventualSerializer(beneficio).data,
    )

    return Response(BeneficioEventualSerializer(beneficio).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
@transaction.atomic
def registrar_encaminhamento(request, cidadao_id: str):
    """
    Registra encaminhamento, com a ficha, pelo prontuário.

    Se o operador não informar um caso existente, o sistema abre um para manter a
    rastreabilidade — com o resumo da situação como relato inicial — e o leva ao
    destino. O caso informado precisa ser da unidade de quem encaminha e estar
    aberto: antes, qualquer técnico encaminhava o caso de qualquer unidade.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    operador = request.user
    if not getattr(operador, 'unidade_id', None):
        return Response(
            {'detalhe': 'O operador precisa estar vinculado a uma unidade para registrar encaminhamento.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    dados = NovoEncaminhamentoDoCidadaoSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    d = dados.validated_data

    destino = None
    destino_id = (d.get('unidade_destino_id') or '').strip()
    if destino_id:
        destino = Unidade.ativas.filter(id=destino_id).first()
        if destino is None:
            return Response({'unidade_destino_id': 'Unidade de destino não encontrada.'}, status=status.HTTP_400_BAD_REQUEST)

    agora = timezone.now()
    caso_id = (d.get('caso_id') or '').strip()
    if caso_id:
        caso = Caso.vigentes.select_for_update().filter(id=caso_id, cidadao=cidadao).first()
        if caso is None:
            return Response({'caso_id': 'Caso não encontrado para este cidadão.'}, status=status.HTTP_400_BAD_REQUEST)
        if not pode_acessar_unidade(operador, caso.unidade_id):
            return Response({'detalhe': 'Caso de outra unidade'}, status=status.HTTP_403_FORBIDDEN)
        if caso.situacao in Caso.ENCERRADAS:
            rotulo = dict(Caso.Situacao.choices).get(caso.situacao, caso.situacao)
            return Response({'detalhe': f'Este caso já foi encerrado ({rotulo}).'}, status=status.HTTP_409_CONFLICT)
    else:
        caso = Caso(
            id=str(uuid.uuid4()),
            protocolo=_protocolo_do_prontuario(),
            situacao=Caso.Situacao.EM_ATENDIMENTO,
            prioridade=Caso.Prioridade.NORMAL,
            descricao=d['resumo_da_situacao'].strip(),
            cidadao=cidadao,
            unidade=operador.unidade,
            tecnico=operador,
            aberto_em=agora,
            ativo=True,
            criado_em=agora,
            atualizado_em=agora,
        )
        caso.save(force_insert=True)

    try:
        encaminhamento = encaminhamentos.criar(
            caso=caso, operador=operador, destino=destino,
            destino_externo=(d.get('destino_externo') or '').strip(), dados=d, agora=agora,
        )
    except encaminhamentos.EncaminhamentoInvalido as erro:
        return Response(erro.corpo, status=erro.status)

    _registrar_auditoria(
        request,
        'CRIAR',
        'Encaminhamento',
        encaminhamento.id,
        dados_novos=EncaminhamentoSerializer(encaminhamento).data,
    )

    return Response(EncaminhamentoSerializer(encaminhamento).data, status=status.HTTP_201_CREATED)
