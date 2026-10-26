"""
Eliminação de dados pessoais (LGPD, Art. 18, VI).

Elimina tudo que identifica ou descreve a pessoa: o cadastro inteiro, os
documentos escaneados (no banco e no disco) e o nome copiado nos benefícios. O
registro em si permanece, anônimo, para a integridade das referências.

Os textos livres dos atendimentos (relato do caso, motivo da recepção,
observações de encaminhamento, descrição do benefício) ficam: por decisão da
direção, o histórico de atendimento é prestação de contas. Eles continuam
ligados a "Cidadão excluído xxxxxxxx", sem nome, documento ou cadastro. O que o
técnico escreveu dentro do texto não é varrido — se citar o nome da pessoa, o
nome fica no texto.
"""
from __future__ import annotations

from django.db import transaction

from apps.atendimentos.models import BeneficioEventual
from apps.cidadaos import anexos
from apps.cidadaos.models import Cidadao

# Tudo no cadastro que identifica ou descreve a pessoa. Fora da lista ficam: o id,
# as datas de criação, o vínculo com a ação itinerante e o histórico de
# consentimento — a prova de que o consentimento foi dado (Art. 8, §6), que sem
# identidade é inofensiva.
CAMPOS_DE_DADOS_PESSOAIS = (
    'cpf', 'cpf_indice', 'nis', 'nis_indice', 'email', 'email_indice', 'rg', 'telefone', 'endereco',
    'nascimento', 'sexo', 'naturalidade', 'escolaridade', 'identidade_de_genero', 'raca',
    'tem_deficiencia', 'estado_civil', 'bairro', 'cidade', 'uf', 'cep', 'observacoes',
    'documentos', 'endereco_detalhado', 'socioeconomico', 'ingresso', 'membros_da_familia',
    'termo_de_responsabilidade', 'anexos', 'imagem_responsavel', 'situacao_beneficiario',
    'id_local', 'familia_id',
)

PREFIXO_DO_NOME_ANONIMO = 'Cidadão excluído '


def rotulo_anonimo(cidadao: Cidadao) -> str:
    return f'{PREFIXO_DO_NOME_ANONIMO}{cidadao.id[:8]}'


def restos_de_dados(cidadao: Cidadao) -> list[str]:
    """Nomes dos campos de dados pessoais que ainda guardam alguma coisa."""
    return [
        campo for campo in CAMPOS_DE_DADOS_PESSOAIS
        if getattr(cidadao, campo, None) not in (None, '', [], {})
    ]


def pendencias(cidadao: Cidadao) -> list[str]:
    """
    Tudo que falta para a eliminação deste cadastro estar completa: campos, nome
    nos benefícios e arquivos em disco. Vazia quando não falta nada.
    """
    faltando = list(restos_de_dados(cidadao))
    if BeneficioEventual.objects.filter(cidadao=cidadao).exclude(nome_da_pessoa=rotulo_anonimo(cidadao)).exists():
        faltando.append('nome nos benefícios')
    pasta = anexos.pasta_do_cidadao(cidadao.id)
    if pasta is not None and pasta.exists():
        faltando.append('arquivos em disco')
    return faltando


def eliminar(cidadao: Cidadao, agora) -> dict:
    """
    Aplica a eliminação. Idempotente; deve rodar dentro de uma transação.

    Os arquivos só saem do disco depois que a transação gravar (`on_commit`): se
    a gravação falhasse depois de apagá-los, ficaria o metadado apontando para o
    vazio e nenhum dos dois recuperável.
    """
    rotulo = rotulo_anonimo(cidadao)
    anexos_removidos = len(cidadao.anexos or [])

    for campo in CAMPOS_DE_DADOS_PESSOAIS:
        setattr(cidadao, campo, None)
    cidadao.nome = rotulo
    cidadao.ativo = False
    # Mantém a data original ao completar uma eliminação antiga.
    cidadao.excluido_em = cidadao.excluido_em or agora
    cidadao.atualizado_em = agora
    cidadao.save()

    # O nome da pessoa copiado nos benefícios. `objects` inclui os removidos.
    BeneficioEventual.objects.filter(cidadao=cidadao).update(nome_da_pessoa=rotulo)

    cidadao_id = cidadao.id
    transaction.on_commit(lambda: anexos.remover_pasta_do_cidadao(cidadao_id))
    return {'anexos_removidos': anexos_removidos}
