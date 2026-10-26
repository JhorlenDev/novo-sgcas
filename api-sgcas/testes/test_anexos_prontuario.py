"""
O que a tela de anexos recebe da API.

O nome do arquivo original não é guardado (carrega dado pessoal com frequência),
então a lista precisa de outra coisa para dizer qual documento é qual: o tipo, o
tamanho e a data de envio. E o catálogo de tipos vem da API, para a tela não
manter uma segunda lista que desanda da primeira.
"""
import shutil
import tempfile
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from apps.cidadaos.anexos import TipoDeDocumento
from apps.cidadaos.models import Cidadao
from testes.base import CenarioBase

PDF = b'%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n'


class AnexosNoProntuario(CenarioBase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)

    def enviar(self, tipo='rg_frente'):
        arquivo = SimpleUploadedFile('Documento da Maria.pdf', PDF, content_type='application/pdf')
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            return self.como(self.tecnico).post(
                f'/api/citizens/{self.cidadao.id}/anexos', {'file': arquivo, 'tipo_documento': tipo},
            )

    def prontuario(self):
        return self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}/prontuario').json()

    def test_o_envio_registra_quando_foi_feito(self):
        antes = timezone.now() - timedelta(seconds=5)
        resposta = self.enviar()
        depois = timezone.now() + timedelta(seconds=5)

        enviado_em = parse_datetime(resposta.json()['enviado_em'])
        self.assertIsNotNone(enviado_em)
        self.assertTrue(timezone.is_aware(enviado_em))
        self.assertTrue(antes <= enviado_em <= depois, enviado_em)

    def test_o_prontuario_lista_o_anexo_com_tipo_tamanho_e_data(self):
        self.enviar(tipo='comprovante_residencia')
        anexo = self.prontuario()['anexos'][0]

        self.assertEqual(anexo['tipo_documento'], 'comprovante_residencia')
        self.assertEqual(anexo['mime'], 'application/pdf')
        self.assertEqual(anexo['tamanho'], len(PDF))
        self.assertIn('enviado_em', anexo)
        self.assertIn('id', anexo)

    def test_o_prontuario_nao_expoe_nome_nem_caminho_do_arquivo(self):
        self.enviar()
        anexo = self.prontuario()['anexos'][0]
        for segredo in ('arquivo', 'miniatura', 'nome_original', 'nome_arquivo'):
            self.assertNotIn(segredo, anexo)
        self.assertNotIn('Maria', str(anexo))

    def test_anexo_antigo_sem_data_continua_sendo_listado(self):
        Cidadao.objects.filter(pk=self.cidadao.pk).update(anexos=[
            {'id': 'antigo-1', 'tipo_documento': 'rg_frente', 'arquivo': 'x.jpg', 'miniatura': 'x_min.jpg',
             'mime': 'image/jpeg', 'tamanho': 123},
        ])
        anexos = self.prontuario()['anexos']
        self.assertEqual(len(anexos), 1)
        self.assertNotIn('enviado_em', anexos[0])
        self.assertNotIn('arquivo', anexos[0])

    def test_o_prontuario_traz_o_catalogo_de_tipos_com_rotulos(self):
        tipos = self.prontuario()['tipos_de_anexo']
        self.assertEqual([t['valor'] for t in tipos], list(TipoDeDocumento.values))
        por_valor = {t['valor']: t['rotulo'] for t in tipos}
        self.assertEqual(por_valor['rg_frente'], 'RG (frente)')
        self.assertEqual(por_valor['outro'], 'Outro')
        for t in tipos:
            self.assertTrue(t['rotulo'])

    def test_a_listagem_de_anexos_tambem_traz_a_data(self):
        self.enviar()
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            lista = self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}/anexos').json()
        self.assertIn('enviado_em', lista[0])


class NomeDoDownload(CenarioBase):
    """
    O arquivo baixado tem um nome legível e neutro.

    Sem isso o `FileResponse` do Django manda o nome gravado em disco (um UUID),
    e o cabeçalho do servidor vence o atributo `download` da tela. O nome
    original do arquivo não é guardado (carrega dado pessoal), então o nome vem do
    tipo do documento.
    """

    def setUp(self):
        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)

    def enviar(self, conteudo, tipo_mime, tipo, nome='Documento da Maria Souza'):
        arquivo = SimpleUploadedFile(nome, conteudo, content_type=tipo_mime)
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            self.como(self.tecnico).post(
                f'/api/citizens/{self.cidadao.id}/anexos', {'file': arquivo, 'tipo_documento': tipo},
            )
        return Cidadao.objects.get(id=self.cidadao.id).anexos[-1]

    def baixar(self, anexo, miniatura=False):
        sufixo = '?miniatura=true' if miniatura else ''
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            return self.como(self.tecnico).get(
                f'/api/citizens/{self.cidadao.id}/anexos/{anexo["id"]}{sufixo}',
            )

    def test_pdf_baixa_com_o_nome_do_tipo(self):
        anexo = self.enviar(PDF, 'application/pdf', 'comprovante_residencia')
        self.assertEqual(
            self.baixar(anexo)['Content-Disposition'],
            'inline; filename="comprovante-de-residencia.pdf"',
        )

    def test_imagem_baixa_como_jpg_com_o_nome_do_tipo(self):
        import io

        from PIL import Image

        buffer = io.BytesIO()
        Image.new('RGB', (30, 20), 'white').save(buffer, format='PNG')
        anexo = self.enviar(buffer.getvalue(), 'image/png', 'rg_frente')
        self.assertEqual(self.baixar(anexo)['Content-Disposition'], 'inline; filename="rg-frente.jpg"')

    def test_miniatura_diz_que_e_miniatura(self):
        import io

        from PIL import Image

        buffer = io.BytesIO()
        Image.new('RGB', (30, 20), 'white').save(buffer, format='PNG')
        anexo = self.enviar(buffer.getvalue(), 'image/png', 'rg_frente')
        self.assertEqual(
            self.baixar(anexo, miniatura=True)['Content-Disposition'],
            'inline; filename="rg-frente-miniatura.jpg"',
        )

    def test_o_nome_nao_expoe_o_arquivo_em_disco_nem_o_original(self):
        anexo = self.enviar(PDF, 'application/pdf', 'laudo', nome='Laudo da Maria Souza.pdf')
        cabecalho = self.baixar(anexo)['Content-Disposition']
        self.assertNotIn(anexo['id'], cabecalho)
        self.assertNotIn(anexo['arquivo'], cabecalho)
        self.assertNotIn('Maria', cabecalho)

    def test_tipo_antigo_fora_do_catalogo_nao_quebra_o_nome(self):
        # Anexos de antes do vocabulário fechado podem ter qualquer texto no tipo —
        # inclusive caracteres que não cabem num cabeçalho HTTP.
        anexo = self.enviar(PDF, 'application/pdf', 'outro')
        for tipo_antigo, esperado in (('Foto Antiga!', 'foto-antiga'), ('çãõ"; x=y\r\nX: 1', 'cao-xy-x-1'), ('###', 'documento')):
            with self.subTest(tipo_antigo):
                cidadao = Cidadao.objects.get(id=self.cidadao.id)
                cidadao.anexos = [{**cidadao.anexos[0], 'tipo_documento': tipo_antigo}]
                cidadao.save(update_fields=['anexos'])
                cabecalho = self.baixar(anexo)['Content-Disposition']
                self.assertEqual(cabecalho, f'inline; filename="{esperado}.pdf"')
                self.assertNotIn('\n', cabecalho)
