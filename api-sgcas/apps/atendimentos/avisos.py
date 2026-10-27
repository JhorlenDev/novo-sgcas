"""
O texto e a forma dos avisos entre unidades.

O aviso guarda o tipo e as ligações; o texto é montado aqui, na hora de mostrar,
com o nome vindo do cadastro. Assim, depois de uma eliminação LGPD, o aviso diz
"Cidadão excluído xxxxxxxx" sem que ninguém tenha de procurar o nome dentro de
mensagens gravadas. E nenhum texto livre do relato entra no aviso: ele vai para a
unidade inteira, recepção incluída.
"""
from __future__ import annotations

from rest_framework import serializers

from apps.atendimentos.models import Aviso

_URGENCIA = {'ALTA': ' Urgência alta.', 'URGENTE': ' Urgente.'}


def mensagem(aviso: Aviso) -> str:
    nome = aviso.cidadao.nome if aviso.cidadao_id else 'Uma pessoa'
    d = aviso.dados or {}
    Tipo = Aviso.Tipo

    if aviso.tipo == Tipo.ENCAMINHAMENTO_RECEBIDO:
        return (
            f'Encaminhamento recebido: {nome}, vindo de {d.get("origem")}. '
            f'Motivo: {d.get("categoria")}.{_URGENCIA.get(d.get("urgencia"), "")}'
        )
    if aviso.tipo == Tipo.ENCAMINHAMENTO_ACEITO:
        return f'{d.get("destino")} aceitou o encaminhamento de {nome}.'
    if aviso.tipo == Tipo.ENCAMINHAMENTO_RECUSADO:
        return f'{d.get("destino")} recusou o encaminhamento de {nome}. O motivo está na ficha.'
    if aviso.tipo == Tipo.PESSOA_CHEGOU:
        return f'{nome} chegou a {d.get("destino")} (encaminhamento de {d.get("origem")}).'
    if aviso.tipo == Tipo.ENCAMINHAMENTO_CONCLUIDO:
        return f'{d.get("destino")} concluiu o atendimento de {nome}.'
    if aviso.tipo == Tipo.NAO_COMPARECEU:
        return f'{nome} não compareceu ao atendimento em {d.get("destino")}.'
    if aviso.tipo == Tipo.ENCAMINHADO_ADIANTE:
        return f'{d.get("unidade")} encaminhou {nome} para {d.get("destino")}.'
    if aviso.tipo == Tipo.BENEFICIO_REPETIDO:
        # Avisos anteriores à janela de um ano não guardam o período: eram todos do mês.
        periodo = d.get('periodo') or 'neste mês'
        if d.get('pedido'):
            return (
                f'{d.get("unidade")} atendeu novamente o pedido de {d.get("o_que")} de {nome} '
                f'{periodo}. Justificativa registrada.'
            )
        return (
            f'{d.get("unidade")} concedeu {d.get("o_que")} novamente a {nome} {periodo}. '
            f'Justificativa registrada.'
        )
    return aviso.get_tipo_display()


class AvisoSerializer(serializers.ModelSerializer):
    titulo = serializers.CharField(source='get_tipo_display', read_only=True)
    mensagem = serializers.SerializerMethodField()
    cidadao_nome = serializers.CharField(source='cidadao.nome', read_only=True, default=None)
    lido = serializers.SerializerMethodField()

    class Meta:
        model = Aviso
        fields = [
            'id', 'tipo', 'titulo', 'mensagem', 'cidadao', 'cidadao_nome',
            'encaminhamento', 'criado_em', 'lido', 'lido_em',
        ]

    def get_mensagem(self, aviso):
        return mensagem(aviso)

    def get_lido(self, aviso):
        return aviso.lido_em is not None
