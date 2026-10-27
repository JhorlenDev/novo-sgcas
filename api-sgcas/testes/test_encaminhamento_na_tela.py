"""
O que a tela precisa da API para o encaminhamento chegar a quem atende.

O técnico do destino chama a pessoa e precisa ter a ficha diante dos olhos, no
mesmo lugar onde atende — não procurá-la em outra tela. E a prévia de duplicidade
da recepção tem de dar a mesma resposta que o registro vai dar: se a prévia
avisasse de uma repetição que o registro não cobra, a recepção escreveria uma
justificativa à toa.
"""
from apps.atendimentos.models import Caso, Encaminhamento, SenhaDaFila
from testes.test_duplicidade import _PedidoDoSulAoCentro
from testes.test_encaminhamento_chegada import _Chegada


class FichaNoAtendimento(_Chegada):
    def chamar(self, operador=None):
        return self.como(operador or self.tecnico).post('/api/queues/chamar-proximo')

    def test_quem_chama_a_pessoa_recebe_a_ficha_do_encaminhamento(self):
        caso_id, enc = self.enviar(urgencia='ALTA')
        self.chegar(enc)

        recebido = self.chamar().json()['encaminhamento_recebido']
        self.assertEqual(recebido['id'], enc.id)
        self.assertEqual(recebido['unidade_origem_nome'], 'CRAS Sul')
        self.assertEqual(recebido['urgencia'], 'ALTA')
        self.assertIn('resumo_da_situacao', recebido)
        self.assertEqual(recebido['ficha']['unidade_origem'], 'CRAS Sul')

    def test_atendimento_comum_nao_tem_encaminhamento_recebido(self):
        self.chegar()
        self.assertIsNone(self.chamar().json()['encaminhamento_recebido'])

    def test_retomar_o_atendimento_traz_a_ficha_de_novo(self):
        _, enc = self.enviar()
        self.chegar(enc)
        self.chamar()
        atual = self.como(self.tecnico).get('/api/queues/atendimento-atual').json()
        self.assertEqual(atual['encaminhamento_recebido']['id'], enc.id)

    def test_o_encaminhamento_recusado_nao_e_o_que_a_pessoa_trouxe(self):
        _, enc = self.enviar()
        self.chegar(enc)
        Encaminhamento.objects.filter(pk=enc.pk).update(situacao=Encaminhamento.Situacao.RECUSADO)
        self.assertIsNone(self.chamar().json()['encaminhamento_recebido'])

    def test_o_encaminhamento_de_outra_unidade_nao_aparece_para_quem_atende_aqui(self):
        # Quem atende no Sul (a origem) não vê o encaminhamento como "recebido".
        caso_id, enc = self.enviar()
        self.chegar(enc)
        Caso.objects.filter(pk=caso_id).update(unidade=self.sul)
        SenhaDaFila.objects.filter(caso_id=caso_id).update(unidade=self.sul)
        resposta = self.chamar(self.coordenador)
        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.assertIsNone(resposta.json()['encaminhamento_recebido'])


class PreviaRespeitaOEncaminhamento(_PedidoDoSulAoCentro):
    def previa(self, **parametros):
        consulta = '&'.join(f'{k}={v}' for k, v in parametros.items())
        return self.como(self.recepcao()).get(
            f'/api/citizens/{self.cidadao.id}/duplicidade?servico_id={self.servico_do_centro.id}&{consulta}'
        )

    def test_com_o_encaminhamento_a_previa_nao_acusa_o_atendimento_que_o_originou(self):
        enc = self.pedido_no_sul_encaminhado_ao_centro()
        resposta = self.previa(encaminhamento_id=enc.id)
        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.assertEqual(resposta.json(), {'alertas': [], 'exige_justificativa': False})

    def test_sem_o_encaminhamento_a_previa_acusa(self):
        self.pedido_no_sul_encaminhado_ao_centro()
        corpo = self.como(self.recepcao()).get(
            f'/api/citizens/{self.cidadao.id}/duplicidade?servico_id={self.servico_do_centro.id}'
        ).json()
        self.assertTrue(corpo['exige_justificativa'])
        self.assertEqual(corpo['alertas'][0]['unidade'], 'CRAS Sul')

    def test_encaminhamento_inexistente_nao_isenta(self):
        self.pedido_no_sul_encaminhado_ao_centro()
        corpo = self.previa(encaminhamento_id='inventado').json()
        self.assertTrue(corpo['exige_justificativa'])
