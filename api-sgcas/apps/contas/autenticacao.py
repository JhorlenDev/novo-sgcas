"""
Autenticacao das requisicoes do DRF a partir da sessao.

A sessao e criada no retorno do Tefe Cidadao e guarda apenas o identificador do
operador. O papel e relido do banco a cada requisicao, e nao copiado para a
sessao: assim, retirar o acesso de alguem tem efeito imediato, em vez de valer
so quando a sessao dela expirar.

Duas travas que o DRF nao poe sozinho numa autenticacao propria:

- **CSRF.** As views do DRF sao isentas do `CsrfViewMiddleware`, e a classe de
  sessao do DRF (que confere o token) nao e a usada aqui. Sem conferir, so o
  `SameSite=Lax` do cookie protegia as escritas, o que nao vale contra outro
  subdominio do mesmo site. O front ja manda `X-CSRFToken` em toda escrita.
- **Vida maxima.** A sessao renova a cada requisicao; sem um teto, quem usa o
  sistema sem pausa longa nunca precisa entrar de novo, e uma permissao retirada
  direto no Keycloak so chegaria aqui no proximo login.
"""
import time

from django.conf import settings
from rest_framework import authentication, exceptions

from apps.contas.models import Operador

CHAVE_OPERADOR = 'operador_id'
CHAVE_ID_TOKEN = 'id_token'
CHAVE_LOGIN_EM = 'login_em'


class SessaoDoTefeCidadao(authentication.SessionAuthentication):
    def authenticate_header(self, request):
        """
        Sem este cabeçalho o DRF responde 403 a quem não tem sessão, igual a quem
        tem sessão mas não tem permissão. O front só leva ao login quando recebe
        401, então uma sessão que expirava no meio do uso deixava a tela cheia de
        erros. "Session" é um esquema próprio: só Basic e Digest fazem o
        navegador abrir a janela de usuário e senha.
        """
        return 'Session'

    def authenticate(self, request):
        operador_id = request.session.get(CHAVE_OPERADOR)
        if not operador_id:
            return None

        self._conferir_vida_da_sessao(request)

        operador = (
            Operador.objects.select_related('unidade')
            .filter(id=operador_id, excluido_em__isnull=True)
            .first()
        )

        if operador is None:
            request.session.flush()
            raise exceptions.AuthenticationFailed('Sessão inválida')

        if not operador.ativo:
            # Desativado enquanto a sessao estava aberta: a sessao morre junto.
            request.session.flush()
            raise exceptions.AuthenticationFailed('Acesso desativado')

        # A escrita so vale com o token CSRF; a leitura nao precisa.
        self.enforce_csrf(request)
        return (operador, None)

    @staticmethod
    def _conferir_vida_da_sessao(request) -> None:
        agora = time.time()
        iniciada = request.session.get(CHAVE_LOGIN_EM)
        if iniciada is None:
            # Aberta antes desta regra existir: ganha a marca agora, para nao derrubar
            # todo mundo de uma vez na implantacao. Dali em diante vale o limite.
            request.session[CHAVE_LOGIN_EM] = agora
            return
        try:
            vencida = agora - float(iniciada) > settings.SESSION_MAX_LIFETIME
        except (TypeError, ValueError):
            vencida = True
        if vencida:
            request.session.flush()
            raise exceptions.AuthenticationFailed('Sessão expirada')
