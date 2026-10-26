"""A trilha de auditoria."""
from apps.auditoria.models import RegistroDeAuditoria
from testes.base import CenarioBase


class TrilhaDeAuditoria(CenarioBase):
    def test_registra_leitura_de_prontuario(self):
        # Um sistema que só audita escrita não responde "quem consultou os
        # dados desta pessoa" — que é o que a LGPD pede.
        self.como(self.tecnico).get(f'/api/citizens/{self.cidadao.id}')
        registro = RegistroDeAuditoria.objects.filter(acao='READ', entidade='citizens').first()
        self.assertIsNotNone(registro)
        self.assertEqual(registro.operador_id, self.tecnico.id)

    def test_registra_escrita_com_dados_redigidos(self):
        self.como(self.recepcionista).post(
            '/api/reception/atendimento',
            {'cidadao_id': self.cidadao.id, 'servico_id': self.servico.id,
             'desfecho': 'FINALIZADO', 'motivo': 'Relato de violência doméstica'},
            content_type='application/json',
        )
        registro = RegistroDeAuditoria.objects.filter(acao='CREATE').first()
        self.assertIsNotNone(registro)
        self.assertTrue(registro.dados_depois['motivo'].startswith('[REDIGIDO:'))
        self.assertNotIn('violência', str(registro.dados_depois))

    def test_nao_polui_a_trilha_com_consulta_a_catalogo(self):
        # Auditar todo GET enterraria a informação que importa no ruído.
        antes = RegistroDeAuditoria.objects.count()
        cliente = self.como(self.tecnico)
        cliente.get('/api/institutional/units')
        cliente.get('/api/institutional/demands')
        cliente.get('/api/auth/me')
        self.assertEqual(RegistroDeAuditoria.objects.count(), antes)

    def test_requisicao_recusada_vira_registro_de_acesso_negado(self):
        # A tentativa barrada fica na trilha — é sinal de segurança. Mas com
        # ação própria: gravá-la como READ afirmaria que a pessoa viu o
        # prontuário, quando o acesso foi justamente impedido.
        resposta = self.como(self.recepcionista).get(f'/api/citizens/{self.cidadao.id}')
        self.assertEqual(resposta.status_code, 403)

        registro = RegistroDeAuditoria.objects.get()
        self.assertEqual(registro.acao, 'ACESSO_NEGADO')
        self.assertEqual(registro.operador_id, self.recepcionista.id)
        self.assertEqual(registro.entidade, 'citizens')

    def test_acesso_negado_nao_se_confunde_com_leitura(self):
        # Quem pergunta "quem consultou os dados desta pessoa" filtra por READ,
        # e a tentativa recusada não pode aparecer nessa resposta.
        self.como(self.recepcionista).get(f'/api/citizens/{self.cidadao.id}')  # 403
        self.assertFalse(
            RegistroDeAuditoria.objects.filter(acao='READ', entidade='citizens').exists()
        )


class AuditoriaComCorpoGrande(CenarioBase):
    """
    A trilha só lê o corpo de requisições JSON.

    Ler `request.body` de um upload carrega o arquivo inteiro na memória e
    esbarra em DATA_UPLOAD_MAX_MEMORY_SIZE (2,5 MB): qualquer anexo maior que
    isso era recusado com 400 pela própria auditoria, antes de chegar à view.
    Uma foto de celular ou um PDF digitalizado passam disso com folga.

    (O limite continua valendo para o JSON da API, onde o DRF lê o corpo
    inteiro: é a proteção de memória do Django, e relato de 3 MB não é uso.)
    """

    def setUp(self):
        import shutil
        import tempfile

        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)

    def _enviar_pdf(self, megabytes):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from django.test import override_settings

        conteudo = b'%PDF-1.4\n' + b'0' * (megabytes * 1024 * 1024) + b'\n%%EOF\n'
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            return self.como(self.tecnico).post(
                f'/api/citizens/{self.cidadao.id}/anexos',
                {'file': SimpleUploadedFile('d.pdf', conteudo, content_type='application/pdf'),
                 'tipo_documento': 'laudo'},
            )

    def test_anexo_acima_de_2_5_mb_e_aceito(self):
        resposta = self._enviar_pdf(4)
        self.assertEqual(resposta.status_code, 201, resposta.content[:300])

    def test_anexo_grande_e_auditado_sem_gravar_o_conteudo(self):
        self._enviar_pdf(4)
        registro = RegistroDeAuditoria.objects.filter(acao='CREATE', entidade='citizens').first()
        self.assertIsNotNone(registro)
        self.assertEqual(registro.operador_id, self.tecnico.id)
        self.assertIsNone(registro.dados_depois)

    def test_anexo_pequeno_continua_funcionando(self):
        self.assertEqual(self._enviar_pdf(0).status_code, 201)

    def test_json_pequeno_continua_auditado_com_redacao(self):
        self.como(self.recepcionista).post(
            '/api/citizens/novo',
            {'nome': 'Pessoa Auditada', 'email': 'auditada@teste.local', 'cpf': '529.982.247-25',
             'criar_acesso_tefe_cidadao': False},
            content_type='application/json',
        )
        registro = RegistroDeAuditoria.objects.filter(acao='CREATE', entidade='citizens').first()
        self.assertEqual(registro.dados_depois['cpf'], '***.***.***-25')
