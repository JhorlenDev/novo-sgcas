"""
O relato do caso é um histórico: a observação da recepção, a evolução anotada
durante o atendimento e, por fim, a conclusão. Concluir acrescenta; não pode
apagar o que veio antes — é o registro que o próximo atendimento vai ler.
"""
import re

from apps.atendimentos.models import Caso, SenhaDaFila
from testes.base import CenarioBase

PADRAO_DA_ANOTACAO = r'\[\d{2}/\d{2}/\d{4} \d{2}:\d{2}\] Coordenador: '


class _CasoEmAtendimento(CenarioBase):
    """Um caso aberto na recepção e já chamado da fila, para os testes abaixo."""

    def abrir(self):
        self.como(self.recepcionista).post(
            '/api/reception/atendimento',
            {
                'cidadao_id': self.cidadao.id, 'servico_id': self.servico.id,
                'desfecho': 'ENCAMINHADO', 'observacao': 'Pedido de cesta básica',
            },
            content_type='application/json',
        )
        resposta = self.como(self.coordenador).post(
            '/api/queues/chamar-proximo', {}, content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 200)
        return resposta.json()['caso']['id']

    def post(self, caminho, corpo):
        return self.como(self.coordenador).post(caminho, corpo, content_type='application/json')



class ConcluirPreservaOHistorico(_CasoEmAtendimento):
    def test_concluir_nao_apaga_o_que_veio_antes(self):
        caso_id = self.abrir()
        self.post(f'/api/cases/{caso_id}/observacao', {'observacao': 'Visita agendada para sexta'})

        resposta = self.post(
            f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'Cesta entregue'},
        )

        self.assertEqual(resposta.status_code, 200)
        descricao = Caso.objects.get(pk=caso_id).descricao
        self.assertIn('Pedido de cesta básica', descricao)
        self.assertIn('Visita agendada para sexta', descricao)
        self.assertIn('Cesta entregue', descricao)
        # Na ordem em que aconteceu.
        self.assertLess(descricao.index('Pedido de cesta'), descricao.index('Visita agendada'))
        self.assertLess(descricao.index('Visita agendada'), descricao.index('Cesta entregue'))

    def test_conclusao_entra_com_data_autor_e_situacao(self):
        caso_id = self.abrir()
        self.post(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'Cesta entregue'})

        descricao = Caso.objects.get(pk=caso_id).descricao
        self.assertRegex(descricao, PADRAO_DA_ANOTACAO + r'Concluído\. Cesta entregue$')

    def test_continua_encerrando_o_caso_e_liberando_a_senha(self):
        caso_id = self.abrir()
        self.post(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'Cesta entregue'})

        caso = Caso.objects.get(pk=caso_id)
        self.assertEqual(caso.situacao, Caso.Situacao.CONCLUIDO)
        self.assertIsNotNone(caso.fechado_em)
        self.assertEqual(caso.tecnico_id, self.coordenador.id)
        self.assertFalse(SenhaDaFila.objects.filter(situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO).exists())
        self.assertTrue(SenhaDaFila.objects.filter(situacao=SenhaDaFila.Situacao.ATENDIDO).exists())

    def test_caso_sem_descricao_previa_recebe_so_a_conclusao(self):
        caso_id = self.abrir()
        Caso.objects.filter(pk=caso_id).update(descricao=None)
        self.post(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'Cesta entregue'})

        descricao = Caso.objects.get(pk=caso_id).descricao
        self.assertFalse(descricao.startswith('\n'), repr(descricao))
        self.assertRegex(descricao, r'^' + PADRAO_DA_ANOTACAO + r'Concluído\. Cesta entregue$')

    def test_relato_vazio_continua_recusado(self):
        caso_id = self.abrir()
        resposta = self.post(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': '  '})
        self.assertEqual(resposta.status_code, 400)
        self.assertEqual(Caso.objects.get(pk=caso_id).situacao, Caso.Situacao.EM_ATENDIMENTO)

    def test_caso_de_outra_unidade_continua_fechado(self):
        caso_id = self.abrir()
        resposta = self.como(self.tecnico).post(
            f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'x'},
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 403)
        self.assertIn('Pedido de cesta básica', Caso.objects.get(pk=caso_id).descricao)


class NaoCompareceuTambemPreserva(_CasoEmAtendimento):
    """Já acrescentava; fixa o comportamento para os dois caminhos não divergirem."""

    def test_nao_compareceu_mantem_o_historico(self):
        caso_id = self.abrir()
        senha_id = SenhaDaFila.objects.get(situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO).id
        self.post(f'/api/queues/{senha_id}/nao-compareceu', {'motivo': 'Não atendeu o telefone'})

        caso = Caso.objects.get(pk=caso_id)
        self.assertEqual(caso.situacao, Caso.Situacao.CANCELADO)
        self.assertIn('Pedido de cesta básica', caso.descricao)
        self.assertRegex(caso.descricao, PADRAO_DA_ANOTACAO + r'Não compareceu\. Não atendeu o telefone$')
