"""Cadastro do cidadão: busca, cadastro novo, prontuário, histórico municipal e aviso de repetição."""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos.models import (
    AtendimentoDeRecepcao,
    BeneficioEventual,
    Caso,
    Encaminhamento,
    SenhaDaFila,
)
from apps.atendimentos.serializers import (
    AtendimentoDeRecepcaoSerializer,
    BeneficioEventualSerializer,
    CasoSerializer,
    EncaminhamentoSerializer,
    SenhaSerializer,
)
from apps.atendimentos import duplicidade, historico
from apps.cidadaos.models import Cidadao
from apps.cidadaos.serializers import (
    CidadaoNaListaSerializer,
    CidadaoSerializer,
    EntradaDoHistoricoSerializer,
    NovoCidadaoSerializer,
)
import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.cidadaos import anexos as arquivos
from apps.cidadaos import pre_cadastro
from apps.contas.permissoes import (
    ComunicacaoEntreUnidades, EquipeDeAtendimento, PodeConsultar, Recepcao,
)
from apps.institucional.models import Servico


LIMITE_DA_BUSCA = 50


@api_view(['GET'])
@permission_classes([PodeConsultar])
def buscar(request):
    """
    Busca por nome ou por documento.

    O cadastro do cidadão é municipal: a pessoa circula entre as unidades, e
    quem a recebe precisa encontrá-la. O escopo por unidade vale para o que é
    operacional — fila e casos em andamento —, não para o cadastro.

    Por documento, a busca usa o índice cego: compara HMAC com HMAC, sem
    decifrar nada. Por nome, é comparação direta na coluna em texto.
    """
    termo = (request.query_params.get('busca') or '').strip()
    if not termo:
        recentes = Cidadao.vigentes.order_by('-atualizado_em')[:LIMITE_DA_BUSCA]
        return Response(CidadaoNaListaSerializer(recentes, many=True).data)

    por_documento = Cidadao.vigentes.por_documento(termo)
    if por_documento.exists():
        encontrados = por_documento[:LIMITE_DA_BUSCA]
    else:
        encontrados = Cidadao.vigentes.filter(nome__icontains=termo)[:LIMITE_DA_BUSCA]

    return Response(CidadaoNaListaSerializer(encontrados, many=True).data)


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def detalhar(request, cidadao_id: str):
    """O prontuário completo. Recepção não entra aqui — ver `permissoes`."""
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)
    return Response(CidadaoSerializer(cidadao).data)


@api_view(['GET'])
@permission_classes([PodeConsultar])
def historico_do_cidadao(request, cidadao_id: str):
    """
    Linha do tempo de todas as unidades — o que a recepção consulta antes de
    conceder de novo.

    A recepção alcança este endpoint, ao contrário do prontuário: ela precisa
    saber que houve atendimento, onde e o quê, para decidir. O nome de quem
    atendeu é filtrado dentro do serviço, conforme o papel de quem lê.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    entradas = historico.do_cidadao(cidadao, request.user)
    return Response({
        'cidadao': CidadaoNaListaSerializer(cidadao).data,
        'entradas': EntradaDoHistoricoSerializer(entradas, many=True).data,
    })


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def prontuario(request, cidadao_id: str):
    """Resumo completo do prontuário para a tela de detalhe do cidadão."""
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    casos = (
        Caso.vigentes.filter(cidadao=cidadao)
        .select_related('cidadao', 'unidade', 'tecnico', 'servico')
        .order_by('-aberto_em')[:50]
    )
    atendimentos = (
        AtendimentoDeRecepcao.objects.filter(cidadao=cidadao)
        .select_related('cidadao', 'unidade', 'atendido_por', 'caso', 'caso__unidade')
        .order_by('-criado_em')[:50]
    )
    beneficios = (
        BeneficioEventual.vigentes.filter(cidadao=cidadao)
        .select_related('cidadao', 'unidade', 'registrado_por')
        .order_by('-criado_em')[:50]
    )
    encaminhamentos = (
        Encaminhamento.objects.filter(caso__cidadao=cidadao)
        .select_related('caso__cidadao', 'unidade_origem', 'unidade_destino', 'encaminhado_por', 'respondido_por')
        .order_by('-criado_em')[:50]
    )
    senhas = (
        SenhaDaFila.objects.filter(cidadao=cidadao)
        .select_related('cidadao', 'unidade', 'atendido_por')
        .order_by('-criado_em')[:50]
    )
    entradas = historico.do_cidadao(cidadao, request.user)

    anexos = [
        {k: v for k, v in anexo.items() if k not in ('arquivo', 'miniatura')}
        for anexo in (cidadao.anexos or [])
    ]

    return Response({
        'cidadao': CidadaoSerializer(cidadao).data,
        'historico': EntradaDoHistoricoSerializer(entradas, many=True).data,
        'casos': CasoSerializer(casos, many=True).data,
        'atendimentos_recepcao': AtendimentoDeRecepcaoSerializer(atendimentos, many=True).data,
        'beneficios_eventuais': BeneficioEventualSerializer(beneficios, many=True).data,
        'encaminhamentos': EncaminhamentoSerializer(encaminhamentos, many=True).data,
        'senhas': SenhaSerializer(senhas, many=True).data,
        'anexos': anexos,
        # O catálogo vem da API: a tela não mantém uma segunda lista de tipos.
        'tipos_de_anexo': [
            {'valor': valor, 'rotulo': rotulo} for valor, rotulo in arquivos.TipoDeDocumento.choices
        ],
        'membros_da_familia': cidadao.membros_da_familia or [],
        'socioeconomico': cidadao.socioeconomico or {},
        'documentos': cidadao.documentos or {},
        'endereco_detalhado': cidadao.endereco_detalhado or {},
    })


@api_view(['GET'])
@permission_classes([ComunicacaoEntreUnidades])
def verificar_duplicidade(request, cidadao_id: str):
    """
    O aviso de repetição, antes de enviar: a tela o mostra assim que o serviço (no
    balcão) ou o tipo (no prontuário) é escolhido, em vez de só descobrir ao
    receber o 409.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    servico_id = request.query_params.get('servico_id')
    tipo = request.query_params.get('tipo')
    if servico_id:
        servico = Servico.objects.filter(id=servico_id, ativo=True).select_related('demanda').first()
        if servico is None:
            return Response({'servico_id': 'Serviço não encontrado'}, status=status.HTTP_400_BAD_REQUEST)
        # Cumprindo um encaminhamento desta pessoa, a visita que o originou não é
        # repetição — a prévia tem de responder o que o registro vai responder.
        cumprindo = Encaminhamento.objects.filter(id=request.query_params.get('encaminhamento_id') or '').first()
        alertas = duplicidade.alertas_para_servico(
            cidadao, servico, ignorar_caso_id=cumprindo.caso_id if cumprindo else None,
        )
    elif tipo:
        if tipo not in BeneficioEventual.Tipo.values:
            return Response({'tipo': 'Tipo de benefício inválido'}, status=status.HTTP_400_BAD_REQUEST)
        alertas = duplicidade.alertas_de_beneficio(cidadao, tipo, request.query_params.get('tipo_outro'))
    else:
        return Response({'detalhe': 'Informe servico_id ou tipo.'}, status=status.HTTP_400_BAD_REQUEST)

    return Response({'alertas': alertas, 'exige_justificativa': bool(alertas)})


def _resposta_de_documento_repetido(cidadao: Cidadao):
    """
    409 dizendo qual documento já tem dono, ou `None` se a colisão foi de outra coluna.

    Com a cifragem ligada, CPF e e-mail têm índice único. Sem tratar isso o atendente
    veria um erro 500 e não saberia que a pessoa já está cadastrada.
    """
    for rotulo, coluna in (('CPF', 'cpf_indice'), ('e-mail', 'email_indice')):
        indice = getattr(cidadao, coluna)
        if not indice:
            continue
        existente = Cidadao.objects.filter(**{coluna: indice}).first()
        if existente is None:
            continue
        corpo = {'detalhe': f'Já existe um cadastro com este {rotulo}.'}
        # Cadastro arquivado não é para abrir: só o aviso.
        if existente.excluido_em is None:
            corpo['cidadaoId'] = existente.id
        return Response(corpo, status=status.HTTP_409_CONFLICT)
    return None


@api_view(['POST'])
@permission_classes([Recepcao])
@transaction.atomic
def cadastrar(request):
    """
    Cadastro completo do cidadão, feito no balcão.

    O pré-cadastro no Tefé Cidadão roda depois de gravar e nunca derruba o
    cadastro: se o SSO estiver fora do ar, a pessoa já foi atendida e o registro
    dela existe. O resultado volta na resposta para o atendente saber o que
    dizer — inclusive quando faltou dado para criar a conta.
    """
    dados = NovoCidadaoSerializer(data=request.data)
    dados.is_valid(raise_exception=True)
    d = dict(dados.validated_data)

    quer_acesso = d.pop('criar_acesso_tefe_cidadao', True)
    consentiu = d.pop('consentimento', False)
    acao_id = (d.pop('acao_itinerante_id', None) or '').strip() or None

    agora = timezone.now()
    cidadao = Cidadao(
        id=str(uuid.uuid4()), **d,
        acao_itinerante_id=acao_id,
        consentiu_tefe_cidadao_em=agora if consentiu else None,
        criado_em=agora, atualizado_em=agora,
    )
    try:
        # Em savepoint próprio: a colisão de índice estraga a transação em curso, e a
        # busca do cadastro existente, logo abaixo, precisa de uma transação viva.
        with transaction.atomic():
            cidadao.save(force_insert=True)
    except IntegrityError:
        repetido = _resposta_de_documento_repetido(cidadao)
        if repetido is None:
            raise
        return repetido

    acesso = None
    if quer_acesso:
        operador = request.user
        unidade = operador.unidade.nome_qualificado() if operador.unidade_id else None
        resultado = pre_cadastro.criar(cidadao, unidade, operador.email)
        acesso = {
            'situacao': resultado.situacao,
            'mensagem': resultado.mensagem,
            'faltando': list(resultado.faltando),
        }

    return Response(
        {**CidadaoSerializer(cidadao).data, 'tefeCidadao': acesso},
        status=status.HTTP_201_CREATED,
    )
