"""
Busca por CPF e NIS, com ou sem pontos e traço.

O cadastro grava o documento como foi digitado, e quem busca digita de outro jeito:
"529.982.247-25" no cadastro e "52998224725" na busca (ou o contrário). O atendente que
não encontra a pessoa a cadastra de novo — a duplicidade que a busca existe para evitar.

Vale com a cifragem ligada (o caso de produção, em que a busca compara índice cego) e
desligada (desenvolvimento, em que compara a coluna).
"""
import base64
import os
import uuid
from io import StringIO

from django.core.management import call_command
from django.db import connection
from django.test import override_settings
from django.utils import timezone

from apps.cidadaos.models import Cidadao
from testes.base import CenarioBase

CHAVE_DE_CIFRA = base64.b64encode(os.urandom(32)).decode()
CHAVE_DO_INDICE = base64.b64encode(os.urandom(32)).decode()

CIFRA_LIGADA = override_settings(
    PII_ENCRYPTION_ENABLED=True, PII_ENCRYPTION_KEY=CHAVE_DE_CIFRA, PII_HMAC_KEY=CHAVE_DO_INDICE,
)
CIFRA_DESLIGADA = override_settings(PII_ENCRYPTION_ENABLED=False)


def _cadastrar_pessoa(nome, **campos):
    agora = timezone.now()
    return Cidadao.objects.create(
        id=str(uuid.uuid4()), nome=nome, criado_em=agora, atualizado_em=agora, **campos,
    )


class _BuscaPorDocumento:
    """As regras, iguais com a cifragem ligada ou desligada."""

    def buscar(self, termo):
        resposta = self.como(self.recepcionista).get('/api/citizens/', {'busca': termo})
        self.assertEqual(resposta.status_code, 200, resposta.content)
        return [item['nome'] for item in resposta.json()]

    def test_cpf_gravado_com_mascara_e_buscado_sem(self):
        _cadastrar_pessoa('Beatriz Mascarada', cpf='111.444.777-35')
        self.assertEqual(self.buscar('11144477735'), ['Beatriz Mascarada'])

    def test_cpf_gravado_sem_mascara_e_buscado_com(self):
        _cadastrar_pessoa('Carlos Cru', cpf='11144477735')
        self.assertEqual(self.buscar('111.444.777-35'), ['Carlos Cru'])

    def test_cpf_gravado_com_mascara_e_buscado_com_a_mesma(self):
        _cadastrar_pessoa('Diana Igual', cpf='111.444.777-35')
        self.assertEqual(self.buscar('111.444.777-35'), ['Diana Igual'])

    def test_cpf_buscado_com_mascara_pela_metade(self):
        _cadastrar_pessoa('Elisa Meio', cpf='11144477735')
        self.assertEqual(self.buscar('111444.777-35'), ['Elisa Meio'])
        self.assertEqual(self.buscar(' 111.444.777-35 '), ['Elisa Meio'])

    def test_cpf_gravado_com_espacos(self):
        _cadastrar_pessoa('Fabio Espaco', cpf=' 111 444 777 35 ')
        self.assertEqual(self.buscar('111.444.777-35'), ['Fabio Espaco'])
        self.assertEqual(self.buscar('11144477735'), ['Fabio Espaco'])

    def test_nis_com_ou_sem_pontuacao(self):
        _cadastrar_pessoa('Gabriela Nis', nis='123.45678.90-1')
        self.assertEqual(self.buscar('12345678901'), ['Gabriela Nis'])
        self.assertEqual(self.buscar('123.45678.90-1'), ['Gabriela Nis'])

    def test_nao_confunde_cpf_diferente(self):
        _cadastrar_pessoa('Heitor Outro', cpf='111.444.777-35')
        self.assertEqual(self.buscar('111.444.777-36'), [])

    def test_cpf_do_cenario_com_mascara_e_achado_sem(self):
        # Cadastro feito pelo cenário-base, com a máscara de sempre.
        self.assertEqual(self.buscar('52998224725'), [self.cidadao.nome])

    def test_email_continua_achando_sem_diferenciar_caixa(self):
        self.assertEqual(self.buscar('Antonia@TESTE.local'), [self.cidadao.nome])

    def test_nome_continua_achando_por_trecho(self):
        _cadastrar_pessoa('Isadora Nome', cpf='111.444.777-35')
        self.assertEqual(self.buscar('isadora'), ['Isadora Nome'])

    def test_numero_que_nao_e_documento_nao_acha_ninguem(self):
        self.assertEqual(self.buscar('00000000000'), [])


@CIFRA_LIGADA
class BuscaPorDocumentoComCifra(_BuscaPorDocumento, CenarioBase):
    def cadastrar(self, **campos):
        corpo = {
            'nome': 'Pessoa Nova', 'email': 'pessoa.nova@teste.local', 'cpf': '111.444.777-35',
            'criar_acesso_tefe_cidadao': False,
        }
        corpo.update(campos)
        return self.como(self.recepcionista).post(
            '/api/citizens/novo', corpo, content_type='application/json',
        )

    def test_mesmo_cpf_com_e_sem_mascara_e_o_mesmo_cadastro(self):
        _cadastrar_pessoa('Ja Existente', cpf='111.444.777-35', email='ja@teste.local')

        resposta = self.cadastrar(cpf='11144477735', email='outra@teste.local')

        self.assertEqual(resposta.status_code, 409, resposta.content)
        self.assertIn('CPF', resposta.json()['detalhe'])
        self.assertEqual(Cidadao.objects.filter(nome='Pessoa Nova').count(), 0)

    def test_mesmo_cpf_sem_mascara_e_depois_com(self):
        _cadastrar_pessoa('Ja Existente', cpf='11144477735', email='ja@teste.local')

        resposta = self.cadastrar(cpf='111.444.777-35', email='outra@teste.local')

        self.assertEqual(resposta.status_code, 409, resposta.content)

    def test_cadastro_novo_pela_api_e_achado_nos_dois_formatos(self):
        self.assertEqual(self.cadastrar(cpf='111.444.777-35').status_code, 201)
        self.assertEqual(self.buscar('11144477735'), ['Pessoa Nova'])
        self.assertEqual(self.buscar('111.444.777-35'), ['Pessoa Nova'])

    def test_corrigir_o_cpf_atualiza_a_busca(self):
        pessoa = _cadastrar_pessoa('Julia Troca', cpf='111.444.777-35')
        pessoa.cpf = '222.555.888-46'
        pessoa.save(update_fields=['cpf'])

        self.assertEqual(self.buscar('11144477735'), [])
        self.assertEqual(self.buscar('22255588846'), ['Julia Troca'])

    def test_cadastro_com_cpf_que_so_tem_letras_nao_gera_indice(self):
        pessoa = _cadastrar_pessoa('Kleber Sem', cpf='nao tem')
        pessoa.refresh_from_db()
        self.assertIsNone(pessoa.cpf_indice)

    def test_dois_cadastros_sem_cpf_convivem(self):
        _cadastrar_pessoa('Sem Cpf Um', email='um@teste.local')
        _cadastrar_pessoa('Sem Cpf Dois', email='dois@teste.local')

    def test_indice_antigo_e_refeito_pelo_comando(self):
        # Índice do tempo em que era calculado sobre o texto digitado, máscara incluída.
        from apps.comum import cripto
        pessoa = _cadastrar_pessoa('Laura Antiga', cpf='111.444.777-35')
        with connection.cursor() as cursor:
            cursor.execute(
                'UPDATE citizens SET "cpfHash" = %s WHERE "id" = %s',
                [cripto.indice_cego('111.444.777-35'), pessoa.id],
            )
        self.assertEqual(self.buscar('11144477735'), [])

        saida = StringIO()
        call_command('cifrar_dados_pessoais', stdout=saida)

        self.assertEqual(self.buscar('11144477735'), ['Laura Antiga'])
        self.assertEqual(self.buscar('111.444.777-35'), ['Laura Antiga'])

    def test_comando_repetido_nao_grava_de_novo(self):
        _cadastrar_pessoa('Marta Pronta', cpf='111.444.777-35')
        call_command('cifrar_dados_pessoais', stdout=StringIO())

        saida = StringIO()
        call_command('cifrar_dados_pessoais', stdout=saida)

        self.assertIn('nada a fazer', saida.getvalue())


@CIFRA_DESLIGADA
class BuscaPorDocumentoSemCifra(_BuscaPorDocumento, CenarioBase):
    pass
