"""
Como o login e a aprovação ligam uma identidade do Tefé Cidadão a um operador.

A identidade estável é o `sub` do token (keycloak_id). O e-mail serve para
adotar uma conta antiga que ainda não tem vínculo — e só se o Tefé Cidadão
garante que a pessoa é dona dele. Casar só por e-mail deixava quem tivesse o
mesmo e-mail em outra identidade entrar na conta de outra pessoa.
"""
import uuid
from unittest import mock

from django.conf import settings
from django.test import Client
from django.utils import timezone

from apps.contas import servicos
from apps.contas.autenticacao import CHAVE_OPERADOR
from apps.contas.models import Operador, PedidoDeAcesso
from apps.contas.servicos import AcessoPendente, ContaEmConflito
from testes.base import CenarioBase
from testes.test_papeis import token_falso


def _claims(sub, email, verificado=True, nome='Fulano de Tal'):
    claims = {'sub': sub, 'email': email, 'name': nome}
    if verificado is not None:
        claims['email_verified'] = verificado
    return claims


class _ComOperadorVinculado(CenarioBase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        agora = timezone.now()
        cls.vinculado = Operador.objects.create(
            id=str(uuid.uuid4()), email='ana@teste.local', nome='Ana', papel='TECNICO',
            ativo=True, unidade=cls.sul, keycloak_id='kc-ana', criado_em=agora, atualizado_em=agora,
        )
        cls.antigo = Operador.objects.create(
            id=str(uuid.uuid4()), email='antigo@teste.local', nome='Antigo', papel='TECNICO',
            ativo=True, unidade=cls.sul, keycloak_id=None, criado_em=agora, atualizado_em=agora,
        )

    def entrar(self, claims, papeis=('TECNICO',)):
        return servicos.entrar(token_falso(list(papeis), settings.KEYCLOAK_CLIENT_ID), claims)


class VinculoNoLogin(_ComOperadorVinculado):
    def test_conta_nova_nasce_vinculada(self):
        operador = self.entrar(_claims('kc-novo', 'novo@teste.local'))
        self.assertEqual(operador.keycloak_id, 'kc-novo')
        self.assertEqual(operador.email, 'novo@teste.local')

    def test_identidade_ja_vinculada_volta_para_a_mesma_conta(self):
        operador = self.entrar(_claims('kc-ana', 'ana@teste.local'))
        self.assertEqual(operador.id, self.vinculado.id)

    def test_troca_de_email_no_realm_nao_cria_conta_duplicada(self):
        # O `sub` não muda quando a pessoa troca de e-mail; a conta, a lotação e
        # o histórico dela têm de seguir junto.
        total = Operador.objects.count()
        operador = self.entrar(_claims('kc-ana', 'ana.nova@teste.local'))
        self.assertEqual(operador.id, self.vinculado.id)
        self.assertEqual(operador.unidade_id, self.sul.id)
        self.assertEqual(Operador.objects.count(), total)

    def test_mesmo_email_em_outra_identidade_e_recusado(self):
        with self.assertRaises(ContaEmConflito) as erro:
            self.entrar(_claims('kc-impostor', 'ana@teste.local'), papeis=('ADMIN',))
        self.assertEqual(erro.exception.motivo, servicos.MOTIVO_OUTRA_IDENTIDADE)

    def test_recusa_nao_altera_a_conta_existente(self):
        with self.assertRaises(ContaEmConflito):
            self.entrar(_claims('kc-impostor', 'ana@teste.local'), papeis=('ADMIN',))
        self.vinculado.refresh_from_db()
        self.assertEqual(self.vinculado.keycloak_id, 'kc-ana')
        self.assertEqual(self.vinculado.papel, 'TECNICO')
        self.assertTrue(self.vinculado.ativo)

    def test_recusa_nao_cria_conta_nova(self):
        total = Operador.objects.count()
        with self.assertRaises(ContaEmConflito):
            self.entrar(_claims('kc-impostor', 'ana@teste.local'))
        self.assertEqual(Operador.objects.count(), total)

    def test_adota_conta_antiga_quando_o_email_e_confirmado(self):
        operador = self.entrar(_claims('kc-antigo', 'antigo@teste.local', verificado=True))
        self.assertEqual(operador.id, self.antigo.id)
        self.antigo.refresh_from_db()
        self.assertEqual(self.antigo.keycloak_id, 'kc-antigo')

    def test_nao_adota_conta_antiga_com_email_nao_confirmado(self):
        with self.assertRaises(ContaEmConflito) as erro:
            self.entrar(_claims('kc-qualquer', 'antigo@teste.local', verificado=False))
        self.assertEqual(erro.exception.motivo, servicos.MOTIVO_EMAIL_NAO_CONFIRMADO)
        self.antigo.refresh_from_db()
        self.assertIsNone(self.antigo.keycloak_id)

    def test_sem_a_informacao_de_confirmacao_tambem_nao_adota(self):
        with self.assertRaises(ContaEmConflito):
            self.entrar(_claims('kc-qualquer', 'antigo@teste.local', verificado=None))
        self.antigo.refresh_from_db()
        self.assertIsNone(self.antigo.keycloak_id)

    def test_conta_desligada_volta_quando_o_realm_concede_papel(self):
        Operador.objects.filter(pk=self.vinculado.pk).update(ativo=False, excluido_em=timezone.now())
        operador = self.entrar(_claims('kc-ana', 'ana@teste.local'), papeis=('COORDENADOR',))
        self.assertTrue(operador.ativo)
        self.assertIsNone(operador.excluido_em)
        self.assertEqual(operador.papel, 'COORDENADOR')

    def test_sem_papel_no_client_continua_sendo_pedido_de_acesso(self):
        total = Operador.objects.count()
        with self.assertRaises(AcessoPendente):
            self.entrar(_claims('kc-curioso', 'curioso@teste.local'), papeis=())
        self.assertEqual(Operador.objects.count(), total)
        self.assertTrue(PedidoDeAcesso.objects.filter(keycloak_id='kc-curioso').exists())


class RetornoDoKeycloak(_ComOperadorVinculado):
    def _voltar_do_keycloak(self, claims, papeis=('TECNICO',)):
        navegador = Client(headers={'host': 'localhost'})
        navegador.get('/api/auth/keycloak/login')
        state = navegador.session['kc_state']
        token = token_falso(list(papeis), settings.KEYCLOAK_CLIENT_ID)
        with mock.patch('apps.contas.views.keycloak.trocar_codigo_por_token',
                        return_value={'access_token': token, 'id_token': ''}), \
             mock.patch('apps.contas.views.keycloak.validar_token', return_value=claims):
            resposta = navegador.get(f'/api/auth/keycloak/callback?state={state}&code=abc')
        return navegador, resposta

    def test_conflito_volta_ao_login_com_o_motivo(self):
        navegador, resposta = self._voltar_do_keycloak(_claims('kc-impostor', 'ana@teste.local'))
        self.assertEqual(resposta.status_code, 302)
        self.assertTrue(resposta['Location'].endswith('/login?erro=conta-em-conflito'), resposta['Location'])
        self.assertNotIn(CHAVE_OPERADOR, navegador.session)

    def test_email_nao_confirmado_volta_ao_login_com_o_motivo(self):
        navegador, resposta = self._voltar_do_keycloak(
            _claims('kc-qualquer', 'antigo@teste.local', verificado=False),
        )
        self.assertTrue(resposta['Location'].endswith('/login?erro=email-nao-confirmado'), resposta['Location'])
        self.assertNotIn(CHAVE_OPERADOR, navegador.session)

    def test_entrada_normal_continua_funcionando(self):
        navegador, resposta = self._voltar_do_keycloak(_claims('kc-ana', 'ana@teste.local'))
        self.assertTrue(resposta['Location'].endswith('/dashboard'), resposta['Location'])
        self.assertEqual(navegador.session[CHAVE_OPERADOR], self.vinculado.id)


class VinculoNaAprovacao(_ComOperadorVinculado):
    def _pedido(self, keycloak_id, email):
        return PedidoDeAcesso.objects.create(
            id=str(uuid.uuid4()), keycloak_id=keycloak_id, email=email, nome='Pessoa Pedinte',
            situacao=PedidoDeAcesso.Situacao.PENDENTE, pedido_em=timezone.now(),
        )

    def _aprovar(self, pedido, papel='TECNICO'):
        with mock.patch('apps.contas.api.keycloak.definir_papel') as definir:
            resposta = self.como(self.admin).post(
                f'/api/access-requests/{pedido.id}/aprovar',
                {'papel': papel, 'unidade_id': self.sul.id}, content_type='application/json',
            )
        return resposta, definir

    def test_aprova_pedido_de_email_novo(self):
        pedido = self._pedido('kc-novo', 'novo@teste.local')
        resposta, definir = self._aprovar(pedido)

        self.assertEqual(resposta.status_code, 200, resposta.content)
        definir.assert_called_once_with('kc-novo', 'TECNICO')
        self.assertEqual(Operador.objects.get(email='novo@teste.local').keycloak_id, 'kc-novo')

    def test_email_de_conta_ligada_a_outra_identidade_e_conflito(self):
        pedido = self._pedido('kc-impostor', 'ana@teste.local')
        resposta, _ = self._aprovar(pedido, papel='ADMIN')

        self.assertEqual(resposta.status_code, 409)
        self.vinculado.refresh_from_db()
        self.assertEqual(self.vinculado.keycloak_id, 'kc-ana')
        self.assertEqual(self.vinculado.papel, 'TECNICO')
        pedido.refresh_from_db()
        self.assertEqual(pedido.situacao, PedidoDeAcesso.Situacao.PENDENTE)

    def test_conflito_nao_concede_papel_no_realm(self):
        # O papel vai para o Tefé Cidadão antes da gravação local. Detectar o
        # conflito depois deixaria o papel concedido lá com a aprovação negada.
        pedido = self._pedido('kc-impostor', 'ana@teste.local')
        _, definir = self._aprovar(pedido, papel='ADMIN')
        definir.assert_not_called()

    def test_aprovar_adota_conta_antiga_sem_vinculo(self):
        pedido = self._pedido('kc-antigo', 'antigo@teste.local')
        resposta, _ = self._aprovar(pedido)

        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.antigo.refresh_from_db()
        self.assertEqual(self.antigo.keycloak_id, 'kc-antigo')

    def test_reaprovar_a_mesma_identidade_reaproveita_a_conta(self):
        pedido = self._pedido('kc-ana', 'ana@teste.local')
        resposta, _ = self._aprovar(pedido, papel='COORDENADOR')

        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.assertEqual(Operador.objects.filter(email='ana@teste.local').count(), 1)
        self.vinculado.refresh_from_db()
        self.assertEqual(self.vinculado.papel, 'COORDENADOR')
