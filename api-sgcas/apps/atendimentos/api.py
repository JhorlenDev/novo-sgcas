"""Recepção, fila e atendimento — o fluxo do balcão até a conclusão."""
from __future__ import annotations

import uuid

from django.db import models, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos import duplicidade, encaminhamentos, historico
from apps.atendimentos.relato import acrescentar_ao_relato as _acrescentar_ao_relato
from apps.atendimentos.models import (
    AcaoItinerante,
    AtendimentoDeRecepcao,
    Caso,
    Encaminhamento,
    SenhaDaFila,
)
from apps.atendimentos.serializers import (
    AcaoItineranteSerializer,
    AtendimentoDeRecepcaoSerializer,
    CasoSerializer,
    ConclusaoSerializer,
    EncaminhamentoDetalheSerializer,
    EncaminhamentoResumoSerializer,
    EncaminhamentoSerializer,
    NaoCompareceuSerializer,
    NovaAcaoItineranteSerializer,
    NovoEncaminhamentoSerializer,
    ObservacaoDoCasoSerializer,
    RegistroDeRecepcaoSerializer,
    SenhaSerializer,
)
from apps.cidadaos.models import Cidadao
from apps.institucional.models import Servico, Unidade
from apps.cidadaos.serializers import CidadaoSerializer, EntradaDoHistoricoSerializer
from apps.contas.models import Operador
from apps.contas.escopo import pode_acessar_unidade, resolver_filtro
from apps.contas.permissoes import EquipeDeAtendimento, PodeConsultar, Recepcao


# O que uma ação em campo pode declarar atender: bem acima do real, bem abaixo do que o banco aceita.
LIMITE_DOS_NUMEROS_DA_ACAO = 1_000_000


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


def _caso_encerrado(caso):
    """Resposta 409 se o caso já foi encerrado; `None` se ainda pode mudar de estado."""
    if caso.situacao not in Caso.ENCERRADAS:
        return None
    rotulo = dict(Caso.Situacao.choices).get(caso.situacao, caso.situacao)
    return Response(
        {'detalhe': f'Este caso já foi encerrado ({rotulo}).'},
        status=status.HTTP_409_CONFLICT,
    )


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
