"""
CSRF nas rotas de sessão (sair e reenviar solicitação).

São views comuns do Django, sob `CsrfViewMiddleware`, e o front manda o token no
cabeçalho `X-CSRFToken` lendo o cookie `csrftoken`. Faltava alguém emitir esse
cookie: sem ele a saída respondia 403 e a sessão seguia aberta no servidor.

Os clientes aqui imitam o navegador atrás do proxy do Next: `Origin` é o do
front e `Host` é o da API (o proxy troca o Host pelo do destino).
"""
from urllib.parse import urlparse

from django.conf import settings
from django.test import Client

from apps.contas.autenticacao import CHAVE_OPERADOR
from apps.contas.models import PedidoDeAcesso
from testes.base import CenarioBase

CLAIMS_PENDENTES = {
    'sub': 'kc-pendente-1', 'email': 'pendente@teste.local',
    'preferred_username': 'pendente', 'name': 'Pessoa Pendente',
}


def _origem_do_front() -> str:
    url = urlparse(settings.FRONTEND_URL)
    return f'{url.scheme}://{url.netloc}'


class CsrfNasRotasDeSessao(CenarioBase):
    def _navegador(self, operador=None, origem=None, **sessao):
        cliente = Client(
            enforce_csrf_checks=True,
            headers={'host': 'localhost:8000', 'origin': origem or _origem_do_front()},
        )
        dados = dict(sessao)
        if operador:
            dados[CHAVE_OPERADOR] = operador.id
        if dados:
            sessao_http = cliente.session
            for chave, valor in dados.items():
                sessao_http[chave] = valor
            sessao_http.save()
            cliente.cookies['sessionid'] = sessao_http.session_key
        return cliente

    @staticmethod
    def _token(cliente) -> str:
        return cliente.cookies['csrftoken'].value

    # ─── o cookie chega ao navegador ───

    def test_me_entrega_o_cookie_csrf(self):
        navegador = self._navegador(self.tecnico)
        self.assertEqual(navegador.get('/api/auth/me').status_code, 200)
        self.assertIn('csrftoken', navegador.cookies)

    def test_retorno_do_keycloak_entrega_o_cookie_csrf(self):
        # Quem cai em /waiting-approval não chama /auth/me: o cookie tem de vir
        # do próprio retorno do login, senão "reenviar" nunca funciona.
        navegador = self._navegador()
        resposta = navegador.get('/api/auth/keycloak/callback?state=invalido')
        self.assertEqual(resposta.status_code, 302)
        self.assertIn('csrftoken', navegador.cookies)

    # ─── sair ───

    def test_sair_com_o_token_encerra_a_sessao(self):
        navegador = self._navegador(self.tecnico)
        navegador.get('/api/auth/me')

        resposta = navegador.post('/api/auth/logout', headers={'X-CSRFToken': self._token(navegador)})

        self.assertEqual(resposta.status_code, 200)
        self.assertIn('urlDeLogout', resposta.json())
        # A sessão morreu no servidor, não só no navegador.
        self.assertEqual(navegador.get('/api/auth/me').status_code, 403)

    def test_sair_sem_token_continua_recusado(self):
        navegador = self._navegador(self.tecnico)
        navegador.get('/api/auth/me')
        self.assertEqual(navegador.post('/api/auth/logout').status_code, 403)

    def test_sair_vindo_de_outra_origem_e_recusado(self):
        navegador = self._navegador(self.tecnico)
        navegador.get('/api/auth/me')
        token = self._token(navegador)

        estranho = self._navegador(self.tecnico, origem='https://site-malicioso.example')
        estranho.cookies['csrftoken'] = token
        resposta = estranho.post('/api/auth/logout', headers={'X-CSRFToken': token})

        self.assertEqual(resposta.status_code, 403)

    # ─── reenviar solicitação ───

    def test_reenviar_solicitacao_com_o_token_do_retorno(self):
        navegador = self._navegador(pending_access_claims=CLAIMS_PENDENTES)
        navegador.get('/api/auth/keycloak/callback?state=invalido')

        resposta = navegador.post(
            '/api/auth/access-request/resend', headers={'X-CSRFToken': self._token(navegador)},
        )

        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.assertTrue(PedidoDeAcesso.objects.filter(
            keycloak_id='kc-pendente-1', situacao=PedidoDeAcesso.Situacao.PENDENTE,
        ).exists())

    def test_reenviar_solicitacao_sem_token_continua_recusado(self):
        navegador = self._navegador(pending_access_claims=CLAIMS_PENDENTES)
        self.assertEqual(navegador.post('/api/auth/access-request/resend').status_code, 403)
