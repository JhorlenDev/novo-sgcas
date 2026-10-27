"""
O mesmo auxílio em unidades diferentes.

Era o que o projeto precisava acabar: a pessoa recebe a cesta no CRAS, vai ao
CREAS e recebe a mesma cesta, porque as unidades não se falavam. Agora o sistema
avisa — onde, quando e o quê — e só deixa seguir com uma justificativa escrita,
que fica no histórico para as outras unidades lerem. Não bloqueia: quem tem uma
necessidade nova não pode ficar travado por um atendimento antigo. A janela é o
mês corrente.
"""
import threading
import uuid
from datetime import timedelta
from unittest import mock

from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone

from apps.atendimentos import duplicidade
from apps.atendimentos.models import (
    AtendimentoDeRecepcao, Aviso, BeneficioEventual, Caso, SenhaDaFila,
)
from apps.atendimentos.models import Encaminhamento
from apps.auditoria.models import RegistroDeAuditoria
from testes.base import CenarioBase
from testes.test_encaminhamento_chegada import _Chegada

CESTA = {'tipo': 'SITUACAO_VULNERABILIDADE_TEMPORARIA', 'descricao': 'Cesta básica'}
JUSTIFICATIVA = 'Família numerosa, a cesta anterior acabou em uma semana.'


class _Duplicidade(CenarioBase):
    def beneficio(self, operador, **corpo):
        return self.como(operador).post(
            f'/api/citizens/{self.cidadao.id}/beneficios', {**CESTA, **corpo}, content_type='application/json',
        )

    def cesta_no_centro(self):
        resposta = self.beneficio(self.tecnico)
        self.assertEqual(resposta.status_code, 201, resposta.content)
        return resposta

    def total(self):
        return BeneficioEventual.objects.filter(cidadao=self.cidadao).count()

    def recepcao(self, operador=None, **mudancas):
        corpo = {
            'cidadao_id': self.cidadao.id, 'servico_id': self.servico.id,
            'desfecho': 'ENCAMINHADO', 'observacao': 'Pede cesta básica',
        }
        corpo.update(mudancas)
        return self.como(operador or self.recepcionista).post(
            '/api/reception/atendimento', corpo, content_type='application/json',
        )


class BeneficioRepetido(_Duplicidade):
    def test_o_primeiro_beneficio_nao_gera_aviso(self):
        self.assertEqual(self.beneficio(self.tecnico).status_code, 201)

    def test_o_mesmo_tipo_no_mes_exige_justificativa(self):
        self.cesta_no_centro()
        resposta = self.beneficio(self.coordenador)                    # o Sul repete

        self.assertEqual(resposta.status_code, 409, resposta.content)
        corpo = resposta.json()
        self.assertTrue(corpo['exige_justificativa'])
        self.assertEqual(self.total(), 1)                              # nada foi gravado

    def test_o_aviso_diz_onde_quando_e_o_que_foi_concedido(self):
        self.cesta_no_centro()
        alerta = self.beneficio(self.coordenador).json()['duplicidade'][0]

        self.assertEqual(alerta['origem'], 'beneficio')
        self.assertEqual(alerta['unidade'], 'CRAS Centro')
        self.assertEqual(alerta['o_que'], 'Vulnerabilidade temporária')
        self.assertEqual(alerta['detalhe'], 'Cesta básica')
        self.assertTrue(alerta['quando'])

    def test_com_justificativa_escrita_segue_e_ela_fica_gravada(self):
        self.cesta_no_centro()
        resposta = self.beneficio(self.coordenador, justificativa_duplicidade=JUSTIFICATIVA)

        self.assertEqual(resposta.status_code, 201, resposta.content)
        self.assertEqual(resposta.json()['justificativa_duplicidade'], JUSTIFICATIVA)
        segundo = BeneficioEventual.objects.get(unidade=self.sul)
        self.assertEqual(segundo.justificativa_duplicidade, JUSTIFICATIVA)
        self.assertEqual(self.total(), 2)

    def test_justificativa_curta_demais_e_recusada(self):
        self.cesta_no_centro()
        resposta = self.beneficio(self.coordenador, justificativa_duplicidade='precisa')
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('justificativa_duplicidade', resposta.json())
        self.assertEqual(self.total(), 1)

    def test_justificativa_em_branco_conta_como_ausente(self):
        self.cesta_no_centro()
        resposta = self.beneficio(self.coordenador, justificativa_duplicidade='          ')
        self.assertEqual(resposta.status_code, 409)

    def test_justificativa_sem_repeticao_nao_e_gravada(self):
        resposta = self.beneficio(self.tecnico, justificativa_duplicidade=JUSTIFICATIVA)
        self.assertEqual(resposta.status_code, 201)
        self.assertIsNone(BeneficioEventual.objects.get().justificativa_duplicidade)

    def test_tipo_diferente_nao_e_repeticao(self):
        self.cesta_no_centro()
        self.assertEqual(self.beneficio(self.coordenador, tipo='SITUACAO_NASCIMENTO').status_code, 201)

    def test_mes_anterior_nao_conta(self):
        self.cesta_no_centro()
        BeneficioEventual.objects.update(criado_em=timezone.now() - timedelta(days=40))
        self.assertEqual(self.beneficio(self.coordenador).status_code, 201)

    def test_a_propria_unidade_tambem_conta(self):
        self.beneficio(self.coordenador)
        self.assertEqual(self.beneficio(self.coordenador).status_code, 409)

    def test_beneficio_removido_nao_conta(self):
        self.cesta_no_centro()
        BeneficioEventual.objects.update(excluido_em=timezone.now())
        self.assertEqual(self.beneficio(self.coordenador).status_code, 201)

    def test_outros_compara_o_que_foi_dado_nao_so_a_palavra_outros(self):
        self.beneficio(self.tecnico, tipo='OUTROS', tipo_outro='Passagem para tratamento')
        diferente = self.beneficio(self.coordenador, tipo='OUTROS', tipo_outro='Urna funerária')
        self.assertEqual(diferente.status_code, 201)
        igual = self.beneficio(self.coordenador, tipo='OUTROS', tipo_outro='  passagem PARA tratamento ')
        self.assertEqual(igual.status_code, 409)

    def test_a_outra_unidade_e_avisada_da_repeticao(self):
        self.cesta_no_centro()
        self.beneficio(self.coordenador, justificativa_duplicidade=JUSTIFICATIVA)

        aviso = Aviso.objects.get(tipo=Aviso.Tipo.BENEFICIO_REPETIDO)
        self.assertEqual(aviso.unidade_id, self.centro.id)             # quem tinha dado antes
        mensagem = [a['mensagem'] for a in self.como(self.tecnico).get('/api/notices/').json()
                    if a['tipo'] == 'BENEFICIO_REPETIDO'][0]
        self.assertEqual(
            mensagem,
            f'CRAS Sul concedeu Vulnerabilidade temporária novamente a {self.cidadao.nome} neste mês. '
            f'Justificativa registrada.',
        )
        self.assertNotIn('numerosa', mensagem)                         # o texto fica no histórico, não no aviso

    def test_a_unidade_que_repete_nao_e_avisada_de_si_mesma(self):
        self.beneficio(self.coordenador)
        self.beneficio(self.coordenador, justificativa_duplicidade=JUSTIFICATIVA)
        self.assertFalse(Aviso.objects.exists())

    def test_o_historico_municipal_mostra_a_justificativa(self):
        self.cesta_no_centro()
        self.beneficio(self.coordenador, justificativa_duplicidade=JUSTIFICATIVA)
        entradas = self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}/historico').json()['entradas']
        repetido = [e for e in entradas if e['unidade'] == 'CRAS Sul' and 'Benefício concedido' in e['o_que']][0]
        self.assertIn('Justificativa para repetir', repetido['detalhe'])
        self.assertIn('Família numerosa', repetido['detalhe'])

    def test_a_auditoria_nao_guarda_o_texto_da_justificativa(self):
        self.cesta_no_centro()
        self.beneficio(self.coordenador, justificativa_duplicidade=JUSTIFICATIVA)
        textos = ' '.join(str(r.dados_depois) for r in RegistroDeAuditoria.objects.all())
        self.assertNotIn('Família numerosa', textos)

    def test_o_visualizador_nao_registra_beneficio(self):
        self.assertEqual(self.beneficio(self.visualizador).status_code, 403)


class PedidoNaRecepcao(_Duplicidade):
    def test_servico_de_beneficio_com_beneficio_no_mes_exige_justificativa(self):
        self.cesta_no_centro()
        resposta = self.recepcao()                                     # o Sul atende o mesmo pedido

        self.assertEqual(resposta.status_code, 409, resposta.content)
        corpo = resposta.json()
        self.assertTrue(corpo['exige_justificativa'])
        self.assertEqual(corpo['duplicidade'][0]['unidade'], 'CRAS Centro')
        # Recusou sem deixar nada: nem caso, nem senha, nem visita registrada.
        self.assertFalse(Caso.objects.filter(cidadao=self.cidadao).exists())
        self.assertFalse(SenhaDaFila.objects.filter(cidadao=self.cidadao).exists())
        self.assertFalse(AtendimentoDeRecepcao.objects.filter(cidadao=self.cidadao).exists())

    def test_com_justificativa_a_visita_segue_e_ela_fica_gravada(self):
        self.cesta_no_centro()
        resposta = self.recepcao(justificativa_duplicidade=JUSTIFICATIVA)

        self.assertEqual(resposta.status_code, 201, resposta.content)
        visita = AtendimentoDeRecepcao.objects.get(cidadao=self.cidadao)
        self.assertEqual(visita.justificativa_duplicidade, JUSTIFICATIVA)

    def test_a_outra_unidade_e_avisada(self):
        self.cesta_no_centro()
        self.recepcao(justificativa_duplicidade=JUSTIFICATIVA)
        aviso = Aviso.objects.get(tipo=Aviso.Tipo.BENEFICIO_REPETIDO)
        self.assertEqual(aviso.unidade_id, self.centro.id)

    def test_a_negativa_no_balcao_nao_exige_justificativa(self):
        # Quem recusa porque "já recebeu" está fazendo o certo: não é repetição.
        self.cesta_no_centro()
        resposta = self.recepcao(desfecho='FINALIZADO', motivo='Já recebeu cesta este mês no CRAS Centro')
        self.assertEqual(resposta.status_code, 201, resposta.content)

    def test_justificativa_curta_demais_e_recusada(self):
        self.cesta_no_centro()
        resposta = self.recepcao(justificativa_duplicidade='precisa')
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('justificativa_duplicidade', resposta.json())

    def test_servico_que_nao_e_de_beneficio_nao_tem_controle(self):
        from apps.institucional.models import Demanda, Servico
        agora = timezone.now()
        outra = Demanda.objects.create(
            id=str(uuid.uuid4()), nome='Violação de Direitos', criada_em=agora, atualizada_em=agora,
        )
        servico = Servico.objects.create(id=str(uuid.uuid4()), unidade=self.sul, nome='PAEFI', demanda=outra)
        self.cesta_no_centro()
        self.assertEqual(self.recepcao(servico_id=servico.id).status_code, 201)

    def test_pessoa_sem_beneficio_no_mes_nao_tem_aviso(self):
        self.assertEqual(self.recepcao().status_code, 201)

    def test_atendimento_de_beneficio_em_outra_unidade_no_mes_tambem_avisa(self):
        # O pedido já foi encaminhado à fila de outra unidade e talvez ainda nem
        # tenha virado benefício: a recepção precisa saber mesmo assim.
        self.recepcao(operador=self.recepcionista)                     # Sul
        no_centro = self.recepcao_do_centro()
        resposta = self.como(no_centro).post(
            '/api/reception/atendimento',
            {'cidadao_id': self.cidadao.id, 'servico_id': self.servico_do_centro.id,
             'desfecho': 'ENCAMINHADO', 'observacao': 'Também pede cesta'},
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 409)
        alerta = resposta.json()['duplicidade'][0]
        self.assertEqual(alerta['origem'], 'atendimento')
        self.assertEqual(alerta['unidade'], 'CRAS Sul')

    def test_o_aviso_da_outra_unidade_fala_de_pedido_e_nao_de_concessao(self):
        self.cesta_no_centro()
        self.recepcao(justificativa_duplicidade=JUSTIFICATIVA)
        mensagem = [a['mensagem'] for a in self.como(self.tecnico).get('/api/notices/').json()
                    if a['tipo'] == 'BENEFICIO_REPETIDO'][0]
        self.assertEqual(
            mensagem,
            f'CRAS Sul atendeu novamente o pedido de {self.servico.nome} de {self.cidadao.nome} '
            f'neste mês. Justificativa registrada.',
        )

    def test_o_historico_municipal_mostra_a_justificativa_da_visita(self):
        self.cesta_no_centro()
        self.recepcao(justificativa_duplicidade=JUSTIFICATIVA)
        entradas = self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}/historico').json()['entradas']
        visita = [e for e in entradas if e['o_que'].startswith('Recepção encaminhou')][0]
        self.assertIn('Justificativa para repetir', visita['detalhe'])

    def recepcao_do_centro(self):
        from apps.contas.models import Operador
        agora = timezone.now()
        return Operador.objects.create(
            id=str(uuid.uuid4()), email='recepcao.centro.dup@teste.local', nome='Recepção Centro',
            papel='RECEPCIONISTA', ativo=True, unidade=self.centro, criado_em=agora, atualizado_em=agora,
        )


class ChegadaPorEncaminhamento(_Chegada):
    """Cumprir um encaminhamento entre unidades não é repetir o atendimento que o originou."""

    def pedido_no_sul_encaminhado_ao_centro(self):
        visita = self.como(self.recepcionista).post(
            '/api/reception/atendimento',
            {'cidadao_id': self.cidadao.id, 'servico_id': self.servico.id,
             'desfecho': 'ENCAMINHADO', 'observacao': 'Pede cesta básica'},
            content_type='application/json',
        )
        self.assertEqual(visita.status_code, 201, visita.content)
        caso_id = visita.json()['caso']['id']
        self.assertEqual(self.encaminhar(caso_id).status_code, 201)
        return Encaminhamento.objects.get(caso_id=caso_id)

    def test_a_visita_que_originou_o_encaminhamento_nao_e_repeticao(self):
        enc = self.pedido_no_sul_encaminhado_ao_centro()
        self.assertEqual(self.chegar(enc).status_code, 201)

    def test_sem_o_encaminhamento_a_mesma_chegada_e_repeticao(self):
        # A isenção vale só para o caso ligado: o mesmo pedido, feito do zero no
        # Centro, é o balcão repetindo o que o Sul já recebeu.
        self.pedido_no_sul_encaminhado_ao_centro()
        resposta = self.chegar()
        self.assertEqual(resposta.status_code, 409, resposta.content)
        self.assertEqual(resposta.json()['duplicidade'][0]['unidade'], 'CRAS Sul')


class PreviaDoAviso(_Duplicidade):
    """A tela mostra o aviso assim que o serviço é escolhido, antes de enviar."""

    def previa(self, operador=None, **parametros):
        consulta = '&'.join(f'{k}={v}' for k, v in parametros.items())
        return self.como(operador or self.recepcionista).get(
            f'/api/citizens/{self.cidadao.id}/duplicidade?{consulta}',
        )

    def test_para_um_servico(self):
        self.cesta_no_centro()
        dados = self.previa(servico_id=self.servico.id).json()
        self.assertTrue(dados['exige_justificativa'])
        self.assertEqual(dados['alertas'][0]['unidade'], 'CRAS Centro')

    def test_para_um_tipo_de_beneficio(self):
        self.cesta_no_centro()
        dados = self.previa(self.coordenador, tipo='SITUACAO_VULNERABILIDADE_TEMPORARIA').json()
        self.assertTrue(dados['exige_justificativa'])

    def test_sem_repeticao(self):
        dados = self.previa(servico_id=self.servico.id).json()
        self.assertEqual(dados, {'alertas': [], 'exige_justificativa': False})

    def test_exige_servico_ou_tipo(self):
        self.assertEqual(self.previa().status_code, 400)

    def test_servico_inexistente_e_400_e_tipo_invalido_tambem(self):
        self.assertEqual(self.previa(servico_id='inventado').status_code, 400)
        self.assertEqual(self.previa(tipo='QUALQUER').status_code, 400)

    def test_cidadao_inexistente_e_404(self):
        resposta = self.como(self.recepcionista).get('/api/citizens/inventado/duplicidade?tipo=OUTROS')
        self.assertEqual(resposta.status_code, 404)

    def test_o_visualizador_nao_consulta(self):
        self.assertEqual(self.previa(self.visualizador, tipo='OUTROS').status_code, 403)

    def test_a_previa_nao_expoe_quem_atendeu(self):
        self.cesta_no_centro()
        alerta = self.previa(servico_id=self.servico.id).json()['alertas'][0]
        for chave in ('quem_atendeu', 'registrado_por', 'operador'):
            self.assertNotIn(chave, alerta)


class JanelaDoMes(_Duplicidade):
    def test_o_inicio_da_janela_e_o_primeiro_dia_do_mes_no_fuso_local(self):
        inicio = duplicidade.inicio_do_mes()
        local = timezone.localtime(inicio)
        self.assertEqual((local.day, local.hour, local.minute, local.second), (1, 0, 0, 0))
        self.assertEqual(local.month, timezone.localtime(timezone.now()).month)

    def test_benefício_do_primeiro_instante_do_mes_conta_e_do_ultimo_do_anterior_nao(self):
        self.cesta_no_centro()
        inicio = duplicidade.inicio_do_mes()
        BeneficioEventual.objects.update(criado_em=inicio)
        self.assertEqual(self.beneficio(self.coordenador).status_code, 409)
        BeneficioEventual.objects.update(criado_em=inicio - timedelta(seconds=1))
        self.assertEqual(self.beneficio(self.coordenador).status_code, 201)


class DuasRegistrosAoMesmoTempo(TransactionTestCase):
    """Conexões separadas: a corrida não existe dentro da transação única de um TestCase."""

    def setUp(self):
        CenarioBase.setUpTestData.__func__(type(self))

    def _registrar(self, resultados, indice, operador):
        try:
            resultados[indice] = CenarioBase.como(self, operador).post(
                f'/api/citizens/{self.cidadao.id}/beneficios', CESTA, content_type='application/json',
            )
        finally:
            connections.close_all()

    def test_so_um_dos_dois_registros_simultaneos_passa_sem_justificativa(self):
        # Força o encontro: os dois conferem a repetição antes de qualquer um
        # gravar. Sem trava, os dois passam e a pessoa recebe duas vezes.
        conferir = duplicidade.alertas_de_beneficio
        encontro = threading.Barrier(2, timeout=1)

        def conferir_e_esperar(*args, **kwargs):
            alertas = conferir(*args, **kwargs)
            try:
                encontro.wait()
            except threading.BrokenBarrierError:
                pass
            return alertas

        resultados = {}
        with mock.patch.object(duplicidade, 'alertas_de_beneficio', conferir_e_esperar):
            fios = [
                threading.Thread(target=self._registrar, args=(resultados, 0, self.tecnico)),
                threading.Thread(target=self._registrar, args=(resultados, 1, self.coordenador)),
            ]
            for fio in fios:
                fio.start()
            for fio in fios:
                fio.join(timeout=30)

        self.assertEqual(sorted(r.status_code for r in resultados.values()), [201, 409])
        self.assertEqual(BeneficioEventual.objects.filter(cidadao=self.cidadao).count(), 1)

    def _pedir_no_balcao(self, resultados, indice, operador, servico):
        try:
            resultados[indice] = CenarioBase.como(self, operador).post(
                '/api/reception/atendimento',
                {'cidadao_id': self.cidadao.id, 'servico_id': servico.id,
                 'desfecho': 'ENCAMINHADO', 'observacao': 'Pede cesta básica'},
                content_type='application/json',
            )
        finally:
            connections.close_all()

    def test_so_um_dos_dois_pedidos_simultaneos_no_balcao_passa_sem_justificativa(self):
        # Dois balcões, duas unidades, o mesmo pedido no mesmo instante.
        from apps.contas.models import Operador
        agora = timezone.now()
        recepcao_do_centro = Operador.objects.create(
            id=str(uuid.uuid4()), email='recepcao.centro.corrida@teste.local', nome='Recepção Centro',
            papel='RECEPCIONISTA', ativo=True, unidade=self.centro, criado_em=agora, atualizado_em=agora,
        )
        conferir = duplicidade.alertas_para_servico
        encontro = threading.Barrier(2, timeout=1)

        def conferir_e_esperar(*args, **kwargs):
            alertas = conferir(*args, **kwargs)
            try:
                encontro.wait()
            except threading.BrokenBarrierError:
                pass
            return alertas

        resultados = {}
        with mock.patch.object(duplicidade, 'alertas_para_servico', conferir_e_esperar):
            fios = [
                threading.Thread(target=self._pedir_no_balcao,
                                 args=(resultados, 0, self.recepcionista, self.servico)),
                threading.Thread(target=self._pedir_no_balcao,
                                 args=(resultados, 1, recepcao_do_centro, self.servico_do_centro)),
            ]
            for fio in fios:
                fio.start()
            for fio in fios:
                fio.join(timeout=30)

        self.assertEqual(sorted(r.status_code for r in resultados.values()), [201, 409])
        self.assertEqual(AtendimentoDeRecepcao.objects.filter(cidadao=self.cidadao).count(), 1)
