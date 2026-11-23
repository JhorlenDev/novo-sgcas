"""
`dados_de_demonstracao`: cria um administrador fictício e uma sessão sem passar pelo Tefé
Cidadão, então só pode rodar em desenvolvimento. O que ele cria entra pela própria API.
"""
import re
from io import StringIO

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, TestCase, override_settings

from apps.atendimentos.models import SenhaDaFila
from apps.cidadaos.models import Cidadao
from apps.contas.management.commands.dados_de_demonstracao import (
    EMAIL_DO_OPERADOR,
    PESSOAS,
    QUANTOS_VAO_PARA_A_FILA,
)
from apps.contas.models import Operador

NOMES = [pessoa[0] for pessoa in PESSOAS]


def rodar(*argumentos) -> str:
    saida = StringIO()
    call_command('dados_de_demonstracao', *argumentos, stdout=saida)
    return saida.getvalue()


class SoEmDesenvolvimento(TestCase):
    @override_settings(DEBUG=False)
    def test_recusa_sem_debug_e_nao_cria_nada(self):
        with self.assertRaisesMessage(CommandError, 'DEBUG=True'):
            rodar()
        self.assertFalse(Operador.objects.filter(email=EMAIL_DO_OPERADOR).exists())

    @override_settings(DEBUG=True)
    def test_sem_catalogo_pede_o_cadastrar_servicos(self):
        with self.assertRaisesMessage(CommandError, 'cadastrar_servicos'):
            rodar()


@override_settings(DEBUG=True)
class CriaPelaApi(TestCase):
    @classmethod
    def setUpTestData(cls):
        call_command('cadastrar_servicos', stdout=StringIO())

    def test_cria_operador_cidadaos_fila_e_uma_sessao_que_entra(self):
        saida = rodar()

        operador = Operador.objects.get(email=EMAIL_DO_OPERADOR)
        self.assertEqual(operador.papel, 'ADMIN')
        self.assertEqual(Cidadao.vigentes.filter(nome__in=NOMES).count(), len(PESSOAS))
        # Os que foram para a fila: um já chamado pelo operador, os outros aguardando.
        self.assertEqual(
            SenhaDaFila.objects.filter(atendido_por=operador, situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO).count(), 1,
        )
        self.assertEqual(
            SenhaDaFila.objects.filter(situacao=SenhaDaFila.Situacao.AGUARDANDO).count(), QUANTOS_VAO_PARA_A_FILA - 1,
        )

        # A chave impressa abre uma sessão de verdade.
        chave = re.search(rf'{settings.SESSION_COOKIE_NAME}=([a-z0-9]+);', saida).group(1)
        cliente = Client(HTTP_HOST='localhost')
        cliente.cookies[settings.SESSION_COOKIE_NAME] = chave
        self.assertEqual(cliente.get('/api/auth/me').json()['email'], EMAIL_DO_OPERADOR)

    def test_rodar_de_novo_nao_duplica(self):
        rodar()
        rodar()
        self.assertEqual(Operador.objects.filter(email=EMAIL_DO_OPERADOR).count(), 1)
        self.assertEqual(Cidadao.vigentes.filter(nome__in=NOMES).count(), len(PESSOAS))
        self.assertEqual(SenhaDaFila.objects.count(), QUANTOS_VAO_PARA_A_FILA)

    def test_so_sessao_nao_cria_cidadaos(self):
        rodar('--so-sessao')
        self.assertTrue(Operador.objects.filter(email=EMAIL_DO_OPERADOR).exists())
        self.assertEqual(Cidadao.vigentes.filter(nome__in=NOMES).count(), 0)
