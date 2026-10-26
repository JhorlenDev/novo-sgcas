"""
Um caso encerrado não volta a ser concluído nem encaminhado.

"Encerrado" é o que o resto do sistema já entende por isso: concluído ou
cancelado (a fila e o painel os excluem). Sem a guarda, concluir de novo
reescrevia o fechamento, duplicava a conclusão no relato e — pior — liberava a
senha EM_ATENDIMENTO de um atendimento *novo* da mesma pessoa na unidade.
"""
import threading
import uuid
from unittest import mock

from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone

from apps.atendimentos import api
from apps.atendimentos.models import Caso, Encaminhamento, SenhaDaFila
from testes.base import CenarioBase
from testes.test_concluir_caso import _CasoEmAtendimento


class _Operacoes(_CasoEmAtendimento):
    def concluir(self, caso_id, relato='Feito', situacao='CONCLUIDO'):
        return self.post(f'/api/cases/{caso_id}/concluir', {'situacao': situacao, 'relato': relato})

    def encaminhar(self, caso_id):
        return self.post(
            f'/api/cases/{caso_id}/encaminhar',
            {'unidade_destino_id': self.centro.id, 'motivo': 'Precisa do CRAS Centro'},
        )

    def estado(self, caso_id):
        return Caso.objects.get(pk=caso_id)


class ConcluirCasoEncerrado(_Operacoes):
    def test_caso_concluido_nao_pode_ser_concluido_de_novo(self):
        caso_id = self.abrir()
        self.assertEqual(self.concluir(caso_id).status_code, 200)
        antes = self.estado(caso_id)

        resposta = self.concluir(caso_id, relato='Segunda conclusão')

        self.assertEqual(resposta.status_code, 409)
        self.assertIn('já foi encerrado', resposta.json()['detalhe'])
        depois = self.estado(caso_id)
        self.assertEqual(depois.descricao, antes.descricao)      # sem conclusão duplicada
        self.assertEqual(depois.fechado_em, antes.fechado_em)    # o fechamento não é reescrito
        self.assertNotIn('Segunda conclusão', depois.descricao)

    def test_caso_cancelado_nao_pode_ser_concluido(self):
        caso_id = self.abrir()
        senha = SenhaDaFila.objects.get(situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO)
        self.post(f'/api/queues/{senha.id}/nao-compareceu', {'motivo': 'Não veio'})
        self.assertEqual(self.estado(caso_id).situacao, Caso.Situacao.CANCELADO)

        resposta = self.concluir(caso_id)

        self.assertEqual(resposta.status_code, 409)
        self.assertIn('Cancelado', resposta.json()['detalhe'])
        self.assertEqual(self.estado(caso_id).situacao, Caso.Situacao.CANCELADO)

    def test_a_mensagem_diz_em_que_situacao_o_caso_esta(self):
        caso_id = self.abrir()
        self.concluir(caso_id)
        self.assertIn('Concluído', self.concluir(caso_id).json()['detalhe'])

    def test_reconcluir_nao_fecha_a_senha_de_um_atendimento_novo(self):
        # O dano concreto: concluir libera a senha EM_ATENDIMENTO da mesma pessoa
        # na unidade. Se ela já voltou e foi chamada de novo, essa senha é outra.
        caso_antigo = self.abrir()
        self.concluir(caso_antigo)

        agora = timezone.now()
        nova = SenhaDaFila.objects.create(
            id=str(uuid.uuid4()), senha='NR002', cidadao=self.cidadao, unidade=self.sul,
            prioridade='NORMAL', situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO,
            atendido_por=self.coordenador, criado_em=agora, atualizado_em=agora,
        )

        self.assertEqual(self.concluir(caso_antigo).status_code, 409)
        nova.refresh_from_db()
        self.assertEqual(nova.situacao, SenhaDaFila.Situacao.EM_ATENDIMENTO)

    def test_caso_em_atendimento_continua_podendo_ser_concluido(self):
        self.assertEqual(self.concluir(self.abrir()).status_code, 200)

    def test_caso_em_triagem_continua_podendo_ser_concluido(self):
        caso_id = self.abrir()
        Caso.objects.filter(pk=caso_id).update(situacao=Caso.Situacao.EM_TRIAGEM)
        self.assertEqual(self.concluir(caso_id).status_code, 200)

    def test_caso_encaminhado_continua_podendo_ser_concluido(self):
        # Quem recebe o encaminhamento é quem conclui: ENCAMINHADO é caso aberto.
        caso_id = self.abrir()
        Caso.objects.filter(pk=caso_id).update(situacao=Caso.Situacao.ENCAMINHADO)
        self.assertEqual(self.concluir(caso_id).status_code, 200)

    def test_caso_de_outra_unidade_continua_sendo_403_e_nao_409(self):
        # A permissão vem antes: não se revela o estado de caso alheio.
        caso_id = self.abrir()
        self.concluir(caso_id)
        resposta = self.como(self.tecnico).post(
            f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'x'},
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 403)


class EncaminharCasoEncerrado(_Operacoes):
    def test_caso_concluido_nao_pode_ser_encaminhado(self):
        caso_id = self.abrir()
        self.concluir(caso_id)

        resposta = self.encaminhar(caso_id)

        self.assertEqual(resposta.status_code, 409)
        caso = self.estado(caso_id)
        self.assertEqual(caso.situacao, Caso.Situacao.CONCLUIDO)   # não é reaberto
        self.assertEqual(caso.unidade_id, self.sul.id)             # não muda de unidade
        self.assertFalse(Encaminhamento.objects.filter(caso_id=caso_id).exists())

    def test_caso_cancelado_nao_pode_ser_encaminhado(self):
        caso_id = self.abrir()
        Caso.objects.filter(pk=caso_id).update(situacao=Caso.Situacao.CANCELADO)
        self.assertEqual(self.encaminhar(caso_id).status_code, 409)

    def test_caso_em_atendimento_continua_podendo_ser_encaminhado(self):
        caso_id = self.abrir()
        self.assertEqual(self.encaminhar(caso_id).status_code, 201)
        self.assertEqual(self.estado(caso_id).situacao, Caso.Situacao.ENCAMINHADO)


class DuasConclusoesAoMesmoTempo(TransactionTestCase):
    """Conexões separadas: a corrida não existe dentro da transação única de um TestCase."""

    def setUp(self):
        CenarioBase.setUpTestData.__func__(type(self))
        CenarioBase.como(self, self.recepcionista).post(
            '/api/reception/atendimento',
            {'cidadao_id': self.cidadao.id, 'servico_id': self.servico.id, 'desfecho': 'ENCAMINHADO'},
            content_type='application/json',
        )
        resposta = CenarioBase.como(self, self.coordenador).post(
            '/api/queues/chamar-proximo', {}, content_type='application/json',
        )
        self.caso_id = resposta.json()['caso']['id']

    def _concluir(self, resultados, indice):
        try:
            resultados[indice] = CenarioBase.como(self, self.coordenador).post(
                f'/api/cases/{self.caso_id}/concluir',
                {'situacao': 'CONCLUIDO', 'relato': f'Conclusão {indice}'},
                content_type='application/json',
            )
        finally:
            connections.close_all()

    def test_so_uma_conclusao_vence(self):
        # Força o encontro: as duas chegam à gravação do relato juntas. Sem
        # trava no caso, as duas passam pela checagem de estado e as duas
        # concluem; com a trava, a segunda só lê depois da primeira gravar.
        gravar = api._acrescentar_ao_relato
        encontro = threading.Barrier(2, timeout=1)

        def gravar_e_esperar(*args, **kwargs):
            try:
                encontro.wait()
            except threading.BrokenBarrierError:
                pass
            return gravar(*args, **kwargs)

        resultados = {}
        with mock.patch.object(api, '_acrescentar_ao_relato', gravar_e_esperar):
            fios = [threading.Thread(target=self._concluir, args=(resultados, i)) for i in range(2)]
            for fio in fios:
                fio.start()
            for fio in fios:
                fio.join(timeout=30)

        codigos = sorted(r.status_code for r in resultados.values())
        self.assertEqual(codigos, [200, 409], codigos)
        descricao = Caso.objects.get(pk=self.caso_id).descricao
        self.assertEqual(descricao.count('Concluído.'), 1, descricao)
