"""
Healthcheck: a API está de pé e o banco responde?

Fica num middleware no topo da cadeia, e não numa view, de propósito. O
healthcheck roda dentro do container, em HTTP puro e com o Host do próprio curl
(`127.0.0.1`), que em produção não está em ALLOWED_HOSTS. Como view, ele
esbarraria na validação de host (400) e no redirecionamento para HTTPS (301) —
e este último o `curl -f` aceita como sucesso, então o container pareceria
saudável sem a aplicação ter respondido. Aqui, nenhuma dessas camadas vê o
pedido, e nem sessão, limite de requisições ou auditoria entram em jogo.

A resposta não revela nada: o motivo da falha vai para o log, não para quem
perguntou — a rota não exige login.
"""
from __future__ import annotations

import logging

from django.db import Error as ErroDeBanco
from django.db import connection
from django.http import JsonResponse

logger = logging.getLogger(__name__)

CAMINHO = '/api/health'


class Saude:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path != CAMINHO or request.method not in ('GET', 'HEAD'):
            return self.get_response(request)

        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
        except ErroDeBanco:
            logger.exception('Healthcheck: o banco não respondeu.')
            resposta = JsonResponse({'status': 'indisponivel'}, status=503)
        else:
            resposta = JsonResponse({'status': 'ok'})

        resposta['Cache-Control'] = 'no-store'
        return resposta
