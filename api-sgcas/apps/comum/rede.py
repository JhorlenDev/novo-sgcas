"""
Quem está do outro lado da conexão.

Em produção a cadeia é navegador -> proxy reverso (nginx ou similar, que termina
o HTTPS) -> Next -> API. O proxy reverso acrescenta ao fim de `X-Forwarded-For`
o endereço que viu conectar. O proxy de rewrites do Next não acrescenta nada: só
repassa o cabeçalho como veio. O que vem antes do endereço acrescentado por nós
foi escrito por quem fez o pedido, e acreditar nele deixa qualquer um se passar
por outro IP — inclusive para escapar do limite de requisições.

`TRUSTED_PROXIES` diz quantos proxies reversos nossos acrescentam ao cabeçalho.
O endereço confiável é o que fica nessa posição, contando do fim:

    0 proxies (desenvolvimento)        ->  ignora o cabeçalho; vale a conexão
    1 proxy   (nginx)                  ->  "cliente"           vale o último
    2 proxies (balanceador + nginx)    ->  "cliente, balanc."  vale o penúltimo

Sem proxy reverso, o endereço da conexão é o do Next, igual para todos: o limite
e a auditoria passam a enxergar um único "cliente". Isto só protege se a API não
puder ser alcançada sem passar pelos proxies: quem chega direto a ela escreve o
cabeçalho inteiro.
"""
from __future__ import annotations

from django.conf import settings


def ip_do_cliente(request) -> str | None:
    remoto = request.META.get('REMOTE_ADDR')
    proxies = settings.TRUSTED_PROXIES
    if proxies <= 0:
        return remoto

    enderecos = [
        parte.strip()
        for parte in (request.META.get('HTTP_X_FORWARDED_FOR') or '').split(',')
        if parte.strip()
    ]
    if not enderecos:
        return remoto

    # Cadeia mais curta que o esperado: alguém falou com um proxy a menos do que
    # a infraestrutura prevê. Vale o que houver, o mais perto do cliente.
    return enderecos[-min(proxies, len(enderecos))]
