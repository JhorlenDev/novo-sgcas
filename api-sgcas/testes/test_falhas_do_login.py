"""
Quando o login falha na conversa com o Tefé Cidadão, a tela diz a causa real.

Antes, toda falha virava `sem-acesso`, com o texto "ainda não tem perfil aprovado":
quem tinha o papel certo achava que faltava permissão, e o defeito (o segredo do
client errado no servidor) só aparecia no log, que só quem tem acesso ao servidor lê.
"""
import json
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import jwt
import requests
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings
from django.http import HttpResponseRedirect
from django.test import Client, SimpleTestCase, TestCase, override_settings

from apps.contas import keycloak, throttle, views

SSO = {'KEYCLOAK_URL': 'https://sso.exemplo', 'KEYCLOAK_REALM': 'prefeitura', 'KEYCLOAK_CLIENT_ID': 'sgcas-web'}
EMISSOR = 'https://sso.exemplo/realms/prefeitura'


def _resposta(status, corpo=None, texto='', cabecalhos=None):
    resposta = requests.Response()
    resposta.status_code = status
    if corpo is not None:
        resposta._content = json.dumps(corpo).encode()
        resposta.headers['Content-Type'] = 'application/json'
    else:
        resposta._content = texto.encode()
    resposta.headers.update(cabecalhos or {})
    return resposta


@override_settings(**SSO)
class RecusaNaTrocaDoCodigo(SimpleTestCase):
    def trocar(self, resposta=None, erro=None):
        with mock.patch.object(keycloak.requests, 'post', return_value=resposta, side_effect=erro):
            with self.assertRaises(keycloak.ErroDoKeycloak) as recusa:
                keycloak.trocar_codigo_por_token('c', 'https://sgcas.exemplo/api/auth/keycloak/callback')
        return recusa.exception

    def test_segredo_errado(self):
        erro = self.trocar(_resposta(401, {
            'error': 'unauthorized_client', 'error_description': 'Invalid client or Invalid client credentials',
        }))
        self.assertEqual((erro.motivo, erro.detalhe), ('sso-segredo', '401-unauthorized_client'))
        self.assertIn('Invalid client credentials', str(erro))

    def test_client_desconhecido_tambem_e_credencial(self):
        erro = self.trocar(_resposta(400, {'error': 'invalid_client'}))
        self.assertEqual(erro.motivo, 'sso-segredo')

    def test_endereco_de_retorno_diferente(self):
        erro = self.trocar(_resposta(400, {'error': 'invalid_grant', 'error_description': 'Incorrect redirect_uri'}))
        self.assertEqual((erro.motivo, erro.detalhe), ('sso-retorno', '400-invalid_grant'))

    def test_codigo_vencido_ou_repetido(self):
        erro = self.trocar(_resposta(400, {'error': 'invalid_grant', 'error_description': 'Code not valid'}))
        self.assertEqual(erro.motivo, 'sso-codigo')

    def test_firewall_no_caminho_e_identificado_pelo_cabecalho(self):
        erro = self.trocar(_resposta(403, texto='<html>blocked</html>', cabecalhos={
            'Content-Type': 'text/html', 'Server': 'cloudflare',
        }))
        self.assertEqual((erro.motivo, erro.detalhe), ('sso-recusado', '403'))
        self.assertIn('Server cloudflare', str(erro))

    def test_keycloak_com_erro_interno(self):
        self.assertEqual(self.trocar(_resposta(502, texto='Bad Gateway')).motivo, 'sso-indisponivel')

    def test_sem_conexao_nao_vira_erro_500(self):
        erro = self.trocar(erro=requests.ConnectionError('sem rota'))
        self.assertEqual((erro.motivo, erro.detalhe), ('sso-indisponivel', 'ConnectionError'))


@override_settings(**SSO)
class DefeitoNoToken(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.chave = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def token(self, **mudancas):
        agora = int(time.time())
        claims = {'iss': EMISSOR, 'aud': 'account', 'sub': 's1', 'iat': agora, 'exp': agora + 300}
        claims.update(mudancas)
        return jwt.encode(claims, self.chave, algorithm='RS256')

    def validar(self, token, chaves=None):
        cliente = chaves or SimpleNamespace(
            get_signing_key_from_jwt=lambda _: SimpleNamespace(key=self.chave.public_key()),
        )
        with mock.patch.object(keycloak, '_cliente_de_chaves', return_value=cliente):
            with self.assertRaises(keycloak.ErroDoKeycloak) as recusa:
                keycloak.validar_token(token)
        return recusa.exception

    def test_token_valido_passa(self):
        cliente = SimpleNamespace(get_signing_key_from_jwt=lambda _: SimpleNamespace(key=self.chave.public_key()))
        with mock.patch.object(keycloak, '_cliente_de_chaves', return_value=cliente):
            self.assertEqual(keycloak.validar_token(self.token())['sub'], 's1')

    def test_chaves_inacessiveis(self):
        def falhar(_):
            raise jwt.PyJWKClientError('Fail to fetch data from the url, err: "HTTP Error 403: Forbidden"')

        erro = self.validar(self.token(), SimpleNamespace(get_signing_key_from_jwt=falhar))
        self.assertEqual((erro.motivo, erro.detalhe), ('sso-chaves', 'PyJWKClientError'))

    def test_relogio_do_servidor_adiantado(self):
        agora = int(time.time())
        erro = self.validar(self.token(iat=agora - 900, exp=agora - 600))
        self.assertEqual((erro.motivo, erro.detalhe), ('sso-relogio', 'ExpiredSignatureError'))

    def test_relogio_do_servidor_atrasado(self):
        agora = int(time.time())
        erro = self.validar(self.token(iat=agora + 600, exp=agora + 900))
        self.assertEqual(erro.motivo, 'sso-relogio')

    def test_emissor_diferente_do_configurado(self):
        erro = self.validar(self.token(iss='http://keycloak:8080/realms/prefeitura'))
        self.assertEqual(erro.motivo, 'sso-emissor')

    def test_sem_a_audiencia_account(self):
        self.assertEqual(self.validar(self.token(aud='outro')).motivo, 'sso-audiencia')

    def test_token_malformado(self):
        self.assertEqual(self.validar('isto.nao.e-um-token').motivo, 'sso-token')


class RetornoAoLogin(TestCase):
    def voltar_do_sso(self, erro):
        navegador = Client(headers={'host': 'localhost'})
        navegador.get('/api/auth/keycloak/login')
        state = navegador.session['kc_state']
        with mock.patch.object(views.keycloak, 'trocar_codigo_por_token', side_effect=erro):
            return navegador.get(f'/api/auth/keycloak/callback?state={state}&code=c')

    def test_a_tela_recebe_a_causa_e_o_detalhe(self):
        with self.assertLogs('apps.contas.views', 'WARNING') as log:
            resposta = self.voltar_do_sso(keycloak.ErroDoKeycloak(
                'O Tefé Cidadão recusou a troca do código: HTTP 401 unauthorized_client',
                motivo='sso-segredo', detalhe='401-unauthorized_client',
            ))
        self.assertTrue(
            resposta['Location'].endswith('/login?erro=sso-segredo&ref=401-unauthorized_client'), resposta['Location'],
        )
        self.assertIn('Erro no login Keycloak: motivo=sso-segredo detalhe=401-unauthorized_client', '\n'.join(log.output))

    def test_sem_detalhe_vai_so_a_causa(self):
        resposta = self.voltar_do_sso(keycloak.ErroDoKeycloak('falhou'))
        self.assertTrue(resposta['Location'].endswith('/login?erro=sso-falha'), resposta['Location'])

    def test_o_log_nao_leva_o_codigo_nem_o_segredo(self):
        with self.settings(KEYCLOAK_CLIENT_SECRET='segredo-que-nao-pode-vazar'), \
                mock.patch.object(keycloak.requests, 'post', return_value=_resposta(401, {'error': 'unauthorized_client'})), \
                self.assertLogs('apps.contas.views', 'WARNING') as log:
            navegador = Client(headers={'host': 'localhost'})
            navegador.get('/api/auth/keycloak/login')
            state = navegador.session['kc_state']
            navegador.get(f'/api/auth/keycloak/callback?state={state}&code=codigo-de-uso-unico')
        saida = '\n'.join(log.output)
        self.assertIn('motivo=sso-segredo', saida)
        self.assertNotIn('segredo-que-nao-pode-vazar', saida)
        self.assertNotIn('codigo-de-uso-unico', saida)


class FalhasContamNoLimiteDeErros(SimpleTestCase):
    def test_cada_causa_conta_como_erro_do_retorno(self):
        # Quem repete retornos forjados continua pagando por erro, qualquer que seja a causa.
        for motivo in keycloak.MOTIVOS_DO_LOGIN:
            resposta = HttpResponseRedirect(f'/login?erro={motivo}&ref=401-x')
            self.assertTrue(throttle._foi_erro_de_pedido(resposta), motivo)


TELA_DE_ENTRADA = Path(settings.BASE_DIR).parent / 'front-sgcas' / 'src' / 'app' / 'login' / 'page.tsx'


class TelaConheceCadaCausa(SimpleTestCase):
    def test_cada_motivo_tem_texto_na_tela_de_entrada(self):
        # Sem texto, a tela não mostraria nada, e a pessoa voltaria a ficar no escuro.
        if not TELA_DE_ENTRADA.exists():
            self.skipTest('front-sgcas fora deste checkout')
        tela = TELA_DE_ENTRADA.read_text(encoding='utf-8')
        faltando = [m for m in sorted(keycloak.MOTIVOS_DO_LOGIN) if f'"{m}":' not in tela]
        self.assertEqual(faltando, [])
