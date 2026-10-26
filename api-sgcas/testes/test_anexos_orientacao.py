"""
Foto de celular: a orientação é aplicada, não só descartada.

O celular grava a imagem sempre na posição do sensor e anota em EXIF como
girá-la para exibir. O anexo é recomprimido sem metadados (para não vazar a
coordenada de onde foi tirada); se a orientação não for aplicada antes, a
anotação some e a foto fica de lado para sempre — um RG ilegível sem girar a
tela.
"""
import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image

from apps.cidadaos import anexos
from apps.cidadaos.models import Cidadao
from testes.base import CenarioBase

LARGURA, ALTURA, LADO = 64, 32, 12  # marcadores de 12x12 nos cantos do arquivo

# Onde ficam, na foto JÁ CORRIGIDA, o canto superior esquerdo (vermelho) e o
# superior direito (azul) do arquivo armazenado — segundo a tabela do EXIF
# (https://exiftool.org/TagNames/EXIF.html, Orientation):
#   orientação: (canto do vermelho, canto do azul)
ONDE_FICAM = {
    1: ('esq-cima', 'dir-cima'),
    2: ('dir-cima', 'esq-cima'),
    3: ('dir-baixo', 'esq-baixo'),
    4: ('esq-baixo', 'dir-baixo'),
    5: ('esq-cima', 'esq-baixo'),
    6: ('dir-cima', 'dir-baixo'),
    7: ('dir-baixo', 'dir-cima'),
    8: ('esq-baixo', 'esq-cima'),
}
GIRAM_A_FOTO = (5, 6, 7, 8)  # as que trocam largura por altura


def foto_do_celular(orientacao: int, formato='JPEG', extras=None) -> bytes:
    """Arquivo no formato do sensor (paisagem) com a orientação anotada no EXIF."""
    imagem = Image.new('RGB', (LARGURA, ALTURA), 'white')
    imagem.paste((255, 0, 0), (0, 0, LADO, LADO))                   # canto sup. esquerdo
    imagem.paste((0, 0, 255), (LARGURA - LADO, 0, LARGURA, LADO))   # canto sup. direito
    exif = Image.Exif()
    exif[0x0112] = orientacao
    for etiqueta, valor in (extras or {}).items():
        exif[etiqueta] = valor
    buffer = io.BytesIO()
    imagem.save(buffer, format=formato, exif=exif)
    return buffer.getvalue()


def _cor(pixel):
    r, g, b = pixel
    if r > 170 and g < 100 and b < 100:
        return 'vermelho'
    if b > 170 and r < 100 and g < 100:
        return 'azul'
    if min(pixel) > 200:
        return 'branco'
    return f'?{pixel}'


def cor_no_canto(imagem: Image.Image, canto: str) -> str:
    """Cor no centro do marcador de 12x12 que fica no canto pedido."""
    largura, altura = imagem.size
    x = LADO // 2 if canto.startswith('esq') else largura - LADO // 2
    y = LADO // 2 if canto.endswith('cima') else altura - LADO // 2
    return _cor(imagem.getpixel((x, y)))


def abrir(conteudo: bytes) -> Image.Image:
    imagem = Image.open(io.BytesIO(conteudo))
    imagem.load()
    return imagem


class OrientacaoDaFoto(SimpleTestCase):
    def conferir(self, orientacao, principal):
        imagem = abrir(principal)
        esperado = (ALTURA, LARGURA) if orientacao in GIRAM_A_FOTO else (LARGURA, ALTURA)
        self.assertEqual(imagem.size, esperado, f'tamanho com orientação {orientacao}')
        vermelho, azul = ONDE_FICAM[orientacao]
        self.assertEqual(cor_no_canto(imagem, vermelho), 'vermelho', f'orientação {orientacao}: marcador 1')
        self.assertEqual(cor_no_canto(imagem, azul), 'azul', f'orientação {orientacao}: marcador 2')

    def test_as_oito_orientacoes_do_exif_saem_na_posicao_certa(self):
        for orientacao in range(1, 9):
            with self.subTest(orientacao=orientacao):
                principal, _ = anexos._processar_imagem(foto_do_celular(orientacao))
                self.conferir(orientacao, principal)

    def test_a_miniatura_tambem_sai_na_posicao_certa(self):
        for orientacao in (3, 6, 8):
            with self.subTest(orientacao=orientacao):
                _, miniatura = anexos._processar_imagem(foto_do_celular(orientacao))
                self.conferir(orientacao, miniatura)

    def test_vale_tambem_para_png_e_webp(self):
        for formato in ('PNG', 'WEBP'):
            with self.subTest(formato=formato):
                principal, _ = anexos._processar_imagem(foto_do_celular(6, formato=formato))
                self.conferir(6, principal)

    def test_foto_sem_orientacao_nao_e_alterada(self):
        # Escaneamento, captura de tela: não há EXIF e nada deve girar.
        imagem = Image.new('RGB', (LARGURA, ALTURA), 'white')
        imagem.paste((255, 0, 0), (0, 0, LADO, LADO))
        buffer = io.BytesIO()
        imagem.save(buffer, format='PNG')
        principal, _ = anexos._processar_imagem(buffer.getvalue())

        saida = abrir(principal)
        self.assertEqual(saida.size, (LARGURA, ALTURA))
        self.assertEqual(cor_no_canto(saida, 'esq-cima'), 'vermelho')

    def test_a_saida_nao_leva_exif_nem_a_orientacao(self):
        # Os metadados continuam sendo descartados (a coordenada de onde a foto
        # foi tirada). Levar a orientação junto giraria a foto uma segunda vez
        # em qualquer visualizador.
        principal, miniatura = anexos._processar_imagem(
            foto_do_celular(6, extras={0x010F: 'Fabricante do aparelho', 0x0110: 'Modelo X'}),
        )
        for nome, conteudo in (('principal', principal), ('miniatura', miniatura)):
            exif = abrir(conteudo).getexif()
            self.assertEqual(dict(exif), {}, f'EXIF restante na {nome}')

    def test_o_limite_de_dimensoes_continua_valendo(self):
        grande = io.BytesIO()
        exif = Image.Exif()
        exif[0x0112] = 6
        Image.new('1', (9000, 7000)).save(grande, format='PNG', exif=exif)
        with self.assertRaises(anexos.ErroDeAnexo):
            anexos._processar_imagem(grande.getvalue())


class FotoEnviadaPelaApi(CenarioBase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)

    def test_foto_de_celular_enviada_fica_em_pe(self):
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            arquivo = SimpleUploadedFile('IMG_0001.jpg', foto_do_celular(6), content_type='image/jpeg')
            resposta = self.como(self.tecnico).post(
                f'/api/citizens/{self.cidadao.id}/anexos', {'file': arquivo, 'tipo_documento': 'rg_frente'},
            )
            self.assertEqual(resposta.status_code, 201, resposta.content)

            anexo = Cidadao.objects.get(id=self.cidadao.id).anexos[0]
            baixado = self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}/anexos/{anexo["id"]}')
            miniatura = self.como(self.tecnico).get(
                f'/api/citizens/{self.cidadao.id}/anexos/{anexo["id"]}?miniatura=true',
            )

        for resposta_do_arquivo in (baixado, miniatura):
            imagem = abrir(b''.join(resposta_do_arquivo.streaming_content))
            self.assertEqual(imagem.size, (ALTURA, LARGURA))  # paisagem do sensor virou retrato
            self.assertEqual(cor_no_canto(imagem, 'dir-cima'), 'vermelho')
            self.assertEqual(cor_no_canto(imagem, 'dir-baixo'), 'azul')
