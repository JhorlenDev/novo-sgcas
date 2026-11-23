"""
Dados fictícios e uma sessão de administrador, para ver o sistema rodando na máquina.

Sem um Keycloak configurado para `localhost`, ninguém entra no SGCAS local, e as telas
internas não podem ser vistas. Este comando cria um operador ADMIN fictício, alguns
cidadãos fictícios, uma fila com uma pessoa já chamada, e imprime a chave de uma sessão
para colar no navegador.

Os dados passam pela própria API (cadastro, recepção, chamar o próximo), e não direto no
banco: assim nascem com as mesmas regras e a mesma cifragem de um cadastro real.

Só roda com DEBUG=True. Em produção ele criaria um administrador sem passar pelo Tefé
Cidadão, então recusa.
"""
import time
import uuid

from django.conf import settings
from django.contrib.sessions.backends.db import SessionStore
from django.core.management.base import BaseCommand, CommandError
from django.test import Client
from django.utils import timezone

from apps.atendimentos.models import SenhaDaFila
from apps.cidadaos.models import Cidadao
from apps.contas.autenticacao import CHAVE_LOGIN_EM, CHAVE_OPERADOR
from apps.contas.models import Operador
from apps.contas.papeis import Papel
from apps.institucional.models import Servico, Unidade

EMAIL_DO_OPERADOR = 'admin.demonstracao@example.com'

# (nome, sexo, nascimento, bairro, final do CPF fictício). Nomes e números inventados.
PESSOAS = [
    ('Maria das Graças Oliveira', 'F', '1979-03-14', 'Abial', '01'),
    ('José Raimundo Batista', 'M', '1962-11-02', 'Centro', '02'),
    ('Francisca Lima de Souza', 'F', '1991-07-25', 'São Francisco', '03'),
    ('Antônio Carlos Ferreira', 'M', '1985-01-30', 'Santa Rosa', '04'),
    ('Raimunda Nonata Pereira', 'F', '1948-09-08', 'Monte Castelo', '05'),
    ('Luana Cristina Mendes', 'F', '2001-05-19', 'Juruá', '06'),
    ('Pedro Henrique Cardoso', 'M', '1996-12-11', 'Aeroporto', '07'),
]
QUANTOS_VAO_PARA_A_FILA = 4


class Command(BaseCommand):
    help = 'Cria dados fictícios e uma sessão de administrador para ver o sistema local (só com DEBUG=True).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--so-sessao', action='store_true',
            help='Só cria o operador e uma sessão nova, sem cidadãos nem fila.',
        )

    def handle(self, *args, **opcoes):
        if not settings.DEBUG:
            raise CommandError(
                'Recusado: este comando só roda com DEBUG=True. Ele cria um administrador e uma '
                'sessão sem passar pelo Tefé Cidadão, o que em produção seria uma porta aberta.'
            )

        unidade = (
            Unidade.objects.filter(sigla='CRAS-C').first()
            or Unidade.objects.filter(tipo='CRAS').order_by('nome').first()
        )
        if unidade is None:
            raise CommandError('Não há unidade CRAS no banco. Rode antes: python manage.py cadastrar_servicos')

        operador = self._operador(unidade)
        chave = self._sessao(operador)

        if not opcoes['so_sessao']:
            self._popular(operador, unidade, chave)

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(f'Entre como "{operador.nome}" (ADMIN, {unidade.nome}):'))
        self.stdout.write('  1. Abra http://localhost:3000/login no navegador.')
        self.stdout.write('  2. Abra o console do navegador (F12, aba Console) e cole:')
        self.stdout.write(f'       document.cookie = "{settings.SESSION_COOKIE_NAME}={chave}; path=/"')
        self.stdout.write('  3. Abra http://localhost:3000/dashboard')
        self.stdout.write(f'A sessão vale {settings.SESSION_MAX_LIFETIME // 3600} horas. Rode o comando de novo para outra.')

    def _operador(self, unidade):
        agora = timezone.now()
        operador, criado = Operador.objects.get_or_create(
            email=EMAIL_DO_OPERADOR,
            defaults=dict(
                id=str(uuid.uuid4()), nome='Administrador de demonstração', papel=Papel.ADMIN,
                ativo=True, unidade=unidade, criado_em=agora, atualizado_em=agora,
            ),
        )
        self.stdout.write(f'operador {"criado" if criado else "já existia"}: {operador.nome}')
        return operador

    @staticmethod
    def _sessao(operador):
        sessao = SessionStore()
        sessao[CHAVE_OPERADOR] = operador.id
        sessao[CHAVE_LOGIN_EM] = time.time()
        sessao.create()
        return sessao.session_key

    def _popular(self, operador, unidade, chave):
        cliente = Client(HTTP_HOST='localhost')
        cliente.cookies[settings.SESSION_COOKIE_NAME] = chave

        servicos = list(Servico.objects.filter(unidade=unidade, ativo=True).order_by('nome'))
        if not servicos:
            raise CommandError(f'A unidade {unidade.nome} não tem serviços. Rode: python manage.py cadastrar_servicos')

        novos = []
        for nome, sexo, nascimento, bairro, final in PESSOAS:
            if Cidadao.vigentes.filter(nome=nome).exists():
                continue
            resposta = cliente.post('/api/citizens/novo', content_type='application/json', data={
                'nome': nome, 'cpf': f'000.000.0{final}-{final}', 'sexo': sexo,
                'email': f'demonstracao.{final}@example.com', 'telefone': f'(97) 90000-00{final}',
                'nascimento': f'{nascimento}T12:00:00Z', 'bairro': bairro, 'cidade': 'Tefé', 'uf': 'AM',
                'endereco': f'Rua Fictícia, {int(final)}',
                'criar_acesso_tefe_cidadao': False, 'consentimento': False,
            })
            self._conferir(resposta, f'cadastrar {nome}')
            novos.append(resposta.json())
        self.stdout.write(f'cidadãos fictícios criados: {len(novos)} (de {len(PESSOAS)})')

        # Só quem acabou de ser cadastrado entra na fila: rodar de novo não duplica senhas.
        for indice, cidadao in enumerate(novos):
            servico = servicos[indice % len(servicos)]
            na_fila = indice < QUANTOS_VAO_PARA_A_FILA
            resposta = cliente.post('/api/reception/atendimento', content_type='application/json', data={
                'cidadao_id': cidadao['id'], 'servico_id': servico.id,
                'desfecho': 'ENCAMINHADO' if na_fila else 'FINALIZADO',
                'motivo': None if na_fila else 'Orientação dada no balcão (dado de demonstração).',
                'observacao': 'Dado fictício, gerado para demonstração.',
            })
            self._conferir(resposta, f'recepção de {cidadao["nome"]}')

        aguardando = SenhaDaFila.objects.filter(unidade=unidade, situacao=SenhaDaFila.Situacao.AGUARDANDO).count()
        em_atendimento = SenhaDaFila.objects.filter(atendido_por=operador, situacao=SenhaDaFila.Situacao.EM_ATENDIMENTO)
        if aguardando and not em_atendimento.exists():
            self._conferir(cliente.post('/api/queues/chamar-proximo'), 'chamar o próximo')
        self.stdout.write(
            f'fila de {unidade.nome}: '
            f'{SenhaDaFila.objects.filter(unidade=unidade, situacao=SenhaDaFila.Situacao.AGUARDANDO).count()} '
            f'aguardando, {em_atendimento.count()} em atendimento com o operador de demonstração'
        )

    @staticmethod
    def _conferir(resposta, o_que):
        if resposta.status_code >= 400:
            raise CommandError(f'Falhou ao {o_que}: HTTP {resposta.status_code} {resposta.content[:300]!r}')
