"""
Eliminação de dados pessoais (LGPD, Art. 18, VI).

A eliminação apagava 10 campos do cadastro e deixava de pé outros 24: data de
nascimento, raça, deficiência, a composição da família (com CPF de cada
membro), os JSON de documentos e situação socioeconômica e os arquivos
escaneados em disco. A eliminação constava como feita sem estar.

Decisão da direção sobre os textos livres dos atendimentos (relato do caso,
motivo da recepção, observações de encaminhamento): ficam, sem vínculo com a
pessoa. O histórico de atendimento é prestação de contas; o que identifica a
pessoa — o cadastro, os documentos e o nome copiado nos benefícios — é apagado.
"""
import base64
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone as fuso
from io import StringIO
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from apps.atendimentos.models import (
    AtendimentoDeRecepcao, BeneficioEventual, Caso, Encaminhamento,
)
from apps.auditoria.models import RegistroDeAuditoria
from apps.cidadaos import anexos
from apps.cidadaos.eliminacao import restos_de_dados
from apps.cidadaos.models import Cidadao
from testes.base import CenarioBase

PDF = b'%PDF-1.4\n1 0 obj\n<< >>\nendobj\ntrailer\n<< >>\n%%EOF\n'
CHAVE = base64.b64encode(b'0' * 32).decode()
RELATO = 'Relato do atendimento: família sem renda, visita agendada.'


def _cadastro_completo(cenario, pasta, **extra) -> Cidadao:
    """Um cidadão com TUDO preenchido, inclusive dois arquivos reais em disco."""
    agora = timezone.now()
    # CPF e e-mail são únicos (índice da cifragem): um segundo cadastro precisa dos seus.
    unicos = {'cpf': '111.444.777-35', 'email': 'maria.titular@exemplo.local'}
    unicos.update({campo: extra.pop(campo) for campo in tuple(unicos) if campo in extra})
    titular = Cidadao(
        id=str(uuid.uuid4()), nome='Maria Titular da Silva', nis='12345678901',
        rg='1234567 SSP/AM', telefone='(97) 99999-0000', **unicos,
        endereco='Rua das Flores, 100',
        nascimento=datetime(1985, 3, 14, tzinfo=fuso.utc), sexo='FEMININO', naturalidade='Tefé',
        escolaridade='MEDIO_COMPLETO', identidade_de_genero='MULHER_CIS', raca='PARDA',
        tem_deficiencia=True, estado_civil='CASADA', bairro='Centro', cidade='Tefé', uf='AM',
        cep='69470-000', observacoes='Relata violência doméstica; evitar contato com o companheiro.',
        documentos={'rg_orgao': 'SSP/AM', 'titulo_eleitor': '123456789012'},
        endereco_detalhado={'logradouro': 'Rua das Flores', 'numero': '100'},
        socioeconomico={'renda_total': 400, 'recebe_beneficio': True},
        ingresso={'forma': 'DEMANDA_ESPONTANEA'},
        membros_da_familia=[{'nome_membro': 'João Titular', 'cpf_membro': '222.555.888-46', 'parentesco': 'FILHO'}],
        termo_de_responsabilidade={'assinado_por': 'Maria Titular da Silva'},
        imagem_responsavel='Maria Titular da Silva', situacao_beneficiario='BENEFICIARIA',
        id_local=f'cadastro-offline-{uuid.uuid4().hex[:8]}', familia_id='familia-9', autoriza_imagem=True,
        imagem_aceita_em=agora, consentiu_tefe_cidadao_em=agora,
        criado_em=agora, atualizado_em=agora, **extra,
    )
    titular.save(force_insert=True)

    with override_settings(ARMAZENAMENTO_LOCAL=pasta):
        registros = [
            anexos.guardar(titular.id, SimpleUploadedFile('rg.pdf', PDF, content_type='application/pdf'), 'rg_frente'),
            anexos.guardar(titular.id, SimpleUploadedFile('cpf.pdf', PDF, content_type='application/pdf'), 'cpf'),
        ]
    titular.anexos = registros
    titular.save(update_fields=['anexos'])
    return titular


def _registros_ligados(cenario, titular):
    agora = timezone.now()
    caso = Caso.objects.create(
        id=str(uuid.uuid4()), protocolo='PROT-1', cidadao=titular, unidade=cenario.sul,
        descricao=RELATO, aberto_em=agora, criado_em=agora, atualizado_em=agora,
    )
    recepcao = AtendimentoDeRecepcao.objects.create(
        id=str(uuid.uuid4()), cidadao=titular, unidade=cenario.sul, atendido_por=cenario.recepcionista,
        demanda='Alimentação e nutrição', desfecho='FINALIZADO', motivo='Já retirou cesta este mês.',
    )
    encaminhamento = Encaminhamento.objects.create(
        id=str(uuid.uuid4()), caso=caso, encaminhado_por=cenario.coordenador, destino_externo='Conselho Tutelar',
        motivo='Suspeita de violação de direitos', observacoes='Família resiste a contato.',
        criado_em=agora, atualizado_em=agora,
    )
    beneficio = BeneficioEventual.objects.create(
        id=str(uuid.uuid4()), cidadao=titular, nome_da_pessoa='Maria Titular da Silva',
        tipo='OUTROS', tipo_outro='Passagem para tratamento', descricao='Cesta básica e passagem.',
        registrado_por=cenario.coordenador, unidade=cenario.sul, criado_em=agora, atualizado_em=agora,
    )
    return caso, recepcao, encaminhamento, beneficio


class _Cenario(CenarioBase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)
        self.titular = _cadastro_completo(self, self.pasta)
        self.caso, self.recepcao, self.encaminhamento, self.beneficio = _registros_ligados(self, self.titular)

    def eliminar(self, operador=None, titular=None):
        titular = titular or self.titular
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            with self.captureOnCommitCallbacks(execute=True):
                return self.como(operador or self.admin).delete(f'/api/citizens/{titular.id}/dados-pessoais')

    def arquivos_no_disco(self):
        return [f for _, _, nomes in os.walk(self.pasta) for f in nomes]


class AntesDaEliminacao(_Cenario):
    def test_o_cenario_de_teste_tem_tudo_preenchido(self):
        # Sem isto, os testes abaixo poderiam passar por não haver o que apagar.
        restos = restos_de_dados(self.titular)
        self.assertGreaterEqual(len(restos), 24, restos)
        self.assertEqual(len(self.arquivos_no_disco()), 2)


class EliminacaoDoCadastro(_Cenario):
    def test_nenhum_dado_pessoal_sobra_no_cadastro(self):
        resposta = self.eliminar()
        self.assertEqual(resposta.status_code, 200, resposta.content)

        titular = Cidadao.objects.get(pk=self.titular.pk)
        self.assertEqual(restos_de_dados(titular), [])

    def test_o_registro_fica_inacessivel_e_com_nome_anonimo(self):
        self.eliminar()
        titular = Cidadao.objects.get(pk=self.titular.pk)

        self.assertIsNotNone(titular.excluido_em)
        self.assertFalse(titular.ativo)
        self.assertEqual(titular.nome, f'Cidadão excluído {titular.id[:8]}')
        self.assertFalse(Cidadao.vigentes.filter(pk=titular.pk).exists())
        self.assertEqual(self.como(self.coordenador).get(f'/api/citizens/{titular.id}').status_code, 404)

    def test_o_nome_antigo_nao_aparece_em_lugar_nenhum_do_cadastro(self):
        self.eliminar()
        titular = Cidadao.objects.get(pk=self.titular.pk)
        texto = str({campo.name: getattr(titular, campo.name) for campo in Cidadao._meta.concrete_fields})
        for pessoal in ('Maria', 'Titular', '111.444', '12345678901', 'maria.titular', 'Flores', 'João', '222.555'):
            self.assertNotIn(pessoal, texto)

    def test_o_mesmo_cpf_pode_ser_cadastrado_de_novo(self):
        # Os índices de busca são únicos; se sobrassem, a pessoa não poderia
        # voltar ao sistema depois de exercer o direito de ser esquecida.
        self.eliminar()
        agora = timezone.now()
        Cidadao.objects.create(
            id=str(uuid.uuid4()), nome='Maria Recadastrada', cpf='111.444.777-35',
            email='maria.titular@exemplo.local', criado_em=agora, atualizado_em=agora,
        )

    def test_a_segunda_eliminacao_e_404(self):
        self.eliminar()
        self.assertEqual(self.eliminar().status_code, 404)

    @override_settings(PII_ENCRYPTION_ENABLED=True, PII_ENCRYPTION_KEY=CHAVE, PII_HMAC_KEY=CHAVE)
    def test_funciona_com_a_cifragem_ligada(self):
        cifrado = _cadastro_completo(self, self.pasta)
        self.assertIsNotNone(Cidadao.objects.get(pk=cifrado.pk).cpf_indice)

        self.assertEqual(self.eliminar(titular=cifrado).status_code, 200)

        apagado = Cidadao.objects.get(pk=cifrado.pk)
        self.assertEqual(restos_de_dados(apagado), [])
        self.assertIsNone(apagado.cpf_indice)


class EliminacaoDosArquivos(_Cenario):
    def test_os_documentos_escaneados_saem_do_disco(self):
        self.assertEqual(len(self.arquivos_no_disco()), 2)
        self.eliminar()
        self.assertEqual(self.arquivos_no_disco(), [])

    def test_a_pasta_do_cidadao_tambem_some_com_arquivo_orfao_dentro(self):
        # Arquivo que ficou no disco sem metadado (upload interrompido) também é dado.
        pasta_do_titular = os.path.join(self.pasta, 'cidadaos', self.titular.id)
        with open(os.path.join(pasta_do_titular, 'orfao.jpg'), 'wb') as arquivo:
            arquivo.write(b'x')
        self.eliminar()
        self.assertFalse(os.path.exists(pasta_do_titular))

    def test_nao_toca_nos_arquivos_de_outro_cidadao(self):
        outro = _cadastro_completo(self, self.pasta, cpf='222.555.888-46', email='outro@exemplo.local')
        self.eliminar()
        pasta_do_outro = os.path.join(self.pasta, 'cidadaos', outro.id)
        self.assertEqual(len(os.listdir(pasta_do_outro)), 2)

    def test_os_arquivos_so_saem_depois_de_a_transacao_gravar(self):
        # Se a gravação falhasse depois de apagar os arquivos, ficaria o metadado
        # apontando para o vazio e nenhum dos dois recuperável.
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            with self.captureOnCommitCallbacks(execute=False) as pendentes:
                self.como(self.admin).delete(f'/api/citizens/{self.titular.id}/dados-pessoais')
        self.assertEqual(len(self.arquivos_no_disco()), 2, 'apagou antes do commit')
        self.assertGreaterEqual(len(pendentes), 1)

    def test_falha_ao_apagar_arquivos_nao_desfaz_a_eliminacao_e_vai_ao_log(self):
        with mock.patch('apps.cidadaos.anexos.shutil.rmtree', side_effect=OSError('sem permissão')):
            with self.assertLogs('apps.cidadaos.anexos', level='ERROR'):
                resposta = self.eliminar()
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(restos_de_dados(Cidadao.objects.get(pk=self.titular.pk)), [])


class RegistrosLigados(_Cenario):
    def test_o_nome_copiado_nos_beneficios_e_anonimizado(self):
        self.eliminar()
        self.beneficio.refresh_from_db()
        self.assertEqual(self.beneficio.nome_da_pessoa, f'Cidadão excluído {self.titular.id[:8]}')

    def test_os_relatos_dos_atendimentos_ficam_como_a_direcao_decidiu(self):
        self.eliminar()
        self.caso.refresh_from_db()
        self.recepcao.refresh_from_db()
        self.encaminhamento.refresh_from_db()
        self.beneficio.refresh_from_db()

        self.assertEqual(self.caso.descricao, RELATO)
        self.assertEqual(self.recepcao.motivo, 'Já retirou cesta este mês.')
        self.assertEqual(self.encaminhamento.motivo, 'Suspeita de violação de direitos')
        self.assertEqual(self.encaminhamento.observacoes, 'Família resiste a contato.')
        self.assertEqual(self.beneficio.descricao, 'Cesta básica e passagem.')
        self.assertEqual(self.beneficio.tipo_outro, 'Passagem para tratamento')

    def test_os_registros_continuam_ligados_a_um_cidadao_anonimo(self):
        self.eliminar()
        casos = self.como(self.admin).get(f'/api/cases/?cidadao={self.titular.id}').json()
        self.assertEqual(len(casos), 1)
        self.assertEqual(casos[0]['cidadao_nome'], f'Cidadão excluído {self.titular.id[:8]}')

    def test_nao_mexe_nos_registros_de_outras_pessoas(self):
        agora = timezone.now()
        alheio = BeneficioEventual.objects.create(
            id=str(uuid.uuid4()), cidadao=self.cidadao, nome_da_pessoa='Antonia Ribeiro', tipo='OUTROS',
            registrado_por=self.coordenador, unidade=self.sul, criado_em=agora, atualizado_em=agora,
        )
        self.eliminar()
        alheio.refresh_from_db()
        self.assertEqual(alheio.nome_da_pessoa, 'Antonia Ribeiro')
        self.assertEqual(Cidadao.objects.get(pk=self.cidadao.pk).nome, 'Antonia Ribeiro')

    def test_o_historico_de_consentimento_e_preservado(self):
        # Art. 8, §6: o controlador precisa poder demonstrar que o consentimento
        # foi dado. Sem identidade, a data é inofensiva e continua sendo a prova.
        antes = Cidadao.objects.get(pk=self.titular.pk)
        self.eliminar()
        depois = Cidadao.objects.get(pk=self.titular.pk)
        self.assertEqual(depois.imagem_aceita_em, antes.imagem_aceita_em)
        self.assertEqual(depois.consentiu_tefe_cidadao_em, antes.consentiu_tefe_cidadao_em)


class PermissaoEAuditoria(_Cenario):
    def test_so_o_admin_elimina(self):
        # Eliminar é irreversível e apaga também os documentos do disco: fica com
        # quem responde pelo sistema, não com a coordenação de uma unidade.
        for operador in (self.coordenador, self.recepcionista, self.tecnico, self.visualizador, self.sem_unidade):
            resposta = self.eliminar(operador)
            self.assertEqual(resposta.status_code, 403, operador.papel)
        titular = Cidadao.objects.get(pk=self.titular.pk)
        self.assertIsNone(titular.excluido_em)
        self.assertEqual(len(self.arquivos_no_disco()), 2, 'os documentos não podem sair do disco')

    def test_o_admin_elimina(self):
        self.assertEqual(self.eliminar(self.admin).status_code, 200)

    def test_a_eliminacao_fica_na_trilha_sem_dado_pessoal(self):
        self.eliminar()
        registro = RegistroDeAuditoria.objects.get(acao='ERASURE', entidade_id=self.titular.id)
        self.assertEqual(registro.operador_id, self.admin.id)
        texto = f'{registro.dados_antes} {registro.dados_depois}'
        for pessoal in ('Maria', '111.444', '12345678901', 'maria.titular'):
            self.assertNotIn(pessoal, texto)
        self.assertEqual(registro.dados_depois['anexos_removidos'], 2)


class CompletarEliminacoesAntigas(_Cenario):
    """
    Quem pediu a eliminação na versão anterior teve só parte dos dados apagada e
    o registro marcado como eliminado. O comando termina o serviço.
    """

    def _eliminacao_parcial_da_versao_antiga(self):
        agora = timezone.now()
        Cidadao.objects.filter(pk=self.titular.pk).update(
            cpf=None, cpf_indice=None, nis=None, nis_indice=None, email=None, email_indice=None,
            rg=None, telefone=None, endereco=None,
            nome=f'Cidadão excluído {self.titular.id[:8]}', excluido_em=agora,
        )

    def rodar(self, *argumentos):
        saida = StringIO()
        with override_settings(ARMAZENAMENTO_LOCAL=self.pasta):
            with self.captureOnCommitCallbacks(execute=True):
                call_command('completar_eliminacao_lgpd', *argumentos, stdout=saida)
        return saida.getvalue()

    def test_o_estado_antigo_realmente_deixa_dados(self):
        self._eliminacao_parcial_da_versao_antiga()
        restos = restos_de_dados(Cidadao.objects.get(pk=self.titular.pk))
        self.assertIn('membros_da_familia', restos)
        self.assertIn('nascimento', restos)

    def test_completa_o_que_a_versao_antiga_deixou(self):
        self._eliminacao_parcial_da_versao_antiga()
        saida = self.rodar()

        self.assertEqual(restos_de_dados(Cidadao.objects.get(pk=self.titular.pk)), [])
        self.assertEqual(self.arquivos_no_disco(), [])
        self.beneficio.refresh_from_db()
        self.assertEqual(self.beneficio.nome_da_pessoa, f'Cidadão excluído {self.titular.id[:8]}')
        self.assertIn('1', saida)

    def test_simular_nao_altera_nada(self):
        self._eliminacao_parcial_da_versao_antiga()
        saida = self.rodar('--simular')

        self.assertIn('simulação', saida)
        self.assertIn('membros_da_familia', str(restos_de_dados(Cidadao.objects.get(pk=self.titular.pk))))
        self.assertEqual(len(self.arquivos_no_disco()), 2)

    def test_so_toca_em_quem_foi_eliminado_pelo_sistema(self):
        # Um registro "excluído" por outro motivo (duplicado, por exemplo) não é
        # eliminação LGPD e não pode ser apagado às cegas.
        outro = _cadastro_completo(
            self, self.pasta, excluido_em=timezone.now(), cpf='222.555.888-46', email='outro@exemplo.local',
        )
        self._eliminacao_parcial_da_versao_antiga()
        self.rodar()

        outro = Cidadao.objects.get(pk=outro.pk)
        self.assertEqual(outro.nome, 'Maria Titular da Silva')
        self.assertTrue(restos_de_dados(outro))
        self.assertEqual(len(os.listdir(os.path.join(self.pasta, 'cidadaos', outro.id))), 2)

    def test_rodar_de_novo_nao_faz_nada(self):
        self._eliminacao_parcial_da_versao_antiga()
        self.rodar()
        self.assertIn('nada a fazer', self.rodar())
