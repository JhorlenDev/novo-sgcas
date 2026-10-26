"""
Cadastra as unidades e os serviços que elas ofertam.

Idempotente: rodar de novo atualiza o que mudou e não duplica nada. Serve tanto
para montar um ambiente do zero quanto para incorporar um serviço novo depois.

A fonte é a relação de serviços entregue pela Secretaria. Os do CREAS seguem a
Tipificação Nacional dos Serviços Socioassistenciais — nomes padronizados, que
é o que permite o dado alimentar o RMA sem tradução manual.
"""
import uuid

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.institucional.models import Coordenacao, Demanda, Servico, Unidade

# (sigla da unidade, nome, tipo, [(serviço, descrição, categoria municipal)])
CATALOGO = [
    # ── CRAS ──────────────────────────────────────────────────────────
    (
        'CRAS-C', 'CRAS Centro', 'CRAS',
        [
            ('PAEFI — Proteção e Atendimento Especializado a Famílias e Indivíduos',
             'Serviço tipificado da proteção social especial de média complexidade.',
             'Violação de Direitos'),
            ('Serviço Especializado em Abordagem Social',
             'Busca ativa em espaços públicos e acolhimento.', 'Situação de Rua'),
            ('Serviço de Proteção Social a Adolescentes em Medida Socioeducativa',
             'Liberdade assistida (LA) e prestação de serviço à comunidade (PSC).',
             'Violação de Direitos'),
            ('Serviço Especializado para Pessoas em Situação de Rua',
             'Atendimento à população em situação de rua.', 'Situação de Rua'),
            ('Visita domiciliar', 'Visita técnica ao domicílio.', 'Acompanhamento Familiar'),
            ('Estudo psicossocial e laudos técnicos',
             'Elaboração de estudo psicossocial e documentos técnicos.', 'Violação de Direitos'),
        ],
    ),
    (
        'CRAS-N', 'CRAS Norte', 'CRAS',
        [
            ('PAEFI — Proteção e Atendimento Especializado a Famílias e Indivíduos',
             'Serviço tipificado da proteção social especial de média complexidade.',
             'Violação de Direitos'),
            ('Serviço Especializado em Abordagem Social',
             'Busca ativa em espaços públicos e acolhimento.', 'Situação de Rua'),
            ('Serviço de Proteção Social a Adolescentes em Medida Socioeducativa',
             'Liberdade assistida (LA) e prestação de serviço à comunidade (PSC).',
             'Violação de Direitos'),
            ('Serviço Especializado para Pessoas em Situação de Rua',
             'Atendimento à população em situação de rua.', 'Situação de Rua'),
            ('Visita domiciliar', 'Visita técnica ao domicílio.', 'Acompanhamento Familiar'),
            ('Estudo psicossocial e laudos técnicos',
             'Elaboração de estudo psicossocial e documentos técnicos.', 'Violação de Direitos'),
        ],
    ),
    (
        'CRAS-S', 'CRAS Sul', 'CRAS',
        [
            ('PAEFI — Proteção e Atendimento Especializado a Famílias e Indivíduos',
             'Serviço tipificado da proteção social especial de média complexidade.',
             'Violação de Direitos'),
            ('Serviço Especializado em Abordagem Social',
             'Busca ativa em espaços públicos e acolhimento.', 'Situação de Rua'),
            ('Serviço de Proteção Social a Adolescentes em Medida Socioeducativa',
             'Liberdade assistida (LA) e prestação de serviço à comunidade (PSC).',
             'Violação de Direitos'),
            ('Serviço Especializado para Pessoas em Situação de Rua',
             'Atendimento à população em situação de rua.', 'Situação de Rua'),
            ('Visita domiciliar', 'Visita técnica ao domicílio.', 'Acompanhamento Familiar'),
            ('Estudo psicossocial e laudos técnicos',
             'Elaboração de estudo psicossocial e documentos técnicos.', 'Violação de Direitos'),
        ],
    ),
    # ── CREAS ─────────────────────────────────────────────────────────
    (
        'CREAS-001', 'CREAS', 'CREAS',
        [
            ('PAEFI — Proteção e Atendimento Especializado a Famílias e Indivíduos',
             'Serviço tipificado da proteção social especial de média complexidade.',
             'Violação de Direitos'),
            ('Serviço Especializado em Abordagem Social',
             'Busca ativa em espaços públicos.', 'Situação de Rua'),
            ('Serviço de Proteção Social a Adolescentes em Medida Socioeducativa',
             'Liberdade assistida (LA) e prestação de serviço à comunidade (PSC).',
             'Violação de Direitos'),
            ('Serviço de Proteção Social Especial para Pessoas com Deficiência, Idosas e suas Famílias',
             'Atendimento especializado a pessoas com deficiência e idosas.', 'Acompanhamento Familiar'),
            ('Serviço Especializado para Pessoas em Situação de Rua',
             'Atendimento à população em situação de rua.', 'Situação de Rua'),
            ('Visita domiciliar', 'Visita técnica ao domicílio.', 'Acompanhamento Familiar'),
            ('Atendimento psicossocial em domicílio',
             'Atendimento psicossocial realizado no domicílio.', 'Acompanhamento Familiar'),
            ('Estudo psicossocial e laudos técnicos',
             'Elaboração de estudo psicossocial e documentos técnicos.', 'Violação de Direitos'),
        ],
    ),
    # ── ABRIGO ────────────────────────────────────────────────────────
    (
        'RESINC-001', 'Residência Inclusiva', 'ABRIGO',
        [
            ('Serviço de acolhimento institucional',
             'Moradia protegida, atendimento contínuo e proteção social.', 'Acompanhamento Familiar'),
            ('Cuidados pessoais e atividades de vida diária',
             'Higiene, banho, alimentação, mobilidade e estímulo à autonomia.', None),
            ('Alimentação e nutrição',
             'Alimentação diária, refeições adequadas e apoio durante as refeições.', 'Benefício Eventual'),
            ('Acompanhamento da saúde',
             'Consultas, exames, medicação e articulação com a rede de saúde.', None),
            ('Acompanhamento psicológico e psicossocial',
             'Escuta, acompanhamento emocional e mediação de conflitos.', 'Acompanhamento Familiar'),
            ('Acompanhamento social',
             'Atendimento social, acesso a direitos e articulação com a rede.', 'Acompanhamento Familiar'),
            ('Desenvolvimento da autonomia e independência',
             'Autocuidado, habilidades de vida diária e tomada de decisão.', None),
            ('Atividades socioeducativas, recreativas e de lazer',
             'Oficinas, atividades culturais, passeios e convivência.', None),
            ('Inclusão e participação comunitária',
             'Participação na comunidade e combate ao isolamento.', None),
            ('Apoio e acompanhamento técnico',
             'Equipe multiprofissional e planejamento individualizado.', None),
            ('Articulação intersetorial',
             'Articulação com saúde, ensino e órgãos de garantia de direitos.', None),
            ('Promoção da dignidade e dos direitos da pessoa com deficiência',
             'Defesa de direitos, protagonismo e combate ao preconceito.', 'Violação de Direitos'),
        ],
    ),
    (
        'ILPI-001', 'ILPI — Instituição de Longa Permanência para Idosos', 'ABRIGO',
        [
            ('Acolhimento institucional para pessoa idosa',
             'Moradia coletiva para pessoas de 60 anos ou mais em situação de '
             'abandono, violência ou sem condições de autossustento.', 'Acompanhamento Familiar'),
            ('Proteção integral',
             'Atendimento contínuo, dia e noite.', 'Acompanhamento Familiar'),
            ('Apoio multidisciplinar',
             'Cuidadores, técnicos de enfermagem, assistentes sociais e psicólogos.', None),
            ('Atividades diárias',
             'Lazer, convivência comunitária e autocuidado.', None),
            ('Alimentação e cuidados de saúde',
             'Alimentação e acompanhamento de saúde dos residentes.', 'Benefício Eventual'),
        ],
    ),
]


# A secretaria no topo da hierarquia. A sigla é a que o Tefé Cidadão recebe na
# auditoria do pré-cadastro (`SEMAS/CRAS Centro`); o nome por extenso é o padrão
# da sigla e pode ser ajustado depois na tela Institucional.
RAIZ_SIGLA = 'SEMAS'
RAIZ_NOME = 'Secretaria Municipal de Assistência Social'

# As categorias que o catálogo acima cita, na ordem em que aparecem.
CATEGORIAS = list(dict.fromkeys(
    categoria for *_, servicos in CATALOGO for _, _, categoria in servicos if categoria
))


class Command(BaseCommand):
    help = 'Cadastra unidades e os serviços que elas ofertam (idempotente).'

    def _garantir_raiz(self, agora):
        """
        A coordenação de topo, criada só em banco sem nenhuma coordenação.

        Num ambiente novo ela não existe, e as unidades nasceriam soltas — sem o
        prefixo `SEMAS/` que identifica a secretaria na auditoria. Se já há
        coordenações, a estrutura é de quem a cadastrou e não se mexe.
        """
        raiz = Coordenacao.objects.filter(superior__isnull=True).first()
        if raiz is not None or Coordenacao.objects.exists():
            return raiz, False
        raiz = Coordenacao.objects.create(
            id=str(uuid.uuid4()), nome=RAIZ_NOME, sigla=RAIZ_SIGLA,
            criada_em=agora, atualizada_em=agora,
        )
        return raiz, True

    def _garantir_demandas(self, agora):
        """
        As demandas que o catálogo cita, criando só as que faltam (pelo nome).

        Sem elas o serviço é cadastrado mesmo assim, mas sem categoria — e não
        entra na soma do relatório da rede. Uma demanda de mesmo nome que já
        exista é reaproveitada como está.
        """
        demandas = {d.nome: d for d in Demanda.objects.all()}
        criadas = 0
        for nome in CATEGORIAS:
            if nome not in demandas:
                demandas[nome] = Demanda.objects.create(
                    id=str(uuid.uuid4()), nome=nome, criada_em=agora, atualizada_em=agora,
                )
                criadas += 1
        return demandas, criadas

    @transaction.atomic
    def handle(self, *args, **opcoes):
        agora = timezone.now()
        raiz, raiz_criada = self._garantir_raiz(agora)
        demandas, demandas_criadas = self._garantir_demandas(agora)

        criadas = atualizadas = servicos_novos = sem_categoria = 0

        for sigla, nome, tipo, servicos in CATALOGO:
            unidade = Unidade.objects.filter(sigla=sigla).first()
            if unidade is None:
                unidade = Unidade.objects.create(
                    id=str(uuid.uuid4()), nome=nome, sigla=sigla, tipo=tipo,
                    coordenacao=raiz, criada_em=agora, atualizada_em=agora,
                )
                criadas += 1
                self.stdout.write(self.style.SUCCESS(f'  unidade criada: {nome}'))
            else:
                atualizadas += 1
                # Unidade criada por uma versão anterior deste comando, antes de
                # ele garantir a raiz: fica sem secretaria e sem o prefixo da
                # auditoria. Só preenche o vazio; nunca troca uma coordenação.
                if unidade.coordenacao_id is None and raiz is not None:
                    unidade.coordenacao = raiz
                    unidade.atualizada_em = agora
                    unidade.save(update_fields=['coordenacao', 'atualizada_em'])

            for nome_servico, descricao, categoria in servicos:
                demanda = demandas.get(categoria) if categoria else None
                if categoria and demanda is None:
                    self.stdout.write(self.style.WARNING(
                        f'  categoria "{categoria}" não existe no catálogo de demandas'
                    ))
                if demanda is None:
                    sem_categoria += 1

                # O id só existe na criação: em `defaults` ele trocaria a chave
                # primária de um serviço já cadastrado, e os casos que apontam
                # para ele ficariam soltos.
                dados = {'descricao': descricao, 'demanda': demanda, 'ativo': True}
                _, novo = Servico.objects.update_or_create(
                    unidade=unidade, nome=nome_servico,
                    defaults=dados, create_defaults={'id': str(uuid.uuid4()), **dados},
                )
                servicos_novos += int(novo)

        self.stdout.write('')
        if raiz_criada:
            self.stdout.write(self.style.SUCCESS(
                f'coordenação raiz criada: {RAIZ_SIGLA} — {RAIZ_NOME}'
            ))
        self.stdout.write(f'demandas criadas    : {demandas_criadas}')
        self.stdout.write(f'unidades criadas    : {criadas}')
        self.stdout.write(f'unidades existentes : {atualizadas}')
        self.stdout.write(f'serviços novos      : {servicos_novos}')
        self.stdout.write(f'total de serviços   : {Servico.objects.count()}')
        if sem_categoria:
            # Sem categoria o serviço funciona, mas não entra na soma da rede.
            self.stdout.write(self.style.WARNING(
                f'sem categoria municipal: {sem_categoria} — não somam no relatório da rede'
            ))
