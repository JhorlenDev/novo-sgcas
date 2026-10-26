"""
DEV-LOGIN — entrada de desenvolvimento, sem Keycloak. TEMPORÁRIO.

Existe só para trabalhar localmente enquanto não há um realm de teste. Não
substitui o login real: em produção o acesso é, e continua sendo, pelo Tefé
Cidadão.

Três travas, porque um atalho de autenticação esquecido ligado é o pior tipo de
falha possível neste sistema:

1. só funciona com `DEBUG=True` **e** `DEV_LOGIN_ENABLED=true` (desligado por
   padrão);
2. `sgcas/settings.py` se recusa a subir com `DEV_LOGIN_ENABLED` ligado e
   `DEBUG=False`;
3. as views conferem as duas condições de novo a cada requisição.

Uso: abrir http://localhost:3000/api/auth/dev e escolher perfil e unidade. As
contas criadas têm e-mail `dev-<perfil>@dev.local` e nenhum vínculo com o
Keycloak.

Para remover, quando o login real estiver configurado:

1. apagar este arquivo e `testes/test_dev_login.py`;
2. tirar as linhas marcadas com `DEV-LOGIN` (`git grep -n DEV-LOGIN`);
3. desativar as contas de teste, no mesmo padrão de `desligar_operador`:
   `Operador.objects.filter(email__endswith='@dev.local').update(ativo=False)`.
"""
from __future__ import annotations

import json
import logging
import uuid

from django.conf import settings
from django.http import Http404, HttpResponse, HttpResponseBadRequest
from django.utils import timezone
from django.utils.html import escape, format_html, format_html_join
from django.views.decorators.http import require_GET

from apps.contas.autenticacao import CHAVE_ID_TOKEN, CHAVE_OPERADOR
from apps.contas.models import Operador
from apps.contas.papeis import PRECEDENCIA
from apps.institucional.models import Unidade

logger = logging.getLogger(__name__)

# Mesma chave que o frontend grava ao sair (`front-sgcas/src/lib/api.ts`). Sem
# limpá-la, quem saiu e voltou por aqui seria mandado de volta ao /login: o
# front só pergunta quem está logado quando a chave não existe.
MARCADOR_DE_SAIDA = 'sgcas-logged-out'


def _liberado() -> bool:
    return bool(settings.DEBUG and settings.DEV_LOGIN_ENABLED)


def _pagina(corpo: str, status: int = 200) -> HttpResponse:
    return HttpResponse(
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
        '<title>Entrada de desenvolvimento</title></head>'
        f'<body style="font-family:sans-serif;max-width:32rem;margin:3rem auto">{corpo}</body></html>',
        status=status,
    )


@require_GET
def indice(request):
    """Formulário para escolher com que perfil e unidade entrar."""
    if not _liberado():
        raise Http404

    perfis = format_html_join('', '<option>{}</option>', ((p,) for p in PRECEDENCIA))
    unidades = format_html_join(
        '', '<option value="{}">{} — {}</option>',
        ((u.sigla, u.sigla, u.nome) for u in Unidade.ativas.order_by('sigla')),
    )
    return _pagina(format_html(
        '<h1>Entrada de desenvolvimento</h1>'
        '<p style="color:#b42318"><strong>Temporário.</strong> Não existe em produção.</p>'
        '<form method="get" action="/api/auth/dev/login">'
        '<p><label>Perfil<br><select name="papel">{}</select></label></p>'
        '<p><label>Unidade<br><select name="unidade">{}</select></label></p>'
        '<button type="submit">Entrar</button></form>',
        perfis, unidades,
    ))


@require_GET
def entrar_como(request):
    """Abre a sessão como o perfil pedido, criando a conta de teste se preciso."""
    if not _liberado():
        raise Http404

    papel = request.GET.get('papel') or 'ADMIN'
    if papel not in PRECEDENCIA:
        return HttpResponseBadRequest(f'Perfil desconhecido: {escape(papel)}')

    # Quase todo fluxo operacional exige unidade de lotação, inclusive para o
    # ADMIN (registrar recepção, chamar fila). Sem escolha, vale a primeira.
    sigla = request.GET.get('unidade')
    if sigla:
        unidade = Unidade.ativas.filter(sigla=sigla).first()
        if unidade is None:
            return HttpResponseBadRequest(f'Unidade desconhecida: {escape(sigla)}')
    else:
        unidade = Unidade.ativas.order_by('sigla').first()

    agora = timezone.now()
    email = f'dev-{papel.lower().replace("_", "-")}@dev.local'
    operador = Operador.objects.filter(email=email).first() or Operador(
        id=str(uuid.uuid4()), email=email, criado_em=agora,
    )
    operador.nome = f'[DEV] {papel}'
    operador.papel = papel
    operador.unidade = unidade
    operador.ativo = True
    operador.excluido_em = None
    operador.atualizado_em = agora
    operador.save()

    request.session.cycle_key()
    request.session[CHAVE_OPERADOR] = operador.id
    request.session[CHAVE_ID_TOKEN] = ''
    logger.warning(
        'DEV-LOGIN: sessão aberta sem Keycloak. operador=%s papel=%s unidade=%s',
        operador.id, papel, unidade.sigla if unidade else None,
    )

    destino = f'{settings.FRONTEND_URL.rstrip("/")}/dashboard'
    # `</` escapado para o valor nunca fechar o <script> por acidente.
    destino_js = json.dumps(destino).replace('</', '<\\/')
    return _pagina(
        f'<p>Entrando como <strong>{escape(operador.nome)}</strong>…</p>'
        f'<noscript><meta http-equiv="refresh" content="0;url={escape(destino)}"></noscript>'
        f'<script>try{{localStorage.removeItem("{MARCADOR_DE_SAIDA}")}}catch(e){{}}'
        f'location.replace({destino_js})</script>'
    )
