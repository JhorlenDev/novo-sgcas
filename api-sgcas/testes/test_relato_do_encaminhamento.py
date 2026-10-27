"""
O que a recepção lê do encaminhamento: o resumo, nunca o relato.

A recepção do destino vê de onde a pessoa veio, quando, a categoria do motivo e a
urgência. O motivo e o resumo — que podem falar de violência ou de saúde — são da
equipe técnica. Mas a recepção também lê o relato do caso (pelo histórico
municipal e por /api/cases/), e o texto do motivo era gravado ali: a regra valia
na ficha e era contornada duas telas adiante.
"""
from apps.atendimentos.models import Caso
from testes.test_encaminhamento_ciclo import _Ciclo

MOTIVO = 'Suspeita de violência doméstica; precisa de acompanhamento especializado'
RESUMO = 'Mulher relata agressões do companheiro; filhos presentes na casa.'
MOTIVO_DA_RECUSA = 'Fora do perfil do CRAS Centro; caso de saúde mental'


class _Recepcao(_Ciclo):
    def le_pela_recepcao(self, recepcao):
        """O que a recepção recebe dos dois lugares onde o relato do caso aparece."""
        cliente = self.como(recepcao)
        casos = cliente.get(f'/api/cases/?cidadao={self.cidadao.id}')
        historico = cliente.get(f'/api/citizens/{self.cidadao.id}/historico')
        self.assertEqual(casos.status_code, 200, casos.content)
        self.assertEqual(historico.status_code, 200, historico.content)
        return casos.content.decode() + historico.content.decode()


class MotivoDoEncaminhamento(_Recepcao):
    def test_o_texto_do_motivo_nao_vai_para_o_relato_do_caso(self):
        caso_id, _ = self.enviar()
        descricao = Caso.objects.get(pk=caso_id).descricao
        self.assertNotIn('violência doméstica', descricao)
        self.assertNotIn(RESUMO, descricao)

    def test_o_relato_registra_so_para_onde_a_categoria_e_a_urgencia(self):
        caso_id, _ = self.enviar()
        self.assertIn(
            'Encaminhado para CRAS Centro (Violação de direitos, urgência alta).',
            Caso.objects.get(pk=caso_id).descricao,
        )

    def test_a_recepcao_do_destino_nao_le_motivo_nem_resumo(self):
        self.enviar()
        lido = self.le_pela_recepcao(self.recepcionista_do_centro())
        self.assertNotIn('violência doméstica', lido)
        self.assertNotIn('agressões', lido)
        # ...mas fica sabendo que houve o encaminhamento, e a categoria.
        self.assertIn('Violação de direitos', lido)

    def test_o_tecnico_do_destino_continua_lendo_tudo_na_ficha(self):
        _, enc = self.enviar()
        ficha = self.como(self.tecnico).get(f'/api/referrals/{enc.id}').json()
        self.assertEqual(ficha['motivo'], MOTIVO)
        self.assertEqual(ficha['resumo_da_situacao'], RESUMO)


class MotivoDaRecusa(_Recepcao):
    def test_o_motivo_da_recusa_nao_vai_para_o_relato_do_caso(self):
        caso_id, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': MOTIVO_DA_RECUSA})
        descricao = Caso.objects.get(pk=caso_id).descricao
        self.assertNotIn('saúde mental', descricao)
        self.assertIn('Encaminhamento recusado por CRAS Centro.', descricao)

    def test_o_motivo_da_recusa_fica_na_ficha_para_a_equipe_da_origem(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': MOTIVO_DA_RECUSA})
        ficha = self.como(self.coordenador).get(f'/api/referrals/{enc.id}').json()
        self.assertEqual(ficha['resposta'], MOTIVO_DA_RECUSA)

    def test_a_recepcao_da_origem_nao_le_o_motivo_da_recusa(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': MOTIVO_DA_RECUSA})
        lido = self.le_pela_recepcao(self.recepcionista)       # recepção do Sul, a origem
        self.assertNotIn('saúde mental', lido)
