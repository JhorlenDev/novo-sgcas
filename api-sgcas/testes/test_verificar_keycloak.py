"""
Comando que confere, de fora, se o Tefé Cidadão está configurado como o SGCAS exige.

Quem implanta não precisa adivinhar o que falta no Keycloak: o comando testa cada exigência
e diz, em português, qual está faltando. Aqui o Keycloak é de mentira, respondendo como o real.
"""
from io import StringIO
from unittest import mock

import requests
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from apps.contas.papeis import PRECEDENCIA

BASE = 'https://sso.teste/realms/prefeitura'
ADMIN = 'https://sso.teste/admin/realms/prefeitura'
RETORNO = 'http://localhost:3000/api/auth/keycloak/callback'
SEGREDO = 'segredo-que-nunca-pode-aparecer'
TOKEN = 'token-que-nunca-pode-aparecer'

CONFIG = dict(
    KEYCLOAK_URL='https://sso.teste', KEYCLOAK_REALM='prefeitura', KEYCLOAK_CLIENT_ID='sgcas-web',
    KEYCLOAK_CLIENT_SECRET=SEGREDO, KEYCLOAK_REDIRECT_URI=RETORNO, FRONTEND_URL='http://localhost:3000',
)


class Resposta:
    def __init__(self, status=200, corpo=None):
        self.status_code = status
        self._corpo = corpo
        self.text = str(corpo)

    def json(self):
        return self._corpo


class KeycloakDeMentira:
    """Responde por caminho. `trocar` troca a resposta de um caminho para simular um defeito."""

    def __init__(self):
        funcoes = [{'name': nome} for nome in ('view-users', 'manage-users', 'view-clients')]
        self.respostas = {
            f'{BASE}/.well-known/openid-configuration': Resposta(200, {
                'issuer': BASE, 'jwks_uri': f'{BASE}/protocol/openid-connect/certs',
            }),
            f'{BASE}/protocol/openid-connect/certs': Resposta(200, {'keys': [{'kid': 'k'}]}),
            f'{BASE}/protocol/openid-connect/auth': Resposta(200, None),
            f'{BASE}/protocol/openid-connect/token': Resposta(200, {'access_token': TOKEN}),
            f'{ADMIN}/clients': Resposta(200, [{'id': 'uuid-do-client'}]),
            f'{ADMIN}/clients/uuid-do-client': Resposta(200, {
                'publicClient': False, 'standardFlowEnabled': True, 'directAccessGrantsEnabled': False,
                'implicitFlowEnabled': False, 'serviceAccountsEnabled': True,
                'redirectUris': [RETORNO],
                'attributes': {'post.logout.redirect.uris': 'http://localhost:3000/login'},
            }),
            f'{ADMIN}/users': Resposta(200, [{'id': 'uuid-da-conta-de-servico'}]),
            f'{ADMIN}/users/uuid-da-conta-de-servico/role-mappings': Resposta(200, {
                'clientMappings': {'realm-management': {'mappings': funcoes}},
            }),
            f'{ADMIN}/clients/uuid-do-client/roles': Resposta(200, [{'name': p} for p in PRECEDENCIA]),
            f'{ADMIN}/clients/uuid-do-client/roles/ADMIN/users': Resposta(200, [{'id': 'um-admin'}]),
        }
        self.chamadas = []

    def trocar(self, caminho, resposta):
        self.respostas[caminho] = resposta

    def _responder(self, url, **opcoes):
        self.chamadas.append((url, opcoes))
        resposta = self.respostas[url]
        if isinstance(resposta, Exception):
            raise resposta
        return resposta

    def get(self, url, **opcoes):
        return self._responder(url, **opcoes)

    def post(self, url, **opcoes):
        return self._responder(url, **opcoes)


@override_settings(**CONFIG)
class VerificarKeycloak(SimpleTestCase):
    def setUp(self):
        self.keycloak = KeycloakDeMentira()
        for metodo in ('get', 'post'):
            patcher = mock.patch.object(requests, metodo, getattr(self.keycloak, metodo))
            patcher.start()
            self.addCleanup(patcher.stop)

    def rodar(self):
        saida = StringIO()
        try:
            call_command('verificar_keycloak', stdout=saida)
        except CommandError as erro:
            return saida.getvalue(), erro
        return saida.getvalue(), None

    def assertFalha(self, trecho):
        saida, erro = self.rodar()
        self.assertIsNotNone(erro, saida)
        self.assertIn(trecho, saida)
        return saida

    def test_tudo_certo_passa_sem_erro(self):
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)
        self.assertNotIn('✘', saida)
        self.assertIn('✔', saida)

    def test_nunca_mostra_o_segredo_nem_o_token(self):
        saida, _ = self.rodar()
        self.assertNotIn(SEGREDO, saida)
        self.assertNotIn(TOKEN, saida)

    def test_segredo_de_exemplo_e_apontado_sem_chamar_o_token(self):
        for exemplo in ('', 'SEGREDO_CLIENTE_AQUI'):
            with self.subTest(exemplo=exemplo), override_settings(KEYCLOAK_CLIENT_SECRET=exemplo):
                self.keycloak.chamadas.clear()
                self.assertFalha('KEYCLOAK_CLIENT_SECRET')
                self.assertFalse([c for c in self.keycloak.chamadas if c[0].endswith('/token')])

    def test_emissor_diferente_e_apontado(self):
        self.keycloak.trocar(f'{BASE}/.well-known/openid-configuration', Resposta(200, {
            'issuer': 'https://outro.endereco/realms/prefeitura',
            'jwks_uri': f'{BASE}/protocol/openid-connect/certs',
        }))
        self.assertFalha('emissor')

    def test_realm_inexistente(self):
        self.keycloak.trocar(f'{BASE}/.well-known/openid-configuration', Resposta(404, None))
        self.assertFalha('realm')

    def test_endereco_de_retorno_recusado(self):
        self.keycloak.trocar(f'{BASE}/protocol/openid-connect/auth', Resposta(400, None))
        saida = self.assertFalha('endereço de retorno')
        self.assertIn(RETORNO, saida)

    def test_segredo_errado(self):
        self.keycloak.trocar(f'{BASE}/protocol/openid-connect/token', Resposta(401, {
            'error': 'unauthorized_client', 'error_description': 'Invalid client or Invalid client credentials',
        }))
        self.assertFalha('segredo')

    def test_conta_de_servico_desligada(self):
        self.keycloak.trocar(f'{BASE}/protocol/openid-connect/token', Resposta(400, {
            'error': 'unauthorized_client',
            'error_description': 'Client not enabled to retrieve service account',
        }))
        self.assertFalha('Service accounts roles')

    def test_sem_view_clients_a_lista_vem_vazia(self):
        self.keycloak.trocar(f'{ADMIN}/clients', Resposta(200, []))
        self.assertFalha('view-clients')

    def test_admin_bloqueado(self):
        self.keycloak.trocar(f'{ADMIN}/clients', Resposta(403, None))
        self.assertFalha('/admin')

    def test_funcao_faltando_na_conta_de_servico(self):
        self.keycloak.trocar(f'{ADMIN}/users/uuid-da-conta-de-servico/role-mappings', Resposta(200, {
            'clientMappings': {'realm-management': {'mappings': [{'name': 'view-users'}, {'name': 'view-clients'}]}},
        }))
        saida = self.assertFalha('manage-users')
        self.assertNotIn('view-users não', saida)

    def test_sem_nenhuma_funcao_de_administracao(self):
        self.keycloak.trocar(f'{ADMIN}/users/uuid-da-conta-de-servico/role-mappings', Resposta(200, {}))
        saida = self.assertFalha('view-users')
        self.assertIn('manage-users', saida)

    def test_sem_view_users_a_conta_de_servico_nao_e_listada(self):
        self.keycloak.trocar(f'{ADMIN}/users', Resposta(403, None))
        self.assertFalha('view-users')

    def test_papeis_faltando_sao_listados_pelo_nome(self):
        self.keycloak.trocar(f'{ADMIN}/clients/uuid-do-client/roles', Resposta(200, [
            {'name': 'ADMIN'}, {'name': 'COORDENADOR'}, {'name': 'TECNICO'},
        ]))
        saida = self.assertFalha('RECEPCIONISTA')
        self.assertIn('VISUALIZADOR', saida)
        linha = next(l for l in saida.splitlines() if 'Faltam papéis' in l)
        for existente in ('ADMIN', 'COORDENADOR', 'TECNICO'):
            self.assertNotIn(existente, linha)

    def test_papel_do_realm_nao_vale_no_lugar_do_papel_do_client(self):
        self.keycloak.trocar(f'{ADMIN}/clients/uuid-do-client/roles', Resposta(200, []))
        self.assertFalha('ADMIN')

    def test_ninguem_com_admin_e_so_aviso(self):
        self.keycloak.trocar(f'{ADMIN}/clients/uuid-do-client/roles/ADMIN/users', Resposta(200, []))
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)
        self.assertIn('ninguém tem o papel ADMIN', saida)

    def test_rede_fora_nao_derruba_o_comando(self):
        self.keycloak.trocar(
            f'{BASE}/.well-known/openid-configuration', requests.ConnectionError('sem rota'),
        )
        saida = self.assertFalha('alcançar')
        self.assertNotIn('Traceback', saida)

    def test_se_o_segredo_falha_nao_tenta_o_admin(self):
        self.keycloak.trocar(f'{BASE}/protocol/openid-connect/token', Resposta(401, {}))
        self.rodar()
        self.assertFalse([c for c in self.keycloak.chamadas if '/admin/' in c[0]])

    def test_realm_admin_vale_por_todas_as_funcoes(self):
        self.keycloak.trocar(f'{ADMIN}/users/uuid-da-conta-de-servico/role-mappings', Resposta(200, {
            'clientMappings': {'realm-management': {'mappings': [{'name': 'realm-admin'}]}},
        }))
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)

    def avisos(self, saida):
        return [linha for linha in saida.splitlines() if linha.lstrip().startswith('!')]

    def detalhes(self, **mudancas):
        base = self.keycloak.respostas[f'{ADMIN}/clients/uuid-do-client'].json()
        self.keycloak.trocar(f'{ADMIN}/clients/uuid-do-client', Resposta(200, {**base, **mudancas}))

    def test_login_com_senha_direta_ligado_e_so_aviso(self):
        self.detalhes(directAccessGrantsEnabled=True)
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)
        self.assertTrue(any('Direct access grants' in a for a in self.avisos(saida)), saida)

    def test_fluxo_implicito_ligado_e_so_aviso(self):
        self.detalhes(implicitFlowEnabled=True)
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)
        self.assertTrue(any('Implicit' in a for a in self.avisos(saida)), saida)

    def test_fluxo_padrao_desligado_e_falha(self):
        self.detalhes(standardFlowEnabled=False)
        self.assertFalha('Standard flow')

    def test_endereco_de_retorno_curinga_e_falha(self):
        self.detalhes(redirectUris=['*'])
        self.assertFalha('qualquer endereço')

    def test_endereco_de_retorno_com_curinga_no_fim_do_caminho_passa(self):
        self.detalhes(redirectUris=['http://localhost:3000/*'])
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)

    def test_endereco_de_saida_nao_autorizado_e_so_aviso(self):
        self.detalhes(attributes={'post.logout.redirect.uris': 'https://outro.site/login'})
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)
        self.assertTrue(any('http://localhost:3000/login' in a for a in self.avisos(saida)), saida)

    def test_endereco_de_saida_igual_ao_de_retorno_com_mais_passa(self):
        self.detalhes(attributes={'post.logout.redirect.uris': '+'}, redirectUris=['http://localhost:3000/*'])
        saida, erro = self.rodar()
        self.assertIsNone(erro, saida)
        self.assertEqual(self.avisos(saida), [])
