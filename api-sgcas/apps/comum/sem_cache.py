"""
Nada do que a API devolve fica guardado no navegador.

Prontuário, impressão, exportação e anexos são dados pessoais, e em um CRAS
vários servidores usam o mesmo computador: o que ficasse em cache (ou na
página "voltar") ainda estaria ali para o próximo a sentar. Valem também as
respostas de erro, que podem carregar o nome de quem foi buscado.

`add_never_cache_headers` é o que o Django oferece para isso: `no-store`,
`no-cache`, `must-revalidate`, `private` e `max-age=0`, mais `Expires`.
"""
from django.utils.cache import add_never_cache_headers


class SemCacheNaApi:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        resposta = self.get_response(request)
        if request.path.startswith('/api/'):
            add_never_cache_headers(resposta)
        return resposta
