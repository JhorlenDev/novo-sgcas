"""
O mesmo auxílio em unidades diferentes.

A pessoa recebe a cesta no CRAS, vai ao CREAS e recebe a mesma cesta, porque as
unidades não se falavam. Aqui o sistema avisa — onde, quando e o quê — e só deixa
seguir com uma justificativa escrita, que fica no histórico para as outras
unidades lerem. Não bloqueia: quem tem uma necessidade nova não pode ficar
travado por um atendimento antigo, e quem decide é quem atende.

A janela é o mês corrente, no fuso do município: é nele que a repetição costuma
acontecer, e o aviso que dispara a todo pedido deixa de ser lido. A exceção é o
auxílio de nascimento (o auxílio maternidade), que a regra do município limita a
uma vez por ano: para ele a janela são os últimos 12 meses.

O controle no balcão vale para os serviços ligados à demanda "Benefício
Eventual". Um serviço que seja um auxílio mas não esteja ligado a essa categoria
não é controlado — a categoria é cadastrada na tela Institucional. O nome do
serviço não diz que tipo de auxílio é; quem o cadastra informa o tipo
(`Servico.tipo_de_beneficio`), e é por ele que o balcão aplica a regra de um ano.
Sem o tipo, o balcão só enxerga o que é do mês.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta

from rest_framework import status
from rest_framework.response import Response

from django.db.models import Q
from django.utils import timezone

from apps.atendimentos import encaminhamentos
from apps.atendimentos.models import AtendimentoDeRecepcao, Aviso, BeneficioEventual
from apps.institucional.models import Servico

CATEGORIA_DE_BENEFICIO = 'Benefício Eventual'
MINIMO_DA_JUSTIFICATIVA = 10

# Os auxílios que a regra do município limita a uma vez por ano, e não por mês.
TIPOS_DE_UMA_VEZ_POR_ANO = frozenset({BeneficioEventual.Tipo.NASCIMENTO.value})

PERIODO_DO_MES = 'neste mês'
PERIODO_DO_ANO = 'nos últimos 12 meses'


def inicio_do_mes(agora=None):
    """O primeiro instante do mês corrente, no fuso local."""
    agora = timezone.localtime(agora or timezone.now())
    return agora.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _um_ano_antes(dia: date) -> date:
    try:
        return dia.replace(year=dia.year - 1)
    except ValueError:                                  # 29 de fevereiro
        return dia.replace(year=dia.year - 1, day=28)


def inicio_da_janela(tipo: str, agora=None):
    """
    Desde quando um benefício deste tipo conta como repetição.

    Para os tipos de uma vez por ano, a janela abre no dia seguinte ao aniversário
    do benefício: o concedido em 27/10 deixa de contar em 27/10 do ano seguinte —
    o ano já se completou —, e ainda conta em 26/10.
    """
    if tipo not in TIPOS_DE_UMA_VEZ_POR_ANO:
        return inicio_do_mes(agora)
    local = timezone.localtime(agora or timezone.now())
    primeiro_dia = _um_ano_antes(local.date()) + timedelta(days=1)
    return datetime.combine(primeiro_dia, time.min, tzinfo=local.tzinfo)


def periodo_do(tipo: str) -> str:
    return PERIODO_DO_ANO if tipo in TIPOS_DE_UMA_VEZ_POR_ANO else PERIODO_DO_MES


def _normalizar(texto: str | None) -> str:
    return ' '.join((texto or '').split()).casefold()


def _rotulo_do_beneficio(b: BeneficioEventual) -> str:
    if b.tipo == BeneficioEventual.Tipo.OUTROS and b.tipo_outro:
        return b.tipo_outro
    return dict(BeneficioEventual.Tipo.choices).get(b.tipo, b.tipo)


def _de_beneficio(b: BeneficioEventual, periodo: str) -> dict:
    return {
        'origem': 'beneficio',
        'quando': b.criado_em.isoformat(),
        'unidade': b.unidade.nome if b.unidade_id else 'Unidade não informada',
        'unidade_id': b.unidade_id,
        'o_que': _rotulo_do_beneficio(b),
        'detalhe': b.descricao,
        'periodo': periodo,
    }


def alertas_de_beneficio(cidadao, tipo: str, tipo_outro: str | None = None) -> list[dict]:
    """
    Benefícios do mesmo tipo concedidos a esta pessoa na janela do tipo (o mês, ou
    os últimos 12 meses no auxílio de nascimento), em qualquer unidade. Em "Outros" o que conta é o que foi dado — passagem e urna funerária
    não são o mesmo auxílio —, comparado sem diferença de caixa nem de espaços.
    """
    consulta = (
        BeneficioEventual.vigentes
        .filter(cidadao=cidadao, tipo=tipo, criado_em__gte=inicio_da_janela(tipo))
        .select_related('unidade')
        .order_by('criado_em')
    )
    anteriores = list(consulta)
    if tipo == BeneficioEventual.Tipo.OUTROS:
        procurado = _normalizar(tipo_outro)
        anteriores = [b for b in anteriores if _normalizar(b.tipo_outro) == procurado]
    return [_de_beneficio(b, periodo_do(tipo)) for b in anteriores]


def alertas_para_servico(cidadao, servico, ignorar_caso_id: str | None = None) -> list[dict]:
    """
    O que a recepção precisa saber antes de atender um pedido de auxílio: o que já
    foi concedido a esta pessoa neste mês e os pedidos do mesmo tipo já
    encaminhados à fila de alguma unidade — que talvez ainda nem tenham virado
    benefício.

    Quando o serviço diz o tipo de auxílio que concede e esse tipo vale uma vez por
    ano, entra também o benefício do mesmo tipo concedido nos últimos 12 meses. Só
    o concedido: um pedido que ficou na fila sem virar benefício não trava a
    pessoa por um ano.

    `ignorar_caso_id` é o caso de um encaminhamento entre unidades que a pessoa
    está cumprindo agora: a visita que o originou é o mesmo atendimento, não uma
    repetição dele.
    """
    if servico is None or servico.demanda_id is None or servico.demanda.nome != CATEGORIA_DE_BENEFICIO:
        return []

    inicio = inicio_do_mes()
    tipo = servico.tipo_de_beneficio
    periodo = periodo_do(tipo)
    no_periodo = Q(criado_em__gte=inicio)
    if tipo in TIPOS_DE_UMA_VEZ_POR_ANO:
        no_periodo |= Q(tipo=tipo, criado_em__gte=inicio_da_janela(tipo))
    alertas = [
        _de_beneficio(b, periodo)
        for b in (
            BeneficioEventual.vigentes.filter(no_periodo, cidadao=cidadao)
            .select_related('unidade').order_by('criado_em')
        )
    ]

    nomes_de_servicos_de_beneficio = list(
        Servico.objects.filter(demanda__nome=CATEGORIA_DE_BENEFICIO).values_list('nome', flat=True).distinct()
    )
    visitas = (
        AtendimentoDeRecepcao.objects
        .filter(
            cidadao=cidadao, criado_em__gte=inicio,
            desfecho=AtendimentoDeRecepcao.Desfecho.ENCAMINHADO,
            demanda__in=nomes_de_servicos_de_beneficio,
        )
        .select_related('unidade').order_by('criado_em')
    )
    if ignorar_caso_id:
        visitas = visitas.exclude(caso_id=ignorar_caso_id)
    alertas += [
        {
            'origem': 'atendimento',
            'quando': v.criado_em.isoformat(),
            'unidade': v.unidade.nome,
            'unidade_id': v.unidade_id,
            'o_que': f'Atendimento: {v.demanda}',
            'detalhe': 'Encaminhado para a fila',
            'periodo': periodo,
        }
        for v in visitas
    ]
    return alertas


def exigir_justificativa(alertas: list[dict], justificativa: str | None) -> Response | None:
    """
    `None` quando pode seguir; a resposta de erro quando falta a justificativa.

    Sem repetição, o que foi escrito é ignorado. Com repetição, em branco conta
    como ausente (409, com os avisos para a tela mostrar) e curta demais é um erro
    de preenchimento (400): uma justificativa de uma palavra não explica nada.
    """
    if not alertas:
        return None
    texto = (justificativa or '').strip()
    if not texto:
        return Response({
            'detalhe': f'Esta pessoa já recebeu ou pediu este auxílio {alertas[0]["periodo"]}. '
                       'Para seguir, escreva a justificativa.',
            'exige_justificativa': True,
            'duplicidade': alertas,
        }, status=status.HTTP_409_CONFLICT)
    if len(texto) < MINIMO_DA_JUSTIFICATIVA:
        return Response(
            {'justificativa_duplicidade': f'Explique o motivo em pelo menos {MINIMO_DA_JUSTIFICATIVA} caracteres.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


def justificativa_a_gravar(alertas: list[dict], justificativa: str | None) -> str | None:
    """Só se grava a justificativa quando houve repetição a justificar."""
    return (justificativa or '').strip() or None if alertas else None


def avisar_as_outras_unidades(
    alertas: list[dict], unidade_propria, o_que: str, cidadao, agora, pedido: bool = False,
) -> None:
    """
    As unidades que tinham dado ou recebido o pedido antes ficam sabendo que
    outra unidade repetiu: é a comunicação que faltava. O texto da justificativa
    fica no histórico, não no aviso.
    """
    for unidade_id in {a['unidade_id'] for a in alertas if a['unidade_id']} - {unidade_propria.id}:
        encaminhamentos.avisar(
            unidade_id, Aviso.Tipo.BENEFICIO_REPETIDO, cidadao_id=cidadao.id,
            dados={
                'unidade': unidade_propria.nome, 'o_que': o_que, 'pedido': pedido,
                'periodo': alertas[0]['periodo'],
            },
            agora=agora,
        )
