"""
O conteúdo de um anexo é conferido, não só o tipo que o cliente informou.

O `Content-Type` de um upload é escrito por quem envia: aceitá-lo por si só
deixava gravar qualquer coisa como "PDF" — e depois servi-la com esse tipo.
"""
import io
import os
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image

from apps.cidadaos import anexos
from apps.cidadaos.models import Cidadao
from testes.base import CenarioBase

PDF_MINIMO = b'%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'


def _imagem(formato, tamanho=(40, 30), modo='RGB', **opcoes) -> bytes:
    buffer = io.BytesIO()
    Image.new(modo, tamanho, 'white' if modo != '1' else 0).save(buffer, format=formato, **opcoes)
    return buffer.getvalue()


def _arquivo(conteudo: bytes, tipo: str, nome='documento') -> SimpleUploadedFile:
    return SimpleUploadedFile(nome, conteudo, content_type=tipo)


class ConteudoDoAnexo(CenarioBase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)

    def enviar(self, arquivo):
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            return self.como(self.tecnico).post(
                f'/api/citizens/{self.cidadao.id}/anexos',
                {'file': arquivo, 'tipo_documento': 'comprovante'},
            )

    def anexos_do_cidadao(self):
        return Cidadao.objects.get(id=self.cidadao.id).anexos or []

    def arquivos_no_disco(self):
        return [f for _, _, nomes in os.walk(self.pasta) for f in nomes]

    def assertRecusado(self, resposta):
        self.assertEqual(resposta.status_code, 400, resposta.content)
        self.assertIn('file', resposta.json())
        # Recusar não pode deixar rastro: nem metadado, nem arquivo.
        self.assertEqual(self.anexos_do_cidadao(), [])
        self.assertEqual(self.arquivos_no_disco(), [])

    # ─── PDF ───

    def test_pdf_verdadeiro_e_aceito(self):
        resposta = self.enviar(_arquivo(PDF_MINIMO, 'application/pdf'))
        self.assertEqual(resposta.status_code, 201, resposta.content)
        anexo = self.anexos_do_cidadao()[0]
        self.assertEqual(anexo['mime'], 'application/pdf')
        self.assertEqual(anexo['tamanho'], len(PDF_MINIMO))
        self.assertTrue(anexo['arquivo'].endswith('.pdf'))

    def test_html_declarado_como_pdf_e_recusado(self):
        html = b'<html><script>alert(document.cookie)</script></html>'
        self.assertRecusado(self.enviar(_arquivo(html, 'application/pdf')))

    def test_executavel_declarado_como_pdf_e_recusado(self):
        self.assertRecusado(self.enviar(_arquivo(b'MZ\x90\x00' + b'\x00' * 200, 'application/pdf')))

    def test_pdf_truncado_e_recusado(self):
        # Sem o %%EOF o upload foi cortado: o arquivo não abriria.
        self.assertRecusado(self.enviar(_arquivo(PDF_MINIMO[:40], 'application/pdf')))

    def test_pdf_com_pouco_lixo_antes_do_cabecalho_e_aceito(self):
        # A norma admite o cabeçalho em qualquer ponto dos primeiros 1024 bytes.
        resposta = self.enviar(_arquivo(b'\n' * 500 + PDF_MINIMO, 'application/pdf'))
        self.assertEqual(resposta.status_code, 201, resposta.content)

    def test_cabecalho_depois_da_janela_e_recusado(self):
        self.assertRecusado(self.enviar(_arquivo(b'x' * 2000 + PDF_MINIMO, 'application/pdf')))

    def test_pdf_declarado_como_imagem_e_recusado(self):
        self.assertRecusado(self.enviar(_arquivo(PDF_MINIMO, 'image/png')))

    # ─── imagem ───

    def test_jpeg_png_e_webp_verdadeiros_sao_aceitos(self):
        for formato, tipo in (('JPEG', 'image/jpeg'), ('PNG', 'image/png'), ('WEBP', 'image/webp')):
            with self.subTest(formato):
                resposta = self.enviar(_arquivo(_imagem(formato), tipo))
                self.assertEqual(resposta.status_code, 201, resposta.content)

    def test_texto_declarado_como_imagem_e_recusado(self):
        self.assertRecusado(self.enviar(_arquivo(b'isto nao e uma imagem', 'image/jpeg')))

    def test_formatos_fora_da_lista_sao_recusados_mesmo_declarados_como_png(self):
        # O Pillow abre muito mais do que JPEG, PNG e WEBP — GIF, BMP, TIFF, EPS.
        # Só os três aceitos chegam a ser decodificados.
        for formato in ('GIF', 'BMP', 'TIFF'):
            with self.subTest(formato):
                self.assertRecusado(self.enviar(_arquivo(_imagem(formato), 'image/png')))

    def test_imagem_com_dimensoes_absurdas_e_recusada(self):
        # Poucos KB comprimidos, centenas de MB de memória ao decodificar.
        enorme = _imagem('PNG', tamanho=(9000, 7000), modo='1')
        self.assertLess(len(enorme), 1024 * 1024)
        self.assertRecusado(self.enviar(_arquivo(enorme, 'image/png')))

    def test_imagem_no_limite_de_dimensoes_e_aceita(self):
        grande = _imagem('PNG', tamanho=(7000, 7000), modo='1')  # 49 MP
        self.assertEqual(self.enviar(_arquivo(grande, 'image/png')).status_code, 201)

    # ─── geral ───

    def test_arquivo_vazio_e_recusado(self):
        self.assertRecusado(self.enviar(_arquivo(b'', 'application/pdf')))

    def test_tipo_nao_aceito_continua_recusado(self):
        self.assertRecusado(self.enviar(_arquivo(b'MZ', 'application/x-msdownload')))

    def test_limite_de_tamanho_continua_valendo(self):
        with mock_tamanho_maximo(100):
            self.assertRecusado(self.enviar(_arquivo(PDF_MINIMO + b' ' * 200, 'application/pdf')))


class mock_tamanho_maximo:
    """Baixa o limite de 25 MB só durante o teste, sem gravar 25 MB em memória."""

    def __init__(self, novo):
        self.novo = novo

    def __enter__(self):
        self.antigo = anexos.TAMANHO_MAXIMO
        anexos.TAMANHO_MAXIMO = self.novo

    def __exit__(self, *erro):
        anexos.TAMANHO_MAXIMO = self.antigo
