"""
O tipo do documento é um vocabulário fechado.

Era texto livre: qualquer coisa, de qualquer tamanho, ia para o JSON do cidadão
e depois para a tela. Um conjunto fechado também é o que permite filtrar e
contar documentos por tipo depois.
"""
import os
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from apps.cidadaos.anexos import TipoDeDocumento
from apps.cidadaos.models import Cidadao
from testes.base import CenarioBase

PDF = b'%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n'


class TipoDoDocumento(CenarioBase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)

    def enviar(self, **campos):
        arquivo = SimpleUploadedFile('d.pdf', PDF, content_type='application/pdf')
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            return self.como(self.tecnico).post(
                f'/api/citizens/{self.cidadao.id}/anexos', {'file': arquivo, **campos},
            )

    def anexos(self):
        return Cidadao.objects.get(id=self.cidadao.id).anexos or []

    def arquivos_no_disco(self):
        return [f for _, _, nomes in os.walk(self.pasta) for f in nomes]

    def assertRecusado(self, resposta):
        self.assertEqual(resposta.status_code, 400, resposta.content[:300])
        self.assertIn('tipo_documento', resposta.json())
        # Recusar não deixa rastro: nem metadado, nem arquivo.
        self.assertEqual(self.anexos(), [])
        self.assertEqual(self.arquivos_no_disco(), [])

    def test_todo_tipo_do_catalogo_e_aceito(self):
        for tipo in TipoDeDocumento.values:
            with self.subTest(tipo):
                resposta = self.enviar(tipo_documento=tipo)
                self.assertEqual(resposta.status_code, 201, resposta.content[:300])
                self.assertEqual(resposta.json()['tipo_documento'], tipo)

    def test_sem_tipo_vale_outro(self):
        resposta = self.enviar()
        self.assertEqual(resposta.status_code, 201)
        self.assertEqual(self.anexos()[0]['tipo_documento'], 'outro')

    def test_tipo_em_branco_vale_outro(self):
        # Um formulário HTML manda o campo vazio quando nada foi escolhido.
        self.assertEqual(self.enviar(tipo_documento='').status_code, 201)
        self.assertEqual(self.anexos()[0]['tipo_documento'], 'outro')

    def test_tipo_inventado_e_recusado(self):
        self.assertRecusado(self.enviar(tipo_documento='documento_secreto'))

    def test_texto_enorme_e_recusado(self):
        self.assertRecusado(self.enviar(tipo_documento='x' * 100_000))

    def test_html_no_lugar_do_tipo_e_recusado(self):
        self.assertRecusado(self.enviar(tipo_documento='<script>alert(1)</script>'))

    def test_maiusculas_nao_sao_normalizadas_em_silencio(self):
        # O vocabulário é exato: aceitar "RG_FRENTE" criaria um segundo tipo.
        self.assertRecusado(self.enviar(tipo_documento='RG_FRENTE'))

    def test_o_catalogo_tem_o_que_o_balcao_precisa(self):
        # Documentos que a assistência social pede no dia a dia.
        for esperado in ('rg_frente', 'rg_verso', 'cpf', 'comprovante_residencia', 'comprovante_renda', 'laudo', 'outro'):
            self.assertIn(esperado, TipoDeDocumento.values)

    def test_cada_tipo_tem_um_rotulo_legivel(self):
        for tipo in TipoDeDocumento:
            self.assertTrue(tipo.label and tipo.label != tipo.value, tipo)
