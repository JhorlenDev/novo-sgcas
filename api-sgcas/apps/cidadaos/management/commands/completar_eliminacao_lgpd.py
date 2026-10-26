"""
Completa as eliminações de dados pessoais feitas pela versão anterior.

Aquela versão apagava 10 campos do cadastro, marcava o registro como eliminado e
deixava o resto — data de nascimento, raça, deficiência, a composição da família
com os CPFs, os JSON de documentos e situação socioeconômica, o nome nos
benefícios e os arquivos escaneados no disco. Quem pediu a eliminação teve o
pedido registrado como atendido sem ter sido.

Só toca em cadastro que o próprio sistema eliminou: marcado como excluído e com o
nome anônimo ("Cidadão excluído xxxxxxxx"). Um registro excluído por outro motivo
— duplicidade, por exemplo — não é eliminação LGPD e não é apagado às cegas.

Idempotente. A saída mostra só o início do id, nunca dado pessoal. Use
`--simular` antes: o que este comando apaga não tem volta.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.cidadaos import eliminacao
from apps.cidadaos.models import Cidadao


class Command(BaseCommand):
    help = 'Completa as eliminações de dados pessoais que a versão anterior deixou pela metade.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--simular', action='store_true',
            help='Relata o que seria apagado, sem apagar nada.',
        )

    def handle(self, *args, **opcoes):
        # `objects` inclui os excluídos, que `vigentes` esconde.
        eliminados = Cidadao.objects.filter(
            excluido_em__isnull=False, nome__startswith=eliminacao.PREFIXO_DO_NOME_ANONIMO,
        )

        com_pendencia = []
        for cidadao in eliminados.iterator():
            faltando = eliminacao.pendencias(cidadao)
            if faltando:
                com_pendencia.append((cidadao, faltando))

        self.stdout.write(f'cadastros eliminados pelo sistema : {eliminados.count()}')
        self.stdout.write(f'com dados que ficaram para trás    : {len(com_pendencia)}')

        if not com_pendencia:
            self.stdout.write(self.style.SUCCESS('nada a fazer'))
            return

        for cidadao, faltando in com_pendencia:
            self.stdout.write(f'  {cidadao.id[:8]}…: {len(faltando)} pendência(s) — {", ".join(faltando)}')

        if opcoes['simular']:
            self.stdout.write(self.style.WARNING('simulação — nada foi apagado'))
            return

        agora = timezone.now()
        for cidadao, _ in com_pendencia:
            # Por cadastro: os arquivos de um só saem do disco depois que o banco
            # daquele cadastro gravou.
            with transaction.atomic():
                eliminacao.eliminar(cidadao, agora)

        self.stdout.write(self.style.SUCCESS(f'{len(com_pendencia)} cadastro(s) completado(s)'))
