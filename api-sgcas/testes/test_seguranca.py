"""
Varredura de segurança: falhas achadas na leitura do código, cada uma com o teste
que a reproduzia antes da correção.

Os clientes imitam o navegador atrás do proxy do Next (`Origin` é o do front e
`Host` é o da API), como em `test_csrf_sessao`.
"""
import base64
import os
import subprocess
import sys
import time
import uuid
from datetime import timedelta
from pathlib import Path
from unittest import mock
from urllib.parse import urlparse

from django.conf import settings
from django.test import Client
from django.utils import timezone

from apps.contas.autenticacao import CHAVE_OPERADOR
from apps.contas.models import PedidoDeAcesso
from apps.institucional.models import Servico
from testes.base import CenarioBase

RAIZ_DA_API = Path(__file__).resolve().parent.parent


def _origem_do_front() -> str:
    url = urlparse(settings.FRONTEND_URL)
    return f'{url.scheme}://{url.netloc}'


class _Navegador(CenarioBase):
    def navegador(self, operador=None, origem=None, **sessao):
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
    def com_token(cliente) -> dict:
        cliente.get('/api/auth/me')            # é daqui que o front recebe o cookie
        return {'X-CSRFToken': cliente.cookies['csrftoken'].value}


class CsrfNasRotasDaApi(_Navegador):
    """
    Toda escrita autenticada por sessão exige o token CSRF, não só sair e reenviar.

    As views do DRF são isentas de CSRF por padrão e a classe de autenticação do
    projeto não o conferia: só o `SameSite=Lax` do cookie protegia. Isso não vale
    contra outro subdomínio do mesmo site.
    """

    def test_post_com_sessao_e_sem_token_e_recusado(self):
        navegador = self.navegador(self.tecnico)
        resposta = navegador.post('/api/notices/lidos')
        self.assertEqual(resposta.status_code, 403, resposta.content)
        self.assertIn('CSRF', resposta.json()['detail'])

    def test_post_com_token_passa(self):
        navegador = self.navegador(self.tecnico)
        resposta = navegador.post('/api/notices/lidos', headers=self.com_token(navegador))
        self.assertEqual(resposta.status_code, 200, resposta.content)

    def test_token_com_origem_de_fora_e_recusado(self):
        navegador = self.navegador(self.tecnico, origem='https://site-malicioso.example')
        cabecalho = self.com_token(navegador)
        resposta = navegador.post('/api/notices/lidos', headers=cabecalho)
        self.assertEqual(resposta.status_code, 403)

    def test_token_que_nao_e_o_do_cookie_e_recusado(self):
        navegador = self.navegador(self.tecnico)
        navegador.get('/api/auth/me')
        resposta = navegador.post('/api/notices/lidos', headers={'X-CSRFToken': 'x' * 64})
        self.assertEqual(resposta.status_code, 403)

    def test_patch_e_delete_tambem_exigem_o_token(self):
        navegador = self.navegador(self.admin)
        servico = f'/api/institutional/services/{self.servico.id}'
        self.assertEqual(navegador.patch(servico, {}, content_type='application/json').status_code, 403)
        cabecalho = self.com_token(navegador)
        self.assertEqual(navegador.patch(servico, {}, content_type='application/json', headers=cabecalho).status_code, 200)

    def test_leitura_nao_exige_token(self):
        navegador = self.navegador(self.tecnico)
        self.assertEqual(navegador.get('/api/notices/resumo').status_code, 200)

    def test_sem_sessao_continua_sendo_401(self):
        # Quem não está logado não vê um erro de CSRF: vê que precisa entrar.
        self.assertEqual(self.navegador().post('/api/notices/lidos').status_code, 401)

    def test_envio_de_arquivo_com_token_passa(self):
        navegador = self.navegador(self.tecnico)
        cabecalho = self.com_token(navegador)
        sem = navegador.post(f'/api/citizens/{self.cidadao.id}/anexos', {'tipo_documento': 'outro'})
        self.assertEqual(sem.status_code, 403)
        com = navegador.post(f'/api/citizens/{self.cidadao.id}/anexos', {'tipo_documento': 'outro'}, headers=cabecalho)
        self.assertEqual(com.status_code, 400)          # passou do CSRF; falta o arquivo


class RespostasNaoFicamEmCache(_Navegador):
    """
    Em computador de CRAS, vários servidores usam a mesma máquina: o que a API
    devolve (prontuário, anexo, impressão) não pode ficar guardado no navegador.
    """

    def _sem_cache(self, resposta):
        self.assertIn('no-store', resposta.headers.get('Cache-Control', ''), resposta.request['PATH_INFO'])

    def test_sessao_e_listas(self):
        navegador = self.navegador(self.tecnico)
        for caminho in ('/api/auth/me', '/api/citizens/', '/api/institutional/units'):
            self._sem_cache(navegador.get(caminho))

    def test_prontuario_impressao_e_exportacao(self):
        navegador = self.navegador(self.tecnico)
        for sufixo in ('prontuario', 'imprimir', 'exportar', ''):
            self._sem_cache(navegador.get(f'/api/citizens/{self.cidadao.id}/{sufixo}'.rstrip('/')))

    def test_inclusive_a_resposta_de_erro(self):
        self._sem_cache(self.navegador().get('/api/citizens/'))              # 401
        self._sem_cache(self.navegador(self.tecnico).get('/api/citizens/inexistente'))

    def test_a_saude_continua_sem_cache(self):
        self._sem_cache(Client().get('/api/health'))


class SessaoTemVidaMaxima(_Navegador):
    """
    A sessão renova a cada requisição (`SESSION_SAVE_EVERY_REQUEST`): sem um teto, quem
    usa o sistema sem pausa longa nunca sai, e uma permissão retirada direto no
    Keycloak só chega aqui quando a pessoa entra de novo.
    """

    def test_sessao_dentro_do_limite_funciona(self):
        agora = time.time()
        navegador = self.navegador(self.tecnico, login_em=agora - 3600)
        self.assertEqual(navegador.get('/api/auth/me').status_code, 200)

    def test_sessao_alem_do_limite_e_encerrada(self):
        navegador = self.navegador(self.tecnico, login_em=time.time() - settings.SESSION_MAX_LIFETIME - 60)
        resposta = navegador.get('/api/auth/me')
        self.assertEqual(resposta.status_code, 401)
        self.assertEqual(navegador.get('/api/auth/me').status_code, 401)      # a sessão foi descartada

    def test_usar_a_sessao_nao_estende_o_limite(self):
        agora = time.time()
        navegador = self.navegador(self.tecnico, login_em=agora - settings.SESSION_MAX_LIFETIME + 5)
        self.assertEqual(navegador.get('/api/auth/me').status_code, 200)
        with mock.patch('apps.contas.autenticacao.time.time', return_value=agora + 30):
            self.assertEqual(navegador.get('/api/auth/me').status_code, 401)

    def test_sessao_sem_marca_ganha_a_marca_no_primeiro_uso(self):
        # Sessões abertas antes desta regra existir não podem cair todas de uma vez.
        navegador = self.navegador(self.tecnico)
        self.assertEqual(navegador.get('/api/auth/me').status_code, 200)
        self.assertIn('login_em', navegador.session)

    def test_o_login_grava_a_marca(self):
        from apps.contas import views
        corpo = {'access_token': 'a.b.c', 'id_token': 'x'}
        with mock.patch.object(views.keycloak, 'trocar_codigo_por_token', return_value=corpo), \
                mock.patch.object(views.keycloak, 'validar_token', return_value={'sub': 's1'}), \
                mock.patch.object(views, 'entrar', return_value=self.tecnico):
            navegador = self.navegador()
            sessao = navegador.session
            sessao['kc_state'] = 'estado'
            sessao.save()
            navegador.cookies['sessionid'] = sessao.session_key
            resposta = navegador.get('/api/auth/keycloak/callback?state=estado&code=c')
        self.assertEqual(resposta.status_code, 302)
        self.assertAlmostEqual(navegador.session['login_em'], time.time(), delta=10)


class OperadorSoParaQuemPodeVer(_Navegador):
    def test_coordenador_nao_le_operador_de_outra_unidade(self):
        # `listar_operadores` já recusa; o detalhe também tem de recusar.
        resposta = self.como(self.coordenador).get(f'/api/users/{self.tecnico.id}')          # Sul x Centro
        self.assertEqual(resposta.status_code, 403, resposta.content)

    def test_coordenador_le_operador_da_propria_unidade(self):
        self.assertEqual(self.como(self.coordenador).get(f'/api/users/{self.recepcionista.id}').status_code, 200)

    def test_coordenador_le_quem_ainda_nao_tem_unidade(self):
        # Quem acabou de entrar aparece na lista dele, para receber lotação.
        self.assertEqual(self.como(self.coordenador).get(f'/api/users/{self.sem_unidade.id}').status_code, 200)

    def test_admin_le_qualquer_um(self):
        self.assertEqual(self.como(self.admin).get(f'/api/users/{self.tecnico.id}').status_code, 200)

    def test_a_propria_conta_sempre(self):
        self.assertEqual(self.como(self.tecnico).get(f'/api/users/{self.tecnico.id}').status_code, 200)


class ServicoSoNaPropriaUnidade(CenarioBase):
    def cadastrar(self, operador, unidade):
        return self.como(operador).post(
            '/api/institutional/services',
            {'nome': 'Serviço novo', 'unidade_id': unidade.id}, content_type='application/json',
        )

    def test_coordenador_cadastra_na_propria_unidade(self):
        self.assertEqual(self.cadastrar(self.coordenador, self.sul).status_code, 201)

    def test_coordenador_nao_cadastra_em_outra_unidade(self):
        resposta = self.cadastrar(self.coordenador, self.centro)
        self.assertEqual(resposta.status_code, 403, resposta.content)
        self.assertFalse(Servico.objects.filter(nome='Serviço novo').exists())

    def test_admin_cadastra_em_qualquer_unidade(self):
        self.assertEqual(self.cadastrar(self.admin, self.centro).status_code, 201)


class ProntuarioNaoExpoeCaminhoDeArquivo(CenarioBase):
    def test_o_cadastro_nao_traz_o_nome_do_arquivo_em_disco(self):
        self.cidadao.anexos = [{
            'id': str(uuid.uuid4()), 'tipo_documento': 'rg_frente', 'arquivo': 'abc.jpg',
            'miniatura': 'abc_min.jpg', 'mime': 'image/jpeg', 'tamanho': 10, 'enviado_em': '2026-01-01T00:00:00',
        }]
        self.cidadao.save()
        corpo = self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}').json()
        anexo = corpo['anexos'][0]
        self.assertNotIn('arquivo', anexo)
        self.assertNotIn('miniatura', anexo)
        self.assertEqual(anexo['tipo_documento'], 'rg_frente')        # o resto segue
        self.assertEqual(anexo['mime'], 'image/jpeg')


class AcaoItineranteValidaOsNumeros(CenarioBase):
    def _acao(self):
        resposta = self.como(self.tecnico).post(
            '/api/itinerant-actions/',
            {'titulo': 'Mutirão', 'local': 'Comunidade', 'data': '2030-01-01T10:00'}, content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 201, resposta.content)
        return resposta.json()['id']

    def _concluir(self, acao_id, **corpo):
        return self.como(self.tecnico).patch(
            f'/api/itinerant-actions/{acao_id}/concluir', corpo, content_type='application/json',
        )

    def test_numeros_validos(self):
        resposta = self._concluir(self._acao(), cidadaos_atendidos=10, participantes=3, beneficios_concedidos=2, casos_abertos=1)
        self.assertEqual(resposta.status_code, 200, resposta.content)

    def test_negativo_e_recusado(self):
        for campo in ('cidadaos_atendidos', 'participantes', 'beneficios_concedidos', 'casos_abertos'):
            corpo = {'cidadaos_atendidos': 1, campo: -5}
            self.assertEqual(self._concluir(self._acao(), **corpo).status_code, 400, campo)

    def test_numero_absurdo_e_recusado_em_vez_de_estourar_o_banco(self):
        self.assertEqual(self._concluir(self._acao(), cidadaos_atendidos=10 ** 12).status_code, 400)

    def test_nao_e_numero(self):
        self.assertEqual(self._concluir(self._acao(), cidadaos_atendidos='muitos').status_code, 400)


class AprovacaoValidaAntesDeTocarNoRealm(CenarioBase):
    def _pedido(self):
        return PedidoDeAcesso.objects.create(
            id=str(uuid.uuid4()), keycloak_id='kc-novo-1', email='novo@teste.local', nome='Novo Operador',
            pedido_em=timezone.now(),
        )

    def test_unidade_inexistente_e_recusada_sem_conceder_papel(self):
        pedido = self._pedido()
        with mock.patch('apps.contas.api.keycloak.definir_papel') as definir:
            resposta = self.como(self.admin).post(
                f'/api/access-requests/{pedido.id}/aprovar',
                {'papel': 'TECNICO', 'unidade_id': 'unidade-que-nao-existe'}, content_type='application/json',
            )
        self.assertEqual(resposta.status_code, 400, resposta.content)
        definir.assert_not_called()
        pedido.refresh_from_db()
        self.assertEqual(pedido.situacao, PedidoDeAcesso.Situacao.PENDENTE)

    def test_unidade_valida_segue(self):
        pedido = self._pedido()
        with mock.patch('apps.contas.api.keycloak.definir_papel') as definir:
            resposta = self.como(self.admin).post(
                f'/api/access-requests/{pedido.id}/aprovar',
                {'papel': 'TECNICO', 'unidade_id': self.centro.id}, content_type='application/json',
            )
        self.assertEqual(resposta.status_code, 200, resposta.content)
        definir.assert_called_once()


class AdminNaoSeTrancaParaFora(CenarioBase):
    def test_nao_desativa_a_propria_conta(self):
        with mock.patch('apps.contas.api.keycloak.remover_papeis') as remover:
            resposta = self.como(self.admin).put(
                f'/api/users/{self.admin.id}/atualizar', {'ativo': False}, content_type='application/json',
            )
        self.assertEqual(resposta.status_code, 400, resposta.content)
        remover.assert_not_called()
        self.admin.refresh_from_db()
        self.assertTrue(self.admin.ativo)

    def test_desativa_outro_operador(self):
        with mock.patch('apps.contas.api.keycloak.remover_papeis'):
            resposta = self.como(self.admin).put(
                f'/api/users/{self.tecnico.id}/atualizar', {'ativo': False}, content_type='application/json',
            )
        self.assertEqual(resposta.status_code, 200, resposta.content)


def _importar_settings(**ambiente):
    env = {k: v for k, v in os.environ.items() if not k.startswith(('DJANGO_', 'DEBUG', 'PII_'))}
    env.update({'DATABASE_URL': 'postgresql://u:p@localhost:5432/x', 'DJANGO_SETTINGS_MODULE': 'sgcas.settings', **ambiente})
    return subprocess.run(
        [sys.executable, '-c', 'import sgcas.settings'], cwd=RAIZ_DA_API, env=env, capture_output=True, text=True,
    )


class ChaveSecretaDeProducao(CenarioBase):
    """O boot recusa uma chave de exemplo ou fraca; um .env copiado do modelo não pode subir."""

    def test_chave_do_modelo_e_recusada_em_producao(self):
        resultado = _importar_settings(DEBUG='False', DJANGO_SECRET_KEY='CHAVE_SECRETA_AQUI')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('DJANGO_SECRET_KEY', resultado.stderr)

    def test_chave_curta_e_recusada_em_producao(self):
        resultado = _importar_settings(DEBUG='False', DJANGO_SECRET_KEY='curta123')
        self.assertNotEqual(resultado.returncode, 0)

    def test_chave_forte_sobe_em_producao(self):
        resultado = _importar_settings(DEBUG='False', DJANGO_SECRET_KEY='x' * 10 + uuid.uuid4().hex + uuid.uuid4().hex)
        self.assertEqual(resultado.returncode, 0, resultado.stderr)

    def test_em_desenvolvimento_a_chave_de_exemplo_vale(self):
        resultado = _importar_settings(DEBUG='True', DJANGO_SECRET_KEY='CHAVE_SECRETA_AQUI')
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


class LogsNaoGuardamCredenciais(_Navegador):
    """A chave da sessão é o que autentica: quem lê o log não pode levá-la dali."""

    def test_inicio_do_login_nao_registra_a_chave_da_sessao(self):
        navegador = self.navegador()
        with self.assertLogs('apps.contas.views', level='INFO') as registros:
            navegador.get('/api/auth/keycloak/login')
        chave = navegador.session.session_key
        self.assertTrue(chave)
        self.assertNotIn(chave, ' '.join(registros.output))

    def test_retorno_recusado_nao_registra_a_chave(self):
        navegador = self.navegador()
        navegador.get('/api/auth/keycloak/login')
        chave = navegador.session.session_key
        with self.assertLogs('apps.contas.views', level='WARNING') as registros:
            navegador.get('/api/auth/keycloak/callback?state=errado')
            navegador.get('/api/auth/keycloak/login')
            navegador.get('/api/auth/keycloak/callback?state=' + navegador.session['kc_state'])     # sem código
        self.assertNotIn(chave, ' '.join(registros.output))
        self.assertTrue(registros.output)


class LeiturasSensiveisSaoAuditadas(CenarioBase):
    """
    O relato de um caso e a ficha de um encaminhamento são dado sensível (violência,
    saúde): quem os abriu tem de constar na trilha, como já consta quem abriu o prontuário.
    """

    def _leituras(self):
        from apps.auditoria.models import RegistroDeAuditoria
        return RegistroDeAuditoria.objects.filter(acao='READ').count()

    def test_casos(self):
        antes = self._leituras()
        self.assertEqual(self.como(self.tecnico).get('/api/cases/').status_code, 200)
        self.assertEqual(self._leituras(), antes + 1)

    def test_encaminhamentos(self):
        antes = self._leituras()
        self.assertEqual(self.como(self.tecnico).get('/api/referrals/recebidos').status_code, 200)
        self.assertEqual(self._leituras(), antes + 1)

    def test_o_que_nao_e_sensivel_continua_fora_da_trilha(self):
        antes = self._leituras()
        self.como(self.tecnico).get('/api/institutional/units')
        self.como(self.tecnico).get('/api/notices/resumo')
        self.assertEqual(self._leituras(), antes)


class AnexoNaoSaiDaPasta(CenarioBase):
    def test_caminho_fora_da_pasta_do_cidadao_e_recusado(self):
        from apps.cidadaos import anexos
        with mock.patch.object(anexos, '_pasta', return_value=Path('/tmp/pasta-do-cidadao')):
            Path('/tmp/pasta-do-cidadao').mkdir(exist_ok=True)
            Path('/tmp/pasta-do-cidadao-irma').mkdir(exist_ok=True)
            Path('/tmp/pasta-do-cidadao-irma/segredo.jpg').write_bytes(b'x')
            # A pasta irmã tem o nome da pasta como prefixo: uma checagem por texto a aceitaria.
            with self.assertRaises(anexos.ErroDeAnexo):
                anexos.caminho(str(uuid.uuid4()), {'arquivo': '../pasta-do-cidadao-irma/segredo.jpg'})


class SenhaDoBancoEmProducao(CenarioBase):
    """
    O Compose já exige uma senha; a API também recusa a de exemplo, para o caso de o banco vir de
    outro lugar. Banco sem senha não é barrado: autenticação por socket (peer) é válida.
    """

    CIFRA = {'PII_ENCRYPTION_ENABLED': 'false'}

    def test_senha_de_exemplo_e_recusada_em_producao(self):
        resultado = _importar_settings(
            DEBUG='False', DJANGO_SECRET_KEY='k' * 60, DATABASE_URL='postgresql://sgcas:change-me@db:5432/sgcas',
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY=base64.b64encode(os.urandom(32)).decode(),
            PII_HMAC_KEY=base64.b64encode(os.urandom(32)).decode(),
        )
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('senha do banco', resultado.stderr)

    def test_senha_de_exemplo_vale_em_desenvolvimento(self):
        resultado = _importar_settings(
            DEBUG='True', DATABASE_URL='postgresql://sgcas:change-me@localhost:5434/sgcas', **self.CIFRA,
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)

    def test_senha_propria_sobe_em_producao(self):
        resultado = _importar_settings(
            DEBUG='False', DJANGO_SECRET_KEY='k' * 60, DATABASE_URL='postgresql://sgcas:Zq8-r4Lm_92xT@db:5432/sgcas',
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY=base64.b64encode(os.urandom(32)).decode(),
            PII_HMAC_KEY=base64.b64encode(os.urandom(32)).decode(),
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)


class CifraDosDadosPessoaisEmProducao(CenarioBase):
    """
    Sem cifragem, CPF, RG e e-mail ficam em texto puro no banco, e quem lê o banco (ou um
    backup) lê todo mundo. Em produção o boot recusa subir assim, ou com chaves que não
    servem: descobrir isso no primeiro cadastro, com a API no ar, seria tarde.
    """

    CHAVE_DE_CIFRA = base64.b64encode(os.urandom(32)).decode()
    CHAVE_DO_INDICE = base64.b64encode(os.urandom(32)).decode()

    def producao(self, **extra):
        ambiente = {'DEBUG': 'False', 'DJANGO_SECRET_KEY': 'k' * 60}
        ambiente.update(extra)
        return _importar_settings(**ambiente)

    def com_chaves(self, **extra):
        return self.producao(
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY=self.CHAVE_DE_CIFRA,
            PII_HMAC_KEY=self.CHAVE_DO_INDICE, **extra,
        )

    def test_producao_sem_cifragem_nao_sobe(self):
        resultado = self.producao(PII_ENCRYPTION_ENABLED='false', PII_ENCRYPTION_KEY='', PII_HMAC_KEY='')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('PII_ENCRYPTION_ENABLED', resultado.stderr)

    def test_producao_com_cifragem_mas_sem_chaves_nao_sobe(self):
        resultado = self.producao(PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY='', PII_HMAC_KEY='')
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('PII_ENCRYPTION_KEY', resultado.stderr)

    def test_chave_do_indice_ausente_nao_sobe(self):
        resultado = self.producao(
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY=self.CHAVE_DE_CIFRA, PII_HMAC_KEY='',
        )
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('PII_HMAC_KEY', resultado.stderr)

    def test_chave_que_nao_tem_32_bytes_nao_sobe(self):
        curta = base64.b64encode(os.urandom(16)).decode()
        resultado = self.producao(
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY=curta, PII_HMAC_KEY=self.CHAVE_DO_INDICE,
        )
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('PII_ENCRYPTION_KEY', resultado.stderr)

    def test_chave_que_nao_e_base64_nao_sobe(self):
        resultado = self.producao(
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY='isto não é base64!', PII_HMAC_KEY=self.CHAVE_DO_INDICE,
        )
        self.assertNotEqual(resultado.returncode, 0)

    def test_a_mesma_chave_para_cifrar_e_para_o_indice_nao_sobe(self):
        # Quem descobrisse uma teria a outra.
        resultado = self.producao(
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY=self.CHAVE_DE_CIFRA, PII_HMAC_KEY=self.CHAVE_DE_CIFRA,
        )
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('diferentes', resultado.stderr)

    def test_a_mensagem_de_erro_nao_revela_a_chave(self):
        resultado = self.producao(
            PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY=self.CHAVE_DE_CIFRA, PII_HMAC_KEY=self.CHAVE_DE_CIFRA,
        )
        self.assertNotIn(self.CHAVE_DE_CIFRA, resultado.stderr)

    def test_producao_com_cifragem_e_chaves_boas_sobe_sem_aviso(self):
        resultado = self.com_chaves()
        self.assertEqual(resultado.returncode, 0, resultado.stderr)
        self.assertNotIn('PII_', resultado.stderr)

    def test_desenvolvimento_pode_rodar_sem_cifragem(self):
        resultado = _importar_settings(
            DEBUG='True', PII_ENCRYPTION_ENABLED='false', PII_ENCRYPTION_KEY='', PII_HMAC_KEY='',
        )
        self.assertEqual(resultado.returncode, 0, resultado.stderr)

    def test_desenvolvimento_com_cifragem_ligada_e_chave_ruim_falha_cedo(self):
        resultado = _importar_settings(
            DEBUG='True', PII_ENCRYPTION_ENABLED='true', PII_ENCRYPTION_KEY='', PII_HMAC_KEY='',
        )
        self.assertNotEqual(resultado.returncode, 0)
        self.assertIn('PII_ENCRYPTION_KEY', resultado.stderr)
