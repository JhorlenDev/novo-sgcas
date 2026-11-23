"""
Confere, de fora, se o Tefé Cidadão (Keycloak) está configurado como o SGCAS exige.

Sem isto, o defeito só aparece no meio do login ("sso-segredo", "aguardando aprovação") e
quem o investiga não sabe qual das exigências falhou. Aqui cada uma é testada e o que falta
sai em português, com o caminho no console do Keycloak.

Só lê: não cria, não altera e não concede nada. Não imprime o segredo do client, o token
nem dados de pessoas: conta quantos administradores existem, e só diz quem são (usuário e
nome, nunca o e-mail) com `--mostrar-admins`.
"""
from __future__ import annotations

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.contas import keycloak
from apps.contas.papeis import PRECEDENCIA, Papel

TEMPO_LIMITE = 15

# O que a conta de serviço usa para conceder e retirar papéis (ver `keycloak.definir_papel`).
FUNCOES_DA_CONTA_DE_SERVICO = ('view-users', 'manage-users', 'view-clients')

SEGREDOS_DE_EXEMPLO = ('', 'SEGREDO_CLIENTE_AQUI')


def _json(resposta):
    try:
        return resposta.json()
    except ValueError:
        return None


def _casa(padrao: str, endereco: str) -> bool:
    """Um endereço autorizado no Keycloak: igual, ou com `*` no fim (prefixo)."""
    if padrao.endswith('*'):
        return endereco.startswith(padrao[:-1])
    return padrao == endereco


class Command(BaseCommand):
    help = 'Confere se o Tefé Cidadão (Keycloak) está configurado como o SGCAS exige.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--mostrar-admins', action='store_true',
            help='Lista quem tem o papel ADMIN (usuário e nome, sem e-mail), e não só quantos são.',
        )

    def handle(self, *args, **opcoes):
        self.falhas = 0
        self.avisos = 0
        self.mostrar_admins = opcoes.get('mostrar_admins', False)

        self.stdout.write(
            f'Tefé Cidadão: {settings.KEYCLOAK_URL} · realm "{settings.KEYCLOAK_REALM}" · '
            f'client "{settings.KEYCLOAK_CLIENT_ID}"\n'
        )
        try:
            self._conferir()
        except requests.RequestException as erro:
            self._falha(
                f'Não consegui alcançar o Tefé Cidadão ({type(erro).__name__}). Confira KEYCLOAK_URL, '
                'a internet do servidor e o certificado do SSO.'
            )

        self.stdout.write('')
        if self.falhas:
            raise CommandError(
                f'{self.falhas} item(ns) a corrigir no Keycloak ou no .env. Corrija e rode de novo.'
            )
        resumo = 'Tudo certo: o Keycloak está pronto para o login do SGCAS.'
        if self.avisos:
            resumo += f' ({self.avisos} aviso(s) acima, que não impedem o login.)'
        self.stdout.write(self.style.SUCCESS(resumo))

    # ─── saída ────────────────────────────────────────────────────

    def _ok(self, texto):
        self.stdout.write(self.style.SUCCESS(f'  ✔ {texto}'))

    def _falha(self, texto):
        self.falhas += 1
        self.stdout.write(self.style.ERROR(f'  ✘ {texto}'))

    def _aviso(self, texto):
        self.avisos += 1
        self.stdout.write(self.style.WARNING(f'  ! {texto}'))

    # ─── as conferências, na ordem em que uma depende da anterior ────

    def _conferir(self):
        if not self._realm():
            return
        self._chaves_publicas()
        self._pedido_de_entrada()

        token = self._segredo_e_conta_de_servico()
        if not token:
            return

        cabecalho = {'Authorization': f'Bearer {token}'}
        uuid = self._client_visivel(cabecalho)
        if not uuid:
            return

        self._configuracao_do_client(cabecalho, uuid)
        self._funcoes_da_conta_de_servico(cabecalho)
        papeis = self._papeis_do_client(cabecalho, uuid)
        if papeis is not None and Papel.ADMIN in papeis:
            self._quem_e_admin(cabecalho, uuid)

    def _realm(self) -> bool:
        base = keycloak._base_realm()
        resposta = requests.get(f'{base}/.well-known/openid-configuration', timeout=TEMPO_LIMITE)
        if resposta.status_code != 200:
            self._falha(
                f'O realm "{settings.KEYCLOAK_REALM}" não respondeu (HTTP {resposta.status_code}). '
                'Confira KEYCLOAK_URL e KEYCLOAK_REALM.'
            )
            return False

        emissor = (_json(resposta) or {}).get('issuer')
        if emissor != base:
            self._falha(
                f'O emissor dos tokens é "{emissor}", mas o SGCAS exige exatamente "{base}": o '
                'endereço público (hostname) do Keycloak precisa ser o de KEYCLOAK_URL, senão todo '
                'login volta com "sso-emissor".'
            )
        else:
            self._ok(f'O realm responde e o emissor dos tokens é o esperado ({emissor}).')
        return True

    def _chaves_publicas(self):
        resposta = requests.get(f'{keycloak._base_realm()}/protocol/openid-connect/certs', timeout=TEMPO_LIMITE)
        chaves = (_json(resposta) or {}).get('keys') if resposta.status_code == 200 else None
        if chaves:
            self._ok('As chaves públicas para conferir a assinatura dos tokens estão acessíveis.')
        else:
            self._falha(
                f'Não consegui ler as chaves públicas do realm (HTTP {resposta.status_code}). '
                'Sem elas o SGCAS não valida nenhum token.'
            )

    def _pedido_de_entrada(self):
        """O mesmo pedido que o navegador faz ao clicar em "Entrar", sem enviar senha."""
        resposta = requests.get(
            f'{keycloak._base_realm()}/protocol/openid-connect/auth',
            params={
                'response_type': 'code', 'client_id': settings.KEYCLOAK_CLIENT_ID,
                'redirect_uri': settings.KEYCLOAK_REDIRECT_URI, 'scope': 'openid profile email',
                'state': 'verificacao',
            },
            allow_redirects=False, timeout=TEMPO_LIMITE,
        )
        if resposta.status_code in (200, 302, 303):
            self._ok('O client existe e aceita o endereço de retorno do .env.')
        else:
            self._falha(
                f'O Tefé Cidadão recusou o pedido de entrada (HTTP {resposta.status_code}): o client '
                f'"{settings.KEYCLOAK_CLIENT_ID}" não existe, ou o endereço de retorno '
                f'{settings.KEYCLOAK_REDIRECT_URI} não está em Clients → {settings.KEYCLOAK_CLIENT_ID} '
                '→ Settings → Valid redirect URIs.'
            )

    def _segredo_e_conta_de_servico(self) -> str | None:
        if (settings.KEYCLOAK_CLIENT_SECRET or '') in SEGREDOS_DE_EXEMPLO:
            self._falha(
                'KEYCLOAK_CLIENT_SECRET no .env está vazio ou é o texto de exemplo. Copie o segredo '
                f'de Clients → {settings.KEYCLOAK_CLIENT_ID} → Credentials → Client secret '
                '(só para o .env: nunca para o GitHub nem para mensagens).'
            )
            return None

        resposta = requests.post(
            f'{keycloak._base_realm()}/protocol/openid-connect/token',
            data={
                'grant_type': 'client_credentials', 'client_id': settings.KEYCLOAK_CLIENT_ID,
                'client_secret': settings.KEYCLOAK_CLIENT_SECRET,
            },
            timeout=TEMPO_LIMITE,
        )
        if resposta.status_code == 200:
            self._ok('O segredo do client confere e a conta de serviço está ligada.')
            return (_json(resposta) or {}).get('access_token')

        descricao = str((_json(resposta) or {}).get('error_description', '')).lower()
        if 'service account' in descricao:
            self._falha(
                f'"Service accounts roles" está desligado no client. Ligue em Clients → '
                f'{settings.KEYCLOAK_CLIENT_ID} → Settings → Capability config.'
            )
        elif resposta.status_code == 401:
            self._falha(
                'O Keycloak recusou o segredo do client. Copie de novo o Client secret (aba Credentials) '
                'para KEYCLOAK_CLIENT_SECRET e confira KEYCLOAK_CLIENT_ID.'
            )
        else:
            self._falha(f'O Keycloak recusou o pedido de token da conta de serviço (HTTP {resposta.status_code}).')
        return None

    def _client_visivel(self, cabecalho) -> str | None:
        resposta = requests.get(
            f'{keycloak._base_admin()}/clients', headers=cabecalho,
            params={'clientId': settings.KEYCLOAK_CLIENT_ID}, timeout=TEMPO_LIMITE,
        )
        if resposta.status_code != 200:
            self._falha(
                f'A API de administração (/admin) recusou a conta de serviço (HTTP {resposta.status_code}): '
                'ou falta a função view-clients, ou o /admin do SSO está bloqueado para este servidor.'
            )
            return None
        clientes = _json(resposta) or []
        if not clientes:
            self._falha(
                'A lista de clients veio vazia: falta a função view-clients (realm-management) na conta '
                'de serviço — o Keycloak não nega, devolve vazio e o client parece inexistente.'
            )
            return None
        self._ok('A API de administração (/admin) responde e a conta de serviço enxerga o client.')
        return clientes[0]['id']

    def _configuracao_do_client(self, cabecalho, uuid):
        resposta = requests.get(f'{keycloak._base_admin()}/clients/{uuid}', headers=cabecalho, timeout=TEMPO_LIMITE)
        dados = _json(resposta) if resposta.status_code == 200 else None
        if not isinstance(dados, dict):
            self._aviso(f'Não consegui ler a configuração do client (HTTP {resposta.status_code}).')
            return

        if not dados.get('standardFlowEnabled'):
            self._falha('"Standard flow" está desligado no client: o login por código não funciona.')
        if dados.get('directAccessGrantsEnabled'):
            self._aviso(
                '"Direct access grants" está ligado: permite entrar com senha direto, fora do login do '
                'SGCAS. Desligue em Settings → Capability config.'
            )
        if dados.get('implicitFlowEnabled'):
            self._aviso('"Implicit flow" está ligado: o SGCAS não usa e é menos seguro. Desligue.')

        retornos = dados.get('redirectUris') or []
        if '*' in retornos:
            self._falha(
                'Valid redirect URIs tem só "*": o client aceita qualquer endereço de retorno e quem '
                'forjasse um link receberia o código de login. Troque pelos endereços do SGCAS.'
            )

        saida = f'{settings.FRONTEND_URL}/login'
        autorizados = (dados.get('attributes') or {}).get('post.logout.redirect.uris', '')
        padroes = [p for p in autorizados.split('##') if p]
        if '+' in padroes:
            padroes = [p for p in padroes if p != '+'] + list(retornos)
        if not any(_casa(p, saida) for p in padroes):
            self._aviso(
                f'O endereço de saída {saida} não está em Valid post logout redirect URIs: ao sair do '
                'SGCAS o Keycloak vai mostrar erro em vez de voltar à tela de entrada.'
            )

    def _funcoes_da_conta_de_servico(self, cabecalho):
        admin = keycloak._base_admin()
        usuario = f'service-account-{settings.KEYCLOAK_CLIENT_ID}'
        resposta = requests.get(
            f'{admin}/users', headers=cabecalho, params={'username': usuario, 'exact': 'true'},
            timeout=TEMPO_LIMITE,
        )
        if resposta.status_code != 200:
            self._falha(
                f'A conta de serviço não pode listar usuários (HTTP {resposta.status_code}): falta a '
                'função view-users (realm-management).'
            )
            return
        contas = _json(resposta) or []
        if not contas:
            self._falha(f'Não achei a conta de serviço "{usuario}": ligue "Service accounts roles" no client.')
            return

        resposta = requests.get(f'{admin}/users/{contas[0]["id"]}/role-mappings', headers=cabecalho, timeout=TEMPO_LIMITE)
        mapeamentos = (_json(resposta) or {}) if resposta.status_code == 200 else {}
        concedidas = {
            funcao.get('name')
            for funcao in ((mapeamentos.get('clientMappings') or {}).get('realm-management') or {}).get('mappings', [])
        }
        if 'realm-admin' in concedidas:
            self._ok('A conta de serviço tem realm-admin, que cobre as funções de administração.')
            return

        faltam = [funcao for funcao in FUNCOES_DA_CONTA_DE_SERVICO if funcao not in concedidas]
        if faltam:
            self._falha(
                f'Faltam funções do realm-management na conta de serviço: {", ".join(faltam)}. Em Clients → '
                f'{settings.KEYCLOAK_CLIENT_ID} → Service accounts roles → Assign role → filtrar por clients '
                '→ realm-management. Sem elas, aprovar ou desativar alguém na tela Usuários falha.'
            )
        else:
            self._ok('A conta de serviço tem view-users, manage-users e view-clients.')

    def _papeis_do_client(self, cabecalho, uuid) -> set[str] | None:
        resposta = requests.get(
            f'{keycloak._base_admin()}/clients/{uuid}/roles', headers=cabecalho,
            params={'max': 200}, timeout=TEMPO_LIMITE,
        )
        if resposta.status_code != 200:
            self._falha(f'Não consegui listar os papéis do client (HTTP {resposta.status_code}).')
            return None

        existentes = {papel.get('name') for papel in (_json(resposta) or [])}
        faltam = [papel for papel in PRECEDENCIA if papel not in existentes]
        if faltam:
            self._falha(
                f'Faltam papéis no client {settings.KEYCLOAK_CLIENT_ID}: {", ".join(faltam)}. Crie em '
                f'Clients → {settings.KEYCLOAK_CLIENT_ID} → Roles (papel DO CLIENT, não de "Realm roles"), '
                'com os nomes exatos.'
            )
        else:
            self._ok(f'Os {len(PRECEDENCIA)} papéis existem no client.')
        return existentes

    def _quem_e_admin(self, cabecalho, uuid):
        """
        Quantas pessoas conseguem entrar como ADMIN: com o papel dado direto ou por um grupo, e com
        a conta ativa no Keycloak (a desativada não entra). Sem nenhuma, o SGCAS abre sem ninguém
        para aprovar os acessos, e foi assim que o sistema já ficou trancado; por isso é falha, e
        o comando não diz "Tudo certo". Com uma só, basta ela perder o acesso para acontecer de novo.
        """
        papel = f'{keycloak._base_admin()}/clients/{uuid}/roles/{Papel.ADMIN}'
        resposta = requests.get(f'{papel}/users', headers=cabecalho, params={'max': 100}, timeout=TEMPO_LIMITE)
        if resposta.status_code != 200:
            self._aviso(f'Não consegui ver quem tem o papel ADMIN (HTTP {resposta.status_code}).')
            return
        contas = {conta.get('id'): conta for conta in _json(resposta) or [] if isinstance(conta, dict)}
        origem = {id_da_conta: 'papel direto' for id_da_conta in contas}

        # O endereço acima só lista quem recebeu o papel direto; quem o tem por um grupo vem dos grupos.
        grupos = requests.get(f'{papel}/groups', headers=cabecalho, params={'max': 100}, timeout=TEMPO_LIMITE)
        if grupos.status_code != 200:
            self._aviso(
                f'Não consegui ver os grupos com o papel ADMIN (HTTP {grupos.status_code}): '
                'quem recebe ADMIN por grupo não foi contado.'
            )
        else:
            for grupo in _json(grupos) or []:
                membros = requests.get(
                    f'{keycloak._base_admin()}/groups/{grupo.get("id")}/members',
                    headers=cabecalho, params={'max': 100}, timeout=TEMPO_LIMITE,
                )
                if membros.status_code != 200:
                    self._aviso(
                        f'Não consegui ver os membros do grupo "{grupo.get("name")}", que tem o papel ADMIN '
                        f'(HTTP {membros.status_code}): eles não foram contados.'
                    )
                    continue
                for conta in _json(membros) or []:
                    if isinstance(conta, dict):
                        contas.setdefault(conta.get('id'), conta)
                        origem.setdefault(conta.get('id'), f'grupo "{grupo.get("name")}"')

        ativas = sum(1 for conta in contas.values() if conta.get('enabled', True))
        desativadas = len(contas) - ativas
        nota = f' ({desativadas} com a conta desativada no Keycloak, que não entra)' if desativadas else ''
        como_dar = (
            f'Em Users → (a pessoa) → Role mapping → Assign role → filtrar por clients → '
            f'{settings.KEYCLOAK_CLIENT_ID} → ADMIN.'
        )
        if self.mostrar_admins:
            self._listar_admins(contas, origem)
        if ativas >= 2:
            self._ok(f'Há {ativas} pessoas com o papel ADMIN e a conta ativa{nota}.')
        elif ativas == 1:
            self._aviso(
                f'Só 1 pessoa tem o papel ADMIN e a conta ativa{nota}. Se ela perder o acesso (saída do '
                f'cargo, senha, conta bloqueada), ninguém mais aprova acessos. Dê ADMIN a mais alguém. {como_dar}'
            )
        else:
            self._falha(
                f'Ninguém consegue entrar como ADMIN{nota}: o SGCAS abriria sem ninguém para aprovar os '
                f'acessos. {como_dar}'
            )

    def _listar_admins(self, contas, origem):
        """Quem tem o papel ADMIN: usuário e nome, nunca o e-mail. Só com `--mostrar-admins`."""
        if not contas:
            return
        self.stdout.write('    Quem tem o papel ADMIN:')
        for id_da_conta, conta in sorted(contas.items(), key=lambda item: (item[1].get('username') or '').lower()):
            nome = ' '.join(filter(None, (conta.get('firstName'), conta.get('lastName'))))
            usuario = conta.get('username') or '(sem usuário)'
            detalhes = [origem.get(id_da_conta, '')]
            if not conta.get('enabled', True):
                detalhes.append('CONTA DESATIVADA, não entra')
            self.stdout.write(f'      · {usuario}{f" ({nome})" if nome else ""} — {", ".join(filter(None, detalhes))}')
