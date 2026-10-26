"""
Numeração das senhas da fila.

A senha é `prefixo + número do dia`, por unidade e por prioridade. Duas pessoas
na fila com a mesma senha é o pior defeito possível ali: o painel chama "NR003"
e as duas se levantam.
"""
import threading
import uuid
from unittest import mock

from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone

from apps.atendimentos import api
from apps.atendimentos.models import SenhaDaFila
from testes.base import CenarioBase


def _senha_avulsa(cenario, numero, prefixo='NR'):
    agora = timezone.now()
    return SenhaDaFila.objects.create(
        id=str(uuid.uuid4()), senha=f'{prefixo}{numero:03d}', cidadao=cenario.cidadao,
        unidade=cenario.sul, prioridade='NORMAL', criado_em=agora, atualizado_em=agora,
    )


class NumeracaoSequencial(CenarioBase):
    def test_primeira_do_dia_e_001(self):
        self.assertEqual(api._proxima_senha(self.sul.id, 'NORMAL'), 'NR001')

    def test_segue_a_ultima_do_dia(self):
        _senha_avulsa(self, 1)
        _senha_avulsa(self, 2)
        self.assertEqual(api._proxima_senha(self.sul.id, 'NORMAL'), 'NR003')

    def test_lacuna_nao_reaproveita_numero(self):
        # Contar linhas daria NR002 aqui — e NR002 já existe.
        _senha_avulsa(self, 1)
        _senha_avulsa(self, 2)
        SenhaDaFila.objects.filter(senha='NR001').delete()
        self.assertEqual(api._proxima_senha(self.sul.id, 'NORMAL'), 'NR003')

    def test_cada_prioridade_tem_a_propria_sequencia(self):
        _senha_avulsa(self, 1)
        self.assertEqual(api._proxima_senha(self.sul.id, 'URGENTE'), 'UR001')
        self.assertEqual(api._proxima_senha(self.sul.id, 'ALTA'), 'PR001')
        self.assertEqual(api._proxima_senha(self.sul.id, 'BAIXA'), 'BX001')

    def test_cada_unidade_tem_a_propria_sequencia(self):
        _senha_avulsa(self, 1)
        self.assertEqual(api._proxima_senha(self.centro.id, 'NORMAL'), 'NR001')

    def test_ignora_senha_fora_do_formato(self):
        SenhaDaFila.objects.filter(unidade=self.sul).delete()
        _senha_avulsa(self, 5)
        outra = _senha_avulsa(self, 0)
        SenhaDaFila.objects.filter(pk=outra.pk).update(senha='NR-manual')
        self.assertEqual(api._proxima_senha(self.sul.id, 'NORMAL'), 'NR006')


class DuasRecepcoesAoMesmoTempo(TransactionTestCase):
    """
    Transação de verdade e conexões separadas: é o único jeito de reproduzir a
    corrida, que não existe dentro da transação única de um TestCase.
    """

    def setUp(self):
        CenarioBase.setUpTestData.__func__(type(self))

    def _registrar(self, resultados, indice):
        try:
            cliente = CenarioBase.como(self, self.recepcionista)
            resposta = cliente.post(
                '/api/reception/atendimento',
                {'cidadao_id': self.cidadao.id, 'servico_id': self.servico.id, 'desfecho': 'ENCAMINHADO'},
                content_type='application/json',
            )
            resultados[indice] = resposta
        finally:
            connections.close_all()

    def test_senhas_simultaneas_nao_repetem(self):
        # Força o pior encontro: as duas calculam o número antes de qualquer
        # uma gravar. Sem trava, as duas saem com NR001. Com a trava, a segunda
        # espera a primeira terminar; o tempo limite só evita que o teste
        # fique preso esperando uma barreira que a trava nunca deixa fechar.
        calcular = api._proxima_senha
        encontro = threading.Barrier(2, timeout=1)

        def calcular_e_esperar(unidade_id, prioridade):
            senha = calcular(unidade_id, prioridade)
            try:
                encontro.wait()
            except threading.BrokenBarrierError:
                pass
            return senha

        resultados = {}
        with mock.patch.object(api, '_proxima_senha', calcular_e_esperar):
            fios = [threading.Thread(target=self._registrar, args=(resultados, i)) for i in range(2)]
            for fio in fios:
                fio.start()
            for fio in fios:
                fio.join(timeout=30)

        self.assertEqual({r.status_code for r in resultados.values()}, {201}, resultados)
        senhas = sorted(SenhaDaFila.objects.values_list('senha', flat=True))
        self.assertEqual(senhas, ['NR001', 'NR002'])

    def test_varias_senhas_simultaneas_saem_todas_diferentes(self):
        resultados = {}
        fios = [threading.Thread(target=self._registrar, args=(resultados, i)) for i in range(6)]
        for fio in fios:
            fio.start()
        for fio in fios:
            fio.join(timeout=60)

        self.assertEqual({r.status_code for r in resultados.values()}, {201})
        senhas = list(SenhaDaFila.objects.values_list('senha', flat=True))
        self.assertEqual(len(senhas), 6)
        self.assertEqual(len(set(senhas)), 6, sorted(senhas))
