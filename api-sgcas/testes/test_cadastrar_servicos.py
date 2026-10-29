"""
`cadastrar_servicos`: montar o catálogo do zero e poder rodar de novo.

O README manda rodar o comando a cada deploy, então ele precisa ser
idempotente de verdade. E num banco novo ele não pode depender de dados que só
existiam no sistema anterior — demandas e a coordenação raiz — senão os
serviços ficam sem categoria e as unidades sem o prefixo da secretaria.
"""
import uuid
from io import StringIO

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.atendimentos.models import BeneficioEventual
from apps.institucional.management.commands.cadastrar_servicos import CATALOGO
from apps.institucional.models import Coordenacao, Demanda, Servico, Unidade
from apps.institucional.serializers import TIPOS_DE_AUXILIO

CATEGORIAS_CITADAS = {s[2] for _, _, _, servicos in CATALOGO for s in servicos if s[2]}
SERVICOS_SEM_CATEGORIA = sum(1 for _, _, _, servicos in CATALOGO for s in servicos if s[2] is None)


def rodar() -> str:
    saida = StringIO()
    call_command('cadastrar_servicos', stdout=saida)
    return saida.getvalue()


class RodarDeNovoNaoQuebraNemDuplica(TestCase):
    def test_segunda_execucao_nao_levanta_erro(self):
        rodar()
        rodar()

    def test_nao_duplica_unidades_nem_servicos(self):
        rodar()
        antes = (Unidade.objects.count(), Servico.objects.count(), Demanda.objects.count())
        rodar()
        self.assertEqual((Unidade.objects.count(), Servico.objects.count(), Demanda.objects.count()), antes)

    def test_servicos_mantem_o_id(self):
        # O id é referenciado por casos; trocá-lo a cada deploy soltaria o vínculo.
        rodar()
        antes = dict(Servico.objects.values_list('nome', 'id').filter(unidade__sigla='CRAS-C'))
        rodar()
        depois = dict(Servico.objects.values_list('nome', 'id').filter(unidade__sigla='CRAS-C'))
        self.assertEqual(antes, depois)

    def test_atualiza_o_que_mudou(self):
        rodar()
        servico = Servico.objects.filter(unidade__sigla='CRAS-C').first()
        Servico.objects.filter(pk=servico.pk).update(descricao='alterada à mão', ativo=False)
        rodar()
        servico.refresh_from_db()
        self.assertNotEqual(servico.descricao, 'alterada à mão')
        self.assertTrue(servico.ativo)


class BancoNovoRecebeOsDadosBase(TestCase):
    def test_cria_as_demandas_que_o_catalogo_cita(self):
        rodar()
        self.assertEqual(set(Demanda.objects.values_list('nome', flat=True)), CATEGORIAS_CITADAS)

    def test_servicos_saem_categorizados(self):
        rodar()
        self.assertEqual(Servico.objects.filter(demanda__isnull=True).count(), SERVICOS_SEM_CATEGORIA)

    def test_nao_avisa_categoria_inexistente(self):
        self.assertNotIn('não existe no catálogo de demandas', rodar())

    def test_cria_a_coordenacao_raiz_e_as_unidades_levam_o_prefixo(self):
        rodar()
        raiz = Coordenacao.objects.get(superior__isnull=True)
        self.assertEqual(raiz.sigla, 'SEMAS')
        centro = Unidade.objects.get(sigla='CRAS-C')
        self.assertEqual(centro.coordenacao_id, raiz.id)
        # É o rótulo que vai para a auditoria do pré-cadastro no Tefé Cidadão.
        self.assertEqual(centro.nome_qualificado(), 'SEMAS/CRAS Centro')

    def test_roda_de_novo_sem_criar_outra_raiz(self):
        rodar()
        rodar()
        self.assertEqual(Coordenacao.objects.count(), 1)


class BancoComDadosNaoEAtropelado(TestCase):
    def test_respeita_a_coordenacao_existente(self):
        agora = timezone.now()
        existente = Coordenacao.objects.create(
            id=str(uuid.uuid4()), nome='Outra Secretaria', sigla='OUTRA',
            criada_em=agora, atualizada_em=agora,
        )
        rodar()
        self.assertEqual(Coordenacao.objects.count(), 1)
        self.assertEqual(Unidade.objects.get(sigla='CRAS-C').coordenacao_id, existente.id)

    def test_reaproveita_a_demanda_de_mesmo_nome(self):
        agora = timezone.now()
        existente = Demanda.objects.create(
            id=str(uuid.uuid4()), nome='Benefício Eventual', categoria='BENEFICIO',
            criada_em=agora, atualizada_em=agora,
        )
        rodar()
        self.assertEqual(Demanda.objects.filter(nome='Benefício Eventual').count(), 1)
        existente.refresh_from_db()
        self.assertEqual(existente.categoria, 'BENEFICIO')
        self.assertTrue(Servico.objects.filter(demanda=existente).exists())

    def test_liga_a_raiz_a_unidade_que_ficou_sem_coordenacao(self):
        # Estado deixado pela versão anterior do comando num banco novo.
        agora = timezone.now()
        Unidade.objects.create(
            id=str(uuid.uuid4()), nome='CRAS Centro', sigla='CRAS-C', tipo='CRAS',
            criada_em=agora, atualizada_em=agora,
        )
        rodar()
        centro = Unidade.objects.get(sigla='CRAS-C')
        self.assertEqual(centro.nome_qualificado(), 'SEMAS/CRAS Centro')

    def test_nao_troca_a_coordenacao_de_uma_unidade_ja_ligada(self):
        agora = timezone.now()
        propria = Coordenacao.objects.create(
            id=str(uuid.uuid4()), nome='Outra Secretaria', sigla='OUTRA',
            criada_em=agora, atualizada_em=agora,
        )
        Unidade.objects.create(
            id=str(uuid.uuid4()), nome='CRAS Centro', sigla='CRAS-C', tipo='CRAS',
            coordenacao=propria, criada_em=agora, atualizada_em=agora,
        )
        rodar()
        self.assertEqual(Unidade.objects.get(sigla='CRAS-C').coordenacao_id, propria.id)


AUXILIOS_DOS_CRAS = {
    'Auxílio maternidade': BeneficioEventual.Tipo.NASCIMENTO,
    'Auxílio funeral': BeneficioEventual.Tipo.MORTE,
    'Cesta básica': BeneficioEventual.Tipo.VULNERABILIDADE,
    'Auxílio em calamidade pública': BeneficioEventual.Tipo.CALAMIDADE,
}


class AuxiliosSaemProntos(TestCase):
    """Os benefícios eventuais já vêm cadastrados, para as unidades não terem de fazê-lo."""

    def test_cada_cras_tem_os_quatro_auxilios_com_categoria_e_tipo(self):
        rodar()
        for sigla in ('CRAS-C', 'CRAS-N', 'CRAS-S'):
            servicos = {
                s.nome: s for s in Servico.objects.filter(unidade__sigla=sigla, demanda__nome='Benefício Eventual')
            }
            self.assertEqual(set(servicos), set(AUXILIOS_DOS_CRAS), sigla)
            for nome, tipo in AUXILIOS_DOS_CRAS.items():
                self.assertEqual(servicos[nome].tipo_de_beneficio, tipo, f'{sigla}: {nome}')
                self.assertTrue(servicos[nome].ativo)

    def test_o_auxilio_maternidade_e_o_de_nascimento_que_vale_um_ano(self):
        rodar()
        servico = Servico.objects.get(unidade__sigla='CRAS-C', nome='Auxílio maternidade')
        self.assertEqual(servico.tipo_de_beneficio, 'SITUACAO_NASCIMENTO')

    def test_o_tipo_so_aparece_em_servico_de_beneficio_e_e_um_tipo_valido(self):
        validos = {valor for valor, _ in TIPOS_DE_AUXILIO}
        for _, _, _, servicos in CATALOGO:
            for nome, _, categoria, *tipo in servicos:
                if tipo:
                    self.assertEqual(categoria, 'Benefício Eventual', nome)
                    self.assertIn(tipo[0], validos, nome)

    def test_servicos_que_nao_sao_auxilio_ficam_sem_tipo(self):
        rodar()
        self.assertFalse(Servico.objects.filter(demanda__nome='Violação de Direitos').exclude(tipo_de_beneficio=None).exists())

    def test_o_controle_de_repeticao_ja_enxerga_os_auxilios_do_catalogo(self):
        # Sem categoria e tipo o balcão não avisaria de nada: o catálogo tem de deixar isto ligado.
        rodar()
        for sigla in ('CRAS-C', 'CRAS-N', 'CRAS-S'):
            servico = Servico.objects.select_related('demanda').get(unidade__sigla=sigla, nome='Auxílio maternidade')
            self.assertEqual(servico.demanda.nome, 'Benefício Eventual')

    def test_segunda_execucao_nao_duplica_os_auxilios(self):
        rodar()
        antes = Servico.objects.filter(demanda__nome='Benefício Eventual').count()
        rodar()
        self.assertEqual(Servico.objects.filter(demanda__nome='Benefício Eventual').count(), antes)


class ClassificacaoFeitaNaTelaNaoEDesfeita(TestCase):
    """O comando roda a cada deploy; o que a coordenação decidiu na tela Institucional tem de sobreviver."""

    def test_nao_troca_a_categoria_ja_definida(self):
        rodar()
        outra = Demanda.objects.get(nome='Situação de Rua')
        servico = Servico.objects.get(unidade__sigla='CRAS-C', nome='Visita domiciliar')
        Servico.objects.filter(pk=servico.pk).update(demanda=outra)
        rodar()
        servico.refresh_from_db()
        self.assertEqual(servico.demanda_id, outra.id)

    def test_preenche_a_categoria_que_faltava(self):
        rodar()
        servico = Servico.objects.get(unidade__sigla='CRAS-C', nome='Visita domiciliar')
        Servico.objects.filter(pk=servico.pk).update(demanda=None)
        rodar()
        servico.refresh_from_db()
        self.assertEqual(servico.demanda.nome, 'Acompanhamento Familiar')

    def test_nao_apaga_o_tipo_escolhido_na_tela(self):
        rodar()
        # "Alimentação e nutrição" é de benefício, mas o catálogo não diz o tipo.
        servico = Servico.objects.get(unidade__sigla='RESINC-001', nome='Alimentação e nutrição')
        Servico.objects.filter(pk=servico.pk).update(tipo_de_beneficio='SITUACAO_VULNERABILIDADE_TEMPORARIA')
        rodar()
        servico.refresh_from_db()
        self.assertEqual(servico.tipo_de_beneficio, 'SITUACAO_VULNERABILIDADE_TEMPORARIA')

    def test_nao_troca_o_tipo_ja_escolhido(self):
        rodar()
        servico = Servico.objects.get(unidade__sigla='CRAS-C', nome='Auxílio maternidade')
        Servico.objects.filter(pk=servico.pk).update(tipo_de_beneficio='SITUACAO_MORTE')
        rodar()
        servico.refresh_from_db()
        self.assertEqual(servico.tipo_de_beneficio, 'SITUACAO_MORTE')

    def test_preenche_o_tipo_que_faltava(self):
        rodar()
        servico = Servico.objects.get(unidade__sigla='CRAS-C', nome='Auxílio maternidade')
        Servico.objects.filter(pk=servico.pk).update(tipo_de_beneficio=None)
        rodar()
        servico.refresh_from_db()
        self.assertEqual(servico.tipo_de_beneficio, 'SITUACAO_NASCIMENTO')

    def test_nao_poe_tipo_em_servico_que_a_coordenacao_tirou_da_categoria_de_beneficio(self):
        rodar()
        outra = Demanda.objects.get(nome='Situação de Rua')
        servico = Servico.objects.get(unidade__sigla='CRAS-C', nome='Auxílio maternidade')
        Servico.objects.filter(pk=servico.pk).update(demanda=outra, tipo_de_beneficio=None)
        rodar()
        servico.refresh_from_db()
        self.assertEqual((servico.demanda_id, servico.tipo_de_beneficio), (outra.id, None))

    def test_serviço_existente_ganha_a_classificacao_do_catalogo_sem_trocar_o_id(self):
        # Caso real: o serviço foi criado à mão antes, só com o nome.
        agora = timezone.now()
        unidade = Unidade.objects.create(
            id=str(uuid.uuid4()), nome='CRAS Centro', sigla='CRAS-C', tipo='CRAS', criada_em=agora, atualizada_em=agora,
        )
        feito_a_mao = Servico.objects.create(id=str(uuid.uuid4()), unidade=unidade, nome='Auxílio maternidade')
        rodar()
        feito_a_mao.refresh_from_db()
        self.assertEqual(feito_a_mao.demanda.nome, 'Benefício Eventual')
        self.assertEqual(feito_a_mao.tipo_de_beneficio, 'SITUACAO_NASCIMENTO')
        self.assertEqual(Servico.objects.filter(unidade=unidade, nome='Auxílio maternidade').count(), 1)
