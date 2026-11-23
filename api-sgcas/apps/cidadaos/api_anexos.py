"""Documentos escaneados do prontuário: enviar, baixar e remover."""

from rest_framework import status
from django.http import FileResponse
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from apps.cidadaos.models import Cidadao
from apps.cidadaos.serializers import (
    NovoAnexoSerializer,
)

from django.utils import timezone

from apps.cidadaos import anexos as arquivos
from apps.contas.permissoes import (
    EquipeDeAtendimento, Supervisao,
)


@api_view(['GET', 'POST'])
@permission_classes([EquipeDeAtendimento])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def anexos(request, cidadao_id: str):
    """Lista e envia anexos do prontuário."""
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    lista = cidadao.anexos or []

    if request.method == 'GET':
        # O caminho no disco não sai daqui: é detalhe interno, e nome de arquivo
        # carrega dado pessoal com frequência.
        return Response([
            {k: v for k, v in a.items() if k not in ('arquivo', 'miniatura')}
            for a in lista
        ])

    campos = NovoAnexoSerializer(data=request.data)
    campos.is_valid(raise_exception=True)
    tipo_documento = campos.validated_data['tipo_documento']

    arquivo = request.FILES.get('file')
    if arquivo is None:
        return Response({'file': 'Envie um arquivo'}, status=status.HTTP_400_BAD_REQUEST)

    try:
        anexo = arquivos.guardar(cidadao_id, arquivo, tipo_documento)
    except arquivos.ErroDeAnexo as erro:
        return Response({'file': str(erro)}, status=status.HTTP_400_BAD_REQUEST)

    cidadao.anexos = [*lista, anexo]
    cidadao.atualizado_em = timezone.now()
    cidadao.save(update_fields=['anexos', 'atualizado_em'])

    return Response(
        {k: v for k, v in anexo.items() if k not in ('arquivo', 'miniatura')},
        status=status.HTTP_201_CREATED,
    )


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def baixar_anexo(request, cidadao_id: str, anexo_id: str):
    """
    Entrega o arquivo. `?miniatura=true` devolve a versão reduzida.

    O acesso passa pela API em vez de servir a pasta diretamente: assim o
    download respeita a permissão e entra na trilha de auditoria — servir o
    diretório deixaria qualquer um com o link ler documento de cidadão.
    """
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    anexo = next((a for a in (cidadao.anexos or []) if a.get('id') == anexo_id), None)
    if anexo is None:
        return Response({'detalhe': 'Anexo não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    quer_miniatura = request.query_params.get('miniatura') == 'true'
    try:
        caminho = arquivos.caminho(cidadao_id, anexo, miniatura=quer_miniatura)
    except arquivos.ErroDeAnexo as erro:
        return Response({'detalhe': str(erro)}, status=status.HTTP_404_NOT_FOUND)

    mime = 'image/jpeg' if quer_miniatura else anexo.get('mime', 'application/octet-stream')
    # O nome vem do tipo do documento: sem isso o FileResponse manda o nome
    # gravado em disco (um UUID), e o cabeçalho vence o atributo `download` da tela.
    return FileResponse(
        caminho.open('rb'), content_type=mime,
        filename=arquivos.nome_para_download(anexo, miniatura=quer_miniatura),
    )


@api_view(['DELETE'])
@permission_classes([Supervisao])
def remover_anexo(request, cidadao_id: str, anexo_id: str):
    """Remover documento do prontuário é ato de supervisão, não de rotina."""
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    lista = cidadao.anexos or []
    anexo = next((a for a in lista if a.get('id') == anexo_id), None)
    if anexo is None:
        return Response({'detalhe': 'Anexo não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    arquivos.remover(cidadao_id, anexo)
    cidadao.anexos = [a for a in lista if a.get('id') != anexo_id]
    cidadao.atualizado_em = timezone.now()
    cidadao.save(update_fields=['anexos', 'atualizado_em'])

    return Response(status=status.HTTP_204_NO_CONTENT)
