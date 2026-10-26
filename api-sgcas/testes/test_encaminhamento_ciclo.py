"""
O ciclo de vida do encaminhamento: aceitar, recusar, concluir — e o aviso a quem
encaminhou em cada passo.

Antes o estado ficava PENDENTE para sempre: nada o alterava. A unidade de origem
perdia o caso de vista e só descobria o que aconteceu abrindo o prontuário da
pessoa, se lembrasse de abrir.
"""
from apps.atendimentos.models import Aviso, Caso, Encaminhamento, SenhaDaFila
from testes.test_encaminhamento_ficha import _Ficha, _SEM


class _Ciclo(_Ficha):
    """Origem: CRAS Sul (coordenador). Destino: CRAS Centro (técnico)."""

    def enviar(self, **mudancas):
        caso_id = self.abrir()
        self.encaminhar(caso_id, **mudancas)
        return caso_id, Encaminhamento.objects.get(caso_id=caso_id)

    def no_destino(self, rota, corpo=None, operador=None):
        return self.como(operador or self.tecnico).post(
            rota, corpo or {}, content_type='application/json',
        )

    def avisos(self, tipo):
        return list(Aviso.objects.filter(tipo=tipo))

    def recepcionista_do_centro(self):
        import uuid
        from django.utils import timezone
        from apps.contas.models import Operador
        agora = timezone.now()
        return Operador.objects.create(
            id=str(uuid.uuid4()), email='recepcao.centro@teste.local', nome='Recepção Centro',
            papel='RECEPCIONISTA', ativo=True, unidade=self.centro, criado_em=agora, atualizado_em=agora,
        )


class Aceitar(_Ciclo):
    def test_o_destino_aceita(self):
        _, enc = self.enviar()
        resposta = self.no_destino(f'/api/referrals/{enc.id}/aceitar', {'observacao': 'Vamos agendar para terça'})

        self.assertEqual(resposta.status_code, 200, resposta.content)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.ACEITO)
        self.assertEqual(enc.respondido_por_id, self.tecnico.id)
        self.assertIsNotNone(enc.respondido_em)
        self.assertEqual(enc.resposta, 'Vamos agendar para terça')

    def test_a_observacao_e_opcional(self):
        _, enc = self.enviar()
        self.assertEqual(self.no_destino(f'/api/referrals/{enc.id}/aceitar').status_code, 200)

    def test_a_origem_e_avisada(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')
        aviso = self.avisos(Aviso.Tipo.ENCAMINHAMENTO_ACEITO)[0]
        self.assertEqual(aviso.unidade_id, self.sul.id)
        self.assertEqual(aviso.dados['destino'], 'CRAS Centro')
        self.assertEqual(aviso.encaminhamento_id, enc.id)

    def test_nao_aceita_duas_vezes(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')
        self.assertEqual(self.no_destino(f'/api/referrals/{enc.id}/aceitar').status_code, 409)

    def test_so_o_destino_responde(self):
        _, enc = self.enviar()
        # Quem enviou não aceita o próprio encaminhamento.
        self.assertEqual(
            self.no_destino(f'/api/referrals/{enc.id}/aceitar', operador=self.coordenador).status_code, 403,
        )
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.PENDENTE)

    def test_recepcao_nao_responde(self):
        _, enc = self.enviar()
        agora = self.recepcionista_do_centro()
        resposta = self.no_destino(f'/api/referrals/{enc.id}/aceitar', operador=agora)
        self.assertEqual(resposta.status_code, 403)

    def test_encaminhamento_inexistente_e_404(self):
        self.assertEqual(self.no_destino('/api/referrals/inventado/aceitar').status_code, 404)


class Recusar(_Ciclo):
    def test_o_destino_recusa_com_motivo_e_o_caso_volta_para_a_origem(self):
        caso_id, enc = self.enviar()
        resposta = self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': 'Fora do perfil do CRAS Centro'})

        self.assertEqual(resposta.status_code, 200, resposta.content)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.RECUSADO)
        self.assertEqual(enc.resposta, 'Fora do perfil do CRAS Centro')
        self.assertEqual(enc.respondido_por_id, self.tecnico.id)

        caso = Caso.objects.get(pk=caso_id)
        self.assertEqual(caso.unidade_id, self.sul.id)                    # voltou para quem encaminhou
        self.assertEqual(caso.situacao, Caso.Situacao.EM_ATENDIMENTO)     # e está aberto para agir
        self.assertIn('Fora do perfil do CRAS Centro', caso.descricao)

    def test_exige_o_motivo(self):
        _, enc = self.enviar()
        for corpo in ({}, {'motivo': '   '}):
            self.assertEqual(self.no_destino(f'/api/referrals/{enc.id}/recusar', corpo).status_code, 400)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.PENDENTE)

    def test_a_origem_e_avisada(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': 'Fora do perfil'})
        aviso = self.avisos(Aviso.Tipo.ENCAMINHAMENTO_RECUSADO)[0]
        self.assertEqual(aviso.unidade_id, self.sul.id)
        # O motivo está na ficha; o aviso vai para a unidade inteira, recepção incluída.
        self.assertNotIn('Fora do perfil', str(aviso.dados))

    def test_a_origem_pode_encaminhar_de_novo_depois_da_recusa(self):
        caso_id, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': 'Fora do perfil'})
        terceira = self.terceira_unidade()
        resposta = self.encaminhar(caso_id, unidade_destino_id=terceira.id)
        self.assertEqual(resposta.status_code, 201, resposta.content)

    def test_so_se_recusa_o_que_esta_pendente(self):
        _, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')
        self.assertEqual(self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': 'x'}).status_code, 409)

    def test_so_o_destino_recusa(self):
        _, enc = self.enviar()
        resposta = self.no_destino(f'/api/referrals/{enc.id}/recusar', {'motivo': 'x'}, operador=self.coordenador)
        self.assertEqual(resposta.status_code, 403)


class ConclusaoPeloDestino(_Ciclo):
    """O destino conclui o caso, como sempre; o encaminhamento acompanha."""

    def conclusao(self, caso_id, relato='Acompanhamento iniciado; família orientada.'):
        return self.no_destino(f'/api/cases/{caso_id}/concluir', {'situacao': 'CONCLUIDO', 'relato': relato})

    def test_concluir_o_caso_conclui_o_encaminhamento(self):
        caso_id, enc = self.enviar()
        self.no_destino(f'/api/referrals/{enc.id}/aceitar')
        self.assertEqual(self.conclusao(caso_id).status_code, 200)

        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.CONCLUIDO)
        self.assertIsNotNone(enc.concluido_em)
        self.assertIn('família orientada', enc.resultado)

    def test_vale_mesmo_sem_ter_aceitado_antes(self):
        caso_id, enc = self.enviar()
        self.conclusao(caso_id)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.CONCLUIDO)
        self.assertEqual(enc.respondido_por_id, self.tecnico.id)    # concluir é responder

    def test_a_origem_e_avisada_de_que_o_atendimento_acabou(self):
        caso_id, _ = self.enviar()
        self.conclusao(caso_id)
        aviso = self.avisos(Aviso.Tipo.ENCAMINHAMENTO_CONCLUIDO)[0]
        self.assertEqual(aviso.unidade_id, self.sul.id)
        self.assertEqual(aviso.dados['destino'], 'CRAS Centro')

    def test_nao_comparecer_ao_destino_tambem_avisa_a_origem(self):
        import uuid
        from django.utils import timezone

        caso_id, enc = self.enviar()
        # A pessoa foi chamada no destino e não apareceu: a senha está em
        # atendimento e o caso, com o técnico do Centro.
        agora = timezone.now()
        Caso.objects.filter(pk=caso_id).update(situacao=Caso.Situacao.EM_ATENDIMENTO, tecnico=self.tecnico)
        senha = SenhaDaFila.objects.create(
            id=str(uuid.uuid4()), senha='NR001', cidadao=self.cidadao, unidade=self.centro,
            situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO, atendido_por=self.tecnico,
            criado_em=agora, atualizado_em=agora,
        )
        self.no_destino(f'/api/queues/{senha.id}/nao-compareceu', {'motivo': 'Não atendeu o telefone'})

        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.CONCLUIDO)
        self.assertIn('não compareceu', enc.resultado.lower())
        aviso = self.avisos(Aviso.Tipo.NAO_COMPARECEU)[0]
        self.assertEqual(aviso.unidade_id, self.sul.id)


class ConcluirEncaminhamentoExterno(_Ciclo):
    def externo(self):
        caso_id = self.abrir()
        self.encaminhar(caso_id, unidade_destino_id=_SEM, destino_externo='Conselho Tutelar')
        return Encaminhamento.objects.get(caso_id=caso_id)

    def test_a_origem_registra_o_retorno_do_servico_externo(self):
        enc = self.externo()
        resposta = self.post(f'/api/referrals/{enc.id}/concluir', {'resultado': 'Conselho acolheu a denúncia'})
        self.assertEqual(resposta.status_code, 200, resposta.content)
        enc.refresh_from_db()
        self.assertEqual(enc.situacao, Encaminhamento.Situacao.CONCLUIDO)
        self.assertEqual(enc.resultado, 'Conselho acolheu a denúncia')
        self.assertIsNotNone(enc.concluido_em)

    def test_exige_o_resultado(self):
        enc = self.externo()
        self.assertEqual(self.post(f'/api/referrals/{enc.id}/concluir', {'resultado': ' '}).status_code, 400)

    def test_encaminhamento_interno_conclui_pelo_caso_no_destino_e_nao_por_aqui(self):
        _, enc = self.enviar()
        resposta = self.no_destino(f'/api/referrals/{enc.id}/concluir', {'resultado': 'x'})
        self.assertEqual(resposta.status_code, 400)

    def test_so_a_origem_conclui_o_externo(self):
        enc = self.externo()
        self.assertEqual(
            self.no_destino(f'/api/referrals/{enc.id}/concluir', {'resultado': 'x'}).status_code, 403,
        )

    def test_nao_conclui_duas_vezes(self):
        enc = self.externo()
        self.post(f'/api/referrals/{enc.id}/concluir', {'resultado': 'ok'})
        self.assertEqual(self.post(f'/api/referrals/{enc.id}/concluir', {'resultado': 'ok'}).status_code, 409)
