"""
Rate limiting para endpoints de autenticacao.

Os endpoints de login/callback sao Django views, nao DRF, entao nao se beneficiam
do throttling configurado no REST_FRAMEWORK. Este middleware limita as rotas de
entrada, por IP, de duas formas:

- **Teto de volume** (`LIMITES`): requisicoes por minuto, qualquer que seja o
  resultado. Folgado de proposito: atras da prefeitura, secretaria, CRAS e CREAS
  saem pelo MESMO endereco publico (NAT), e um teto apertado deixava de fora a
  decima primeira pessoa a entrar no mesmo minuto. Serve so contra inundacao.
- **Teto de erros no retorno do Tefe Cidadao** (`FALHAS_NO_CALLBACK`): quem forja
  ou repete retornos paga por cada erro (estado invalido, sem codigo, troca do
  codigo recusada) e so por erro. Quem entra do jeito certo nunca gasta esse
  credito, entao um escritorio inteiro entra junto sem se atrapalhar. Os erros
  da conta de quem chegou (conflito, e-mail nao confirmado) nao contam: o token
  e valido e a pessoa e real.

Quem passa do limite numa rota que o navegador abre (login e retorno) volta para a
tela de login com um aviso, em vez de ver JSON cru; as demais recebem 429.

Tres cuidados, cada um corrigindo uma forma de o limite nao limitar:

- **O IP e o que o proxy viu**, nao o primeiro endereco de `X-Forwarded-For`
  (que o cliente escreve). Ver `apps.comum.rede`.
- **A janela e fixa.** O contador vive numa janela de `JANELA` segundos e
  recomeca na seguinte. Renovar o prazo a cada requisicao fazia quem usava com
  folga, mas sem ficar um minuto parado, acumular ate ser bloqueado.
- **O contador fica no banco**, na tabela do cache `limites`. Em memoria, cada
  worker do gunicorn teria o seu, e o limite real seria multiplicado pelo numero
  de workers. A contagem e feita sob uma trava por chave (advisory lock do
  Postgres) para que requisicoes simultaneas nao leiam o mesmo valor.
"""
from __future__ import annotations

import hashlib
import logging
import time
from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.core.cache import caches
from django.db import DatabaseError, connection, transaction
from django.http import HttpResponseRedirect, JsonResponse

from apps.comum.rede import ip_do_cliente

logger = logging.getLogger(__name__)

ROTA_DO_LOGIN = '/api/auth/keycloak/login'
ROTA_DO_RETORNO = '/api/auth/keycloak/callback'

# Teto de volume por IP e por janela. Folgado para um escritorio inteiro atras do
# mesmo endereco (ver o topo do modulo); nao e protecao contra senha, que e do
# Tefe Cidadao.
LIMITES = {
    ROTA_DO_LOGIN: 120,
    ROTA_DO_RETORNO: 120,
    '/api/auth/access-request/resend': 60,
}

# Erros no retorno do Tefe Cidadao que um IP pode acumular por janela.
FALHAS_NO_CALLBACK = 10

# `erro=` que o retorno coloca na volta ao login, quando o problema esta no pedido
# (forjado, repetido, codigo recusado). Os demais sao da conta de quem chegou.
ERROS_DE_PEDIDO = frozenset({'estado-invalido', 'sem-codigo', 'sem-acesso'})

# Rotas que o navegador abre por navegacao: um JSON cru na tela nao explica nada.
ROTAS_DE_NAVEGACAO = frozenset({ROTA_DO_LOGIN, ROTA_DO_RETORNO})

JANELA = 60  # segundos


def _agora() -> float:
    # Relógio do limitador, separado de `time.time` para os testes poderem
    # avançar a janela sem mexer no relógio do resto do processo.
    return time.time()


def _chave(ip: str | None, rota: str, janela: int) -> str:
    # O IP vira hash: o valor pode ser qualquer texto que chegou no cabecalho, e
    # a chave tem tamanho maximo na tabela do cache.
    resumo = hashlib.sha256((ip or '').encode()).hexdigest()[:32]
    return f'throttle:{rota}:{resumo}:{janela}'


def _chave_das_falhas(ip: str | None, janela: int) -> str:
    return _chave(ip, f'{ROTA_DO_RETORNO}#falhas', janela)


def _foi_erro_de_pedido(resposta) -> bool:
    """O retorno terminou em `/login?erro=<algo do pedido>`?"""
    if resposta.status_code not in (301, 302, 303, 307, 308):
        return False
    consulta = parse_qs(urlparse(resposta.get('Location', '')).query)
    return any(erro in ERROS_DE_PEDIDO for erro in consulta.get('erro', []))


def _registrar(chave: str, limite: int) -> bool:
    """
    Conta esta requisicao. Devolve `False` se o limite da janela ja foi atingido.

    Requisicao recusada nao e contada: o contador so cresce ate o limite.
    """
    with transaction.atomic():
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', [chave])

        cache = caches['limites']
        total = cache.get(chave, 0)
        if total >= limite:
            return False
        # Sobrevive a janela inteira e um pouco mais; depois disso a chave nunca
        # mais e consultada, porque o numero da janela entra nela.
        cache.set(chave, total + 1, JANELA * 2)
        return True


def _falhas_esgotadas(chave: str, limite: int) -> bool:
    return caches['limites'].get(chave, 0) >= limite


def _anotar_falha(chave: str) -> None:
    """
    Soma um erro. Sob a mesma trava das demais contagens, para erros simultaneos
    nao se perderem.

    O teto de erros e conferido ANTES da requisicao e este registro acontece
    DEPOIS dela: requisicoes simultaneas podem passar juntas do teto por alguns
    erros. E aceitavel — o freio e contra quem insiste por minutos, nao contra
    uma rajada de dois pedidos.
    """
    with transaction.atomic():
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', [chave])
        cache = caches['limites']
        cache.set(chave, cache.get(chave, 0) + 1, JANELA * 2)


def _recusar(request, janela: int, agora: float, motivo: str):
    espera = str(max(1, int((janela + 1) * JANELA - agora)))
    logger.warning('Limite de requisicoes atingido em %s (%s).', request.path, motivo)

    if request.path in ROTAS_DE_NAVEGACAO:
        resposta = HttpResponseRedirect(
            f'{settings.FRONTEND_URL.rstrip("/")}/login?erro=muitas-tentativas'
        )
    else:
        resposta = JsonResponse(
            {'detalhe': 'Muitas requisições. Aguarde um minuto e tente novamente.'},
            status=429,
        )
    resposta['Retry-After'] = espera
    return resposta


class ThrottleAuth:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method != 'GET' and request.method != 'POST':
            return self.get_response(request)

        limite = LIMITES.get(request.path)
        if limite is None:
            return self.get_response(request)

        agora = _agora()
        janela = int(agora // JANELA)
        ip = ip_do_cliente(request)
        chave = _chave(ip, request.path, janela)
        chave_das_falhas = _chave_das_falhas(ip, janela)
        conta_erros = request.path == ROTA_DO_RETORNO

        try:
            if not _registrar(chave, limite):
                return _recusar(request, janela, agora, 'volume')
            if conta_erros and _falhas_esgotadas(chave_das_falhas, FALHAS_NO_CALLBACK):
                return _recusar(request, janela, agora, 'erros')
        except DatabaseError:
            # O limite protege contra abuso; nao e a autenticacao. Se o contador
            # falhar, derrubar a entrada de todo mundo seria pior do que deixar
            # de contar — o erro fica no log.
            logger.exception('Falha ao contar tentativas em %s; requisicao liberada.', request.path)
            return self.get_response(request)

        resposta = self.get_response(request)

        if conta_erros and _foi_erro_de_pedido(resposta):
            try:
                _anotar_falha(chave_das_falhas)
            except DatabaseError:
                logger.exception('Falha ao anotar erro de retorno; resposta mantida.')
        return resposta
