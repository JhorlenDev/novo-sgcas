from rest_framework import serializers

from apps.atendimentos.models import BeneficioEventual
from apps.institucional.models import Coordenacao, Demanda, Servico, Unidade

# Os tipos de auxílio que um serviço pode conceder: os do benefício, menos "Outros",
# que não diz o quê é dado e, portanto, não dá o que comparar no balcão.
TIPOS_DE_AUXILIO = [
    (valor, rotulo) for valor, rotulo in BeneficioEventual.Tipo.choices if valor != BeneficioEventual.Tipo.OUTROS
]


class CoordenacaoSerializer(serializers.ModelSerializer):
    superior = serializers.CharField(source='superior.sigla', read_only=True, default=None)

    class Meta:
        model = Coordenacao
        fields = ['id', 'nome', 'sigla', 'ativa', 'superior']


class UnidadeSerializer(serializers.ModelSerializer):
    coordenacao = serializers.CharField(source='coordenacao.sigla', read_only=True, default=None)
    nome_qualificado = serializers.CharField(read_only=True)

    class Meta:
        model = Unidade
        fields = [
            'id', 'nome', 'sigla', 'tipo', 'endereco', 'telefone',
            'coordenacao', 'nome_qualificado', 'ativa',
        ]


class DemandaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Demanda
        fields = ['id', 'nome', 'categoria', 'ativa']


class ServicoSerializer(serializers.ModelSerializer):
    unidade_nome = serializers.CharField(source='unidade.nome', read_only=True)
    demanda_id = serializers.CharField(read_only=True, default=None)
    demanda_nome = serializers.CharField(source='demanda.nome', read_only=True, default=None)
    tipo_de_beneficio_rotulo = serializers.SerializerMethodField()

    class Meta:
        model = Servico
        fields = [
            'id', 'nome', 'descricao', 'unidade', 'unidade_nome', 'demanda_id', 'demanda_nome',
            'tipo_de_beneficio', 'tipo_de_beneficio_rotulo', 'ativo',
        ]

    def get_tipo_de_beneficio_rotulo(self, servico) -> str | None:
        return dict(TIPOS_DE_AUXILIO).get(servico.tipo_de_beneficio)


class NovaUnidadeSerializer(serializers.ModelSerializer):
    coordenacao_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = Unidade
        fields = ['nome', 'sigla', 'tipo', 'endereco', 'telefone', 'coordenacao_id']


class NovoServicoSerializer(serializers.ModelSerializer):
    unidade_id = serializers.CharField(required=True, allow_blank=False)
    demanda_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    tipo_de_beneficio = serializers.ChoiceField(
        choices=TIPOS_DE_AUXILIO, required=False, allow_blank=True, allow_null=True,
    )

    class Meta:
        model = Servico
        fields = ['nome', 'descricao', 'unidade_id', 'demanda_id', 'tipo_de_beneficio']


class ClassificacaoDoServicoSerializer(serializers.Serializer):
    """O que se pode mudar num serviço já cadastrado: só onde ele se classifica."""

    demanda_id = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    tipo_de_beneficio = serializers.ChoiceField(
        choices=TIPOS_DE_AUXILIO, required=False, allow_blank=True, allow_null=True,
    )
