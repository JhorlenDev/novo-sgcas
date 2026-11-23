"""Direitos do titular (LGPD, art. 18): exportação, eliminação dos dados pessoais e consentimento de imagem."""
import json

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.cidadaos.models import Cidadao

from django.db import transaction
from django.utils import timezone

from apps.cidadaos import eliminacao
from apps.contas.permissoes import (
    EquipeDeAtendimento, SomenteAdmin,
)
from apps.cidadaos.api_comum import _registrar_auditoria


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def exportar_dados(request, cidadao_id: str):
    """
    Exporta dados pessoais do cidadão em JSON (Art. 18, V — portabilidade).

    O cidadão tem direito de receber seus dados em formato estruturado e
    legível. O endpoint devolve JSON com todos os campos pessoais, incluindo
    histórico de consentimentos.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    dados = {
        'id': cidadao.id,
        'nome': cidadao.nome,
        'cpf': cidadao.cpf,
        'nis': cidadao.nis,
        'rg': cidadao.rg,
        'email': cidadao.email,
        'telefone': cidadao.telefone,
        'endereco': cidadao.endereco,
        'nascimento': cidadao.nascimento.isoformat() if cidadao.nascimento else None,
        'sexo': cidadao.sexo,
        'naturalidade': cidadao.naturalidade,
        'escolaridade': cidadao.escolaridade,
        'identidade_de_genero': cidadao.identidade_de_genero,
        'raca': cidadao.raca,
        'tem_deficiencia': cidadao.tem_deficiencia,
        'estado_civil': cidadao.estado_civil,
        'bairro': cidadao.bairro,
        'cidade': cidadao.cidade,
        'uf': cidadao.uf,
        'cep': cidadao.cep,
        'documentos': cidadao.documentos,
        'endereco_detalhado': cidadao.endereco_detalhado,
        'socioeconomico': cidadao.socioeconomico,
        'membros_da_familia': cidadao.membros_da_familia,
        'observacoes': cidadao.observacoes,
        'consentimentos': {
            'autoriza_imagem': cidadao.autoriza_imagem,
            'imagem_aceita_em': cidadao.imagem_aceita_em.isoformat() if cidadao.imagem_aceita_em else None,
            'imagem_revogada_em': cidadao.imagem_revogada_em.isoformat() if cidadao.imagem_revogada_em else None,
            'consentiu_tefe_cidadao_em': cidadao.consentiu_tefe_cidadao_em.isoformat() if cidadao.consentiu_tefe_cidadao_em else None,
        },
        'criado_em': cidadao.criado_em.isoformat(),
        'atualizado_em': cidadao.atualizado_em.isoformat(),
    }

    _registrar_auditoria(
        request, 'EXPORT', 'cidadao', cidadao.id,
        dados_novos={'acao': 'exportacao_lgpd'},
    )

    response = HttpResponse(
        json.dumps(dados, ensure_ascii=False, indent=2),
        content_type='application/json; charset=utf-8',
    )
    response['Content-Disposition'] = f'attachment; filename="dados_{cidadao.id}.json"'
    return response


@api_view(['DELETE'])
@permission_classes([SomenteAdmin])
@transaction.atomic
def eliminar_dados_pessoais(request, cidadao_id: str):
    """
    Elimina os dados pessoais (Art. 18, VI).

    Apaga o cadastro inteiro, os documentos escaneados (banco e disco) e o nome
    copiado nos benefícios. O registro fica, anônimo, para a integridade das
    referências; os textos livres dos atendimentos ficam sem vínculo com a
    pessoa. Detalhes e a decisão por trás em `apps.cidadaos.eliminacao`.

    Só o administrador: não tem volta (nem pelos arquivos do disco) e vale para
    qualquer unidade, então não fica com a coordenação de uma delas.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    resumo = eliminacao.eliminar(cidadao, timezone.now())

    _registrar_auditoria(
        request, 'ERASURE', 'cidadao', cidadao.id,
        dados_novos={'acao': 'eliminacao_lgpd', **resumo},
    )

    return Response({'mensagem': 'Dados pessoais eliminados com sucesso', **resumo}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
def revogar_consentimento_imagem(request, cidadao_id: str):
    """
    Revoga consentimento de uso de imagem (Art. 18, IX).

    O consentimento de imagem pode ser revogado a qualquer momento. A
    revogação não afeta atendimentos anteriores onde a imagem já foi usada,
    mas impede uso futuro.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    cidadao.autoriza_imagem = False
    cidadao.imagem_revogada_em = timezone.now()
    cidadao.atualizado_em = timezone.now()
    cidadao.save(update_fields=['autoriza_imagem', 'imagem_revogada_em', 'atualizado_em'])

    _registrar_auditoria(
        request, 'CONSENT_REVOKED', 'cidadao', cidadao.id,
        dados_novos={'imagem_revogada_em': str(cidadao.imagem_revogada_em)},
    )

    return Response({'mensagem': 'Consentimento de uso de imagem revogado com sucesso'})


@api_view(['POST'])
@permission_classes([EquipeDeAtendimento])
def registrar_consentimento_imagem(request, cidadao_id: str):
    """
    Registra consentimento de uso de imagem (Art. 8, §6).

    Grava o timestamp do consentimento para demonstrar que foi dado de forma
    válida, livre e informada.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    cidadao.autoriza_imagem = True
    cidadao.imagem_aceita_em = timezone.now()
    cidadao.imagem_revogada_em = None  # Limpa revogação anterior
    cidadao.atualizado_em = timezone.now()
    cidadao.save(update_fields=['autoriza_imagem', 'imagem_aceita_em', 'imagem_revogada_em', 'atualizado_em'])

    _registrar_auditoria(
        request, 'CONSENT_GIVEN', 'cidadao', cidadao.id,
        dados_novos={'imagem_aceita_em': str(cidadao.imagem_aceita_em)},
    )

    return Response({'mensagem': 'Consentimento de uso de imagem registrado com sucesso'})
