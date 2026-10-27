"""
A pessoa chega à unidade de destino.

Antes, a recepção de lá abria um caso novo e o caso encaminhado ficava parado
para sempre: dois casos da mesma pessoa, sem ligação, e a origem sem saber que ela
chegou. Agora a visita cumpre o encaminhamento: é o mesmo caso, com a ficha, na
fila do destino — na urgência que o técnico de origem definiu.
"""
import uuid

from django.utils import timezone

from apps.atendimentos.models import (
    AtendimentoDeRecepcao, Aviso, Caso, Encaminhamento, SenhaDaFila,
)
from apps.contas.models import Operador
from testes.test_encaminhamentos_caixa import _Caixa


class _Chegada(_Caixa):
    """O encaminhamento Sul -> Centro já foi enviado; a pessoa chega ao Centro."""

    def setUp(self):
        self.recepcao_centro = None

    def recepcao(self):
        if self.recepcao_centro is None:
            self.recepcao_centro = self.operador('RECEPCIONISTA', self.centro, 'recepcao centro')
        return self.recepcao_centro

    def chegar(self, enc=None, operador=None, **mudancas):
        corpo = {
            'cidadao_id': self.cidadao.id, 'servico_id': self.servico_do_centro.id,
            'desfecho': 'ENCAMINHADO', 'observacao': 'Veio encaminhada do CRAS Sul',
        }
        if enc is not None:
            corpo['encaminhamento_id'] = enc.id
        corpo.update(mudancas)
        return self.como(operador or self.recepcao()).post(
            '/api/reception/atendimento', corpo, content_type='application/json',
        )


class ChegadaCumpreOEncaminhamento(_Chegada):
    def test_e_o_mesmo_caso_nao_um_segundo(self):
        caso_id, enc = self.enviar()
        resposta = self.chegar(enc)

        self.assertEqual(resposta.status_code, 201, resposta.content)
        self.assertEqual(Caso.objects.filter(cidadao=self.cidadao).count(), 1)
        caso = Caso.objects.get(pk=caso_id)
        self.assertEqual(caso.unidade_id, self.centro.id)
        self.assertEqual(caso.situacao, Caso.Situacao.EM_TRIAGEM)
        self.assertEqual(resposta.json()['caso']['id'], caso_id)

    def test_a_senha_entra_na_fila_do_destino_ligada_ao_caso(self):
        caso_id, enc = self.enviar()
        senha = SenhaDaFila.objects.get(pk=self.chegar(enc).json()['senha']['id'])
        self.assertEqual(senha.unidade_id, self.centro.id)
        self.assertEqual(senha.caso_id, caso_id)
        self.assertEqual(senha.situacao, SenhaDaFila.Situacao.AGUARDANDO)

    def test_a_urgencia_tecnica_da_origem_vale_na_fila(self):
        # A recepção não marca urgência (é avaliação técnica); o técnico que
        # encaminhou marcou, e é essa que vale.
        _, enc = self.enviar(urgencia='URGENTE')
        senha = self.chegar(enc).json()['senha']
        self.assertEqual(senha['prioridade'], 'URGENTE')
        self.assertTrue(senha['senha'].startswith('UR'), senha['senha'])

    def test_a_recepcao_nao_rebaixa_a_urgencia_do_encaminhamento(self):
        _, enc = self.enviar(urgencia='ALTA')
        senha = self.chegar(enc, prioridade='BAIXA').json()['senha']
        self.assertEqual(senha['prioridade'], 'ALTA')

    def test_a_visita_fica_ligada_ao_caso_e_ao_encaminhamento(self):
        caso_id, enc = self.enviar()
        self.chegar(enc)
        visita = AtendimentoDeRecepcao.objects.get(atendido_por=self.recepcao())
        self.assertEqual(visita.caso_id, caso_id)
        self.assertEqual(visita.encaminhamento_id, enc.id)
        self.assertEqual(visita.unidade_id, self.centro.id)

    def test_o_encaminhamento_fica_aceito_e_registra_a_chegada(self):
        _, enc = self.enviar()
        self.chegar(enc)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.ACEITO)
        self.assertEqual(enc.respondido_por_id, self.recepcao().id)
        self.assertIsNotNone(enc.chegou_em)
        self.assertIsNotNone(enc.respondido_em)

    def test_se_o_tecnico_ja_tinha_aceitado_a_chegada_so_registra_a_chegada(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar', {'observacao': 'Vamos agendar'})
        self.chegar(enc)
        enc.refresh_from_db()
        self.assertEqual(enc.respondido_por_id, self.tecnico.id)    # quem aceitou segue sendo quem aceitou
        self.assertEqual(enc.resposta, 'Vamos agendar')
        self.assertIsNotNone(enc.chegou_em)

    def test_a_origem_e_avisada_de_que_a_pessoa_chegou(self):
        _, enc = self.enviar()
        self.chegar(enc)
        aviso = Aviso.objects.get(tipo=Aviso.Tipo.PESSOA_CHEGOU)
        self.assertEqual(aviso.unidade_id, self.sul.id)
        mensagens = [a['mensagem'] for a in self.como(self.coordenador).get('/api/notices/').json()]
        self.assertIn(f'{self.cidadao.nome} chegou a CRAS Centro (encaminhamento de CRAS Sul).', mensagens)

    def test_o_relato_do_caso_registra_a_chegada(self):
        caso_id, enc = self.enviar()
        self.chegar(enc)
        relato = Caso.objects.get(pk=caso_id).descricao
        self.assertIn('Chegou a CRAS Centro', relato)
        self.assertIn('CRAS Sul', relato)
        self.assertIn('Veio encaminhada do CRAS Sul', relato)
        self.assertIn('Pedido de cesta básica', relato)           # o que a origem já tinha escrito

    def test_o_servico_do_caso_passa_a_ser_o_do_destino(self):
        caso_id, enc = self.enviar()
        self.chegar(enc)
        self.assertEqual(Caso.objects.get(pk=caso_id).servico_id, self.servico_do_centro.id)

    def test_o_caso_encaminhado_e_o_que_o_tecnico_atende_mesmo_havendo_outro_mais_novo(self):
        # A fila procurava "o caso aberto mais recente da pessoa na unidade": o
        # encaminhado, mais antigo, perderia para qualquer caso novo. A senha agora
        # sabe qual caso atende.
        caso_id, enc = self.enviar()
        agora = timezone.now()
        Caso.objects.create(
            id=str(uuid.uuid4()), protocolo='OUTRO-1', cidadao=self.cidadao, unidade=self.centro,
            situacao=Caso.Situacao.EM_TRIAGEM, descricao='Caso mais novo, sem relação',
            aberto_em=agora, criado_em=agora, atualizado_em=agora,
        )
        self.chegar(enc)
        chamado = self.no_destino('/api/queues/chamar-proximo').json()
        self.assertEqual(chamado['caso']['id'], caso_id)
        self.assertEqual(Caso.objects.get(pk=caso_id).situacao, Caso.Situacao.EM_ATENDIMENTO)

    def test_o_ciclo_completo_ate_a_conclusao(self):
        caso_id, enc = self.enviar()
        self.chegar(enc)
        chamado = self.no_destino('/api/queues/chamar-proximo').json()
        self.assertEqual(chamado['caso']['id'], caso_id)
        self.assertIn('violência doméstica', chamado['encaminhamento_recebido']['motivo'])     # a ficha chegou

        resposta = self.no_destino(
            f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'Acompanhamento iniciado'},
        )
        self.assertEqual(resposta.status_code, 200)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.CONCLUIDO)
        self.assertEqual(
            sorted(a.tipo for a in Aviso.objects.filter(unidade=self.sul)),
            ['ENCAMINHAMENTO_CONCLUIDO', 'PESSOA_CHEGOU'],
        )


class QuandoNaoHaVinculo(_Chegada):
    def test_sem_encaminhamento_id_tudo_continua_como_antes(self):
        _, enc = self.enviar()
        # Sem o vínculo, a chegada é um pedido novo — e o sistema o trata como a
        # repetição que é, exigindo a justificativa (ver test_duplicidade).
        resposta = self.chegar(justificativa_duplicidade='A recepção optou por abrir um atendimento novo.')

        self.assertEqual(resposta.status_code, 201, resposta.content)
        self.assertEqual(Caso.objects.filter(cidadao=self.cidadao).count(), 2)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.PENDENTE)
        self.assertIsNone(enc.chegou_em)
        self.assertFalse(Aviso.objects.filter(tipo=Aviso.Tipo.PESSOA_CHEGOU).exists())

    def test_a_senha_de_um_atendimento_novo_tambem_sabe_o_seu_caso(self):
        resposta = self.chegar()
        senha = SenhaDaFila.objects.get(pk=resposta.json()['senha']['id'])
        self.assertEqual(senha.caso_id, resposta.json()['caso']['id'])

    def test_senha_antiga_sem_caso_continua_funcionando(self):
        resposta = self.chegar()
        SenhaDaFila.objects.filter(pk=resposta.json()['senha']['id']).update(caso=None)
        chamado = self.no_destino('/api/queues/chamar-proximo')
        self.assertEqual(chamado.status_code, 200)
        self.assertEqual(chamado.json()['caso']['id'], resposta.json()['caso']['id'])


class QuandoOVinculoNaoSeAplica(_Chegada):
    def test_encaminhamento_inexistente(self):
        resposta = self.chegar(encaminhamento_id='inventado')
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('encaminhamento_id', resposta.json())

    def test_encaminhamento_de_outra_pessoa(self):
        from apps.cidadaos.models import Cidadao
        _, enc = self.enviar()
        agora = timezone.now()
        outra = Cidadao.objects.create(id=str(uuid.uuid4()), nome='Outra Pessoa', criado_em=agora, atualizado_em=agora)
        resposta = self.chegar(enc, cidadao_id=outra.id)
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('encaminhamento_id', resposta.json())
        enc.refresh_from_db()
        self.assertIsNone(enc.chegou_em)

    def test_a_visita_e_a_outra_unidade_que_nao_a_de_destino(self):
        _, enc = self.enviar()                                    # destino: Centro
        recepcao_sul = self.recepcionista                         # recepção do Sul
        resposta = self.chegar(enc, operador=recepcao_sul, servico_id=self.servico.id)
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('encaminhamento_id', resposta.json())

    def test_so_se_vincula_ao_encaminhar_para_a_fila(self):
        _, enc = self.enviar()
        resposta = self.chegar(enc, desfecho='FINALIZADO', motivo='Já retirou')
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('encaminhamento_id', resposta.json())

    def test_nao_se_vincula_duas_vezes(self):
        _, enc = self.enviar()
        self.chegar(enc)
        segunda = self.chegar(enc)
        self.assertEqual(segunda.status_code, 409)
        self.assertEqual(SenhaDaFila.objects.filter(cidadao=self.cidadao, unidade=self.centro).count(), 1)

    def test_encaminhamento_ja_concluido_ou_recusado(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': 'Fora do perfil'})
        resposta = self.chegar(enc)
        self.assertEqual(resposta.status_code, 409)

    def test_caso_que_ja_foi_encerrado(self):
        caso_id, enc = self.enviar()
        Caso.objects.filter(pk=caso_id).update(situacao=Caso.Situacao.CANCELADO)
        self.assertEqual(self.chegar(enc).status_code, 409)

    def test_a_recusa_nao_deixa_nada_pela_metade(self):
        caso_id, enc = self.enviar()
        antes = Caso.objects.get(pk=caso_id).situacao
        self.chegar(enc, desfecho='FINALIZADO', motivo='Já retirou')
        self.assertEqual(Caso.objects.get(pk=caso_id).situacao, antes)
        self.assertFalse(SenhaDaFila.objects.filter(unidade=self.centro).exists())
