from django.utils import timezone
from rest_framework import serializers

from apps.atendimentos.models import (
    AcaoItinerante,
    AtendimentoDeRecepcao,
    BeneficioEventual,
    Caso,
    Encaminhamento,
    SenhaDaFila,
)


class CasoSerializer(serializers.ModelSerializer):
    cidadao_nome = serializers.CharField(source='cidadao.nome', read_only=True)
    unidade_nome = serializers.CharField(source='unidade.nome', read_only=True)
    tecnico_nome = serializers.CharField(source='tecnico.nome', read_only=True, default=None)
    servico_nome = serializers.CharField(source='servico.nome', read_only=True, default=None)
    acao_itinerante_titulo = serializers.SerializerMethodField()
    acao_itinerante_local = serializers.SerializerMethodField()

    class Meta:
        model = Caso
        fields = [
            'id', 'protocolo', 'situacao', 'prioridade', 'descricao',
            'cidadao', 'cidadao_nome', 'unidade', 'unidade_nome',
            'tecnico', 'tecnico_nome', 'servico', 'servico_nome',
            'acao_itinerante', 'acao_itinerante_titulo', 'acao_itinerante_local',
            'aberto_em', 'fechado_em',
        ]

    def get_acao_itinerante_titulo(self, obj):
        if not obj.acao_itinerante_id:
            return None
        acao = AcaoItinerante.vigentes.filter(id=obj.acao_itinerante_id).values('titulo').first()
        return acao['titulo'] if acao else None

    def get_acao_itinerante_local(self, obj):
        if not obj.acao_itinerante_id:
            return None
        acao = AcaoItinerante.vigentes.filter(id=obj.acao_itinerante_id).values('local').first()
        return acao['local'] if acao else None


class SenhaSerializer(serializers.ModelSerializer):
    cidadao_nome = serializers.CharField(source='cidadao.nome', read_only=True)

    class Meta:
        model = SenhaDaFila
        fields = [
            'id', 'senha', 'situacao', 'prioridade', 'servico',
            'cidadao', 'cidadao_nome', 'chamado_em', 'criado_em',
        ]


class AtendimentoDeRecepcaoSerializer(serializers.ModelSerializer):
    cidadao_nome = serializers.CharField(source='cidadao.nome', read_only=True)
    unidade_nome = serializers.CharField(source='unidade.nome', read_only=True)
    atendido_por_nome = serializers.CharField(source='atendido_por.nome', read_only=True)
    caso_protocolo = serializers.CharField(source='caso.protocolo', read_only=True, default=None)
    observacao = serializers.SerializerMethodField()
    local_do_atendimento = serializers.SerializerMethodField()

    class Meta:
        model = AtendimentoDeRecepcao
        fields = [
            'id', 'cidadao', 'cidadao_nome', 'unidade_nome', 'atendido_por_nome',
            'demanda', 'desfecho', 'motivo', 'observacao', 'local_do_atendimento',
            'caso', 'caso_protocolo', 'criado_em',
        ]

    def get_observacao(self, obj):
        if obj.caso_id and obj.caso and obj.caso.descricao:
            return obj.caso.descricao
        return obj.motivo

    def get_local_do_atendimento(self, obj):
        if obj.desfecho == AtendimentoDeRecepcao.Desfecho.FINALIZADO:
            return obj.unidade.nome if obj.unidade_id else 'Recepção'
        if obj.caso_id and obj.caso and obj.caso.unidade_id:
            return obj.caso.unidade.nome
        return obj.unidade.nome if obj.unidade_id else 'Fila'


class BeneficioEventualSerializer(serializers.ModelSerializer):
    cidadao_nome = serializers.CharField(source='cidadao.nome', read_only=True)
    unidade_nome = serializers.CharField(source='unidade.nome', read_only=True, default=None)
    registrado_por_nome = serializers.CharField(source='registrado_por.nome', read_only=True, default=None)
    tipo_rotulo = serializers.SerializerMethodField()

    class Meta:
        model = BeneficioEventual
        fields = [
            'id', 'cidadao', 'cidadao_nome', 'nome_da_pessoa', 'tipo', 'tipo_rotulo',
            'tipo_outro', 'descricao', 'justificativa_duplicidade', 'registrado_por', 'registrado_por_nome',
            'unidade', 'unidade_nome', 'criado_em', 'atualizado_em',
        ]

    def get_tipo_rotulo(self, obj):
        return dict(BeneficioEventual.Tipo.choices).get(obj.tipo, obj.tipo)


class NovoBeneficioEventualSerializer(serializers.Serializer):
    nome_da_pessoa = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    tipo = serializers.ChoiceField(choices=BeneficioEventual.Tipo.choices)
    tipo_outro = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    descricao = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    # Exigida quando o mesmo benefício já foi concedido no mês (ver `duplicidade`).
    justificativa_duplicidade = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, dados):
        if dados['tipo'] == BeneficioEventual.Tipo.OUTROS and not (dados.get('tipo_outro') or '').strip():
            raise serializers.ValidationError({'tipo_outro': 'Informe qual é o tipo do benefício.'})
        return dados


class AcaoItineranteSerializer(serializers.ModelSerializer):
    unidade_nome = serializers.CharField(source='unidade.nome', read_only=True)
    responsavel_nome = serializers.CharField(source='responsavel.nome', read_only=True)

    class Meta:
        model = AcaoItinerante
        fields = [
            'id', 'titulo', 'descricao', 'local', 'data', 'observacoes',
            'unidade', 'unidade_nome', 'responsavel', 'responsavel_nome', 'ativa',
            'participantes', 'cidadaos_atendidos', 'beneficios_concedidos', 'casos_abertos', 'concluida',
        ]


class RegistroDeRecepcaoSerializer(serializers.Serializer):
    """
    O que a recepção envia ao concluir o atendimento no balcão.

    `motivo` é exigido quando se finaliza sem encaminhar: é o que a próxima
    unidade vai ler quando a pessoa aparecer lá.

    A prioridade aqui é a de entrada na fila, e vai até `ALTA` — a senha
    preferencial (prefixo PR), que o atendente do balcão precisa poder dar a
    quem tem direito por lei. `URGENTE` não: dizer que um caso é urgente é
    avaliação técnica, feita por quem atende, e não pelo balcão. Pedido de
    urgência vindo da recepção entra como `NORMAL`, e a triagem repriorize.

    `unidade_destino_id` permite encaminhar já no balcão: a pessoa é cadastrada
    aqui e entra na fila de lá, com os dados prontos, em vez de fazer a viagem
    e recomeçar do zero. O serviço escolhido tem de pertencer à unidade de
    destino — marcar serviço alheio como sendo da própria unidade não é
    permitido.
    """

    cidadao_id = serializers.CharField()
    servico_id = serializers.CharField(help_text='De /institutional/services')
    unidade_destino_id = serializers.CharField(
        required=False, allow_null=True, allow_blank=True,
        help_text='Só quando o atendimento seguirá em outra unidade.',
    )
    observacao = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    desfecho = serializers.ChoiceField(choices=AtendimentoDeRecepcao.Desfecho.choices)
    prioridade = serializers.ChoiceField(choices=Caso.Prioridade.choices, default=Caso.Prioridade.NORMAL)
    motivo = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    servico = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    acao_itinerante_id = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    # A visita cumpre este encaminhamento: é o mesmo caso, com a ficha, na fila do
    # destino — em vez de abrir um segundo caso para a mesma pessoa.
    encaminhamento_id = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    # Exigida quando o pedido repete um auxílio já concedido ou pedido no mês.
    justificativa_duplicidade = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate_prioridade(self, valor):
        # Rebaixa em vez de recusar: a recepção pediu urgência de boa-fé, e
        # derrubar o atendimento por isso faria a pessoa esperar de novo. O
        # caso entra na fila normal e quem atende reprioriza ao ver a situação.
        if valor == Caso.Prioridade.URGENTE:
            return Caso.Prioridade.NORMAL
        return valor

    def validate(self, dados):
        finalizou = dados['desfecho'] == AtendimentoDeRecepcao.Desfecho.FINALIZADO
        if finalizou and not (dados.get('motivo') or '').strip():
            raise serializers.ValidationError({
                'motivo': 'Informe o motivo — ele aparece para a próxima unidade que atender esta pessoa.'
            })
        return dados


class EncaminhamentoSerializer(serializers.ModelSerializer):
    """
    O encaminhamento como os técnicos o veem: tudo, menos a fotografia (`ficha`),
    que vai só no detalhe para não pesar a lista.
    """

    cidadao = serializers.CharField(source='caso.cidadao_id', read_only=True)
    cidadao_nome = serializers.CharField(source='caso.cidadao.nome', read_only=True)
    caso_protocolo = serializers.CharField(source='caso.protocolo', read_only=True)
    categoria_rotulo = serializers.SerializerMethodField()
    urgencia_rotulo = serializers.SerializerMethodField()
    unidade_origem_nome = serializers.CharField(source='unidade_origem.nome', read_only=True, default=None)
    unidade_destino_nome = serializers.CharField(source='unidade_destino.nome', read_only=True, default=None)
    encaminhado_por_nome = serializers.CharField(source='encaminhado_por.nome', read_only=True)
    respondido_por_nome = serializers.CharField(source='respondido_por.nome', read_only=True, default=None)

    class Meta:
        model = Encaminhamento
        fields = [
            'id', 'caso', 'caso_protocolo', 'cidadao', 'cidadao_nome', 'situacao',
            'categoria_do_motivo', 'categoria_rotulo', 'urgencia', 'urgencia_rotulo',
            'motivo', 'resumo_da_situacao', 'documentos_entregues', 'contato_para_retorno',
            'prazo', 'observacoes',
            'unidade_origem', 'unidade_origem_nome', 'unidade_destino', 'unidade_destino_nome',
            'destino_externo', 'encaminhado_por_nome',
            'respondido_por_nome', 'respondido_em', 'resposta', 'chegou_em',
            'concluido_em', 'resultado', 'criado_em',
        ]

    def get_categoria_rotulo(self, obj):
        return dict(Encaminhamento.Categoria.choices).get(obj.categoria_do_motivo, obj.categoria_do_motivo)

    def get_urgencia_rotulo(self, obj):
        return dict(Caso.Prioridade.choices).get(obj.urgencia, obj.urgencia)


class EncaminhamentoDetalheSerializer(EncaminhamentoSerializer):
    class Meta(EncaminhamentoSerializer.Meta):
        fields = EncaminhamentoSerializer.Meta.fields + ['ficha']


class EncaminhamentoResumoSerializer(serializers.ModelSerializer):
    """
    O que a recepção vê: quem, de onde, quando e a categoria do motivo.

    Sem o relato. O que está por trás de um encaminhamento pode falar de
    violência doméstica ou de saúde, e quem atende no balcão precisa saber que a
    pessoa foi encaminhada e por que tipo de motivo — não o que ela viveu. Nem o
    nome de quem encaminhou: a unidade basta.
    """

    cidadao = serializers.CharField(source='caso.cidadao_id', read_only=True)
    cidadao_nome = serializers.CharField(source='caso.cidadao.nome', read_only=True)
    categoria_rotulo = serializers.SerializerMethodField()
    urgencia_rotulo = serializers.SerializerMethodField()
    unidade_origem_nome = serializers.CharField(source='unidade_origem.nome', read_only=True, default=None)
    unidade_destino_nome = serializers.CharField(source='unidade_destino.nome', read_only=True, default=None)

    class Meta:
        model = Encaminhamento
        fields = [
            'id', 'cidadao', 'cidadao_nome', 'situacao',
            'categoria_do_motivo', 'categoria_rotulo', 'urgencia', 'urgencia_rotulo', 'prazo',
            'unidade_origem', 'unidade_origem_nome', 'unidade_destino', 'unidade_destino_nome',
            'destino_externo', 'chegou_em', 'concluido_em', 'criado_em',
        ]

    get_categoria_rotulo = EncaminhamentoSerializer.get_categoria_rotulo
    get_urgencia_rotulo = EncaminhamentoSerializer.get_urgencia_rotulo


class NovoEncaminhamentoSerializer(serializers.Serializer):
    """
    A ficha que o técnico preenche.

    Um destino, e apenas um: interno ou externo. Aceitar os dois deixaria
    ambíguo para onde a pessoa deve ir, e é o tipo de ambiguidade que vira
    encaminhamento perdido.

    Categoria, motivo e resumo da situação são obrigatórios: é o que o destino
    lê no lugar da conversa por papel. O resto ajuda, mas não trava.
    """

    unidade_destino_id = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    destino_externo = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    categoria_do_motivo = serializers.ChoiceField(choices=Encaminhamento.Categoria.choices)
    urgencia = serializers.ChoiceField(choices=Caso.Prioridade.choices, default=Caso.Prioridade.NORMAL)
    motivo = serializers.CharField()
    resumo_da_situacao = serializers.CharField()
    documentos_entregues = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    contato_para_retorno = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    prazo = serializers.DateField(required=False, allow_null=True)
    observacoes = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate_prazo(self, valor):
        if valor is not None and valor < timezone.localdate():
            raise serializers.ValidationError('O prazo não pode estar no passado.')
        return valor

    def validate(self, dados):
        interno = (dados.get('unidade_destino_id') or '').strip()
        externo = (dados.get('destino_externo') or '').strip()
        if bool(interno) == bool(externo):
            raise serializers.ValidationError(
                'Informe a unidade de destino OU o destino externo — um dos dois.'
            )
        return dados


class NovoEncaminhamentoDoCidadaoSerializer(NovoEncaminhamentoSerializer):
    caso_id = serializers.CharField(required=False, allow_null=True, allow_blank=True)


class ConclusaoSerializer(serializers.Serializer):
    relato = serializers.CharField()
    # Só concluir. Encaminhar tem ficha própria: concluir "como encaminhado"
    # encerrava o caso sem criar encaminhamento algum, e a outra unidade nunca
    # ficava sabendo.
    situacao = serializers.ChoiceField(
        choices=[(Caso.Situacao.CONCLUIDO, 'Concluído')],
        default=Caso.Situacao.CONCLUIDO,
    )


class ObservacaoDoCasoSerializer(serializers.Serializer):
    observacao = serializers.CharField()


class NaoCompareceuSerializer(serializers.Serializer):
    motivo = serializers.CharField(required=False, allow_blank=True, allow_null=True)


class NovaAcaoItineranteSerializer(serializers.Serializer):
    titulo = serializers.CharField()
    local = serializers.CharField()
    data = serializers.DateTimeField()
    descricao = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    observacoes = serializers.CharField(required=False, allow_blank=True, allow_null=True)
