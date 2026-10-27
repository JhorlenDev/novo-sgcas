"""
O tipo de auxílio de um serviço.

O balcão não sabe, pelo nome do serviço, que "Auxílio maternidade" é um
auxílio de nascimento — e é o tipo que decide a janela da repetição (um ano, e
não o mês). Quem cadastra o serviço diz qual é o tipo; a categoria "Benefício
Eventual" continua sendo o que liga o serviço ao controle de repetição.
"""
import uuid

from apps.institucional.models import Demanda, Servico
from testes.base import CenarioBase

NASCIMENTO = 'SITUACAO_NASCIMENTO'


class _Servicos(CenarioBase):
    def setUp(self):
        self.outra = Demanda.objects.create(
            id=str(uuid.uuid4()), nome='Situação de Rua', categoria='RUA',
            criada_em=self.demanda.criada_em, atualizada_em=self.demanda.atualizada_em,
        )
        self.sem_categoria = Servico.objects.create(
            id=str(uuid.uuid4()), unidade=self.sul, nome='Auxílio maternidade',
        )
        self.de_outra_categoria = Servico.objects.create(
            id=str(uuid.uuid4()), unidade=self.sul, nome='Abordagem', demanda=self.outra,
        )

    def editar(self, operador, servico, **corpo):
        return self.como(operador).patch(
            f'/api/institutional/services/{servico.id}', corpo, content_type='application/json',
        )

    def criar(self, operador, **corpo):
        base = {'nome': 'Auxílio natalidade', 'unidade_id': self.sul.id}
        return self.como(operador).post(
            '/api/institutional/services', {**base, **corpo}, content_type='application/json',
        )


class EditarOTipoDeAuxilio(_Servicos):
    def test_liga_o_servico_a_categoria_e_ao_tipo(self):
        resposta = self.editar(self.admin, self.sem_categoria, demanda_id=self.demanda.id, tipo_de_beneficio=NASCIMENTO)

        self.assertEqual(resposta.status_code, 200, resposta.content)
        corpo = resposta.json()
        self.assertEqual(corpo['demanda_id'], self.demanda.id)
        self.assertEqual(corpo['demanda_nome'], 'Benefício Eventual')
        self.assertEqual(corpo['tipo_de_beneficio'], NASCIMENTO)
        self.assertEqual(corpo['tipo_de_beneficio_rotulo'], 'Situação de nascimento')
        self.sem_categoria.refresh_from_db()
        self.assertEqual((self.sem_categoria.demanda_id, self.sem_categoria.tipo_de_beneficio), (self.demanda.id, NASCIMENTO))

    def test_o_tipo_sozinho_vale_quando_o_servico_ja_e_de_beneficio(self):
        # `servico` (Sul) já está em "Benefício Eventual".
        resposta = self.editar(self.admin, self.servico, tipo_de_beneficio=NASCIMENTO)
        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.servico.refresh_from_db()
        self.assertEqual(self.servico.tipo_de_beneficio, NASCIMENTO)

    def test_so_a_categoria_nao_mexe_no_tipo(self):
        Servico.objects.filter(id=self.servico.id).update(tipo_de_beneficio=NASCIMENTO)
        self.assertEqual(self.editar(self.admin, self.servico, demanda_id=self.demanda.id).status_code, 200)
        self.servico.refresh_from_db()
        self.assertEqual(self.servico.tipo_de_beneficio, NASCIMENTO)

    def test_null_tira_o_tipo(self):
        Servico.objects.filter(id=self.servico.id).update(tipo_de_beneficio=NASCIMENTO)
        self.assertEqual(self.editar(self.admin, self.servico, tipo_de_beneficio=None).status_code, 200)
        self.servico.refresh_from_db()
        self.assertIsNone(self.servico.tipo_de_beneficio)

    def test_tipo_em_servico_de_outra_categoria_e_recusado(self):
        resposta = self.editar(self.admin, self.de_outra_categoria, tipo_de_beneficio=NASCIMENTO)
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('tipo_de_beneficio', resposta.json())

    def test_tipo_em_servico_sem_categoria_e_recusado(self):
        self.assertEqual(self.editar(self.admin, self.sem_categoria, tipo_de_beneficio=NASCIMENTO).status_code, 400)

    def test_tirar_a_categoria_com_o_tipo_ainda_ligado_e_recusado(self):
        Servico.objects.filter(id=self.servico.id).update(tipo_de_beneficio=NASCIMENTO)
        self.assertEqual(self.editar(self.admin, self.servico, demanda_id=self.outra.id).status_code, 400)
        self.servico.refresh_from_db()
        self.assertEqual((self.servico.demanda_id, self.servico.tipo_de_beneficio), (self.demanda.id, NASCIMENTO))

    def test_trocar_a_categoria_e_limpar_o_tipo_na_mesma_chamada_vale(self):
        Servico.objects.filter(id=self.servico.id).update(tipo_de_beneficio=NASCIMENTO)
        resposta = self.editar(self.admin, self.servico, demanda_id=self.outra.id, tipo_de_beneficio=None)
        self.assertEqual(resposta.status_code, 200, resposta.content)

    def test_tipo_invalido_e_outros_sao_recusados(self):
        for tipo in ('QUALQUER', 'OUTROS'):
            resposta = self.editar(self.admin, self.servico, tipo_de_beneficio=tipo)
            self.assertEqual(resposta.status_code, 400, tipo)
        self.servico.refresh_from_db()
        self.assertIsNone(self.servico.tipo_de_beneficio)

    def test_categoria_inexistente_e_recusada(self):
        resposta = self.editar(self.admin, self.servico, demanda_id='inventada')
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('demanda_id', resposta.json())

    def test_servico_inexistente_e_404(self):
        self.assertEqual(self.como(self.admin).patch(
            '/api/institutional/services/inventado', {}, content_type='application/json').status_code, 404)

    def test_so_a_classificacao_muda(self):
        self.editar(self.admin, self.servico, nome='Outro nome', ativo=False, unidade_id=self.centro.id,
                    tipo_de_beneficio=NASCIMENTO)
        self.servico.refresh_from_db()
        self.assertEqual((self.servico.nome, self.servico.ativo, self.servico.unidade_id),
                         ('Alimentação e nutrição', True, self.sul.id))


class QuemPodeEditar(_Servicos):
    def test_o_coordenador_edita_os_servicos_da_propria_unidade(self):
        self.assertEqual(self.editar(self.coordenador, self.servico, tipo_de_beneficio=NASCIMENTO).status_code, 200)

    def test_o_coordenador_nao_edita_os_de_outra_unidade(self):
        resposta = self.editar(self.coordenador, self.servico_do_centro, tipo_de_beneficio=NASCIMENTO)
        self.assertEqual(resposta.status_code, 403)
        self.servico_do_centro.refresh_from_db()
        self.assertIsNone(self.servico_do_centro.tipo_de_beneficio)

    def test_o_admin_edita_os_de_qualquer_unidade(self):
        self.assertEqual(self.editar(self.admin, self.servico_do_centro, tipo_de_beneficio=NASCIMENTO).status_code, 200)

    def test_os_demais_papeis_nao_editam(self):
        for operador in (self.tecnico, self.recepcionista, self.visualizador):
            self.assertEqual(self.editar(operador, self.servico, tipo_de_beneficio=NASCIMENTO).status_code, 403)
        self.servico.refresh_from_db()
        self.assertIsNone(self.servico.tipo_de_beneficio)

    def test_sem_sessao_e_401(self):
        from django.test import Client
        resposta = Client(headers={'host': 'localhost'}).patch(
            f'/api/institutional/services/{self.servico.id}', {}, content_type='application/json')
        self.assertIn(resposta.status_code, (401, 403))


class CadastrarComOTipoDeAuxilio(_Servicos):
    def test_cadastra_ja_com_categoria_e_tipo(self):
        resposta = self.criar(self.admin, demanda_id=self.demanda.id, tipo_de_beneficio=NASCIMENTO)
        self.assertEqual(resposta.status_code, 201, resposta.content)
        self.assertEqual(resposta.json()['tipo_de_beneficio'], NASCIMENTO)
        self.assertEqual(Servico.objects.get(nome='Auxílio natalidade').tipo_de_beneficio, NASCIMENTO)

    def test_o_tipo_sem_a_categoria_de_beneficio_e_recusado(self):
        self.assertEqual(self.criar(self.admin, tipo_de_beneficio=NASCIMENTO).status_code, 400)
        self.assertEqual(self.criar(self.admin, demanda_id=self.outra.id, tipo_de_beneficio=NASCIMENTO).status_code, 400)
        self.assertFalse(Servico.objects.filter(nome='Auxílio natalidade').exists())

    def test_tipo_invalido_e_recusado(self):
        for tipo in ('QUALQUER', 'OUTROS'):
            resposta = self.criar(self.admin, demanda_id=self.demanda.id, tipo_de_beneficio=tipo)
            self.assertEqual(resposta.status_code, 400, tipo)

    def test_sem_tipo_continua_como_antes(self):
        resposta = self.criar(self.admin, demanda_id=self.demanda.id)
        self.assertEqual(resposta.status_code, 201, resposta.content)
        self.assertIsNone(resposta.json()['tipo_de_beneficio'])

    def test_a_listagem_traz_a_categoria_e_o_tipo_para_a_tela_editar(self):
        Servico.objects.filter(id=self.servico.id).update(tipo_de_beneficio=NASCIMENTO)
        lista = self.como(self.recepcionista).get('/api/institutional/services').json()
        item = next(s for s in lista if s['id'] == self.servico.id)
        self.assertEqual(item['demanda_id'], self.demanda.id)
        self.assertEqual(item['tipo_de_beneficio'], NASCIMENTO)
        self.assertEqual(item['tipo_de_beneficio_rotulo'], 'Situação de nascimento')
