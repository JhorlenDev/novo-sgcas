"""O que as views do cadastro de cidadão compartilham: o registro na trilha de auditoria."""


from apps.auditoria.redacao import redigir
from apps.comum.rede import ip_do_cliente
import uuid

from django.utils import timezone



def _registrar_auditoria(request, acao, entidade, entidade_id, dados_novos=None, dados_antes=None):
    """Registra ação LGPD na trilha de auditoria."""
    from apps.auditoria.models import RegistroDeAuditoria

    operador = getattr(request, 'user', None)
    RegistroDeAuditoria(
        id=str(uuid.uuid4()),
        operador=operador if getattr(operador, 'is_authenticated', False) else None,
        acao=acao,
        entidade=entidade,
        entidade_id=entidade_id,
        dados_antes=redigir(dados_antes) if dados_antes else None,
        dados_depois=redigir(dados_novos) if dados_novos else None,
        endereco_ip=ip_do_cliente(request),
        navegador=(request.META.get('HTTP_USER_AGENT') or '')[:400] or None,
        criado_em=timezone.now(),
    ).save(force_insert=True)
