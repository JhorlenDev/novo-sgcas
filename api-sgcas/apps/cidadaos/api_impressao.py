"""Prontuário impresso: a página HTML que o atendente imprime ou salva em PDF."""

from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.atendimentos.models import (
    AtendimentoDeRecepcao,
    BeneficioEventual,
    Caso,
    Encaminhamento,
)
from apps.cidadaos.models import Cidadao

from django.utils.html import escape
from django.utils import timezone

from apps.contas.permissoes import (
    EquipeDeAtendimento,
)
from apps.cidadaos.api_comum import _registrar_auditoria


def _linha_html(rotulo, valor):
    if valor in (None, ''):
        return ''
    return f'<div class="linha"><span>{escape(rotulo)}</span><strong>{escape(str(valor))}</strong></div>'


def _data_curta(valor):
    if not valor:
        return ''
    return timezone.localtime(valor).strftime('%d/%m/%Y %H:%M') if hasattr(valor, 'hour') else valor.strftime('%d/%m/%Y')


def _rotulo(valor, escolhas):
    return dict(escolhas).get(valor, valor)


@api_view(['GET'])
@permission_classes([EquipeDeAtendimento])
def imprimir_prontuario(request, cidadao_id: str):
    """Gera uma versão HTML limpa para impressão/salvar em PDF pelo navegador."""
    cidadao = Cidadao.vigentes.filter(id=cidadao_id).first()
    if cidadao is None:
        return Response({'detalhe': 'Cidadão não encontrado'}, status=status.HTTP_404_NOT_FOUND)

    casos = (
        Caso.vigentes.filter(cidadao=cidadao)
        .select_related('unidade', 'tecnico', 'servico')
        .order_by('-aberto_em')[:20]
    )
    atendimentos = (
        AtendimentoDeRecepcao.objects.filter(cidadao=cidadao)
        .select_related('unidade', 'atendido_por', 'caso')
        .order_by('-criado_em')[:20]
    )
    beneficios = (
        BeneficioEventual.vigentes.filter(cidadao=cidadao)
        .select_related('unidade', 'registrado_por')
        .order_by('-criado_em')[:20]
    )
    encaminhamentos = (
        Encaminhamento.objects.filter(caso__cidadao=cidadao)
        .select_related('unidade_destino', 'encaminhado_por')
        .order_by('-criado_em')[:20]
    )

    def item(titulo, detalhe=''):
        return f'<li><strong>{escape(titulo)}</strong>{f"<p>{escape(detalhe)}</p>" if detalhe else ""}</li>'

    casos_html = ''.join(item(
        f'{caso.protocolo} · {_rotulo(caso.situacao, Caso.Situacao.choices)}',
        ' · '.join(filter(None, [
            caso.servico.nome if caso.servico_id else 'Serviço não informado',
            caso.unidade.nome if caso.unidade_id else '',
            _data_curta(caso.aberto_em),
            caso.descricao or '',
        ])),
    ) for caso in casos) or '<li class="vazio">Sem casos registrados.</li>'

    atendimentos_html = ''.join(item(
        f'{_rotulo(atendimento.desfecho, AtendimentoDeRecepcao.Desfecho.choices)} · {atendimento.demanda}',
        ' · '.join(filter(None, [
            atendimento.unidade.nome if atendimento.unidade_id else '',
            atendimento.atendido_por.nome if atendimento.atendido_por_id else '',
            _data_curta(atendimento.criado_em),
            atendimento.motivo or '',
        ])),
    ) for atendimento in atendimentos) or '<li class="vazio">Sem atendimentos registrados.</li>'

    beneficios_html = ''.join(item(
        f'{beneficio.get_tipo_display() if beneficio.tipo in dict(BeneficioEventual.Tipo.choices) else beneficio.tipo} · {beneficio.nome_da_pessoa}',
        ' · '.join(filter(None, [
            beneficio.unidade.nome if beneficio.unidade_id else '',
            beneficio.registrado_por.nome if beneficio.registrado_por_id else '',
            _data_curta(beneficio.criado_em),
            beneficio.descricao or '',
        ])),
    ) for beneficio in beneficios) or '<li class="vazio">Sem benefícios registrados.</li>'

    encaminhamentos_html = ''.join(item(
        f'{encaminhamento.unidade_destino.nome if encaminhamento.unidade_destino_id else encaminhamento.destino_externo} · {_rotulo(encaminhamento.situacao, Encaminhamento.Situacao.choices)}',
        ' · '.join(filter(None, [
            encaminhamento.encaminhado_por.nome if encaminhamento.encaminhado_por_id else '',
            _data_curta(encaminhamento.criado_em),
            encaminhamento.motivo,
            encaminhamento.observacoes or '',
        ])),
    ) for encaminhamento in encaminhamentos) or '<li class="vazio">Sem encaminhamentos registrados.</li>'

    socio = cidadao.socioeconomico or {}
    familia = cidadao.membros_da_familia or []
    familia_html = ''.join(item(
        str(membro.get('nome_membro') or membro.get('nome') or 'Membro familiar'),
        ' · '.join(filter(None, [
            str(membro.get('parentesco') or ''),
            f"CPF: {membro.get('cpf_membro')}" if membro.get('cpf_membro') else '',
            f"Nascimento: {membro.get('data_nascimento')}" if membro.get('data_nascimento') else '',
        ])),
    ) for membro in familia if isinstance(membro, dict)) or '<li class="vazio">Sem composição familiar cadastrada.</li>'

    html = f"""<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Prontuário - {escape(cidadao.nome)}</title>
  <style>
    :root {{ color: #182230; font-family: Arial, Helvetica, sans-serif; }}
    body {{ margin: 0; background: #f4f7fb; }}
    main {{ max-width: 920px; margin: 0 auto; padding: 32px; background: white; min-height: 100vh; }}
    header {{ border-bottom: 3px solid #1d6fd7; padding-bottom: 18px; margin-bottom: 22px; }}
    .marca {{ color: #1d6fd7; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }}
    h1 {{ margin: 8px 0 4px; font-size: 28px; }}
    h2 {{ margin: 22px 0 10px; font-size: 16px; color: #1d6fd7; border-bottom: 1px solid #d8e2ef; padding-bottom: 6px; }}
    .sub {{ color: #5d6b7c; font-size: 13px; }}
    .grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; }}
    .linha {{ background: #f7f9fc; border: 1px solid #e6edf5; border-radius: 10px; padding: 9px 11px; }}
    .linha span {{ display: block; color: #667085; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }}
    .linha strong {{ display: block; margin-top: 3px; font-size: 13px; font-weight: 700; }}
    ul {{ list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }}
    li {{ border: 1px solid #e6edf5; border-radius: 10px; padding: 10px 12px; }}
    li strong {{ font-size: 13px; }}
    li p {{ margin: 5px 0 0; color: #536171; font-size: 12px; line-height: 1.45; }}
    .vazio {{ color: #667085; font-size: 13px; }}
    footer {{ margin-top: 28px; color: #667085; font-size: 11px; border-top: 1px solid #d8e2ef; padding-top: 12px; }}
    @media print {{ body {{ background: white; }} main {{ padding: 0; }} .no-print {{ display: none; }} }}
  </style>
</head>
<body>
  <main>
    <button class="no-print" onclick="window.print()" style="float:right;border:0;background:#1d6fd7;color:white;border-radius:999px;padding:10px 16px;font-weight:700;cursor:pointer">Imprimir / salvar PDF</button>
    <header>
      <div class="marca">SGCAS · Prontuário do cidadão</div>
      <h1>{escape(cidadao.nome)}</h1>
      <div class="sub">Gerado em {_data_curta(timezone.now())} por {escape(getattr(request.user, 'nome', '') or getattr(request.user, 'email', 'operador'))}</div>
    </header>

    <h2>Dados pessoais</h2>
    <section class="grid">
      {_linha_html('CPF', cidadao.cpf)}
      {_linha_html('NIS', cidadao.nis)}
      {_linha_html('RG', cidadao.rg)}
      {_linha_html('Nascimento', cidadao.nascimento.strftime('%d/%m/%Y') if cidadao.nascimento else '')}
      {_linha_html('Telefone', cidadao.telefone)}
      {_linha_html('E-mail', cidadao.email)}
      {_linha_html('Endereço', ', '.join(filter(None, [cidadao.endereco, cidadao.bairro, cidadao.cidade, cidadao.uf])))}
      {_linha_html('CEP', cidadao.cep)}
    </section>

    <h2>Socioeconômico</h2>
    <section class="grid">
      {_linha_html('Renda total', socio.get('renda_total'))}
      {_linha_html('Pessoas na residência', socio.get('quantidade_pessoas_residencia'))}
      {_linha_html('Recebe benefício', 'Sim' if socio.get('recebe_beneficio') else 'Não' if 'recebe_beneficio' in socio else '')}
      {_linha_html('Observações', socio.get('observacoes_gerais'))}
    </section>

    <h2>Composição familiar</h2>
    <ul>{familia_html}</ul>

    <h2>Casos e acompanhamentos</h2>
    <ul>{casos_html}</ul>

    <h2>Atendimentos de recepção</h2>
    <ul>{atendimentos_html}</ul>

    <h2>Benefícios eventuais</h2>
    <ul>{beneficios_html}</ul>

    <h2>Encaminhamentos</h2>
    <ul>{encaminhamentos_html}</ul>

    <footer>Documento gerado pelo SGCAS para uso administrativo. Dados pessoais devem ser tratados conforme a LGPD.</footer>
  </main>
</body>
</html>"""

    _registrar_auditoria(
        request,
        'EXPORT',
        'cidadao',
        cidadao.id,
        dados_novos={'acao': 'impressao_prontuario'},
    )

    return HttpResponse(html, content_type='text/html; charset=utf-8')
