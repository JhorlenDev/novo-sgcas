"""
`deploy/atualizar.sh`: a atualização do servidor num comando só.

O script roda de verdade num projeto de mentira, com docker, npm, git, curl, systemctl e sudo
trocados por programas que só anotam o que receberam. Confere a ordem dos passos e, sobretudo,
que ele PARA onde deve: sem .env, com o backup falhando, sem administrador no Keycloak.

Roda em Linux, como o servidor (no CI); no Windows é pulado.
"""
import getpass
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from django.test import SimpleTestCase

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy' / 'atualizar.sh'

# Anota "programa argumentos" e falha (saída 1) se a linha contiver um dos trechos de $FALHAR (separados por |).
PROGRAMA = r'''#!/usr/bin/env bash
nome="$(basename "$0")"
linha="$nome $*"
echo "$linha" >> "$REGISTRO"
IFS='|' read -ra trechos <<< "${FALHAR:-}"
for trecho in "${trechos[@]}"; do
  if [ -n "$trecho" ] && [[ "$linha" == *"$trecho"* ]]; then exit 1; fi
done
# O script chama `git -C <pasta> ...`: o subcomando vem depois da pasta.
case "$linha" in
  "git "*" status "*) printf '%s' "${GIT_STATUS:-}" ;;
  "git "*" log "*) echo "abc1234 versão de teste" ;;
  "systemctl cat"*) [ -z "${SEM_SERVICO:-}" ] || exit 1 ;;
  "systemctl show"*) echo "${USUARIO_DO_SERVICO:-}" ;;
esac
exit 0
'''

PROGRAMAS = ('docker', 'npm', 'git', 'curl', 'systemctl', 'sudo', 'runuser', 'sleep')

ORDEM = [
    'backup.sh',
    'fetch origin producao',
    'checkout producao',
    'merge --ff-only origin/producao',
    'docker compose build api',
    'docker compose up -d --wait postgres',
    'docker compose run --rm api python manage.py migrate --noinput',
    'docker compose run --rm api python manage.py cadastrar_servicos',
    'docker compose run --rm api python manage.py verificar_keycloak --mostrar-admins',
    'docker compose up -d --wait api',
    'npm ci',
    'npm run build',
    'systemctl restart sgcas-front',
    '/api/health',
    '/login/',
]


@unittest.skipUnless(os.name == 'posix', 'o script de atualização roda em servidor Linux')
class AtualizarOServidor(SimpleTestCase):
    def setUp(self):
        self.pasta = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)
        self.projeto = self.pasta / 'sgcas'
        (self.projeto / 'deploy').mkdir(parents=True)
        (self.projeto / 'api-sgcas').mkdir()
        (self.projeto / 'front-sgcas').mkdir()
        shutil.copy(SCRIPT, self.projeto / 'deploy' / 'atualizar.sh')
        (self.projeto / 'deploy' / 'atualizar.sh').chmod(0o755)
        self.env = self.projeto / 'api-sgcas' / '.env'
        self.env.write_text('DJANGO_SECRET_KEY=nao-pode-mudar\n')

        self.bin = self.pasta / 'bin'
        self.bin.mkdir()
        for nome in PROGRAMAS:
            self._programa(self.bin / nome)
        self._programa(self.projeto / 'deploy' / 'backup.sh')
        self.registro = self.pasta / 'registro.txt'

    @staticmethod
    def _programa(caminho):
        caminho.write_text(PROGRAMA)
        caminho.chmod(0o755)

    def rodar(self, **ambiente):
        env = {
            'PATH': f'{self.bin}:{os.environ["PATH"]}', 'HOME': str(self.pasta), 'REGISTRO': str(self.registro),
            'USUARIO_DO_SERVICO': getpass.getuser(), **ambiente,
        }
        resultado = subprocess.run(
            ['bash', str(self.projeto / 'deploy' / 'atualizar.sh')],
            env=env, capture_output=True, text=True, timeout=60,
        )
        self.chamadas = self.registro.read_text().splitlines() if self.registro.exists() else []
        return resultado

    def chamou(self, trecho):
        return any(trecho in chamada for chamada in self.chamadas)

    def test_atualiza_tudo_na_ordem_certa(self):
        resultado = self.rodar()
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        posicoes = []
        for trecho in ORDEM:
            achadas = [i for i, chamada in enumerate(self.chamadas) if trecho in chamada]
            self.assertTrue(achadas, f'não chamou "{trecho}":\n' + '\n'.join(self.chamadas))
            posicoes.append(achadas[0])
        self.assertEqual(posicoes, sorted(posicoes), '\n'.join(self.chamadas))
        self.assertIn('SGCAS atualizado: abc1234', resultado.stdout)

    def test_nunca_mexe_no_env_nem_apaga_volumes_ou_dados(self):
        self.rodar()
        self.assertEqual(self.env.read_text(), 'DJANGO_SECRET_KEY=nao-pode-mudar\n')
        for perigoso in ('compose down', 'volume rm', ' -v', 'gerar-env', 'flush'):
            self.assertFalse(self.chamou(perigoso), perigoso)

    def test_sem_env_para_antes_de_tudo(self):
        self.env.unlink()
        resultado = self.rodar()
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('não existe api-sgcas/.env', resultado.stderr)
        self.assertFalse(self.chamou('backup.sh') or self.chamou('docker '))

    def test_alteracao_local_no_codigo_para_antes_do_backup(self):
        resultado = self.rodar(GIT_STATUS=' M api-sgcas/sgcas/settings.py')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('alterações locais', resultado.stderr)
        self.assertFalse(self.chamou('backup.sh'))

    def test_backup_que_falha_nao_deixa_mexer_em_nada(self):
        resultado = self.rodar(FALHAR='backup.sh')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('o backup falhou', resultado.stderr)
        self.assertFalse(self.chamou('fetch origin') or self.chamou('docker '))

    def test_ramo_que_divergiu_do_github_nao_e_misturado(self):
        resultado = self.rodar(FALHAR='merge --ff-only')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('commits que o GitHub não tem', resultado.stderr)
        self.assertFalse(self.chamou('docker compose build'))

    def test_sem_administrador_a_versao_nova_nao_vai_ao_ar(self):
        resultado = self.rodar(FALHAR='verificar_keycloak')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('NÃO foi posta no ar', resultado.stderr)
        self.assertTrue(self.chamou('migrate'))
        self.assertFalse(self.chamou('up -d --wait api'))
        self.assertFalse(self.chamou('npm '))

    def test_api_que_nao_fica_saudavel_para_antes_do_frontend(self):
        resultado = self.rodar(FALHAR='up -d --wait api')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('docker compose logs api', resultado.stderr)
        self.assertFalse(self.chamou('npm '))

    def test_o_build_do_frontend_e_feito_pelo_dono_do_servico(self):
        resultado = self.rodar(USUARIO_DO_SERVICO='sgcas-web')
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertTrue(self.chamou('sudo -u sgcas-web env SGCAS_API_URL=http://localhost:8000 npm ci'), self.chamadas)
        self.assertTrue(self.chamou('sudo -u sgcas-web env SGCAS_API_URL=http://localhost:8000 npm run build'))

    def test_frontend_que_nao_responde_e_apontado(self):
        resultado = self.rodar(FALHAR='/login/')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('journalctl -u sgcas-front', resultado.stderr)
        self.assertNotIn('SGCAS atualizado', resultado.stdout)
