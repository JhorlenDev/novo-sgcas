"""DEV-LOGIN: a entrada de desenvolvimento só abre quando deve. Remover junto com ela."""
import os
import subprocess
import sys
from pathlib import Path

from django.test import Client, SimpleTestCase, override_settings

from apps.contas.models import Operador
from testes.base import CenarioBase

LIGADO = override_settings(DEBUG=True, DEV_LOGIN_ENABLED=True)


class TravasDaEntradaDeDesenvolvimento(CenarioBase):
    @override_settings(DEBUG=True, DEV_LOGIN_ENABLED=False)
    def test_desligada_por_padrao(self):
        # É o estado de qualquer ambiente que não pediu o atalho de propósito —
        # fixado aqui para o teste não depender do .env de quem o roda.
        cliente = self.como(self.admin)
        for rota in ('/api/auth/dev', '/api/auth/dev/login?papel=ADMIN'):
            self.assertEqual(cliente.get(rota).status_code, 404, rota)

    @override_settings(DEBUG=False, DEV_LOGIN_ENABLED=True)
    def test_ligada_mas_sem_debug_continua_fechada(self):
        # A view confere de novo, mesmo que alguém contorne a trava do boot.
        cliente = self.como(self.admin)
        self.assertEqual(cliente.get('/api/auth/dev/login?papel=ADMIN').status_code, 404)
        self.assertFalse(Operador.objects.filter(email__endswith='@dev.local').exists())

    @override_settings(DEBUG=True, DEV_LOGIN_ENABLED=False)
    def test_debug_sozinho_nao_basta(self):
        cliente = self.como(self.admin)
        self.assertEqual(cliente.get('/api/auth/dev/login?papel=ADMIN').status_code, 404)


@LIGADO
class EntradaDeDesenvolvimento(CenarioBase):
    def test_entra_com_o_perfil_e_a_unidade_pedidos(self):
        from django.test import Client

        cliente = Client(headers={'host': 'localhost'})
        resposta = cliente.get(f'/api/auth/dev/login?papel=TECNICO&unidade={self.sul.sigla}')
        self.assertEqual(resposta.status_code, 200)

        eu = cliente.get('/api/auth/me')
        self.assertEqual(eu.status_code, 200)
        self.assertEqual(eu.json()['papel'], 'TECNICO')
        self.assertEqual(eu.json()['unidade']['id'], self.sul.id)

    def test_conta_de_teste_nao_tem_vinculo_com_o_keycloak(self):
        self.client.get('/api/auth/dev/login?papel=COORDENADOR', headers={'host': 'localhost'})
        operador = Operador.objects.get(email='dev-coordenador-cras-c@dev.local')
        self.assertIsNone(operador.keycloak_id)
        self.assertEqual(operador.papel, 'COORDENADOR')

    def test_entrar_de_novo_reaproveita_a_conta(self):
        for _ in range(2):
            self.client.get('/api/auth/dev/login?papel=ADMIN', headers={'host': 'localhost'})
        self.assertEqual(Operador.objects.filter(email='dev-admin-cras-c@dev.local').count(), 1)

    def test_o_mesmo_perfil_em_duas_unidades_sao_duas_contas(self):
        # Para testar o que passa de uma unidade à outra (encaminhamento, histórico)
        # é preciso estar nas duas ao mesmo tempo. Com uma conta por perfil, a
        # segunda entrada movia a conta da primeira para a outra unidade.
        cras = Client(headers={'host': 'localhost'})
        creas = Client(headers={'host': 'localhost'})
        cras.get(f'/api/auth/dev/login?papel=COORDENADOR&unidade={self.centro.sigla}')
        creas.get(f'/api/auth/dev/login?papel=COORDENADOR&unidade={self.sul.sigla}')

        self.assertEqual(cras.get('/api/auth/me').json()['unidade']['id'], self.centro.id)
        self.assertEqual(creas.get('/api/auth/me').json()['unidade']['id'], self.sul.id)
        self.assertNotEqual(cras.get('/api/auth/me').json()['id'], creas.get('/api/auth/me').json()['id'])
        self.assertEqual(Operador.objects.filter(email__startswith='dev-coordenador-').count(), 2)

    def test_perfil_desconhecido_e_recusado(self):
        resposta = self.client.get('/api/auth/dev/login?papel=SUPERUSER', headers={'host': 'localhost'})
        self.assertEqual(resposta.status_code, 400)
        self.assertFalse(Operador.objects.filter(email__endswith='@dev.local').exists())

    def test_unidade_desconhecida_e_recusada(self):
        resposta = self.client.get('/api/auth/dev/login?papel=ADMIN&unidade=NAO-EXISTE', headers={'host': 'localhost'})
        self.assertEqual(resposta.status_code, 400)

    def test_perfil_do_formulario_nao_injeta_html(self):
        resposta = self.client.get('/api/auth/dev/login?papel=<script>x</script>', headers={'host': 'localhost'})
        self.assertEqual(resposta.status_code, 400)
        self.assertNotIn(b'<script>x', resposta.content)

    def test_o_papel_continua_valendo_nas_permissoes(self):
        # A conta de teste passa pelas mesmas permissões das reais: recepção
        # não abre prontuário, mesmo entrando pelo atalho.
        from django.test import Client

        cliente = Client(headers={'host': 'localhost'})
        cliente.get('/api/auth/dev/login?papel=RECEPCIONISTA')
        self.assertEqual(cliente.get(f'/api/citizens/{self.cidadao.id}').status_code, 403)


class TravaDoBoot(SimpleTestCase):
    """`settings.py` não pode subir com o atalho ligado fora de DEBUG."""

    RAIZ = Path(__file__).resolve().parent.parent

    def _importar_settings(self, **ambiente):
        return subprocess.run(
            [sys.executable, '-c', 'import sgcas.settings'],
            cwd=self.RAIZ, capture_output=True, text=True,
            env={**os.environ, 'DJANGO_SECRET_KEY': 'x' * 64, **ambiente},
        )

    def test_recusa_subir_ligado_sem_debug(self):
        resultado = self._importar_settings(DEBUG='False', DEV_LOGIN_ENABLED='true')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('DEV_LOGIN_ENABLED', resultado.stderr)

    def test_sobe_normalmente_ligado_com_debug(self):
        resultado = self._importar_settings(DEBUG='True', DEV_LOGIN_ENABLED='true')
        self.assertEqual(resultado.returncode, 0, resultado.stderr)

    def test_sobe_normalmente_em_producao_com_o_atalho_desligado(self):
        resultado = self._importar_settings(DEBUG='False', DEV_LOGIN_ENABLED='false')
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
