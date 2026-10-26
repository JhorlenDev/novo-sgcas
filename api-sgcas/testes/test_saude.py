"""
/api/health: o que o healthcheck do container consulta.

Precisa responder de dentro do container, em HTTP puro e com o Host que o curl
usa — que em produção não está em ALLOWED_HOSTS —, e dizer a verdade sobre o
banco. A rota protegida que o Compose consultava antes devolvia 403/404 (ou um
redirecionamento que `curl -f` aceita), então o sinal nunca queria dizer nada.
"""
from unittest import mock

from django.db import OperationalError
from django.test import Client, TestCase, override_settings

from apps.auditoria.models import RegistroDeAuditoria


class RespostaDoHealthcheck(TestCase):
    def test_responde_ok_sem_sessao(self):
        resposta = Client().get('/api/health')
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.json(), {'status': 'ok'})

    def test_responde_com_host_que_nao_esta_em_allowed_hosts(self):
        # Dentro do container o curl fala com 127.0.0.1; em produção só o
        # domínio da API está em ALLOWED_HOSTS.
        resposta = Client().get('/api/health', headers={'host': 'um-host-qualquer.exemplo'})
        self.assertEqual(resposta.status_code, 200)

    @override_settings(SECURE_SSL_REDIRECT=True)
    def test_nao_e_redirecionado_para_https(self):
        # O healthcheck é HTTP puro; um 301 aqui faria `curl -f` achar que está
        # tudo bem sem a aplicação ter respondido.
        navegador = Client()
        self.assertEqual(navegador.get('/api/health').status_code, 200)
        self.assertEqual(navegador.get('/api/auth/me').status_code, 301)  # controle: o redirect existe

    def test_head_tambem_responde(self):
        self.assertEqual(Client().head('/api/health').status_code, 200)

    def test_nao_deve_ser_guardado_em_cache(self):
        self.assertIn('no-store', Client().get('/api/health')['Cache-Control'])

    def test_nao_entra_na_trilha_de_auditoria(self):
        for _ in range(3):
            Client().get('/api/health')
        self.assertFalse(RegistroDeAuditoria.objects.exists())

    def test_so_responde_a_leitura(self):
        self.assertNotEqual(Client().post('/api/health').status_code, 200)

    def test_nao_responde_em_caminhos_parecidos(self):
        self.assertNotEqual(Client().get('/api/healthz').status_code, 200)
        self.assertNotEqual(Client().get('/api/health/extra').status_code, 200)


class BancoIndisponivel(TestCase):
    def _sem_banco(self):
        conexao = mock.MagicMock()
        conexao.cursor.side_effect = OperationalError('conexão recusada em 10.0.0.5:5432')
        return mock.patch('apps.comum.saude.connection', conexao)

    def test_responde_503(self):
        with self._sem_banco(), self.assertLogs('apps.comum.saude', level='ERROR'):
            resposta = Client().get('/api/health')
        self.assertEqual(resposta.status_code, 503)
        self.assertEqual(resposta.json(), {'status': 'indisponivel'})

    def test_nao_vaza_o_motivo_da_falha(self):
        # O endpoint não exige login: o erro do banco (host, porta, usuário)
        # vai para o log, não para quem perguntou.
        with self._sem_banco(), self.assertLogs('apps.comum.saude', level='ERROR'):
            corpo = Client().get('/api/health').content.decode()
        self.assertNotIn('10.0.0.5', corpo)
        self.assertNotIn('5432', corpo)
