"""Recepção: o balcão registra a visita, encaminha para a fila ou finaliza ali mesmo."""
from __future__ import annotations

import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos import duplicidade, encaminhamentos
from apps.atendimentos.relato import acrescentar_ao_relato as _acrescentar_ao_relato
from apps.atendimentos.models import (
    AtendimentoDeRecepcao,
    Caso,
    Encaminhamento,
    SenhaDaFila,
)
from apps.atendimentos.serializers import (
    AtendimentoDeRecepcaoSerializer,
    CasoSerializer,
    EncaminhamentoResumoSerializer,
    RegistroDeRecepcaoSerializer,
    SenhaSerializer,
)
from apps.cidadaos.models import Cidadao
from apps.institucional.models import Servico, Unidade
from apps.contas.permissoes import Recepcao


def _protocolo() -> str:
    agora = timezone.localtime(timezone.now())
    return f'{agora:%Y%m%d}-{uuid.uuid4().hex[:6].upper()}'


def _prefixo_da_senha(prioridade: str) -> str:
    return {
        Caso.Prioridade.URGENTE: 'UR',
        Caso.Prioridade.ALTA: 'PR',
        Caso.Prioridade.NORMAL: 'NR',
        Caso.Prioridade.BAIXA: 'BX',
    }.get(prioridade, 'NR')


def _proxima_senha(unidade_id: str, prioridade: str) -> str:
    """
    Próxima senha do dia da unidade, na sequência do prefixo da prioridade.

    Tem de rodar dentro de uma transação. A numeração lê o que já existe e soma
    um, e duas recepções fazendo isso ao mesmo tempo liam o mesmo número e
    geravam a mesma senha — duas pessoas na fila com "NR003". A linha da
    unidade é travada até o fim da transação, então a segunda recepção só lê
    depois que a primeira gravou.

    Parte do maior número já usado, e não da contagem de linhas: se uma senha
    sumir da sequência (correção manual), contar repetiria um número em uso.
    """
    Unidade.objects.select_for_update().only('id').get(pk=unidade_id)

    hoje = timezone.localtime(timezone.now()).date()
    prefixo = _prefixo_da_senha(prioridade)
    usadas = SenhaDaFila.objects.filter(
        unidade_id=unidade_id,
        criado_em__date=hoje,
        senha__startswith=prefixo,
    ).values_list('senha', flat=True)
    numeros = (
        int(senha[len(prefixo):]) for senha in usadas if senha[len(prefixo):].isdigit()
    )
    return f'{prefixo}{max(numeros, default=0) + 1:03d}'


def _encaminhamento_a_cumprir(d, cidadao, destino_id):
    """
    O encaminhamento que esta visita cumpre, validado e travado — ou a resposta de
    erro. Devolve (encaminhamento, caso, None) ou (None, None, resposta).
    """
    def recusa(campo, mensagem, codigo=status.HTTP_400_BAD_REQUEST):
        return None, None, Response({campo: mensagem}, status=codigo)

    if d['desfecho'] != AtendimentoDeRecepcao.Desfecho.ENCAMINHADO:
        return recusa('encaminhamento_id', 'Para cumprir um encaminhamento, encaminhe a pessoa à fila.')

    enc = Encaminhamento.objects.select_for_update().filter(id=d['encaminhamento_id']).first()
    if enc is None:
        return recusa('encaminhamento_id', 'Encaminhamento não encontrado.')

    caso = Caso.objects.select_for_update().get(pk=enc.caso_id)
    if caso.cidadao_id != cidadao.id:
        return recusa('encaminhamento_id', 'Este encaminhamento é de outra pessoa.')
    if enc.unidade_destino_id != destino_id:
        return recusa('encaminhamento_id', 'Este encaminhamento é para outra unidade.')
    if enc.situacao not in encaminhamentos.ABERTOS:
        rotulo = dict(Encaminhamento.Situacao.choices).get(enc.situacao, enc.situacao).lower()
        return recusa('encaminhamento_id', f'Este encaminhamento já está {rotulo}.', status.HTTP_409_CONFLICT)
    if enc.chegou_em is not None:
        return recusa('encaminhamento_id', 'A chegada desta pessoa já foi registrada.', status.HTTP_409_CONFLICT)
    if caso.unidade_id != destino_id or caso.situacao in Caso.ENCERRADAS:
        return recusa(
            'encaminhamento_id', 'O caso deste encaminhamento não está mais com esta unidade ou já foi encerrado.',
            status.HTTP_409_CONFLICT,
        )
    return enc, caso, None


@api_view(['POST'])
@permission_classes([Recepcao])
@transaction.atomic
def registrar_recepcao(request):
    """
    Conclui o atendimento de balcão: encaminha para a fila ou finaliza aqui.

    Os dois caminhos geram registro. Finalizar sem registrar o motivo faria a
    pessoa refazer o mesmo pedido em outra unidade sem que ninguém soubesse do
    primeiro — que é justamente o problema que o histórico municipal resolve.
    """
    dados = RegistroDeRecepcaoSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    d = dados.validated_data

    cidadao = Cidadao.vigentes.filter(id=d['cidadao_id']).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    servico = (
        Servico.objects.filter(id=d['servico_id'], ativo=True)
        .select_related('unidade', 'demanda').first()
    )
    if servico is None:
        return Response({'servico_id': 'Serviço não encontrado'},
                        status=status.HTTP_400_BAD_REQUEST)

    operador = request.user
    if operador.unidade_id is None:
        return Response(
            {'detalhe': 'Seu usuário não tem unidade de lotação definida. Procure o administrador.'},
            status=status.HTTP_409_CONFLICT,
        )

    # Onde o atendimento vai acontecer: a própria unidade, ou outra quando a
    # recepção encaminha de imediato.
    destino_id = (d.get('unidade_destino_id') or '').strip() or operador.unidade_id

    # A recepção pode *ver* os serviços de outra unidade — é assim que descobre
    # para onde mandar alguém. O que não pode é marcar serviço alheio como
    # atendimento da própria unidade: o serviço tem de pertencer ao destino.
    if servico.unidade_id != destino_id:
        return Response(
            {'servico_id': f'O serviço "{servico.nome}" é ofertado pelo '
                           f'{servico.unidade.nome}. Selecione essa unidade como destino '
                           f'ou escolha um serviço da sua unidade.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Valida antes de alterar qualquer coisa: a resposta de erro não pode deixar
    # nada pela metade.
    encaminhamento = None
    caso_encaminhado = None
    if d.get('encaminhamento_id'):
        encaminhamento, caso_encaminhado, erro = _encaminhamento_a_cumprir(d, cidadao, destino_id)
        if erro is not None:
            return erro

    # Repetir um auxílio já concedido ou pedido no mês exige justificativa. Negar
    # no balcão (FINALIZADO) é o certo e nunca exige. A pessoa é travada para que
    # dois balcões simultâneos não conferam o histórico antes de qualquer um gravar.
    alertas = []
    if d['desfecho'] == AtendimentoDeRecepcao.Desfecho.ENCAMINHADO:
        Cidadao.objects.select_for_update().filter(pk=cidadao.pk).first()
        alertas = duplicidade.alertas_para_servico(
            cidadao, servico, ignorar_caso_id=caso_encaminhado.id if caso_encaminhado else None,
        )
        if (recusa := duplicidade.exigir_justificativa(alertas, d.get('justificativa_duplicidade'))) is not None:
            return recusa

    agora = timezone.now()
    caso = None
    senha = None

    if d['desfecho'] == AtendimentoDeRecepcao.Desfecho.ENCAMINHADO:
        prioridade = d.get('prioridade') or Caso.Prioridade.NORMAL

        if encaminhamento is not None:
            # A pessoa chegou: é o mesmo caso, com a ficha, agora na fila deste
            # destino. A urgência é a que o técnico da origem definiu (a recepção
            # não a rebaixa: é avaliação técnica).
            caso = caso_encaminhado
            prioridade = encaminhamentos.mais_urgente(prioridade, encaminhamento.urgencia)
            origem = encaminhamento.unidade_origem.nome if encaminhamento.unidade_origem_id else 'outra unidade'
            nota = f'Chegou a {servico.unidade.nome}, encaminhado de {origem}.'
            if d.get('observacao'):
                nota += f' {d["observacao"]}'
            _acrescentar_ao_relato(caso, operador, agora, nota)
            caso.situacao = Caso.Situacao.EM_TRIAGEM
            caso.prioridade = prioridade
            caso.servico = servico
            caso.demanda_id = servico.demanda_id
            caso.atualizado_em = agora
            caso.save(update_fields=[
                'situacao', 'prioridade', 'servico', 'demanda_id', 'descricao', 'atualizado_em',
            ])
        else:
            caso = Caso(
                id=str(uuid.uuid4()), protocolo=_protocolo(),
                situacao=Caso.Situacao.EM_TRIAGEM, prioridade=prioridade,
                descricao=d.get('observacao') or servico.nome, cidadao=cidadao,
                unidade_id=destino_id, servico=servico,
                demanda_id=servico.demanda_id,
                acao_itinerante_id=d.get('acao_itinerante_id') or None,
                aberto_em=agora, criado_em=agora, atualizado_em=agora,
            )
            caso.save(force_insert=True)

        senha = SenhaDaFila(
            id=str(uuid.uuid4()), senha=_proxima_senha(destino_id, prioridade),
            cidadao=cidadao, unidade_id=destino_id, caso=caso,
            prioridade=prioridade, situacao=SenhaDaFila.Situacao.AGUARDANDO,
            servico=servico.nome,
            criado_em=agora, atualizado_em=agora,
        )
        senha.save(force_insert=True)

    AtendimentoDeRecepcao(
        id=str(uuid.uuid4()), cidadao=cidadao, unidade_id=operador.unidade_id,
        atendido_por=operador, demanda=servico.nome, desfecho=d['desfecho'],
        motivo=d.get('motivo') or None, caso=caso, encaminhamento=encaminhamento,
        justificativa_duplicidade=duplicidade.justificativa_a_gravar(alertas, d.get('justificativa_duplicidade')),
        acao_itinerante_id=d.get('acao_itinerante_id') or None,
    ).save(force_insert=True)
    if alertas:
        duplicidade.avisar_as_outras_unidades(alertas, operador.unidade, servico.nome, cidadao, agora, pedido=True)

    if encaminhamento is not None:
        encaminhamentos.registrar_chegada(encaminhamento, operador, agora)

    return Response({
        'desfecho': d['desfecho'],
        'caso': CasoSerializer(caso).data if caso else None,
        'senha': SenhaSerializer(senha).data if senha else None,
        'encaminhamento': EncaminhamentoResumoSerializer(encaminhamento).data if encaminhamento else None,
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([Recepcao])
def atendimentos_da_recepcao(request):
    """Últimos registros feitos pela recepção logada."""
    consulta = (
        AtendimentoDeRecepcao.objects.filter(atendido_por=request.user)
        .select_related('cidadao', 'unidade', 'atendido_por', 'caso', 'caso__unidade')[:20]
    )
    return Response(AtendimentoDeRecepcaoSerializer(consulta, many=True).data)


@api_view(['GET'])
@permission_classes([Recepcao])
def painel_da_recepcao(request):
    """Resumo do balcão no dia: volume, fila e últimos registros."""
    hoje = timezone.localtime(timezone.now()).date()
    unidade_id = request.user.unidade_id

    atendimentos_hoje = AtendimentoDeRecepcao.objects.filter(
        atendido_por=request.user, criado_em__date=hoje,
    )
    fila_da_unidade = SenhaDaFila.objects.filter(unidade_id=unidade_id) if unidade_id else SenhaDaFila.objects.none()
    ultimos = (
        AtendimentoDeRecepcao.objects.filter(atendido_por=request.user)
        .select_related('cidadao', 'unidade', 'atendido_por', 'caso', 'caso__unidade')[:8]
    )

    return Response({
        'atendimentos_hoje': atendimentos_hoje.count(),
        'finalizados_no_balcao': atendimentos_hoje.filter(
            desfecho=AtendimentoDeRecepcao.Desfecho.FINALIZADO
        ).count(),
        'encaminhados_para_fila': atendimentos_hoje.filter(
            desfecho=AtendimentoDeRecepcao.Desfecho.ENCAMINHADO
        ).count(),
        'aguardando_na_fila': fila_da_unidade.filter(
            situacao=SenhaDaFila.Situacao.AGUARDANDO
        ).count(),
        'em_atendimento': fila_da_unidade.filter(
            situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO
        ).count(),
        'ultimos_atendimentos': AtendimentoDeRecepcaoSerializer(ultimos, many=True).data,
    })
