"""
Cadastro de quem já tem cadastro.

Com a cifragem ligada (obrigatória em produção) o CPF e o e-mail têm índice único. Um
cadastro repetido não pode virar erro 500 na tela do atendente: tem de dizer o que
aconteceu e apontar o cadastro que já existe.
"""
import base64
import os

from django.test import override_settings

from apps.cidadaos.models import Cidadao
from testes.base import CenarioBase

CHAVE_DE_CIFRA = base64.b64encode(os.urandom(32)).decode()
CHAVE_DO_INDICE = base64.b64encode(os.urandom(32)).decode()


def _novo(**campos):
    corpo = {
        'nome': 'Pessoa Nova', 'email': 'pessoa.nova@teste.local', 'cpf': '111.444.777-35',
        'criar_acesso_tefe_cidadao': False,
    }
    corpo.update(campos)
    return corpo


@override_settings(PII_ENCRYPTION_ENABLED=True, PII_ENCRYPTION_KEY=CHAVE_DE_CIFRA, PII_HMAC_KEY=CHAVE_DO_INDICE)
class CadastroComDocumentoRepetido(CenarioBase):
    def cadastrar(self, **campos):
        return self.como(self.recepcionista).post(
            '/api/citizens/novo', _novo(**campos), content_type='application/json',
        )

    def test_cadastro_novo_continua_funcionando(self):
        self.assertEqual(self.cadastrar().status_code, 201)

    def test_cpf_repetido_diz_que_ja_existe_e_aponta_o_cadastro(self):
        total = Cidadao.objects.count()
        resposta = self.cadastrar(cpf=self.cidadao.cpf)

        self.assertEqual(resposta.status_code, 409, resposta.content)
        corpo = resposta.json()
        self.assertIn('CPF', corpo['detalhe'])
        self.assertEqual(corpo['cidadaoId'], self.cidadao.id)
        self.assertEqual(Cidadao.objects.count(), total)

    def test_email_repetido_diz_que_ja_existe(self):
        resposta = self.cadastrar(email=self.cidadao.email)

        self.assertEqual(resposta.status_code, 409, resposta.content)
        self.assertIn('e-mail', resposta.json()['detalhe'])

    def test_a_recusa_nao_derruba_o_atendimento_seguinte(self):
        # Um erro dentro da transação do banco a deixaria inutilizável para o resto da requisição.
        self.assertEqual(self.cadastrar(cpf=self.cidadao.cpf).status_code, 409)
        self.assertEqual(self.cadastrar().status_code, 201)

    def test_cadastro_eliminado_libera_o_cpf(self):
        eliminado = Cidadao.objects.create(
            id='eliminado-1', nome='Cidadão excluído', cpf='222.555.888-46', email='eliminado@teste.local',
            criado_em=self.cidadao.criado_em, atualizado_em=self.cidadao.atualizado_em,
        )
        Cidadao.objects.filter(pk=eliminado.pk).update(cpf=None, cpf_indice=None, email=None, email_indice=None)
        self.assertEqual(self.cadastrar(cpf='222.555.888-46', email='eliminado@teste.local').status_code, 201)
