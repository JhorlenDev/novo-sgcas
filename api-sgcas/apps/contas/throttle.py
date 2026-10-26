"""
Rate limiting para endpoints de autenticacao.

Os endpoints de login/callback sao Django views, nao DRF, entao nao se beneficiam
do throttling configurado no REST_FRAMEWORK. Este middleware aplica limite
especifico: poucas requisicoes por minuto, por IP, nas rotas de entrada.

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

from django.core.cache import caches
from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse

from apps.comum.rede import ip_do_cliente

logger = logging.getLogger(__name__)

LIMITES = {
    '/api/auth/keycloak/login': 10,
    '/api/auth/keycloak/callback': 10,
    '/api/auth/access-request/resend': 5,
}

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
        chave = _chave(ip_do_cliente(request), request.path, janela)

        try:
            permitido = _registrar(chave, limite)
        except DatabaseError:
            # O limite protege contra abuso; nao e a autenticacao. Se o contador
            # falhar, derrubar a entrada de todo mundo seria pior do que deixar
            # de contar — o erro fica no log.
            logger.exception('Falha ao contar tentativas em %s; requisicao liberada.', request.path)
            return self.get_response(request)

        if permitido:
            return self.get_response(request)

        resposta = JsonResponse(
            {'erro': 'Muitas requisicoes. Aguarde e tente novamente.'},
            status=429,
        )
        resposta['Retry-After'] = str(max(1, int((janela + 1) * JANELA - agora)))
        return resposta
