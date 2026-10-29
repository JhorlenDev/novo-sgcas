<div align="center">

# Novo SGCAS

**Sistema de Gestão de Casos da Assistência Social de Tefé — AM**

Do acolhimento ao acompanhamento: cidadãos, recepção, atendimentos e prontuários em uma única plataforma.

![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react)
![Django](https://img.shields.io/badge/Django-5.2%20LTS-092E20?logo=django)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

[Começar](#como-rodar-localmente) · [Configuração](#variáveis-de-ambiente) · [Autenticação](#login-e-primeiro-acesso) · [Testes](#verificações-e-testes) · [Produção](#produção) · [Documentação](#documentação)

</div>

## Sobre o projeto

O SGCAS organiza o trabalho das unidades de assistência social de Tefé. Reúne cadastro de cidadãos, histórico de atendimentos, filas por prioridade, prontuários, concessão de benefícios e encaminhamentos, com acesso controlado por perfil e unidade.

Este repositório reúne o **frontend Next.js** e a **API Django**. O login é integrado ao **Tefé Cidadão/Keycloak**; o sistema não oferece cadastro de senha própria nem login demonstrativo.

## Funcionalidades

| Módulo | Recursos |
| --- | --- |
| Painel | Indicadores e detalhes da operação |
| Cidadãos | Busca, cadastro, prontuário, histórico, anexos e impressão |
| Recepção | Escolha do serviço, prioridade, atendimento no balcão e emissão de senha |
| Atendimento | Chamada da fila, retomada, evolução, conclusão e registro de ausência |
| Acompanhamentos | Consulta dos casos, situação e filtros por ação itinerante |
| Benefícios eventuais | Registro vinculado ao cidadão e ao atendimento, com aviso e justificativa quando repete o mesmo auxílio no mês |
| Encaminhamentos e avisos | Ficha de encaminhamento entre unidades, caixas de recebidos e enviados, resposta do destino e avisos entre as unidades |
| Ações itinerantes | Organização das ações, resumo, balanço e conclusão |
| Institucional | Coordenações, unidades, demandas e serviços |
| Administração | Operadores, perfis, unidades e pedidos de acesso |
| Proteção de dados | Auditoria, consentimento de imagem, exportação, eliminação de dados e cifragem opcional |

```mermaid
flowchart LR
    A[Buscar ou cadastrar cidadão] --> B[Recepção]
    B --> C[Finalizar no balcão]
    B --> D[Fila por prioridade]
    D --> E[Atendimento técnico]
    E --> F[Concluir]
    E --> G[Encaminhar]
    E --> H[Registrar ausência]
    F --> I[Histórico e acompanhamento]
    G --> I
    H --> I
```

As senhas usam os prefixos `UR` (urgente), `PR` (alta), `NR` (normal) e `BX` (baixa). Os casos passam por `EM_TRIAGEM`, `EM_ATENDIMENTO`, `CONCLUIDO`, `ENCAMINHADO` ou `CANCELADO`.

## Comunicação entre unidades

O que antes andava em papel, em horas ou dias, vai pelo sistema: a pessoa atendida no CRAS e encaminhada ao CREAS chega com a ficha, a unidade de origem sabe em que pé está o atendimento e o mesmo auxílio deixa de ser concedido em várias unidades sem que ninguém saiba.

### Encaminhamento com ficha

Quem encaminha (`Encaminhar`, na tela de Atendimento, ou `Registrar`, no prontuário) preenche a **categoria do motivo**, a **urgência**, o **motivo** e o **resumo da situação** (obrigatórios), e, se quiser, documentos entregues, contato para retorno, prazo e observações. O destino é uma unidade da rede (o caso passa a ela, continua aberto) ou um serviço externo (o caso se encerra na origem e a origem registra o retorno depois).

Segue junto, sem digitar de novo, uma fotografia do que a origem sabia: o serviço, o que a pessoa solicitou na recepção, os benefícios que já recebeu da unidade e o relato até ali.

```mermaid
flowchart LR
    A[Origem encaminha com a ficha] --> B[PENDENTE: destino é avisado]
    B --> C[Aceito]
    B --> D[Recusado: o caso volta à origem]
    B --> E[Chegada na recepção do destino]
    C --> E
    E --> F[Mesmo caso, na fila do destino, com a urgência da origem]
    F --> G[Destino conclui o caso: a origem é avisada]
```

- **Chegada.** A recepção do destino mostra o encaminhamento pendente da pessoa e, ao iniciar o atendimento, vincula a visita a ele. O caso é o mesmo (não nasce um segundo), a senha entra na fila na urgência definida pela origem e a origem recebe o aviso. O técnico que chama a pessoa lê a ficha na própria conferência do atendimento.
- **Resposta.** O destino aceita ou recusa (a recusa exige o motivo e devolve o caso à origem). Concluir o caso no destino conclui o encaminhamento; "não compareceu" também.
- **Avisos.** Cada passo gera um aviso para a unidade interessada: encaminhamento recebido, aceito, recusado, pessoa chegou, atendimento concluído, pessoa não compareceu, encaminhado adiante e benefício repetido. O texto é montado na hora, com o nome do cadastro; após a eliminação LGPD o aviso mostra "Cidadão excluído". O menu **Encaminhamentos** mostra a soma do que aguarda resposta e do que não foi lido (atualiza a cada minuto).

### O que cada perfil vê

| | Equipe técnica (administrador, coordenador, assistente social, técnico, gestor de ações itinerantes) | Recepção | Visualizador |
| --- | --- | --- | --- |
| De onde, para onde, quando, categoria, urgência, prazo | Sim | Sim | Não |
| Motivo, resumo, documentos, contato, observações, resposta e a ficha | Sim | **Não** | Não |
| Quem encaminhou | Sim | Não (só a unidade) | Não |
| Aceitar, recusar e registrar retorno | Sim | Não | Não |

A regra vale na API (os campos nem são enviados à recepção) e na tela. O texto do motivo, e o da recusa, **não são gravados no relato do caso**, que a recepção também lê; o relato registra só para onde, a categoria e a urgência.

> **Limite conhecido.** A recepção continua lendo o relato dos casos (as observações que os técnicos escrevem) pelo histórico municipal e por `/api/cases/`. Isso já era assim antes dos encaminhamentos e é uma decisão de privacidade que cabe à direção: se o relato puder conter violência ou saúde, vale restringi-lo também.

### Mesmo auxílio em várias unidades

Ao registrar um benefício, ou ao encaminhar à fila um pedido de serviço da demanda **Benefício Eventual**, o sistema confere o **mês corrente** (no fuso do município), em todas as unidades. A exceção é o **auxílio de nascimento** (o auxílio maternidade, tipo "Situação de nascimento"), que vale **uma vez a cada 12 meses**: o benefício concedido em 27/10 deixa de contar em 27/10 do ano seguinte. O que é conferido:

- benefício do mesmo tipo já concedido (em "Outros", compara o que foi dado, sem diferença de caixa ou espaços);
- no balcão, também pedido do mesmo tipo já encaminhado à fila de alguma unidade.

Havendo repetição, a tela mostra **onde, quando e o quê** e só segue com uma **justificativa escrita** (mínimo de 10 caracteres). Não bloqueia: quem tem necessidade nova não fica travado por atendimento antigo. A justificativa fica no histórico municipal, as outras unidades recebem o aviso (sem o texto) e a auditoria não a guarda. Negar o pedido no balcão ("finalizado") nunca exige justificativa, e cumprir um encaminhamento não conta o atendimento que o originou como repetição. A pessoa é travada durante o registro, para dois balcões simultâneos não passarem juntos.

> **Configuração necessária.** O controle do balcão vale para os serviços ligados à categoria **Benefício Eventual**, na tela Institucional (**Novo serviço**, ou **Classificar** num serviço já cadastrado). Um serviço de auxílio que não esteja nessa categoria não é controlado no balcão; o registro de benefício no prontuário é sempre controlado. Nesses serviços, informe também o **tipo de auxílio** (por exemplo, "Situação de nascimento" para o auxílio maternidade): o nome do serviço é texto livre e não diz ao balcão que tipo é, e é o tipo que decide a janela (um ano no auxílio de nascimento, o mês nos demais). Sem o tipo, o balcão só considera o mês. O administrador classifica os serviços de qualquer unidade; o coordenador, os da sua.

### Rotas

| Rota | Uso |
| --- | --- |
| `GET /api/referrals/recebidos` · `enviados` | Caixas da unidade (`?situacao=abertos\|todos\|PENDENTE…`, `?cidadao=`) |
| `GET /api/referrals/<id>` | Encaminhamento (a ficha só para a equipe técnica) |
| `POST /api/referrals/<id>/aceitar` · `recusar` · `concluir` | Resposta do destino; retorno de um encaminhamento externo, pela origem |
| `GET /api/notices/` · `resumo` | Avisos da unidade e os números do menu |
| `POST /api/notices/lidos` · `<id>/lido` | Marcar como lido |
| `GET /api/citizens/<id>/duplicidade?servico_id=…\|tipo=…` | Aviso de repetição antes de enviar |
| `PATCH /api/institutional/services/<id>` | Categoria e tipo de auxílio de um serviço (administrador; coordenador, na sua unidade) |

## Arquitetura

```mermaid
flowchart LR
    U[Navegador] --> F[Next.js :3000]
    F -->|Proxy /api/*| A[Django / DRF :8000]
    A --> P[(PostgreSQL)]
    A --> K[Keycloak / Tefé Cidadão]
    A --> S[Armazenamento de anexos]
```

O navegador usa o domínio do frontend para acessar `/api/*`. O Next.js encaminha as requisições para a API, e o backend aplica autenticação, autorização e escopo por unidade. O cadastro e o histórico do cidadão têm regras próprias de acesso por perfil, pois a pessoa pode circular entre unidades.

```text
novo-sgcas/
├── README.md
├── CONTRIBUTING.md
├── api-sgcas/
│   ├── apps/                 # Cidadãos, contas, atendimentos e demais domínios
│   ├── sgcas/                # Configuração e rotas Django
│   ├── testes/               # Testes automatizados da API
│   ├── docs/                 # API, privacidade e consentimento
│   ├── .env.example          # Modelo de configuração, sem credenciais reais
│   ├── docker-compose.yml    # API e PostgreSQL
│   ├── compose.dev.yml       # Publicação local da porta do banco
│   └── requirements.txt
└── front-sgcas/
    ├── src/app/              # Páginas e rotas
    ├── src/components/       # Componentes e interface
    ├── src/lib/              # Cliente HTTP, sessão e utilitários
    ├── src/types/            # Contratos TypeScript
    ├── public/               # Imagens e identidade visual
    └── scripts/              # Verificações de navegador
```

## Pré-requisitos

- **Git**.
- **Node.js 22 LTS** e npm para o frontend.
- **Python 3.12** com suporte a `venv` para executar a API fora do Docker.
- **Docker com Compose** para o PostgreSQL e, opcionalmente, a API.
- Acesso a um **Keycloak configurado** para concluir o login real.

Os comandos abaixo usam Bash em Linux/macOS ou WSL. As versões das dependências estão em `requirements.txt` e `package-lock.json`.

## Como rodar localmente

### 1. Clonar o projeto

```bash
git clone https://github.com/JhorlenDev/novo-sgcas.git
cd novo-sgcas
```

### 2. Preparar a API

```bash
cd api-sgcas
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Use a chave gerada em `DJANGO_SECRET_KEY`. Gere também as duas chaves da cifragem dos dados pessoais (rode o comando duas vezes e cole cada resultado em `PII_ENCRYPTION_KEY` e `PII_HMAC_KEY`; se preferir rodar sem cifragem no seu computador, ponha `PII_ENCRYPTION_ENABLED=false`):

```bash
python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
```

Edite o `.env` e configure o banco com **a mesma senha** em `POSTGRES_PASSWORD` e `DATABASE_URL`:

```dotenv
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_SECRET_KEY=cole_a_chave_gerada
POSTGRES_USER=sgcas
POSTGRES_PASSWORD=sgcas_local_dev
POSTGRES_DB=sgcas
POSTGRES_PORT=5434
DATABASE_URL=postgresql://sgcas:sgcas_local_dev@localhost:5434/sgcas
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
KEYCLOAK_REDIRECT_URI=http://localhost:3000/api/auth/keycloak/callback
```

Esses valores de banco são apenas para desenvolvimento local. Preencha também os dados de Keycloak descritos em [Login e primeiro acesso](#login-e-primeiro-acesso). O Django lê o `.env` automaticamente; não é necessário exportar o arquivo no shell.

### 3. Subir o banco e preparar os dados

Ainda em `api-sgcas/`:

```bash
docker compose -f docker-compose.yml -f compose.dev.yml up -d --wait postgres
python manage.py migrate
python manage.py cadastrar_servicos
python manage.py check
python manage.py runserver 0.0.0.0:8000
```

O arquivo `compose.dev.yml` expõe o banco **somente em `127.0.0.1:5434`** por padrão. O Compose base mantém o PostgreSQL acessível apenas na rede Docker.

O comando `cadastrar_servicos` cria/atualiza coordenações, unidades, demandas e serviços do catálogo institucional. Ele é idempotente e não cria contas de acesso nem cidadãos de demonstração.

Os benefícios eventuais dos três CRAS (**Auxílio maternidade**, **Auxílio funeral**, **Cesta básica** e **Auxílio em calamidade pública**) já saem do catálogo com a categoria "Benefício Eventual" e o tipo de auxílio: é isso que liga cada serviço ao aviso de repetição no balcão (e a regra de um ano do auxílio maternidade). As unidades não precisam cadastrar nada para isso valer. Como o comando roda a cada implantação, num serviço que já existe ele só **preenche** a categoria e o tipo quando estão vazios: o que a coordenação decidiu na tela Institucional ("Classificar") não é desfeito. Para incluir outro auxílio em todas as implantações, acrescente-o à lista `AUXILIOS` em `api-sgcas/apps/institucional/management/commands/cadastrar_servicos.py`.

### 4. Subir o frontend

Em outro terminal, a partir da raiz do repositório:

```bash
cd front-sgcas
npm ci
npm run dev
```

Abra **http://localhost:3000**.

| Serviço | Endereço local |
| --- | --- |
| Aplicação | `http://localhost:3000` |
| API | `http://localhost:8000/api/` |
| PostgreSQL | `127.0.0.1:5434` com o override de desenvolvimento |

Se o Next.js escolher outra porta, ajuste o endereço do frontend e o callback no `.env` e no Keycloak. Prefira liberar a porta `3000` para manter os exemplos consistentes.

### Alternativa: API e banco no Docker

Prepare o `.env` conforme acima. Em `api-sgcas/`:

```bash
docker compose build api
docker compose up -d --wait postgres
docker compose run --rm api python manage.py migrate
docker compose run --rm api python manage.py cadastrar_servicos
docker compose up -d api
docker compose logs -f api
```

Nesse modo, o Compose define `DATABASE_URL` para o host interno `postgres:5432`, usando `POSTGRES_USER`, `POSTGRES_PASSWORD` e `POSTGRES_DB`. O frontend continua sendo executado com npm. Não execute simultaneamente a API local e a API Docker na mesma porta.

Para parar os containers sem apagar o banco:

```bash
docker compose stop
```

**Não use `docker compose down -v` para uma parada comum:** a opção `-v` remove o volume do PostgreSQL.

## Login e primeiro acesso

Configure um cliente OpenID Connect no Keycloak com autorização por código e credencial de cliente compatível com o backend:

| Configuração | Valor esperado no ambiente local |
| --- | --- |
| URL | Instância definida em `KEYCLOAK_URL` |
| Realm | `KEYCLOAK_REALM`, por exemplo `prefeitura` |
| Client ID | `KEYCLOAK_CLIENT_ID`, por exemplo `sgcas-web` |
| Client secret | `KEYCLOAK_CLIENT_SECRET` real, somente no `.env` da API |
| Redirect URI | `http://localhost:3000/api/auth/keycloak/callback` |
| Origem do frontend | `http://localhost:3000` |

O botão de entrada abre `/api/auth/keycloak/login`. Após o callback, o backend cria ou atualiza o operador local a partir da identidade e das roles recebidas.

Roles reconhecidas:

- `ADMIN`
- `COORDENADOR`
- `ASSISTENTE_SOCIAL`
- `TECNICO`
- `RECEPCIONISTA`
- `GESTOR_ACOES_ITINERANTES`
- `VISUALIZADOR`

Para o **primeiro administrador**, atribua a role de cliente `ADMIN` do SGCAS à conta correspondente no Keycloak e faça login. `createsuperuser` do Django não substitui esse fluxo.

Quem entra sem uma role reconhecida gera um pedido de acesso e vai para `/waiting-approval`. Um administrador gerencia os pedidos, perfis e vínculos com unidades. Operadores com escopo por unidade precisam desse vínculo para consultar a operação da unidade.

### Checklist do Keycloak para produção

Tudo abaixo é o que o código do SGCAS exige do realm; nada é opcional, exceto o item 8. Os endereços usam o domínio público de exemplo `https://sgcas.tefe.am.gov.br`: troque pelo seu.

1. **Client `sgcas-web`** no realm (`KEYCLOAK_REALM`, por exemplo `prefeitura`):
   - *Client authentication*: **ligado** (client confidencial). *Standard flow*: **ligado**. *Direct access grants* e *Implicit flow*: desligados.
   - *Service accounts roles*: **ligado**. A API usa o próprio client (`client_credentials`) para conceder e retirar papéis quando o administrador aprova um pedido ou desativa um operador.
   - *Valid redirect URIs*: exatamente `https://sgcas.tefe.am.gov.br/api/auth/keycloak/callback`, o mesmo valor de `KEYCLOAK_REDIRECT_URI`.
   - *Valid post logout redirect URIs*: `https://sgcas.tefe.am.gov.br/login`.
   - *Web origins*: `https://sgcas.tefe.am.gov.br`.
   - Na aba *Credentials*, copie o **Client secret** para `KEYCLOAK_CLIENT_SECRET` (só no `.env` da API).
   - Para quem for **rodar o projeto em outra máquina** (desenvolvimento, homologação), acrescente ao mesmo client, além dos endereços de produção, `http://localhost:3000/api/auth/keycloak/callback` em *Valid redirect URIs*, `http://localhost:3000/login` em *Valid post logout redirect URIs* e `http://localhost:3000` em *Web origins*. O `KEYCLOAK_REDIRECT_URI` do `.env` dessa máquina precisa ser exatamente o primeiro.
2. **Conta de serviço do client** (aba *Service account roles* → *Assign role* → filtrar por clients → `realm-management`): conceda `view-users`, `manage-users` e `view-clients`. Sem `view-clients` o Keycloak não nega: devolve lista vazia, e o client parece inexistente.
3. **Papéis do client** (*Clients → sgcas-web → Roles*): crie **com estes nomes exatos** `ADMIN`, `COORDENADOR`, `ASSISTENTE_SOCIAL`, `TECNICO`, `RECEPCIONISTA`, `GESTOR_ACOES_ITINERANTES` e `VISUALIZADOR`. O papel de uma pessoa é o que ela tem **dentro desse client**; o SGCAS não decide papel, só lê.
4. **Conteúdo do token.** O papel é lido do *access token*, em `resource_access.sgcas-web.roles`, então mantenha no client o escopo `roles` padrão (com o mapeador *client roles* adicionando ao access token). A audiência do token precisa conter `account`, o que ocorre quando a pessoa tem o papel padrão do realm (`default-roles-…`, com as funções de `account`): **não retire essas funções dos operadores**, ou o login falha com "token inválido".
5. **Contas dos operadores.** Na primeira entrada o SGCAS cria o operador com o nome e o e-mail do token. O e-mail **verificado** só pesa quando já existe um cadastro local sem vínculo com o SSO (de antes do Keycloak): ele só é adotado se o e-mail estiver verificado; do contrário o login volta com `email-nao-confirmado`. Se o e-mail já estiver ligado a *outra* identidade do SSO, volta `conta-em-conflito`.
6. **Primeiro administrador.** Em *Users → (a pessoa) → Role mapping → Assign role → filtrar por clients → `sgcas-web` → `ADMIN`*, e então entre pelo SGCAS. A partir daí as aprovações e os perfis são feitos na tela **Usuários** do próprio sistema. Quem entra sem papel cai em `/waiting-approval` e vira um pedido de acesso.
7. **Rede.** A API precisa alcançar o SSO por HTTPS (troca do código, chaves públicas e API de administração). O navegador só fala com o domínio do SGCAS.
8. **Pré-cadastro do cidadão no Tefé Cidadão** (opcional, desligado por padrão): peça à equipe do SSO um client de serviço com permissão de chamar `POST {KEYCLOAK_URL}/realms/{realm}/pre-cadastro` e preencha `PRECADASTRO_ENABLED=true`, `PRECADASTRO_CLIENT_ID` e `PRECADASTRO_CLIENT_SECRET`. Sem isso, o cadastro do cidadão segue funcionando; apenas não cria a conta dele no SSO.

Variáveis da API para o login em produção (veja o modelo em [`api-sgcas/.env.example`](api-sgcas/.env.example)):

| Variável | Valor em produção |
| --- | --- |
| `KEYCLOAK_URL` | `https://sso.tefe.am.gov.br` |
| `KEYCLOAK_REALM` | o realm do Tefé Cidadão (`prefeitura`) |
| `KEYCLOAK_CLIENT_ID` | `sgcas-web` |
| `KEYCLOAK_CLIENT_SECRET` | o segredo da aba *Credentials* |
| `KEYCLOAK_REDIRECT_URI` | `https://sgcas.tefe.am.gov.br/api/auth/keycloak/callback` |
| `FRONTEND_URL` | `https://sgcas.tefe.am.gov.br` (a origem pública, com `https`) |
| `DEBUG` | `False` |

Como saber se funcionou: abra `https://sgcas.tefe.am.gov.br/login`, clique em **Entrar com Tefé Cidadão**, entre com a conta que recebeu `ADMIN` e confira que cai no Painel. Se voltar para `/login?erro=…`: `estado-invalido` (sessão expirada ou cookies bloqueados), `sem-codigo` (o SSO não devolveu o código), `conta-em-conflito` (o e-mail já pertence a outra conta do SGCAS), `email-nao-confirmado` (item 5) e `sem-acesso` (token recusado: itens 1, 2 e 4). Os detalhes ficam no log da API.

## Variáveis de ambiente

O modelo completo está em [`api-sgcas/.env.example`](api-sgcas/.env.example).

| Variável | Uso |
| --- | --- |
| `DEBUG` | `True` no desenvolvimento; `False` na produção |
| `DJANGO_SECRET_KEY` | Chave secreta do Django, exclusiva do ambiente |
| `ALLOWED_HOSTS` | Hosts aceitos pela API, separados por vírgula. Atrás do Next, o host de `SGCAS_API_URL` (por exemplo `localhost`), pois o Next troca o `Host` |
| `DATABASE_URL` | Conexão PostgreSQL da API local |
| `FRONTEND_URL` | Destino do navegador após autenticação e origem aceita pela proteção CSRF; em produção, a origem pública com `https` |
| `CORS_ORIGIN` | Configuração lida pelo projeto; o fluxo do frontend usa proxy de mesma origem |
| `SESSION_MAX_LIFETIME` | Vida máxima da sessão desde o login, em segundos, mesmo com uso contínuo (padrão `43200`, 12 horas) |
| `CSRF_TRUSTED_ORIGINS_EXTRAS` | Outros endereços pelos quais o front é aberto (por exemplo, o IP da rede num teste), separados por vírgula. Toda escrita confere o token CSRF e a origem do navegador |
| `KEYCLOAK_*` | Configuração de identidade, cliente e callback |
| `LOCAL_STORAGE_PATH` | Diretório persistente de anexos |
| `TRUSTED_PROXIES` | Quantos proxies reversos (nginx etc., na frente do Next) acrescentam o IP do cliente ao `X-Forwarded-For`; o Next não acrescenta. Padrão: `0` com `DEBUG=True` e `1` com `DEBUG=False`. Define o IP usado no limite de requisições e na auditoria |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credenciais do PostgreSQL no Compose. `POSTGRES_PASSWORD` **não tem valor padrão**: sem ela o Compose recusa subir. Em produção a API também recusa a senha de exemplo `change-me` |
| `POSTGRES_PORT` | Porta local do banco no `compose.dev.yml` |
| `API_PORT` | Porta publicada da API Docker; padrão `8000` |
| `API_BIND_ADDRESS` | Interface em que a porta da API Docker é publicada; padrão `127.0.0.1`. Só o Next e o nginx da mesma máquina a alcançam. Nunca use `0.0.0.0` em produção |
| `PII_ENCRYPTION_ENABLED` | Cifragem dos dados pessoais. **Obrigatória em produção** (padrão `true` com `DEBUG=False`; a API não sobe sem ela). Em desenvolvimento pode ser `false` |
| `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` | Duas chaves **diferentes** de 32 bytes em base64: cifragem e índice de busca. A API confere no boot e não sobe com chave ausente, inválida ou repetida |
| `PRECADASTRO_ENABLED` | Ativa integração de pré-cadastro no Tefé Cidadão |
| `PRECADASTRO_CLIENT_ID`, `PRECADASTRO_CLIENT_SECRET` | Conta de serviço dessa integração |
| `SGCAS_API_URL` | Destino do proxy Next.js; padrão `http://localhost:8000` |

Para usar outra API no desenvolvimento:

```bash
cd front-sgcas
SGCAS_API_URL=http://localhost:8001 npm run dev
```

Em produção, defina `SGCAS_API_URL` **antes de `npm run build`** para gerar os rewrites com o destino correto. Essa variável é configuração do servidor e não precisa do prefixo `NEXT_PUBLIC_`.

## Verificações e testes

Frontend:

```bash
cd front-sgcas
npm ci
npm run lint
npm run build
```

Backend, com o ambiente virtual ativo e PostgreSQL configurado:

```bash
cd api-sgcas
source .venv/bin/activate
python manage.py check
python manage.py test testes --noinput
```

O usuário PostgreSQL dos testes precisa poder criar o banco de testes. Use ambiente de desenvolvimento separado da produção. A suíte cobre permissões, escopo por unidade, recepção, histórico, anexos, auditoria e cifragem, entre outros cenários.

Há também scripts de navegador em `front-sgcas/scripts/`. Eles têm requisitos próprios de navegador e servidor; o teste de login depende de credenciais reais e não integra `npm run lint` ou `npm run build`.

## Produção

1. Configure domínios, HTTPS e proxy reverso. Use [`deploy/nginx/sgcas.conf`](deploy/nginx/sgcas.conf) como ponto de partida (testada no nginx 1.30): troque o domínio e os caminhos dos certificados, copie para `/etc/nginx/conf.d/`, rode `nginx -t` e recarregue. A configuração também limita requisições por IP (`limit_req`) com tetos **folgados de propósito**, porque a prefeitura inteira sai por um IP só; se alguém trabalhando normalmente receber `429`, aumente `rate`/`burst` no topo do arquivo, não remova os limites. Com `DEBUG=False`, a API exige HTTPS e usa cookies seguros; o proxy deve encaminhar `X-Forwarded-Proto` e `X-Forwarded-For`, como essa configuração faz.
2. Gere e preencha as **duas chaves da cifragem dos dados pessoais** (`PII_ENCRYPTION_KEY` e `PII_HMAC_KEY`, comando em [Cifragem de dados pessoais](#cifragem-de-dados-pessoais)): em produção a API não sobe sem elas. Preencha também segredos reais, `ALLOWED_HOSTS`, `FRONTEND_URL` e callback do Keycloak. Nunca publique `.env`. Atenção a dois valores: `ALLOWED_HOSTS` deve conter o host de `SGCAS_API_URL` (por exemplo `localhost`), **não** o domínio público, porque o Next troca o `Host` ao encaminhar para a API; e `FRONTEND_URL` deve ser a origem pública com `https` (por exemplo `https://sgcas.exemplo.gov.br`), pois também define a origem aceita pela proteção CSRF.
3. Faça backup do PostgreSQL, dos anexos (volume `armazenamento`; comandos de backup e restauração em [`api-sgcas/README.md`](api-sgcas/README.md#o-container-é-fechado-de-propósito)) e **das chaves de cifragem, guardadas em lugar diferente do backup do banco**: sem elas os dados pessoais não podem ser recuperados.
4. Construa a API e execute as migrations **antes** de iniciar a nova versão:

   ```bash
   cd api-sgcas
   docker compose build api
   docker compose up -d --wait postgres
   docker compose run --rm api python manage.py migrate
   docker compose run --rm api python manage.py cadastrar_servicos
   docker compose up -d api
   ```

5. Construa e execute o frontend com o destino da API acessível a partir do servidor Next.js:

   ```bash
   cd front-sgcas
   npm ci
   SGCAS_API_URL=http://localhost:8000 npm run build
   npm run start -- -H 127.0.0.1
   ```

O frontend deve ser mantido por um gerenciador de processos ou plataforma de hospedagem, escutando só no loopback (`-H 127.0.0.1`): o Next repassa o `X-Forwarded-For` que recebe, então quem o alcançasse direto escolheria o próprio IP. O Compose atual fornece a API e o banco; não inclui frontend, Keycloak nem terminação TLS (o nginx acima cuida do TLS).

**O IP do cliente e a exposição da API.** O IP usado no limite de requisições e na auditoria vem do `X-Forwarded-For`. O proxy de rewrites do Next não o acrescenta, só o repassa; quem o define é o nginx, que na configuração do repositório **substitui** o cabeçalho pelo endereço que viu conectar (`proxy_set_header X-Forwarded-For $remote_addr;`), descartando o que o cliente enviou. Mantenha `TRUSTED_PROXIES` igual ao número de proxies reversos (1 com só o nginx; 2 com um balanceador antes dele, caso em que a configuração do nginx traz o ajuste necessário). Sem isso todos aparecem com o mesmo IP. O Next e a API também não devem ser alcançáveis sem passar pelo nginx: quem chega direto a eles escreve o cabeçalho inteiro e se passa por outro IP. Por isso o Compose publica a porta da API apenas em `127.0.0.1` (`API_BIND_ADDRESS`); se o Next ficar em outra máquina, informe o IP da interface privada dela, nunca `0.0.0.0`, e proteja a porta também com firewall. A tabela dos contadores do limite é criada pelo `migrate`.

**Limite de entradas por IP e a prefeitura inteira atrás de um IP só.** Secretaria, CRAS e CREAS saem para a internet pelo mesmo endereço público, então um limite apertado por IP deixaria gente de fora no começo do expediente. Por isso são dois limites: um **teto de volume** folgado (120 requisições por minuto de login e de retorno do Tefé Cidadão, 60 de reenvio de solicitação) que só barra inundação, e um **teto de erros** (10 por minuto, por IP) no retorno do Tefé Cidadão, que conta apenas retornos forjados, repetidos ou recusados. Quem entra do jeito certo nunca gasta esse crédito. Passou do limite, a pessoa volta ao login com um aviso e a espera (cabeçalho `Retry-After`). A senha em si é protegida pelo Tefé Cidadão: ative lá a proteção contra força bruta do realm.

**Tamanho dos anexos.** A API aceita anexos de até 25 MB, e três limites na cadeia precisam acompanhá-la: `client_max_body_size 26m` no nginx, `experimental.proxyClientMaxBodySize: "26mb"` em `front-sgcas/next.config.ts` (o padrão do Next, 10 MB, corta o corpo em silêncio e derruba a conexão com a API) e `TAMANHO_MAXIMO` em `api-sgcas/apps/cidadaos/anexos.py`. Se aumentar um, aumente os outros.

**Healthcheck.** O Compose consulta `GET /api/health`, que confere o banco e responde `200` (`{"status":"ok"}`) ou `503`. Ele é tratado antes da validação de host e do redirecionamento HTTPS, então funciona de dentro do container em HTTP puro e só conta `200` como saudável. Serve também para monitoramento externo (passa pelo nginx e pelo Next como qualquer rota `/api`).

### Cifragem de dados pessoais

A cifragem é **obrigatória em produção**: com `DEBUG=False` a API se recusa a subir com ela desligada, ou com chaves ausentes, inválidas ou iguais (a mensagem de erro diz o que falta). Em desenvolvimento ela é opcional. Para ativar, gere duas chaves diferentes, uma por execução:

```bash
python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
```

Preencha `PII_ENCRYPTION_KEY` e `PII_HMAC_KEY` e, numa base que **já tem cadastros** (por exemplo, um banco de desenvolvimento que estava sem cifragem), execute, no ambiente da API:

```bash
python manage.py cifrar_dados_pessoais --simular
python manage.py cifrar_dados_pessoais
```

Em uma base existente, essa atualização também prepara os índices de busca por documentos. O índice de CPF e NIS é calculado só sobre os **dígitos**: a busca acha o cadastro digitando com ou sem pontos e traço, qualquer que seja a forma em que ele foi gravado, e o mesmo CPF com e sem máscara conta como o mesmo cadastro (cadastro repetido devolve 409). O comando também refaz sozinho os índices gravados antes dessa regra, então rode-o de novo ao atualizar o código numa base que já tinha cifragem. Numa base nova, em produção, não há o que migrar: tudo já é gravado cifrado. **Não troque as chaves depois de gravar dados** e preserve cópias seguras delas fora do servidor (e longe do backup do banco): a perda das chaves impede a recuperação dos dados cifrados, e um backup do banco sem elas não serve para nada.

### Eliminação de dados pessoais (LGPD)

`DELETE /api/citizens/:id/dados-pessoais` (**somente ADMIN**: não tem volta e vale para qualquer unidade) elimina os dados pessoais do cidadão:

- **Apaga:** o cadastro inteiro (documentos, contatos, endereço, nascimento, raça, deficiência, composição da família, dados socioeconômicos, índices de busca), os documentos escaneados (no banco e a pasta inteira do disco) e o nome copiado nos benefícios. O registro permanece, anônimo (`Cidadão excluído xxxxxxxx`), e o mesmo CPF pode ser cadastrado de novo.
- **Mantém:** os textos livres dos atendimentos (relato do caso, motivo da recepção, observações de encaminhamento, descrição do benefício), sem vínculo com a pessoa, por decisão da direção: o histórico é prestação de contas. Se o técnico escreveu o nome da pessoa dentro do texto, o nome continua no texto. Também ficam o histórico de consentimento e a trilha de auditoria (que registra a eliminação sem dado pessoal).
- **Não alcança backups.** Restaurar um backup anterior à eliminação traz os dados de volta; reaplique as eliminações registradas na trilha (ação `ERASURE`) depois de qualquer restauração.

Os arquivos só saem do disco depois que o banco grava. Se não puderem ser apagados, a eliminação do cadastro continua valendo e o erro vai ao log com o caminho a apagar à mão.

**Atualizando de uma versão anterior.** A versão anterior apagava só 10 campos e marcava o pedido como atendido. Para completar essas eliminações (o comando só toca em cadastros que o próprio sistema eliminou, nunca em registros excluídos por outro motivo):

```bash
cd api-sgcas
python manage.py completar_eliminacao_lgpd --simular   # relata o que seria apagado, sem apagar
python manage.py completar_eliminacao_lgpd             # apaga, e não há volta
```

## Solução de problemas

| Sintoma | O que conferir |
| --- | --- |
| Conexão recusada em `5434` | Suba o banco com `compose.dev.yml` e confira `POSTGRES_PORT` |
| Autenticação do PostgreSQL falha | Senha de `DATABASE_URL` e `POSTGRES_PASSWORD`; mudar `.env` não altera a senha de um volume já inicializado |
| Relação/coluna inexistente | Execute `python manage.py migrate` no banco correto |
| API retorna `400` | Confira `ALLOWED_HOSTS`: ele precisa conter o host de `SGCAS_API_URL` (o Next troca o `Host`), não o domínio público |
| Login rejeita callback | Compare a URI exata no Keycloak e no `.env`, incluindo porta |
| Tela de aguardando liberação | A conta ainda não recebeu uma role SGCAS válida |
| Operador não vê fila/casos | Confira perfil, unidade vinculada e escopo de acesso |
| Frontend não alcança a API | Confira processo da API, porta e `SGCAS_API_URL`; refaça o build se mudou o destino em produção |
| Docker mostra `unhealthy` | `GET /api/health` devolve `503` quando o banco não responde: confira o PostgreSQL e os logs da API |
| CPF/NIS não encontra cadastro após ativar cifragem | Execute o backfill `cifrar_dados_pessoais` com as chaves corretas |

## Documentação

- [Frontend: telas, perfis e fluxo de uso](front-sgcas/README.md)
- [Backend: endpoints e operação](api-sgcas/README.md)
- [Referência adicional da API](api-sgcas/docs/api.md)
- [Aviso de privacidade](api-sgcas/docs/aviso-de-privacidade.md)
- [Termo de consentimento](api-sgcas/docs/termo-consentimento.md)
- [Guia de contribuição](CONTRIBUTING.md)

## Origem e licença

A importação inicial reúne o estado dos projetos `api-sgcas` e `front-sgcas`, incluindo os ajustes locais do frontend. Os históricos anteriores permanecem nos repositórios de origem; este repositório começa com um snapshot consolidado.

Não há licença de uso definida neste repositório. A disponibilização do código não concede, por si só, uma licença de redistribuição.
