"""
Anexos do prontuário — RG, comprovante de residência, laudo.

O arquivo vai para o disco; no banco fica só o metadado, dentro do campo JSON
do cidadão. Guardar o binário no banco inflaria backup e replicação sem ganho.

Três cuidados que a implementação anterior tomava e foram mantidos:

1. **O caminho é reconstruído a partir dos identificadores**, nunca do que o
   cliente enviou. Confiar no nome recebido abriria travessia de diretório —
   um `../../` levaria a escrita para fora da pasta de armazenamento.
2. **O nome no disco é gerado**, não é o original. Nome de arquivo carrega dado
   pessoal com frequência ("RG da Maria.jpg").
3. **Imagem é recomprimida.** Além de economizar espaço, remove metadados EXIF —
   que costumam trazer a coordenada de onde a foto foi tirada. A orientação
   anotada pelo celular é aplicada antes de descartá-los.
4. **O conteúdo é conferido, não só o tipo informado.** O `Content-Type` do
   upload é escrito por quem envia; aceitá-lo sozinho deixava gravar qualquer
   coisa como "PDF" e depois servi-la com esse tipo. O PDF é reconhecido pelo
   cabeçalho e pelo fim do arquivo, e a imagem só é decodificada se for JPEG,
   PNG ou WEBP e de tamanho razoável.
"""
from __future__ import annotations

import io
import logging
import shutil
import uuid
from pathlib import Path

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import slugify
from PIL import Image, ImageOps

class TipoDeDocumento(models.TextChoices):
    """
    O que um anexo do prontuário pode ser. Vocabulário fechado, não texto livre:
    o que ia para o JSON do cidadão era qualquer coisa, de qualquer tamanho, e
    depois aparecia na tela. Fechado, dá para filtrar e contar por tipo.

    Acrescentar um tipo é acrescentar uma linha aqui (e o rótulo na tela).
    Anexos antigos com outro valor continuam sendo lidos; só o envio valida.
    """

    RG_FRENTE = 'rg_frente', 'RG (frente)'
    RG_VERSO = 'rg_verso', 'RG (verso)'
    CPF = 'cpf', 'CPF'
    CERTIDAO_DE_NASCIMENTO = 'certidao_nascimento', 'Certidão de nascimento'
    CERTIDAO_DE_CASAMENTO = 'certidao_casamento', 'Certidão de casamento'
    COMPROVANTE_DE_RESIDENCIA = 'comprovante_residencia', 'Comprovante de residência'
    COMPROVANTE_DE_RENDA = 'comprovante_renda', 'Comprovante de renda'
    CADUNICO = 'cadunico', 'Cadastro Único / NIS'
    LAUDO = 'laudo', 'Laudo ou relatório técnico'
    DECLARACAO = 'declaracao', 'Declaração'
    OUTRO = 'outro', 'Outro'


TIPOS_ACEITOS = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
}
TAMANHO_MAXIMO = 25 * 1024 * 1024
LADO_MAXIMO = 2000
LADO_MINIATURA = 320

# Os únicos formatos de imagem que chegam a ser decodificados. O Pillow abre
# muito mais (GIF, BMP, TIFF, EPS...), e cada decodificador é superfície de
# ataque que um documento de cidadão não precisa.
FORMATOS_DE_IMAGEM = ('JPEG', 'PNG', 'WEBP')

# Uma imagem de poucos KB pode descomprimir em centenas de MB. O limite cobre as
# câmeras de celular atuais (até uns 50 MP) e barra o resto antes de decodificar.
PIXELS_MAXIMOS = 50_000_000

# Pela norma do PDF, o cabeçalho pode vir em qualquer ponto dos primeiros 1024
# bytes e o marcador de fim, nos últimos. A janela do fim é folgada de propósito:
# o que se quer pegar é o upload cortado, não PDF com algum sufixo.
CABECALHO_DO_PDF = b'%PDF-'
JANELA_DO_CABECALHO = 1024
FIM_DO_PDF = b'%%EOF'
JANELA_DO_FIM = 4096


logger = logging.getLogger(__name__)


class ErroDeAnexo(ValueError):
    """Mensagem mostrável ao atendente."""


def _raiz() -> Path:
    return Path(settings.ARMAZENAMENTO_LOCAL)


def _pasta(cidadao_id: str) -> Path:
    # A pasta sai do id do cidadão, que é um UUID gerado por nós — não há como
    # o cliente influenciar o caminho.
    destino = _raiz() / 'cidadaos' / str(uuid.UUID(cidadao_id))
    destino.mkdir(parents=True, exist_ok=True)
    return destino


def _e_pdf(conteudo: bytes) -> bool:
    return (
        CABECALHO_DO_PDF in conteudo[:JANELA_DO_CABECALHO]
        and FIM_DO_PDF in conteudo[-JANELA_DO_FIM:]
    )


def _processar_imagem(conteudo: bytes) -> tuple[bytes, bytes]:
    """Devolve a imagem recomprimida e a miniatura, ambas sem metadados."""
    # `open` só lê o cabeçalho: a checagem de tamanho acontece antes de qualquer
    # decodificação. `formats` faz o Pillow recusar tudo que não esteja na lista.
    with Image.open(io.BytesIO(conteudo), formats=FORMATOS_DE_IMAGEM) as imagem:
        if imagem.width * imagem.height > PIXELS_MAXIMOS:
            raise ErroDeAnexo('Imagem grande demais. Reduza a resolução e envie novamente.')
        # O celular grava a imagem na posição do sensor e anota em EXIF como
        # girá-la. Como os metadados são descartados abaixo, a orientação tem de
        # ser aplicada aqui: sem isso a anotação some e a foto fica de lado para
        # sempre (um RG que só se lê girando a tela).
        imagem = ImageOps.exif_transpose(imagem).convert('RGB')
        imagem.thumbnail((LADO_MAXIMO, LADO_MAXIMO))

        principal = io.BytesIO()
        imagem.save(principal, format='JPEG', quality=85, optimize=True)

        imagem.thumbnail((LADO_MINIATURA, LADO_MINIATURA))
        miniatura = io.BytesIO()
        imagem.save(miniatura, format='JPEG', quality=75, optimize=True)

    return principal.getvalue(), miniatura.getvalue()


def guardar(cidadao_id: str, arquivo, tipo_documento: str) -> dict:
    if arquivo.size > TAMANHO_MAXIMO:
        raise ErroDeAnexo('Arquivo maior que 25 MB')
    if arquivo.size == 0:
        raise ErroDeAnexo('Arquivo vazio')

    tipo = (arquivo.content_type or '').lower()
    if tipo not in TIPOS_ACEITOS:
        raise ErroDeAnexo('Formato não aceito. Envie JPG, PNG, WEBP ou PDF.')

    conteudo = arquivo.read()
    anexo_id = str(uuid.uuid4())

    # Tudo é conferido antes de criar pasta ou gravar qualquer coisa: recusar não
    # pode deixar rastro no disco.
    if tipo == 'application/pdf':
        if not _e_pdf(conteudo):
            raise ErroDeAnexo('O arquivo não é um PDF válido.')
        principal, mini = conteudo, None
        nome, miniatura, tipo = f'{anexo_id}.pdf', None, 'application/pdf'
    else:
        try:
            principal, mini = _processar_imagem(conteudo)
        except ErroDeAnexo:
            raise
        except Exception as erro:
            raise ErroDeAnexo('Não foi possível ler a imagem enviada') from erro
        nome, miniatura, tipo = f'{anexo_id}.jpg', f'{anexo_id}_min.jpg', 'image/jpeg'

    pasta = _pasta(cidadao_id)
    (pasta / nome).write_bytes(principal)
    if mini is not None:
        (pasta / miniatura).write_bytes(mini)

    return {
        'id': anexo_id,
        'tipo_documento': tipo_documento,
        'arquivo': nome,
        'miniatura': miniatura,
        'mime': tipo,
        'tamanho': len(principal),
        # O nome original não é guardado (carrega dado pessoal); a lista da tela
        # distingue os documentos por tipo, tamanho e data de envio.
        'enviado_em': timezone.now().isoformat(),
    }


def nome_para_download(anexo: dict, miniatura: bool = False) -> str:
    """
    Nome legível e neutro para quem baixa o documento: `rg-frente.jpg`.

    Vem do tipo do documento. O nome original do arquivo não é guardado (carrega
    dado pessoal com frequência) e o nome em disco é um UUID. Anexos de antes do
    vocabulário fechado podem ter qualquer texto no tipo; o `slugify` o reduz a
    letras, números e hífens, o que também o mantém inofensivo num cabeçalho HTTP.
    """
    tipo = str(anexo.get('tipo_documento') or '')
    rotulo = dict(TipoDeDocumento.choices).get(tipo, tipo)
    base = slugify(str(rotulo)) or 'documento'
    if miniatura:
        return f'{base}-miniatura.jpg'
    return f'{base}.pdf' if anexo.get('mime') == 'application/pdf' else f'{base}.jpg'


def caminho(cidadao_id: str, anexo: dict, miniatura: bool = False) -> Path:
    """
    Caminho absoluto do anexo, reconstruído dos identificadores.

    O nome do arquivo vem do metadado gravado por nós, e a resolução final é
    conferida contra a pasta do cidadão: mesmo que o metadado fosse adulterado,
    a leitura não escaparia do diretório.
    """
    nome = anexo.get('miniatura') if miniatura else anexo.get('arquivo')
    if not nome:
        raise ErroDeAnexo('Anexo sem arquivo correspondente')

    pasta = _pasta(cidadao_id).resolve()
    destino = (pasta / Path(nome).name).resolve()
    if not destino.is_relative_to(pasta):
        raise ErroDeAnexo('Caminho de anexo inválido')
    if not destino.exists():
        raise ErroDeAnexo('Arquivo não encontrado no armazenamento')
    return destino


def pasta_do_cidadao(cidadao_id: str) -> Path | None:
    """A pasta de anexos do cidadão, sem criá-la. `None` se o id não for UUID."""
    try:
        return _raiz() / 'cidadaos' / str(uuid.UUID(cidadao_id))
    except ValueError:
        return None


def remover_pasta_do_cidadao(cidadao_id: str) -> None:
    """
    Apaga a pasta inteira do cidadão, inclusive arquivo que ficou sem metadado
    (upload interrompido): na eliminação de dados pessoais, o que está no disco
    também é dado pessoal.

    Chamada depois de a transação gravar. Se falhar, o cadastro já foi eliminado
    e não se desfaz; o erro vai ao log com o que apagar à mão — melhor do que
    derrubar uma eliminação que o titular tem direito de ver concluída.
    """
    pasta = pasta_do_cidadao(cidadao_id)
    if pasta is None:
        logger.error('Pasta de anexos não removida: o id %s não é um UUID.', cidadao_id)
        return
    if not pasta.exists():
        return
    try:
        shutil.rmtree(pasta)
    except OSError:
        logger.exception('Não foi possível apagar a pasta de anexos %s; apague-a manualmente.', pasta)


def remover(cidadao_id: str, anexo: dict) -> None:
    for chave in ('arquivo', 'miniatura'):
        nome = anexo.get(chave)
        if not nome:
            continue
        alvo = _pasta(cidadao_id) / Path(nome).name
        alvo.unlink(missing_ok=True)
