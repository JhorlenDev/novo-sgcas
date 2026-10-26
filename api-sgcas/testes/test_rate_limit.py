"""
Limite de requisições nas rotas de entrada, e o IP em que ele se apoia.

O limite vale por IP, e o IP vem de `X-Forwarded-For`, que o cliente escreve. O
Next (o proxy que está na frente da API) acrescenta o endereço que viu ao fim do
cabeçalho; o que vem antes é do cliente. Por isso o endereço confiável é o que
fica na posição do último proxy, não o primeiro.
"""
import threading
from unittest import mock

from django.core.cache import caches
from django.db import DatabaseError, connection, connections
from django.test import Client, RequestFactory, SimpleTestCase, TransactionTestCase, override_settings

from apps.comum.rede import ip_do_cliente
from apps.contas import throttle
from testes.base import CenarioBase

LOGIN = '/api/auth/keycloak/login'
CALLBACK = '/api/auth/keycloak/callback?state=x'
LIMITE_DO_LOGIN = throttle.LIMITES[LOGIN]
INICIO_DE_JANELA = 6000  # múltiplo de 60: começo exato de uma janela


def _requisicao(remoto='127.0.0.1', encaminhado=None):
    extra = {'REMOTE_ADDR': remoto}
    if encaminhado is not None:
        extra['HTTP_X_FORWARDED_FOR'] = encaminhado
    return RequestFactory().get('/', **extra)


class IpDoCliente(SimpleTestCase):
    @override_settings(TRUSTED_PROXIES=1)
    def test_sem_cabecalho_vale_o_endereco_da_conexao(self):
        self.assertEqual(ip_do_cliente(_requisicao('10.0.0.9')), '10.0.0.9')

    @override_settings(TRUSTED_PROXIES=1)
    def test_com_um_proxy_vale_o_ultimo_endereco(self):
        # O primeiro é do cliente, que pode escrever o que quiser.
        self.assertEqual(ip_do_cliente(_requisicao(encaminhado='1.2.3.4, 198.51.100.7')), '198.51.100.7')

    @override_settings(TRUSTED_PROXIES=1)
    def test_um_unico_endereco_e_o_do_cliente(self):
        self.assertEqual(ip_do_cliente(_requisicao(encaminhado='198.51.100.7')), '198.51.100.7')

    @override_settings(TRUSTED_PROXIES=2)
    def test_com_dois_proxies_vale_o_penultimo(self):
        self.assertEqual(
            ip_do_cliente(_requisicao(encaminhado='falso, 198.51.100.7, 10.0.0.2')), '198.51.100.7',
        )

    @override_settings(TRUSTED_PROXIES=2)
    def test_cadeia_mais_curta_que_o_esperado_usa_o_que_houver(self):
        self.assertEqual(ip_do_cliente(_requisicao(encaminhado='198.51.100.7')), '198.51.100.7')

    @override_settings(TRUSTED_PROXIES=0)
    def test_sem_proxy_confiavel_o_cabecalho_e_ignorado(self):
        self.assertEqual(ip_do_cliente(_requisicao('10.0.0.9', encaminhado='1.2.3.4')), '10.0.0.9')

    @override_settings(TRUSTED_PROXIES=1)
    def test_ignora_espacos_e_entradas_vazias(self):
        self.assertEqual(ip_do_cliente(_requisicao(encaminhado=' 1.2.3.4 ,  198.51.100.7 , ')), '198.51.100.7')

    @override_settings(TRUSTED_PROXIES=1)
    def test_cabecalho_so_com_virgulas_cai_no_endereco_da_conexao(self):
        self.assertEqual(ip_do_cliente(_requisicao('10.0.0.9', encaminhado=' , ,')), '10.0.0.9')


def _cliente(real, falso=None):
    """Navegador atrás do proxy: ele acrescenta `real` ao fim do cabeçalho."""
    cadeia = f'{falso}, {real}' if falso else real
    return Client(headers={'host': 'localhost', 'X-Forwarded-For': cadeia})


def _fixar_o_relogio(teste, instante=INICIO_DE_JANELA + 10):
    """
    Sem isto o teste depende da hora em que roda: se o minuto virar entre duas
    requisições, o contador recomeça no meio e o resultado muda.
    """
    relogio = mock.patch.object(throttle, '_agora', return_value=instante)
    relogio.start()
    teste.addCleanup(relogio.stop)


@override_settings(TRUSTED_PROXIES=1)
class LimiteDasRotasDeEntrada(CenarioBase):
    def setUp(self):
        _fixar_o_relogio(self)

    def esgotar(self, real):
        cliente = _cliente(real)
        for _ in range(LIMITE_DO_LOGIN):
            self.assertEqual(cliente.get(LOGIN).status_code, 302)

    def test_bloqueia_depois_do_limite_e_diz_quando_voltar(self):
        self.esgotar('198.51.100.1')
        resposta = _cliente('198.51.100.1').get(LOGIN)

        self.assertEqual(resposta.status_code, 429)
        espera = int(resposta['Retry-After'])
        self.assertTrue(1 <= espera <= throttle.JANELA, espera)

    def test_falsificar_o_primeiro_endereco_nao_contorna_o_limite(self):
        self.esgotar('198.51.100.2')
        for i in range(5):
            resposta = _cliente('198.51.100.2', falso=f'203.0.113.{i}').get(LOGIN)
            self.assertEqual(resposta.status_code, 429, i)

    def test_clientes_diferentes_nao_se_afetam(self):
        self.esgotar('198.51.100.3')
        self.assertEqual(_cliente('198.51.100.4').get(LOGIN).status_code, 302)

    def test_cada_rota_tem_o_proprio_contador(self):
        self.esgotar('198.51.100.5')
        self.assertEqual(_cliente('198.51.100.5').get(CALLBACK).status_code, 302)

    def test_rotas_fora_da_lista_nao_sao_limitadas(self):
        cliente = _cliente('198.51.100.6')
        for _ in range(LIMITE_DO_LOGIN + 5):
            self.assertEqual(cliente.get('/api/auth/me').status_code, 401)  # sem sessão, mas não 429

    def test_libera_na_janela_seguinte(self):
        cliente = _cliente('198.51.100.7')
        with mock.patch.object(throttle, '_agora', return_value=INICIO_DE_JANELA + 10):
            self.esgotar('198.51.100.7')
            self.assertEqual(cliente.get(LOGIN).status_code, 429)
        with mock.patch.object(throttle, '_agora', return_value=INICIO_DE_JANELA + 61):
            self.assertEqual(cliente.get(LOGIN).status_code, 302)

    def test_janela_e_fixa_uso_espacado_nao_acumula(self):
        # Antes, cada requisição renovava o prazo do contador: quem usava com
        # folga, mas sem nunca ficar um minuto parado, acabava bloqueado.
        cliente = _cliente('198.51.100.8')
        metade = LIMITE_DO_LOGIN // 2 + 1
        with mock.patch.object(throttle, '_agora', return_value=INICIO_DE_JANELA + 55):
            for _ in range(metade):
                self.assertEqual(cliente.get(LOGIN).status_code, 302)
        with mock.patch.object(throttle, '_agora', return_value=INICIO_DE_JANELA + 65):
            for _ in range(metade):
                self.assertEqual(cliente.get(LOGIN).status_code, 302)

    def test_o_contador_fica_no_banco_e_nao_na_memoria_do_processo(self):
        # Com vários workers do gunicorn, um contador em memória multiplicaria o
        # limite pelo número de processos.
        _cliente('198.51.100.9').get(LOGIN)
        tabela = caches['limites']._table
        with connection.cursor() as cursor:
            cursor.execute(f'SELECT count(*) FROM {tabela}')
            self.assertGreaterEqual(cursor.fetchone()[0], 1)

    def test_falha_do_contador_nao_derruba_a_entrada(self):
        # O limite é proteção contra abuso, não a autenticação: se o contador
        # falhar, entrar tem de continuar possível — e o erro fica no log.
        with mock.patch.object(throttle, '_registrar', side_effect=DatabaseError('indisponível')):
            with self.assertLogs('apps.contas.throttle', level='ERROR'):
                resposta = _cliente('198.51.100.10').get(LOGIN)
        self.assertEqual(resposta.status_code, 302)


@override_settings(TRUSTED_PROXIES=1)
class ContagemExataSobConcorrencia(TransactionTestCase):
    def setUp(self):
        _fixar_o_relogio(self)

    def test_requisicoes_simultaneas_respeitam_o_limite_exato(self):
        resultados = []
        trava = threading.Lock()

        def chamar():
            try:
                codigo = _cliente('198.51.100.200').get(LOGIN).status_code
                with trava:
                    resultados.append(codigo)
            finally:
                connections.close_all()

        fios = [threading.Thread(target=chamar) for _ in range(LIMITE_DO_LOGIN * 2)]
        for fio in fios:
            fio.start()
        for fio in fios:
            fio.join(timeout=60)

        self.assertEqual(len(resultados), LIMITE_DO_LOGIN * 2)
        self.assertEqual(resultados.count(302), LIMITE_DO_LOGIN, sorted(resultados))
        self.assertEqual(resultados.count(429), LIMITE_DO_LOGIN, sorted(resultados))
