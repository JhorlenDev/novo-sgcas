"""
`deploy/gerar-env.sh`: o .env de produção sem erro de digitação.

Montar o .env à mão já derrubou uma implantação em teste (variável repetida no exemplo, a última
ganhava). O gerador escreve o arquivo certo, com todos os segredos aleatórios, e o teste mais
importante é o último: o que ele gera tem de ser aceito pelo boot em produção.
"""
import base64
import os
import stat
import subprocess
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from testes.test_seguranca import _importar_settings

RAIZ = Path(__file__).resolve().parents[2]
SCRIPT = RAIZ / 'deploy' / 'gerar-env.sh'
DOMINIO = 'sgcas.tefe.am.gov.br'
SEGREDO_DO_KEYCLOAK = 'segredo-do-keycloak-so-para-o-teste'


def ler_env(caminho: Path) -> dict:
    valores = {}
    for linha in caminho.read_text().splitlines():
        linha = linha.strip()
        if linha and not linha.startswith('#') and '=' in linha:
            chave, valor = linha.split('=', 1)
            valores[chave] = valor
    return valores


class GeradorDeEnv(SimpleTestCase):
    def setUp(self):
        self.pasta = Path(tempfile.mkdtemp())
        self.destino = self.pasta / '.env'

    def rodar(self, *args, segredo=SEGREDO_DO_KEYCLOAK, destino=None):
        ambiente = {k: v for k, v in os.environ.items() if k != 'KEYCLOAK_CLIENT_SECRET'}
        ambiente['SGCAS_ENV_DESTINO'] = str(destino or self.destino)
        if segredo is not None:
            ambiente['KEYCLOAK_CLIENT_SECRET'] = segredo
        return subprocess.run(
            ['bash', str(SCRIPT), *args], env=ambiente, capture_output=True, text=True, stdin=subprocess.DEVNULL,
        )

    def test_gera_o_arquivo_de_producao(self):
        resultado = self.rodar(DOMINIO)
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        env = ler_env(self.destino)

        self.assertEqual(env['DEBUG'], 'False')
        self.assertEqual(env['FRONTEND_URL'], f'https://{DOMINIO}')
        self.assertEqual(env['KEYCLOAK_REDIRECT_URI'], f'https://{DOMINIO}/api/auth/keycloak/callback')
        self.assertEqual(env['KEYCLOAK_CLIENT_SECRET'], SEGREDO_DO_KEYCLOAK)
        self.assertEqual(env['PII_ENCRYPTION_ENABLED'], 'true')
        # O Next troca o Host ao encaminhar: o domínio público NÃO entra em ALLOWED_HOSTS.
        self.assertNotIn(DOMINIO, env['ALLOWED_HOSTS'])
        self.assertIn('localhost', env['ALLOWED_HOSTS'])

    def test_o_arquivo_so_o_dono_le(self):
        self.rodar(DOMINIO)
        self.assertEqual(stat.S_IMODE(self.destino.stat().st_mode), 0o600)

    def test_nenhuma_variavel_repetida(self):
        self.rodar(DOMINIO)
        nomes = [
            linha.split('=', 1)[0] for linha in self.destino.read_text().splitlines()
            if linha.strip() and not linha.startswith('#') and '=' in linha
        ]
        self.assertEqual(sorted({n for n in nomes if nomes.count(n) > 1}), [])

    def test_segredos_sao_fortes_e_aleatorios(self):
        self.rodar(DOMINIO)
        env = ler_env(self.destino)
        self.assertGreaterEqual(len(env['DJANGO_SECRET_KEY']), 50)
        self.assertGreaterEqual(len(env['POSTGRES_PASSWORD']), 40)
        chave_de_cifra = base64.b64decode(env['PII_ENCRYPTION_KEY'], validate=True)
        chave_do_indice = base64.b64decode(env['PII_HMAC_KEY'], validate=True)
        self.assertEqual(len(chave_de_cifra), 32)
        self.assertEqual(len(chave_do_indice), 32)
        self.assertNotEqual(chave_de_cifra, chave_do_indice)

    def test_dois_arquivos_nunca_repetem_segredo(self):
        outro = self.pasta / 'outro.env'
        self.rodar(DOMINIO)
        self.rodar(DOMINIO, destino=outro)
        a, b = ler_env(self.destino), ler_env(outro)
        for chave in ('DJANGO_SECRET_KEY', 'POSTGRES_PASSWORD', 'PII_ENCRYPTION_KEY', 'PII_HMAC_KEY'):
            self.assertNotEqual(a[chave], b[chave], chave)

    def test_a_senha_do_banco_e_a_mesma_na_url(self):
        self.rodar(DOMINIO)
        env = ler_env(self.destino)
        self.assertIn(f":{env['POSTGRES_PASSWORD']}@", env['DATABASE_URL'])

    def test_nao_imprime_nenhum_segredo(self):
        resultado = self.rodar(DOMINIO)
        env = ler_env(self.destino)
        saida = resultado.stdout + resultado.stderr
        for chave in ('DJANGO_SECRET_KEY', 'POSTGRES_PASSWORD', 'PII_ENCRYPTION_KEY', 'PII_HMAC_KEY', 'KEYCLOAK_CLIENT_SECRET'):
            self.assertNotIn(env[chave], saida, chave)

    def test_lembra_de_guardar_as_chaves_fora_do_servidor(self):
        resultado = self.rodar(DOMINIO)
        self.assertIn('PII_ENCRYPTION_KEY', resultado.stdout)
        self.assertIn('fora do servidor', resultado.stdout)

    def test_nao_sobrescreve_arquivo_existente(self):
        self.destino.write_text('DJANGO_SECRET_KEY=nao-mexer\n')
        resultado = self.rodar(DOMINIO)
        self.assertNotEqual(resultado.returncode, 0)
        self.assertEqual(self.destino.read_text(), 'DJANGO_SECRET_KEY=nao-mexer\n')
        self.assertIn('--forcar', resultado.stderr)

    def test_forcar_sobrescreve(self):
        self.destino.write_text('DJANGO_SECRET_KEY=velha\n')
        resultado = self.rodar(DOMINIO, '--forcar')
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertNotEqual(ler_env(self.destino)['DJANGO_SECRET_KEY'], 'velha')

    def test_dominio_invalido_e_recusado(self):
        for ruim in ('https://sgcas.tefe.am.gov.br', 'sgcas.tefe.am.gov.br/', 'sem-ponto', 'com espaco.gov.br', ''):
            with self.subTest(dominio=ruim):
                resultado = self.rodar(ruim)
                self.assertNotEqual(resultado.returncode, 0)
                self.assertFalse(self.destino.exists())

    def test_sem_dominio_e_recusado(self):
        resultado = self.rodar()
        self.assertNotEqual(resultado.returncode, 0)
        self.assertFalse(self.destino.exists())

    def test_sem_segredo_do_keycloak_gera_mesmo_assim_e_avisa(self):
        resultado = self.rodar(DOMINIO, segredo=None)
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertEqual(ler_env(self.destino)['KEYCLOAK_CLIENT_SECRET'], '')
        self.assertIn('KEYCLOAK_CLIENT_SECRET', resultado.stdout + resultado.stderr)

    def test_segredo_de_exemplo_do_keycloak_e_recusado(self):
        resultado = self.rodar(DOMINIO, segredo='SEGREDO_CLIENTE_AQUI')
        self.assertNotEqual(resultado.returncode, 0)

    def test_o_que_ele_gera_sobe_em_producao(self):
        resultado = self.rodar(DOMINIO)
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        env = ler_env(self.destino)
        boot = _importar_settings(**{k: v for k, v in env.items() if k != 'DATABASE_URL'}, DATABASE_URL=env['DATABASE_URL'])
        self.assertEqual(boot.returncode, 0, boot.stderr)
