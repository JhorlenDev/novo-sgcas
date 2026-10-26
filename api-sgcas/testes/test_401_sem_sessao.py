"""
Sem sessão é 401; sem permissão é 403.

Eram os dois 403, porque a autenticação por sessão não declarava o cabeçalho
`WWW-Authenticate` (o DRF só responde 401 quando ele existe). O front só manda a
pessoa ao login quando recebe 401: com 403, a sessão que expirava no meio do
uso deixava a tela cheia de erros em vez de levar ao login.
"""
import uuid

from django.test import Client
from django.utils import timezone

from apps.contas.autenticacao import CHAVE_OPERADOR
from apps.contas.models import Operador
from testes.base import CenarioBase

ROTAS_PROTEGIDAS = (
    '/api/auth/me',
    '/api/citizens/?busca=x',
    '/api/queues/',
    '/api/cases/',
    '/api/institutional/units',
    '/api/users/',
    '/api/access-requests/',
    '/api/auditoria/',
)


class SemSessao(CenarioBase):
    def test_toda_rota_protegida_responde_401_sem_sessao(self):
        anonimo = Client(headers={'host': 'localhost'})
        for rota in ROTAS_PROTEGIDAS:
            with self.subTest(rota):
                self.assertEqual(anonimo.get(rota).status_code, 401)

    def test_escrita_sem_sessao_tambem_e_401(self):
        anonimo = Client(headers={'host': 'localhost'})
        resposta = anonimo.post('/api/reception/atendimento', {}, content_type='application/json')
        self.assertEqual(resposta.status_code, 401)

    def test_resposta_traz_o_cabecalho_e_a_mensagem(self):
        resposta = Client(headers={'host': 'localhost'}).get('/api/auth/me')
        self.assertEqual(resposta['WWW-Authenticate'], 'Session')
        self.assertIn('detail', resposta.json())

    def test_o_cabecalho_nao_faz_o_navegador_pedir_senha(self):
        # Só os esquemas Basic e Digest abrem a janela de usuário e senha;
        # "Session" é esquema próprio e passa em silêncio.
        resposta = Client(headers={'host': 'localhost'}).get('/api/auth/me')
        esquema = resposta['WWW-Authenticate'].split()[0].lower()
        self.assertNotIn(esquema, ('basic', 'digest', 'negotiate', 'ntlm'))


class SessaoInvalida(CenarioBase):
    def test_operador_desativado_enquanto_logado_e_401(self):
        # Perdeu o acesso: precisa ser levado ao login, não ver erro de permissão.
        cliente = self.como(self.inativo)
        self.assertEqual(cliente.get('/api/auth/me').status_code, 401)

    def test_operador_removido_enquanto_logado_e_401_e_a_sessao_morre(self):
        cliente = self.como(self.tecnico)
        self.assertEqual(cliente.get('/api/auth/me').status_code, 200)
        Operador.objects.filter(pk=self.tecnico.pk).update(excluido_em=timezone.now())

        self.assertEqual(cliente.get('/api/auth/me').status_code, 401)
        self.assertNotIn(CHAVE_OPERADOR, cliente.session)

    def test_sessao_apontando_para_operador_inexistente_e_401(self):
        cliente = Client(headers={'host': 'localhost'})
        sessao = cliente.session
        sessao[CHAVE_OPERADOR] = str(uuid.uuid4())
        sessao.save()
        cliente.cookies['sessionid'] = sessao.session_key
        self.assertEqual(cliente.get('/api/auth/me').status_code, 401)


class SemPermissao(CenarioBase):
    def test_logado_sem_permissao_continua_sendo_403(self):
        # Entrar de novo não resolveria: o 401 mandaria a pessoa ao login em
        # laço, para voltar à mesma recusa.
        cliente = self.como(self.recepcionista)
        self.assertEqual(cliente.get(f'/api/citizens/{self.cidadao.id}').status_code, 403)
        self.assertEqual(cliente.get('/api/access-requests/').status_code, 403)
        self.assertEqual(cliente.get('/api/auditoria/').status_code, 403)

    def test_logado_com_permissao_nao_e_afetado(self):
        self.assertEqual(self.como(self.admin).get('/api/auth/me').status_code, 200)
        self.assertEqual(self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}').status_code, 200)
