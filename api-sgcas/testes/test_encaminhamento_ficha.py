"""
A ficha de encaminhamento.

Antes, encaminhar guardava destino, motivo e observações. Quem recebia não sabia
de que unidade vinha, o que a pessoa tinha pedido nem o que já tinha recebido, e
a conversa para descobrir isso era por papel, levando horas ou dias. A ficha leva
tudo junto, no momento em que se encaminha.
"""
import uuid
from datetime import timedelta

from django.utils import timezone

from apps.atendimentos.models import Aviso, Caso, Encaminhamento, SenhaDaFila
from apps.institucional.models import Unidade
from testes.test_concluir_caso import _CasoEmAtendimento

RELATO_DO_BALCAO = 'Pedido de cesta básica'


class _Ficha(_CasoEmAtendimento):
    """
    A origem é o CRAS Sul (recepção e coordenador); o destino, o CRAS Centro
    (técnico). O caso nasce no balcão do Sul e está em atendimento.
    """

    def payload(self, **mudancas):
        base = {
            'unidade_destino_id': self.centro.id,
            'categoria_do_motivo': 'VIOLACAO_DE_DIREITOS',
            'urgencia': 'ALTA',
            'motivo': 'Suspeita de violência doméstica; precisa de acompanhamento especializado',
            'resumo_da_situacao': 'Mulher relata agressões do companheiro; filhos presentes na casa.',
            'documentos_entregues': 'RG, comprovante de residência',
            'contato_para_retorno': '(97) 99999-1234, falar com a irmã',
            'prazo': (timezone.localdate() + timedelta(days=7)).isoformat(),
            'observacoes': 'Família resistente a contato.',
        }
        base.update(mudancas)
        return {k: v for k, v in base.items() if v is not _SEM}

    def encaminhar(self, caso_id, **mudancas):
        return self.post(f'/api/cases/{caso_id}/encaminhar', self.payload(**mudancas))

    def conceder_cesta_no_sul(self):
        return self.post(
            f'/api/citizens/{self.cidadao.id}/beneficios',
            {'tipo': 'SITUACAO_VULNERABILIDADE_TEMPORARIA', 'descricao': 'Cesta básica entregue'},
        )

    def terceira_unidade(self):
        agora = timezone.now()
        return Unidade.objects.create(
            id=str(uuid.uuid4()), nome='CREAS', sigla='CREAS-T', tipo='CREAS',
            coordenacao=self.psb, criada_em=agora, atualizada_em=agora,
        )


_SEM = object()


class CriacaoDaFicha(_Ficha):
    def test_a_ficha_e_gravada_inteira(self):
        caso_id = self.abrir()
        resposta = self.encaminhar(caso_id)

        self.assertEqual(resposta.status_code, 201, resposta.content)
        enc = Encaminhamento.objects.get(caso_id=caso_id)
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.PENDENTE)
        self.assertEqual(enc.categoria_do_motivo, 'VIOLACAO_DE_DIREITOS')
        self.assertEqual(enc.urgencia, 'ALTA')
        self.assertIn('violência doméstica', enc.motivo)
        self.assertIn('agressões', enc.resumo_da_situacao)
        self.assertEqual(enc.documentos_entregues, 'RG, comprovante de residência')
        self.assertEqual(enc.contato_para_retorno, '(97) 99999-1234, falar com a irmã')
        self.assertEqual(enc.prazo, timezone.localdate() + timedelta(days=7))
        self.assertEqual(enc.observacoes, 'Família resistente a contato.')
        self.assertEqual(enc.encaminhado_por_id, self.coordenador.id)

    def test_registra_de_que_unidade_veio(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id)
        enc = Encaminhamento.objects.get(caso_id=caso_id)
        self.assertEqual(enc.unidade_origem_id, self.sul.id)
        self.assertEqual(enc.unidade_destino_id, self.centro.id)

    def test_a_resposta_diz_a_origem_o_destino_e_a_categoria(self):
        dados = self.encaminhar(self.abrir()).json()
        self.assertEqual(dados['unidade_origem_nome'], 'CRAS Sul')
        self.assertEqual(dados['unidade_destino_nome'], 'CRAS Centro')
        self.assertEqual(dados['categoria_rotulo'], 'Violação de direitos')
        self.assertEqual(dados['cidadao_nome'], self.cidadao.nome)
        self.assertEqual(dados['situacao'], 'PENDENTE')


class AFichaLevaOQueAOrigemSabia(_Ficha):
    def ficha(self, caso_id):
        return Encaminhamento.objects.get(caso_id=caso_id).ficha

    def test_leva_o_servico_o_que_foi_pedido_e_o_relato(self):
        caso_id = self.abrir()
        self.post(f'/api/cases/{caso_id}/observacao', {'observacao': 'Visita agendada para sexta'})
        self.encaminhar(caso_id)

        ficha = self.ficha(caso_id)
        self.assertEqual(ficha['unidade_origem'], 'CRAS Sul')
        self.assertEqual(ficha['servico']['nome'], self.servico.nome)
        self.assertEqual(ficha['servico']['categoria'], 'Benefício Eventual')
        self.assertEqual(ficha['solicitado'][0]['demanda'], self.servico.nome)
        self.assertEqual(ficha['solicitado'][0]['unidade'], 'CRAS Sul')
        self.assertIn(RELATO_DO_BALCAO, ficha['relato'])
        self.assertIn('Visita agendada para sexta', ficha['relato'])

    def test_leva_o_que_a_pessoa_recebeu_na_origem_durante_o_caso(self):
        caso_id = self.abrir()
        self.conceder_cesta_no_sul()
        self.encaminhar(caso_id)

        beneficios = self.ficha(caso_id)['beneficios_concedidos']
        self.assertEqual(len(beneficios), 1)
        self.assertEqual(beneficios[0]['unidade'], 'CRAS Sul')
        self.assertEqual(beneficios[0]['tipo'], 'Vulnerabilidade temporária')
        self.assertEqual(beneficios[0]['descricao'], 'Cesta básica entregue')

    def test_beneficio_dado_antes_do_caso_ou_em_outra_unidade_nao_entra(self):
        from apps.atendimentos.models import BeneficioEventual

        caso_id = self.abrir()
        agora = timezone.now()
        BeneficioEventual.objects.create(
            id=str(uuid.uuid4()), cidadao=self.cidadao, nome_da_pessoa=self.cidadao.nome,
            tipo='OUTROS', tipo_outro='Antes do caso', registrado_por=self.coordenador,
            unidade=self.sul, criado_em=agora - timedelta(days=3), atualizado_em=agora,
        )
        BeneficioEventual.objects.create(
            id=str(uuid.uuid4()), cidadao=self.cidadao, nome_da_pessoa=self.cidadao.nome,
            tipo='OUTROS', tipo_outro='Em outra unidade', registrado_por=self.tecnico,
            unidade=self.centro, criado_em=agora, atualizado_em=agora,
        )
        self.encaminhar(caso_id)
        self.assertEqual(self.ficha(caso_id)['beneficios_concedidos'], [])

    def test_e_uma_fotografia_nao_uma_consulta(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id)
        antes = self.ficha(caso_id)['relato']

        Caso.objects.filter(pk=caso_id).update(descricao='Texto reescrito depois')
        self.assertEqual(self.ficha(caso_id)['relato'], antes)
        self.assertIn(RELATO_DO_BALCAO, antes)


class CamposObrigatorios(_Ficha):
    def test_cada_campo_obrigatorio_e_exigido(self):
        # Recusar não altera estado: um só caso serve para todas as voltas.
        caso_id = self.abrir()
        for campo in ('categoria_do_motivo', 'motivo', 'resumo_da_situacao'):
            with self.subTest(campo):
                resposta = self.encaminhar(caso_id, **{campo: _SEM})
                self.assertEqual(resposta.status_code, 400)
                self.assertIn(campo, resposta.json())
        self.assertFalse(Encaminhamento.objects.filter(caso_id=caso_id).exists())

    def test_texto_em_branco_conta_como_ausente(self):
        caso_id = self.abrir()
        for campo in ('motivo', 'resumo_da_situacao'):
            with self.subTest(campo):
                self.assertEqual(self.encaminhar(caso_id, **{campo: '   '}).status_code, 400)
        self.assertFalse(Encaminhamento.objects.filter(caso_id=caso_id).exists())

    def test_categoria_e_urgencia_fora_da_lista_sao_recusadas(self):
        caso_id = self.abrir()
        self.assertEqual(self.encaminhar(caso_id, categoria_do_motivo='QUALQUER').status_code, 400)
        self.assertEqual(self.encaminhar(caso_id, urgencia='MUITO').status_code, 400)

    def test_prazo_no_passado_e_recusado(self):
        resposta = self.encaminhar(self.abrir(), prazo=(timezone.localdate() - timedelta(days=1)).isoformat())
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('prazo', resposta.json())

    def test_so_o_que_nao_e_a_ficha_e_opcional(self):
        resposta = self.encaminhar(
            self.abrir(), documentos_entregues=_SEM, contato_para_retorno=_SEM, prazo=_SEM,
            observacoes=_SEM, urgencia=_SEM,
        )
        self.assertEqual(resposta.status_code, 201, resposta.content)
        enc = Encaminhamento.objects.get()
        self.assertEqual(enc.urgencia, 'NORMAL')  # sem urgência informada, vale a normal

    def test_destino_interno_ou_externo_nunca_os_dois_nem_nenhum(self):
        caso_id = self.abrir()
        self.assertEqual(self.encaminhar(caso_id, destino_externo='Conselho Tutelar').status_code, 400)
        self.assertEqual(self.encaminhar(caso_id, unidade_destino_id=_SEM).status_code, 400)

    def test_a_propria_unidade_nao_e_destino(self):
        resposta = self.encaminhar(self.abrir(), unidade_destino_id=self.sul.id)
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('unidade_destino_id', resposta.json())

    def test_recepcao_nao_encaminha(self):
        caso_id = self.abrir()
        resposta = self.como(self.recepcionista).post(
            f'/api/cases/{caso_id}/encaminhar', self.payload(), content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 403)


class DestinoInterno(_Ficha):
    def test_o_caso_passa_para_a_unidade_de_destino(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id)
        caso = Caso.objects.get(pk=caso_id)
        self.assertEqual(caso.unidade_id, self.centro.id)
        self.assertEqual(caso.situacao, Caso.Situacao.ENCAMINHADO)
        self.assertIsNone(caso.fechado_em)   # continua aberto: quem recebe é quem atende

    def test_a_urgencia_tecnica_sobe_a_prioridade_do_caso(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id, urgencia='URGENTE')
        self.assertEqual(Caso.objects.get(pk=caso_id).prioridade, 'URGENTE')

    def test_urgencia_menor_nao_rebaixa_o_caso(self):
        caso_id = self.abrir()
        Caso.objects.filter(pk=caso_id).update(prioridade='ALTA')
        self.encaminhar(caso_id, urgencia='BAIXA')
        self.assertEqual(Caso.objects.get(pk=caso_id).prioridade, 'ALTA')

    def test_o_relato_do_caso_registra_para_onde_foi_e_por_que(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id)
        relato = Caso.objects.get(pk=caso_id).descricao
        self.assertIn(RELATO_DO_BALCAO, relato)
        self.assertIn('Encaminhado para CRAS Centro', relato)
        self.assertIn('Violação de direitos', relato)

    def test_a_senha_em_atendimento_e_liberada(self):
        self.encaminhar(self.abrir())
        self.assertFalse(SenhaDaFila.objects.filter(situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO).exists())

    def test_o_destino_recebe_um_aviso(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id)
        aviso = Aviso.objects.get(tipo=Aviso.Tipo.ENCAMINHAMENTO_RECEBIDO)
        self.assertEqual(aviso.unidade_id, self.centro.id)
        self.assertEqual(aviso.cidadao_id, self.cidadao.id)
        self.assertEqual(aviso.encaminhamento.caso_id, caso_id)
        self.assertEqual(aviso.dados['origem'], 'CRAS Sul')
        self.assertEqual(aviso.dados['categoria'], 'Violação de direitos')
        self.assertIsNone(aviso.lido_em)

    def test_o_aviso_nao_carrega_texto_livre(self):
        # O aviso vai para toda a unidade, inclusive a recepção: nada do relato.
        self.encaminhar(self.abrir())
        aviso = Aviso.objects.get()
        texto = str(aviso.dados)
        for sensivel in ('violência', 'agressões', 'companheiro', 'cesta'):
            self.assertNotIn(sensivel, texto)


class DestinoExterno(_Ficha):
    def test_o_caso_fica_na_origem_e_se_encerra_la(self):
        caso_id = self.abrir()
        resposta = self.encaminhar(caso_id, unidade_destino_id=_SEM, destino_externo='Conselho Tutelar')
        self.assertEqual(resposta.status_code, 201, resposta.content)

        caso = Caso.objects.get(pk=caso_id)
        self.assertEqual(caso.unidade_id, self.sul.id)
        self.assertEqual(caso.situacao, Caso.Situacao.ENCAMINHADO)
        self.assertIsNotNone(caso.fechado_em)

    def test_guarda_o_destino_e_a_ficha_mas_nao_avisa_ninguem(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id, unidade_destino_id=_SEM, destino_externo='Conselho Tutelar')
        enc = Encaminhamento.objects.get(caso_id=caso_id)
        self.assertIsNone(enc.unidade_destino_id)
        self.assertEqual(enc.destino_externo, 'Conselho Tutelar')
        self.assertEqual(enc.unidade_origem_id, self.sul.id)
        self.assertIsNotNone(enc.ficha)
        self.assertFalse(Aviso.objects.exists())

    def test_nao_encaminha_duas_vezes_ao_mesmo_tempo_para_fora(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id, unidade_destino_id=_SEM, destino_externo='Conselho Tutelar')
        # O caso segue na origem; um segundo encaminhamento aberto seria ruído.
        Caso.objects.filter(pk=caso_id).update(situacao=Caso.Situacao.EM_ATENDIMENTO, fechado_em=None)
        resposta = self.encaminhar(caso_id, unidade_destino_id=_SEM, destino_externo='Saúde')
        self.assertEqual(resposta.status_code, 409)


class CadeiaDeEncaminhamentos(_Ficha):
    def test_encaminhar_adiante_conclui_o_anterior_e_avisa_a_origem(self):
        creas = self.terceira_unidade()
        caso_id = self.abrir()
        self.encaminhar(caso_id)                                  # Sul -> Centro
        primeiro = Encaminhamento.objects.get(caso_id=caso_id)

        resposta = self.como(self.tecnico).post(                  # Centro -> CREAS
            f'/api/cases/{caso_id}/encaminhar',
            self.payload(unidade_destino_id=creas.id, motivo='Precisa do CREAS'),
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 201, resposta.content)

        primeiro.refresh_from_db()
        self.assertEqual(primeiro.situacao, Encaminhamento.Situacao.CONCLUIDO)
        self.assertIsNotNone(primeiro.concluido_em)
        self.assertIn('CREAS', primeiro.resultado)

        segundo = Encaminhamento.objects.exclude(pk=primeiro.pk).get(caso_id=caso_id)
        self.assertEqual(segundo.unidade_origem_id, self.centro.id)
        self.assertEqual(segundo.unidade_destino_id, creas.id)

        # A origem do primeiro (Sul) soube que a pessoa seguiu para o CREAS.
        aviso = Aviso.objects.get(tipo=Aviso.Tipo.ENCAMINHADO_ADIANTE)
        self.assertEqual(aviso.unidade_id, self.sul.id)
        self.assertEqual(aviso.dados['destino'], 'CREAS')


class PeloProntuario(_Ficha):
    def encaminhar_pelo_prontuario(self, operador=None, **mudancas):
        return self.como(operador or self.coordenador).post(
            f'/api/citizens/{self.cidadao.id}/encaminhamentos', self.payload(**mudancas),
            content_type='application/json',
        )

    def test_sem_caso_abre_um_na_origem_e_o_leva_ao_destino(self):
        resposta = self.encaminhar_pelo_prontuario()
        self.assertEqual(resposta.status_code, 201, resposta.content)

        enc = Encaminhamento.objects.get()
        self.assertEqual(enc.unidade_origem_id, self.sul.id)
        self.assertEqual(enc.caso.unidade_id, self.centro.id)
        self.assertEqual(enc.caso.situacao, Caso.Situacao.ENCAMINHADO)
        self.assertIsNone(enc.caso.fechado_em)    # o destino precisa dele aberto
        self.assertIsNotNone(enc.ficha)
        self.assertTrue(Aviso.objects.filter(tipo=Aviso.Tipo.ENCAMINHAMENTO_RECEBIDO).exists())

    def test_exige_a_ficha_inteira_tambem_por_aqui(self):
        resposta = self.encaminhar_pelo_prontuario(resumo_da_situacao=_SEM)
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('resumo_da_situacao', resposta.json())

    def test_caso_de_outra_unidade_nao_pode_ser_encaminhado_por_aqui(self):
        # Antes, qualquer técnico encaminhava o caso de qualquer unidade.
        caso_id = self.abrir()                       # caso do Sul
        resposta = self.encaminhar_pelo_prontuario(self.tecnico, caso_id=caso_id, unidade_destino_id=self.sul.id)
        self.assertEqual(resposta.status_code, 403)
        self.assertEqual(Caso.objects.get(pk=caso_id).unidade_id, self.sul.id)

    def test_caso_encerrado_nao_pode_ser_encaminhado_por_aqui(self):
        caso_id = self.abrir()
        self.post(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': 'Feito'})
        self.assertEqual(self.encaminhar_pelo_prontuario(caso_id=caso_id).status_code, 409)


class ConcluirNaoEncaminha(_Ficha):
    def test_concluir_como_encaminhado_e_recusado(self):
        # Era um atalho: encerrava o caso como ENCAMINHADO sem criar encaminhamento
        # nenhum, e ninguém na outra unidade ficava sabendo.
        caso_id = self.abrir()
        resposta = self.post(f'/api/cases/{caso_id}/concluir', {'situacao': 'ENCAMINHADO', 'relato': 'Segue'})
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('situacao', resposta.json())
        self.assertEqual(Caso.objects.get(pk=caso_id).situacao, Caso.Situacao.EM_ATENDIMENTO)


class PrivacidadeDaFicha(_Ficha):
    def test_a_auditoria_nao_guarda_o_relato_nem_o_telefone_da_ficha(self):
        from apps.auditoria.models import RegistroDeAuditoria

        self.encaminhar(self.abrir())
        registro = RegistroDeAuditoria.objects.filter(entidade='cases', acao='CREATE').latest('criado_em')
        texto = str(registro.dados_depois)
        for sensivel in ('agressões', 'companheiro', '99999-1234', 'violência doméstica', 'irmã', 'RG, comprovante'):
            self.assertNotIn(sensivel, texto)
        self.assertTrue(registro.dados_depois['resumo_da_situacao'].startswith('[REDIGIDO:'))
        self.assertEqual(registro.dados_depois['contato_para_retorno'], '[REDIGIDO]')
        # O que não é sensível continua legível: a trilha precisa dizer o quê e para onde.
        self.assertEqual(registro.dados_depois['categoria_do_motivo'], 'VIOLACAO_DE_DIREITOS')

    def test_a_eliminacao_lgpd_apaga_o_telefone_de_contato_da_ficha(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id)
        self.assertEqual(Encaminhamento.objects.get().contato_para_retorno, '(97) 99999-1234, falar com a irmã')

        resposta = self.como(self.admin).delete(f'/api/citizens/{self.cidadao.id}/dados-pessoais')
        self.assertEqual(resposta.status_code, 200, resposta.content)

        enc = Encaminhamento.objects.get()
        self.assertIsNone(enc.contato_para_retorno)
        # O histórico do encaminhamento permanece, como decidido para os relatos.
        self.assertIn('violência doméstica', enc.motivo)
        self.assertEqual(enc.categoria_do_motivo, 'VIOLACAO_DE_DIREITOS')

    def test_o_aviso_passa_a_dizer_cidadao_excluido_depois_da_eliminacao(self):
        # O aviso não guarda o nome: ele vem do cadastro, e o cadastro anonimizado
        # é o que passa a ser lido.
        self.encaminhar(self.abrir())
        self.como(self.admin).delete(f'/api/citizens/{self.cidadao.id}/dados-pessoais')
        aviso = Aviso.objects.get()
        self.assertTrue(aviso.cidadao.nome.startswith('Cidadão excluído'))
        self.assertNotIn(self.cidadao.nome, str(aviso.dados))
