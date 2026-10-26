"""
As caixas de encaminhamentos e os avisos entre unidades.

Regra de visibilidade, por decisão da direção: os técnicos veem tudo; a recepção
vê só um resumo — quem, de onde, quando e a categoria do motivo. O relato por
trás de um encaminhamento pode falar de violência ou de saúde, e quem atende no
balcão precisa saber que a pessoa foi encaminhada, não o que ela viveu.
"""
import uuid

from django.utils import timezone

from apps.atendimentos.models import Aviso, Encaminhamento
from apps.contas.models import Operador
from testes.test_encaminhamento_ciclo import _Ciclo
from testes.test_encaminhamento_ficha import _SEM

CAMPOS_RESERVADOS_AOS_TECNICOS = (
    'motivo', 'resumo_da_situacao', 'observacoes', 'documentos_entregues', 'contato_para_retorno',
    'ficha', 'encaminhado_por_nome', 'resposta', 'resultado',
)


class _Caixa(_Ciclo):
    def operador(self, papel, unidade, nome):
        agora = timezone.now()
        return Operador.objects.create(
            id=str(uuid.uuid4()), email=f'{nome}@teste.local', nome=nome.title(), papel=papel,
            ativo=True, unidade=unidade, criado_em=agora, atualizado_em=agora,
        )

    def get(self, rota, operador):
        return self.como(operador).get(rota)


class CaixaDeRecebidos(_Caixa):
    def test_o_tecnico_do_destino_ve_o_encaminhamento_completo(self):
        _, enc = self.enviar()
        lista = self.get('/api/referrals/recebidos', self.tecnico).json()

        self.assertEqual([e['id'] for e in lista], [enc.id])
        item = lista[0]
        self.assertEqual(item['unidade_origem_nome'], 'CRAS Sul')
        self.assertEqual(item['cidadao_nome'], self.cidadao.nome)
        self.assertEqual(item['categoria_rotulo'], 'Violação de direitos')
        self.assertIn('violência doméstica', item['motivo'])
        self.assertIn('agressões', item['resumo_da_situacao'])
        self.assertEqual(item['contato_para_retorno'], '(97) 99999-1234, falar com a irmã')
        self.assertEqual(item['encaminhado_por_nome'], self.coordenador.nome)

    def test_so_aparecem_os_encaminhamentos_da_propria_unidade(self):
        self.enviar()
        creas = self.terceira_unidade()
        outro = self.operador('TECNICO', creas, 'tecnico creas')
        self.assertEqual(self.get('/api/referrals/recebidos', outro).json(), [])
        # Quem enviou também não os vê como recebidos.
        self.assertEqual(self.get('/api/referrals/recebidos', self.coordenador).json(), [])

    def test_por_padrao_so_os_abertos_e_todos_a_pedido(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': 'Fora do perfil'})
        self.assertEqual(self.get('/api/referrals/recebidos', self.tecnico).json(), [])
        todos = self.get('/api/referrals/recebidos?situacao=todos', self.tecnico).json()
        self.assertEqual([e['situacao'] for e in todos], ['RECUSADO'])

    def test_filtra_por_situacao_e_por_pessoa(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')
        self.assertEqual(len(self.get('/api/referrals/recebidos?situacao=ACEITO', self.tecnico).json()), 1)
        self.assertEqual(len(self.get('/api/referrals/recebidos?situacao=PENDENTE', self.tecnico).json()), 0)
        self.assertEqual(
            len(self.get(f'/api/referrals/recebidos?cidadao={self.cidadao.id}', self.tecnico).json()), 1,
        )
        self.assertEqual(len(self.get('/api/referrals/recebidos?cidadao=outro', self.tecnico).json()), 0)

    def test_situacao_invalida_e_recusada(self):
        self.assertEqual(self.get('/api/referrals/recebidos?situacao=QUALQUER', self.tecnico).status_code, 400)

    def test_o_mais_urgente_vem_primeiro(self):
        # Dois encaminhamentos para o Centro: a urgente chega depois e passa na frente.
        self.enviar(urgencia='NORMAL')
        from apps.atendimentos.models import Caso
        from apps.cidadaos.models import Cidadao
        agora = timezone.now()
        outro = Cidadao.objects.create(id=str(uuid.uuid4()), nome='Outra Pessoa', criado_em=agora, atualizado_em=agora)
        resposta = self.como(self.coordenador).post(
            f'/api/citizens/{outro.id}/encaminhamentos', self.payload(urgencia='URGENTE'),
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 201, resposta.content)
        ordem = [e['urgencia'] for e in self.get('/api/referrals/recebidos', self.tecnico).json()]
        self.assertEqual(ordem, ['URGENTE', 'NORMAL'])


class CaixaDeEnviados(_Caixa):
    def test_a_origem_acompanha_o_que_enviou_e_em_que_pe_esta(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar', {'observacao': 'Vamos agendar'})

        lista = self.get('/api/referrals/enviados?situacao=todos', self.coordenador).json()
        self.assertEqual(len(lista), 1)
        self.assertEqual(lista[0]['situacao'], 'ACEITO')
        self.assertEqual(lista[0]['unidade_destino_nome'], 'CRAS Centro')
        self.assertEqual(lista[0]['respondido_por_nome'], self.tecnico.nome)
        self.assertEqual(lista[0]['resposta'], 'Vamos agendar')

    def test_o_destino_nao_ve_como_enviado_o_que_recebeu(self):
        self.enviar()
        self.assertEqual(self.get('/api/referrals/enviados', self.tecnico).json(), [])

    def test_aparece_tambem_o_encaminhamento_externo(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id, unidade_destino_id=_SEM, destino_externo='Conselho Tutelar')
        lista = self.get('/api/referrals/enviados?situacao=todos', self.coordenador).json()
        self.assertEqual(lista[0]['destino_externo'], 'Conselho Tutelar')
        self.assertIsNone(lista[0]['unidade_destino'])


class AReceptcaoVeSoOResumo(_Caixa):
    def test_a_recepcao_do_destino_ve_quem_de_onde_quando_e_a_categoria(self):
        self.enviar()
        recepcao = self.operador('RECEPCIONISTA', self.centro, 'recepcao centro')
        lista = self.get('/api/referrals/recebidos', recepcao).json()

        self.assertEqual(len(lista), 1)
        item = lista[0]
        self.assertEqual(item['cidadao_nome'], self.cidadao.nome)
        self.assertEqual(item['unidade_origem_nome'], 'CRAS Sul')
        self.assertEqual(item['categoria_rotulo'], 'Violação de direitos')
        self.assertEqual(item['urgencia'], 'ALTA')
        self.assertIn('criado_em', item)
        self.assertEqual(item['situacao'], 'PENDENTE')

    def test_a_recepcao_nao_ve_o_relato_nem_o_telefone_nem_a_ficha(self):
        self.enviar()
        recepcao = self.operador('RECEPCIONISTA', self.centro, 'recepcao centro')
        item = self.get('/api/referrals/recebidos', recepcao).json()[0]
        for reservado in CAMPOS_RESERVADOS_AOS_TECNICOS:
            self.assertNotIn(reservado, item, reservado)
        texto = str(item)
        for sensivel in ('violência', 'agressões', 'companheiro', '99999-1234', 'irmã', 'cesta'):
            self.assertNotIn(sensivel, texto)

    def test_o_detalhe_para_a_recepcao_e_o_mesmo_resumo(self):
        _, enc = self.enviar()
        recepcao = self.operador('RECEPCIONISTA', self.centro, 'recepcao centro')
        resposta = self.get(f'/api/referrals/{enc.id}', recepcao)
        self.assertEqual(resposta.status_code, 200)
        for reservado in CAMPOS_RESERVADOS_AOS_TECNICOS:
            self.assertNotIn(reservado, resposta.json(), reservado)

    def test_a_recepcao_da_origem_acompanha_o_resumo_do_que_foi_enviado(self):
        self.enviar()
        item = self.get('/api/referrals/enviados', self.recepcionista).json()[0]
        self.assertEqual(item['unidade_destino_nome'], 'CRAS Centro')
        for reservado in CAMPOS_RESERVADOS_AOS_TECNICOS:
            self.assertNotIn(reservado, item, reservado)

    def test_a_recepcao_nao_aceita_nem_recusa(self):
        _, enc = self.enviar()
        recepcao = self.operador('RECEPCIONISTA', self.centro, 'recepcao centro')
        for acao, corpo in (('aceitar', {}), ('recusar', {'motivo': 'x'})):
            resposta = self.como(recepcao).post(
                f'/api/referrals/{enc.id}/{acao}', corpo, content_type='application/json',
            )
            self.assertEqual(resposta.status_code, 403, acao)


class DetalheDoEncaminhamento(_Caixa):
    def test_o_tecnico_do_destino_le_a_ficha_inteira(self):
        _, enc = self.enviar()
        dados = self.get(f'/api/referrals/{enc.id}', self.tecnico).json()
        self.assertEqual(dados['ficha']['unidade_origem'], 'CRAS Sul')
        self.assertEqual(dados['ficha']['servico']['nome'], self.servico.nome)
        self.assertIn('Pedido de cesta básica', dados['ficha']['relato'])
        self.assertIn('violência doméstica', dados['motivo'])

    def test_o_tecnico_da_origem_tambem_le(self):
        _, enc = self.enviar()
        self.assertEqual(self.get(f'/api/referrals/{enc.id}', self.coordenador).status_code, 200)

    def test_quem_nao_e_origem_nem_destino_nao_le(self):
        _, enc = self.enviar()
        creas = self.terceira_unidade()
        estranho = self.operador('TECNICO', creas, 'tecnico creas')
        self.assertEqual(self.get(f'/api/referrals/{enc.id}', estranho).status_code, 403)

    def test_o_admin_le_de_qualquer_unidade(self):
        _, enc = self.enviar()
        self.assertEqual(self.get(f'/api/referrals/{enc.id}', self.admin).status_code, 200)

    def test_inexistente_e_404(self):
        self.assertEqual(self.get('/api/referrals/inventado', self.tecnico).status_code, 404)


class QuemNaoVe(_Caixa):
    def test_o_visualizador_nao_acessa_encaminhamentos_nem_avisos(self):
        _, enc = self.enviar()
        for rota in ('/api/referrals/recebidos', '/api/referrals/enviados', f'/api/referrals/{enc.id}',
                     '/api/notices/', '/api/notices/resumo'):
            self.assertEqual(self.get(rota, self.visualizador).status_code, 403, rota)

    def test_sem_sessao_e_401(self):
        from django.test import Client
        anonimo = Client(headers={'host': 'localhost'})
        for rota in ('/api/referrals/recebidos', '/api/notices/'):
            self.assertEqual(anonimo.get(rota).status_code, 401, rota)

    def test_operador_sem_unidade_nao_ve_nada(self):
        self.enviar()
        self.assertEqual(self.get('/api/referrals/recebidos', self.sem_unidade).json(), [])


class HistoricoComEncaminhamento(_Caixa):
    def entradas(self, operador):
        return self.get(f'/api/citizens/{self.cidadao.id}/historico', operador).json()['entradas']

    def test_o_historico_municipal_registra_o_encaminhamento_entre_unidades(self):
        self.enviar()
        entradas = [e for e in self.entradas(self.tecnico) if 'Encaminhado de' in e['o_que']]
        self.assertEqual(len(entradas), 1)
        self.assertEqual(entradas[0]['o_que'], 'Encaminhado de CRAS Sul para CRAS Centro (pendente)')
        self.assertEqual(entradas[0]['unidade'], 'CRAS Sul')
        self.assertEqual(entradas[0]['detalhe'], 'Violação de direitos')

    def test_a_recepcao_ve_a_entrada_sem_o_relato(self):
        self.enviar()
        recepcao = self.operador('RECEPCIONISTA', self.centro, 'recepcao centro')
        entrada = [e for e in self.entradas(recepcao) if 'Encaminhado de' in e['o_que']][0]
        self.assertEqual(entrada['detalhe'], 'Violação de direitos')
        self.assertNotIn('violência doméstica', str(entrada))
        self.assertIsNone(entrada['quem_atendeu'])

    def test_a_situacao_acompanha_o_ciclo(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')
        entrada = [e for e in self.entradas(self.tecnico) if 'Encaminhado de' in e['o_que']][0]
        self.assertTrue(entrada['o_que'].endswith('(aceito)'), entrada['o_que'])


class Avisos(_Caixa):
    def test_a_unidade_de_destino_recebe_o_aviso_com_texto_pronto(self):
        self.enviar()
        avisos = self.get('/api/notices/', self.tecnico).json()
        self.assertEqual(len(avisos), 1)
        aviso = avisos[0]
        self.assertEqual(aviso['tipo'], 'ENCAMINHAMENTO_RECEBIDO')
        self.assertEqual(
            aviso['mensagem'],
            f'Encaminhamento recebido: {self.cidadao.nome}, vindo de CRAS Sul. Motivo: Violação de direitos. Urgência alta.',
        )
        self.assertFalse(aviso['lido'])
        self.assertEqual(aviso['cidadao'], self.cidadao.id)
        self.assertIsNotNone(aviso['encaminhamento'])

    def test_a_recepcao_tambem_recebe_o_aviso(self):
        self.enviar()
        recepcao = self.operador('RECEPCIONISTA', self.centro, 'recepcao centro')
        self.assertEqual(len(self.get('/api/notices/', recepcao).json()), 1)

    def test_os_avisos_do_ciclo_chegam_a_origem_com_texto_pronto(self):
        caso_id, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')
        self.no_destino(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'Atendido'})

        mensagens = {a['tipo']: a['mensagem'] for a in self.get('/api/notices/', self.coordenador).json()}
        self.assertEqual(mensagens['ENCAMINHAMENTO_ACEITO'], f'CRAS Centro aceitou o encaminhamento de {self.cidadao.nome}.')
        self.assertEqual(mensagens['ENCAMINHAMENTO_CONCLUIDO'], f'CRAS Centro concluiu o atendimento de {self.cidadao.nome}.')

    def test_cada_unidade_ve_so_os_proprios_avisos(self):
        self.enviar()
        self.assertEqual(self.get('/api/notices/', self.coordenador).json(), [])   # o aviso é do Centro
        creas = self.terceira_unidade()
        self.assertEqual(self.get('/api/notices/', self.operador('TECNICO', creas, 'tecnico creas')).json(), [])

    def test_resumo_conta_avisos_nao_lidos_e_encaminhamentos_pendentes(self):
        self.enviar()
        self.assertEqual(
            self.get('/api/notices/resumo', self.tecnico).json(),
            {'avisos_nao_lidos': 1, 'encaminhamentos_pendentes': 1},
        )
        self.assertEqual(
            self.get('/api/notices/resumo', self.coordenador).json(),
            {'avisos_nao_lidos': 0, 'encaminhamentos_pendentes': 0},
        )

    def test_marcar_como_lido(self):
        self.enviar()
        aviso = Aviso.objects.get()
        resposta = self.no_destino(f'/api/notices/{aviso.id}/lido')
        self.assertEqual(resposta.status_code, 200)
        aviso.refresh_from_db()
        self.assertIsNotNone(aviso.lido_em)
        self.assertEqual(aviso.lido_por_id, self.tecnico.id)
        self.assertEqual(self.get('/api/notices/resumo', self.tecnico).json()['avisos_nao_lidos'], 0)

    def test_filtra_os_nao_lidos(self):
        self.enviar()
        aviso = Aviso.objects.get()
        self.no_destino(f'/api/notices/{aviso.id}/lido')
        self.assertEqual(len(self.get('/api/notices/', self.tecnico).json()), 1)
        self.assertEqual(self.get('/api/notices/?nao_lidos=1', self.tecnico).json(), [])

    def test_marcar_todos_como_lidos(self):
        caso_id, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')                    # aviso para o Sul
        self.no_destino(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'ok'})
        self.assertEqual(self.get('/api/notices/resumo', self.coordenador).json()['avisos_nao_lidos'], 2)

        resposta = self.como(self.coordenador).post('/api/notices/lidos', {}, content_type='application/json')
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.json()['marcados'], 2)
        self.assertEqual(self.get('/api/notices/resumo', self.coordenador).json()['avisos_nao_lidos'], 0)
        # Os da outra unidade não são tocados.
        self.assertEqual(self.get('/api/notices/resumo', self.tecnico).json()['avisos_nao_lidos'], 1)

    def test_nao_se_marca_o_aviso_de_outra_unidade(self):
        self.enviar()
        aviso = Aviso.objects.get()                                            # é do Centro
        resposta = self.como(self.coordenador).post(
            f'/api/notices/{aviso.id}/lido', {}, content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 404)
        aviso.refresh_from_db()
        self.assertIsNone(aviso.lido_em)

    def test_apos_a_eliminacao_lgpd_o_aviso_diz_cidadao_excluido(self):
        self.enviar()
        self.como(self.coordenador).delete(f'/api/citizens/{self.cidadao.id}/dados-pessoais')
        mensagem = self.get('/api/notices/', self.tecnico).json()[0]['mensagem']
        self.assertIn('Cidadão excluído', mensagem)
        self.assertNotIn(self.cidadao.nome, mensagem)

    def test_o_aviso_nao_vaza_texto_livre(self):
        self.enviar()
        mensagem = self.get('/api/notices/', self.tecnico).json()[0]['mensagem']
        for sensivel in ('agressões', 'companheiro', 'violência doméstica', 'cesta'):
            self.assertNotIn(sensivel, mensagem)
