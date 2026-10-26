"""Redação da trilha de auditoria."""
from django.test import SimpleTestCase

from apps.auditoria.redacao import redigir


class TresNiveisDeRedacao(SimpleTestCase):
    def test_segredo_some_por_completo(self):
        saida = redigir({'password': 'segredo123', 'access_token': 'eyJ...'})
        self.assertEqual(saida['password'], '[REDIGIDO]')
        self.assertEqual(saida['access_token'], '[REDIGIDO]')

    def test_relato_vira_tamanho(self):
        # Texto sobre violência ou saúde mental é dado sensível: a trilha
        # registra que mudou, não o que dizia.
        texto = 'Relato de violencia domestica com ameaca'
        saida = redigir({'motivo': texto})
        self.assertEqual(saida['motivo'], f'[REDIGIDO:{len(texto)}c]')
        self.assertNotIn('violencia', saida['motivo'])

    def test_identificador_e_mascarado_em_parte(self):
        saida = redigir({
            'cpf': '529.982.247-25',
            'email': 'rosa@exemplo.local',
            'telefone': '(97) 98111-0000',
            'nis': '12345678901',
        })
        self.assertEqual(saida['cpf'], '***.***.***-25')
        self.assertEqual(saida['email'], 'ro***@exemplo.local')
        self.assertEqual(saida['telefone'], '(**) *****-0000')
        self.assertEqual(saida['nis'], '123********')

    def test_desce_em_estrutura_aninhada(self):
        # O CPF de um membro da família também precisa ser mascarado.
        saida = redigir({'membros': [{'nome': 'Filho', 'cpf': '111.444.777-35'}]})
        self.assertEqual(saida['membros'][0]['cpf'], '***.***.***-35')
        self.assertEqual(saida['membros'][0]['nome'], 'Filho')

    def test_campo_comum_passa_intacto(self):
        self.assertEqual(redigir({'prioridade': 'ALTA'})['prioridade'], 'ALTA')

    def test_campos_da_ficha_de_encaminhamento_sao_redigidos(self):
        saida = redigir({
            'resumo_da_situacao': 'Mulher relata agressões', 'documentos_entregues': 'RG e CPF',
            'contato_para_retorno': '(97) 99999-1234', 'resposta': 'Recusado: fora do perfil',
            'resultado': 'Acompanhamento iniciado', 'justificativa_duplicidade': 'Família numerosa',
            'categoria_do_motivo': 'SAUDE', 'urgencia': 'ALTA',
        })
        self.assertTrue(saida['resumo_da_situacao'].startswith('[REDIGIDO:'))
        self.assertTrue(saida['documentos_entregues'].startswith('[REDIGIDO:'))
        self.assertTrue(saida['resposta'].startswith('[REDIGIDO:'))
        self.assertTrue(saida['resultado'].startswith('[REDIGIDO:'))
        self.assertTrue(saida['justificativa_duplicidade'].startswith('[REDIGIDO:'))
        self.assertEqual(saida['contato_para_retorno'], '[REDIGIDO]')
        self.assertEqual(saida['categoria_do_motivo'], 'SAUDE')
        self.assertEqual(saida['urgencia'], 'ALTA')
