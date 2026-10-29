"""
A unidade SEDECTI: onde ficam lotados os devs que cuidam da manutenção do sistema.

Ela existe para organizar quem é quem (a tela Usuários lota as pessoas por unidade), e não
atende a população: não tem serviços, não é secretaria subordinada à de assistência social
e não pode ser destino de encaminhamento de caso. Lotar alguém nela também não dá poder
nenhum — o papel continua vindo do Tefé Cidadão.
"""
import uuid
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.atendimentos.models import Encaminhamento
from apps.contas.models import Operador
from apps.contas.papeis import Papel
from apps.institucional.models import Coordenacao, Servico, Unidade
from testes.base import CenarioBase
from testes.test_encaminhamento_ficha import _Ficha


def rodar() -> str:
    saida = StringIO()
    call_command('cadastrar_servicos', stdout=saida)
    return saida.getvalue()


def criar_sedecti():
    agora = timezone.now()
    return Unidade.objects.create(
        id=str(uuid.uuid4()), nome='SEDECTI — Manutenção do SGCAS', sigla='SEDECTI',
        tipo=Unidade.Tipo.MANUTENCAO, criada_em=agora, atualizada_em=agora,
    )


class CatalogoCriaASedecti(TestCase):
    def test_a_unidade_nasce_com_o_tipo_de_manutencao(self):
        rodar()
        sedecti = Unidade.objects.get(sigla='SEDECTI')
        self.assertEqual(sedecti.tipo, Unidade.Tipo.MANUTENCAO)
        self.assertTrue(sedecti.ativa)
        self.assertIn('SEDECTI', sedecti.nome)

    def test_nao_tem_servicos(self):
        rodar()
        self.assertEqual(Servico.objects.filter(unidade__sigla='SEDECTI').count(), 0)

    def test_nao_e_subordinada_a_secretaria_de_assistencia_social(self):
        rodar()
        sedecti = Unidade.objects.get(sigla='SEDECTI')
        self.assertIsNone(sedecti.coordenacao_id)
        self.assertEqual(sedecti.nome_qualificado(), sedecti.nome)    # sem o prefixo "SEMAS/"

    def test_nao_cria_outra_coordenacao(self):
        rodar()
        self.assertEqual(Coordenacao.objects.count(), 1)

    def test_a_saida_diz_que_criou(self):
        self.assertIn('SEDECTI', rodar())

    def test_rodar_de_novo_nao_duplica_e_mantem_o_id(self):
        rodar()
        antes = Unidade.objects.get(sigla='SEDECTI').id
        rodar()
        self.assertEqual(Unidade.objects.filter(sigla='SEDECTI').count(), 1)
        self.assertEqual(Unidade.objects.get(sigla='SEDECTI').id, antes)

    def test_nao_desfaz_o_que_o_administrador_decidiu(self):
        rodar()
        Unidade.objects.filter(sigla='SEDECTI').update(nome='Equipe de TI', ativa=False)
        rodar()
        sedecti = Unidade.objects.get(sigla='SEDECTI')
        self.assertEqual(sedecti.nome, 'Equipe de TI')
        self.assertFalse(sedecti.ativa)

    def test_unidade_removida_nao_e_recriada(self):
        # A sigla é única: recriar bateria nela e derrubaria o deploy inteiro.
        rodar()
        Unidade.objects.filter(sigla='SEDECTI').update(excluida_em=timezone.now())
        rodar()
        self.assertEqual(Unidade.objects.filter(sigla='SEDECTI').count(), 1)
        self.assertIsNotNone(Unidade.objects.get(sigla='SEDECTI').excluida_em)

    def test_as_unidades_de_atendimento_seguem_recebendo_encaminhamento(self):
        rodar()
        for unidade in Unidade.objects.exclude(sigla='SEDECTI'):
            self.assertTrue(unidade.recebe_encaminhamentos, unidade.sigla)
        self.assertFalse(Unidade.objects.get(sigla='SEDECTI').recebe_encaminhamentos)


class SedectiNaoRecebeEncaminhamento(_Ficha):
    def setUp(self):
        super().setUp()
        self.sedecti = criar_sedecti()

    def test_pelo_caso_e_recusado_e_nada_e_gravado(self):
        resposta = self.encaminhar(self.abrir(), unidade_destino_id=self.sedecti.id)

        self.assertEqual(resposta.status_code, 400, resposta.content)
        self.assertIn('unidade_destino_id', resposta.json())
        self.assertEqual(Encaminhamento.objects.count(), 0)

    def test_pelo_prontuario_e_recusado_e_nada_e_gravado(self):
        resposta = self.como(self.coordenador).post(
            f'/api/citizens/{self.cidadao.id}/encaminhamentos',
            self.payload(unidade_destino_id=self.sedecti.id), content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 400, resposta.content)
        self.assertIn('unidade_destino_id', resposta.json())
        self.assertEqual(Encaminhamento.objects.count(), 0)

    def test_a_recusa_nao_atrapalha_o_encaminhamento_seguinte(self):
        caso_id = self.abrir()
        self.assertEqual(self.encaminhar(caso_id, unidade_destino_id=self.sedecti.id).status_code, 400)
        self.assertEqual(self.encaminhar(caso_id).status_code, 201)


class SedectiLotaOsDevs(CenarioBase):
    def setUp(self):
        self.sedecti = criar_sedecti()

    def test_a_lista_de_unidades_traz_a_sedecti_com_o_tipo(self):
        # O front usa o tipo para tirá-la da lista de destinos de encaminhamento.
        lista = self.como(self.recepcionista).get('/api/institutional/units').json()
        sedecti = next(u for u in lista if u['sigla'] == 'SEDECTI')
        self.assertEqual(sedecti['tipo'], 'MANUTENCAO')

    def test_o_admin_lota_alguem_na_sedecti(self):
        resposta = self.como(self.admin).put(
            f'/api/users/{self.sem_unidade.id}/atualizar',
            {'unidade_id': self.sedecti.id}, content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.sem_unidade.refresh_from_db()
        self.assertEqual(self.sem_unidade.unidade_id, self.sedecti.id)

    def test_estar_na_sedecti_nao_da_poder_o_papel_continua_valendo(self):
        agora = timezone.now()
        dev = Operador.objects.create(
            id=str(uuid.uuid4()), email='dev@teste.local', nome='Dev', papel=Papel.TECNICO,
            ativo=True, unidade=self.sedecti, criado_em=agora, atualizado_em=agora,
        )
        self.assertEqual(self.como(dev).get('/api/users/').status_code, 403)
        self.assertEqual(self.como(dev).put(
            f'/api/users/{self.tecnico.id}/atualizar', {'nome': 'X'}, content_type='application/json',
        ).status_code, 403)

    def test_dev_admin_lotado_na_sedecti_segue_administrando(self):
        agora = timezone.now()
        dev = Operador.objects.create(
            id=str(uuid.uuid4()), email='dev.admin@teste.local', nome='Dev Admin', papel=Papel.ADMIN,
            ativo=True, unidade=self.sedecti, criado_em=agora, atualizado_em=agora,
        )
        self.assertEqual(self.como(dev).get('/api/users/').status_code, 200)
