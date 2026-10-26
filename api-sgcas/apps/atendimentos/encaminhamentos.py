"""
A ficha de encaminhamento: monta, grava e avisa.

Encaminhar é o ponto em que as unidades conversam. O que a origem sabia sai
junto, numa ficha, para o destino não depender de telefonema nem de papel; e a
unidade de destino é avisada na hora. Este módulo concentra isso para que as duas
portas de entrada — a tela de atendimento e o prontuário — se comportem igual.
"""
from __future__ import annotations

import uuid

from django.utils import timezone

from apps.atendimentos.models import (
    AtendimentoDeRecepcao, Aviso, BeneficioEventual, Caso, Encaminhamento,
)
from apps.atendimentos.relato import acrescentar_ao_relato

ORDEM_DE_URGENCIA = {
    Caso.Prioridade.BAIXA: 0,
    Caso.Prioridade.NORMAL: 1,
    Caso.Prioridade.ALTA: 2,
    Caso.Prioridade.URGENTE: 3,
}


class EncaminhamentoInvalido(Exception):
    """Pedido que não pode ser atendido: carrega o corpo e o status da resposta."""

    def __init__(self, corpo: dict, status: int):
        super().__init__(str(corpo))
        self.corpo = corpo
        self.status = status


def mais_urgente(a: str, b: str) -> str:
    return a if ORDEM_DE_URGENCIA.get(a, 1) >= ORDEM_DE_URGENCIA.get(b, 1) else b


def avisar(unidade_id, tipo, *, encaminhamento=None, cidadao_id=None, dados=None, agora=None) -> Aviso | None:
    """Deixa um aviso para a unidade. Sem unidade (destino externo), não há para quem."""
    if not unidade_id:
        return None
    return Aviso.objects.create(
        id=str(uuid.uuid4()), unidade_id=unidade_id, tipo=tipo,
        encaminhamento=encaminhamento, cidadao_id=cidadao_id, dados=dados or {},
        criado_em=agora or timezone.now(),
    )


def montar_ficha(caso: Caso, agora) -> dict:
    """
    O que a origem sabia no momento de encaminhar: o que a pessoa pediu, o que
    recebeu e o relato até ali. Fotografia, não consulta — o destino lê o que foi
    enviado mesmo que o caso mude depois.

    "O que recebeu" são os benefícios concedidos pela origem desde que o caso
    abriu (ou desde o início de hoje, se o caso é de agora: o que foi dado no
    balcão naquele dia). O que veio de outras unidades está no histórico
    municipal, sempre consultável.
    """
    inicio_do_dia = timezone.localtime(agora).replace(hour=0, minute=0, second=0, microsecond=0)
    desde = min(caso.aberto_em, inicio_do_dia)

    visitas = AtendimentoDeRecepcao.objects.filter(caso=caso).select_related('unidade').order_by('criado_em')
    beneficios = (
        BeneficioEventual.vigentes
        .filter(cidadao_id=caso.cidadao_id, unidade_id=caso.unidade_id, criado_em__gte=desde)
        .select_related('unidade')
        .order_by('criado_em')
    )
    rotulos = dict(BeneficioEventual.Tipo.choices)
    servico = caso.servico

    return {
        'gerada_em': agora.isoformat(),
        'unidade_origem': caso.unidade.nome,
        'protocolo': caso.protocolo,
        'aberto_em': caso.aberto_em.isoformat(),
        'prioridade': caso.prioridade,
        'servico': {
            'nome': servico.nome,
            'categoria': servico.demanda.nome if servico.demanda_id else None,
        } if servico else None,
        'solicitado': [
            {
                'quando': v.criado_em.isoformat(),
                'unidade': v.unidade.nome,
                'demanda': v.demanda,
                'desfecho': v.desfecho,
                'observacao': v.motivo,
            }
            for v in visitas
        ],
        'relato': caso.descricao,
        'beneficios_concedidos': [
            {
                'quando': b.criado_em.isoformat(),
                'unidade': b.unidade.nome if b.unidade_id else None,
                'tipo': b.tipo_outro if b.tipo == BeneficioEventual.Tipo.OUTROS and b.tipo_outro
                else rotulos.get(b.tipo, b.tipo),
                'descricao': b.descricao,
            }
            for b in beneficios
        ],
    }


def _concluir_o_que_chegou_aqui(caso: Caso, operador, agora, adiante_para: str) -> None:
    """
    Se a unidade que agora encaminha tinha recebido este caso por encaminhamento,
    esse encaminhamento termina aqui: a pessoa seguiu para outro lugar. A unidade
    que o enviou é avisada — era a pergunta "em que pé anda o atendimento".
    """
    recebidos = Encaminhamento.objects.select_for_update().filter(
        caso=caso, unidade_destino_id=caso.unidade_id,
        situacao__in=[Encaminhamento.Situacao.PENDENTE, Encaminhamento.Situacao.ACEITO],
    )
    for anterior in recebidos:
        anterior.situacao = Encaminhamento.Situacao.CONCLUIDO
        anterior.concluido_em = agora
        anterior.resultado = f'Encaminhado adiante para {adiante_para}.'
        if anterior.respondido_em is None:
            anterior.respondido_por = operador
            anterior.respondido_em = agora
        anterior.atualizado_em = agora
        anterior.save()
        avisar(
            anterior.unidade_origem_id, Aviso.Tipo.ENCAMINHADO_ADIANTE,
            encaminhamento=anterior, cidadao_id=caso.cidadao_id,
            dados={'unidade': caso.unidade.nome, 'destino': adiante_para}, agora=agora,
        )


def criar(*, caso: Caso, operador, destino, destino_externo: str, dados: dict, agora) -> Encaminhamento:
    """
    Grava o encaminhamento e leva o caso ao destino.

    Valida tudo antes de alterar qualquer coisa: o chamador devolve a resposta de
    erro sem ter deixado nada pela metade. Deve rodar dentro de uma transação e
    com o caso travado (`select_for_update`).

    Destino interno: o caso passa para a unidade de destino e continua aberto —
    quem recebe é quem atende. Destino externo: o caso se encerra na origem, que
    registra para onde a pessoa foi orientada.
    """
    origem = caso.unidade

    if destino is not None and destino.id == caso.unidade_id:
        raise EncaminhamentoInvalido(
            {'unidade_destino_id': 'A unidade de destino é a própria unidade do caso.'}, 400,
        )
    ja_enviado = Encaminhamento.objects.filter(
        caso=caso, unidade_origem_id=caso.unidade_id,
        situacao__in=[Encaminhamento.Situacao.PENDENTE, Encaminhamento.Situacao.ACEITO],
    ).exists()
    if ja_enviado:
        raise EncaminhamentoInvalido(
            {'detalhe': 'Este caso já tem um encaminhamento em aberto a partir desta unidade.'}, 409,
        )

    nome_do_destino = destino.nome if destino else destino_externo

    # Antes de mexer no caso: o que a origem sabia, como estava.
    ficha = montar_ficha(caso, agora)
    _concluir_o_que_chegou_aqui(caso, operador, agora, nome_do_destino)

    encaminhamento = Encaminhamento(
        id=str(uuid.uuid4()), caso=caso, encaminhado_por=operador,
        unidade_origem=origem, unidade_destino=destino, destino_externo=nome_do_destino,
        categoria_do_motivo=dados['categoria_do_motivo'], urgencia=dados['urgencia'],
        motivo=dados['motivo'], resumo_da_situacao=dados['resumo_da_situacao'],
        documentos_entregues=dados.get('documentos_entregues') or None,
        contato_para_retorno=dados.get('contato_para_retorno') or None,
        prazo=dados.get('prazo'), observacoes=dados.get('observacoes') or None,
        ficha=ficha, situacao=Encaminhamento.Situacao.PENDENTE,
        criado_em=agora, atualizado_em=agora,
    )
    encaminhamento.save(force_insert=True)

    rotulo_da_categoria = Encaminhamento.Categoria(dados['categoria_do_motivo']).label
    rotulo_da_urgencia = Caso.Prioridade(dados['urgencia']).label.lower()
    acrescentar_ao_relato(
        caso, operador, agora,
        f'Encaminhado para {nome_do_destino} ({rotulo_da_categoria}, urgência {rotulo_da_urgencia}). '
        f'Motivo: {dados["motivo"]}',
    )

    caso.situacao = Caso.Situacao.ENCAMINHADO
    caso.prioridade = mais_urgente(caso.prioridade, dados['urgencia'])
    caso.atualizado_em = agora
    campos = ['situacao', 'prioridade', 'descricao', 'atualizado_em']
    if destino is not None:
        caso.unidade = destino
        campos.append('unidade')
    else:
        caso.fechado_em = agora
        campos.append('fechado_em')
    caso.save(update_fields=campos)

    if destino is not None:
        avisar(
            destino.id, Aviso.Tipo.ENCAMINHAMENTO_RECEBIDO,
            encaminhamento=encaminhamento, cidadao_id=caso.cidadao_id,
            dados={'origem': origem.nome, 'categoria': rotulo_da_categoria, 'urgencia': dados['urgencia']},
            agora=agora,
        )
    return encaminhamento
