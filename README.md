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
| Benefícios e encaminhamentos | Registro vinculado ao cidadão e ao atendimento |
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

Use a chave gerada em `DJANGO_SECRET_KEY`. Edite o `.env` e configure o banco com **a mesma senha** em `POSTGRES_PASSWORD` e `DATABASE_URL`:

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

## Variáveis de ambiente

O modelo completo está em [`api-sgcas/.env.example`](api-sgcas/.env.example).

| Variável | Uso |
| --- | --- |
| `DEBUG` | `True` no desenvolvimento; `False` na produção |
| `DJANGO_SECRET_KEY` | Chave secreta do Django, exclusiva do ambiente |
| `ALLOWED_HOSTS` | Hosts aceitos pela API, separados por vírgula |
| `DATABASE_URL` | Conexão PostgreSQL da API local |
| `FRONTEND_URL` | Destino do navegador após autenticação |
| `CORS_ORIGIN` | Configuração lida pelo projeto; o fluxo do frontend usa proxy de mesma origem |
| `KEYCLOAK_*` | Configuração de identidade, cliente e callback |
| `LOCAL_STORAGE_PATH` | Diretório persistente de anexos |
| `TRUSTED_PROXIES` | Quantos proxies reversos (nginx etc., na frente do Next) acrescentam o IP do cliente ao `X-Forwarded-For`; o Next não acrescenta. Padrão: `0` com `DEBUG=True` e `1` com `DEBUG=False`. Define o IP usado no limite de requisições e na auditoria |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Credenciais do PostgreSQL no Compose |
| `POSTGRES_PORT` | Porta local do banco no `compose.dev.yml` |
| `API_PORT` | Porta publicada da API Docker; padrão `8000` |
| `API_BIND_ADDRESS` | Interface em que a porta da API Docker é publicada; padrão `127.0.0.1`. Só o Next e o nginx da mesma máquina a alcançam. Nunca use `0.0.0.0` em produção |
| `PII_ENCRYPTION_ENABLED` | Ativa cifragem de dados pessoais |
| `PII_ENCRYPTION_KEY`, `PII_HMAC_KEY` | Chaves distintas de cifragem e índice de busca |
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

1. Configure domínios, HTTPS e proxy reverso. Com `DEBUG=False`, a API exige HTTPS e usa cookies seguros. O proxy deve encaminhar corretamente `X-Forwarded-Proto`.
2. Preencha segredos reais, `ALLOWED_HOSTS`, `FRONTEND_URL` e callback do Keycloak. Nunca publique `.env`.
3. Faça backup do PostgreSQL, dos anexos e das chaves de cifragem, quando utilizadas.
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
   npm run start
   ```

O frontend deve ser mantido por um gerenciador de processos ou plataforma de hospedagem. O Compose atual fornece a API e o banco; não inclui frontend, Keycloak nem terminação TLS.

**O IP do cliente e a exposição da API.** O IP usado no limite de requisições e na auditoria vem do `X-Forwarded-For` que o proxy reverso (nginx ou similar) acrescenta; o Next o repassa, mas não o acrescenta. Configure o proxy com `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` e mantenha `TRUSTED_PROXIES` igual ao número de proxies reversos. Sem isso todos aparecem com o mesmo IP. A API também não deve ser alcançável sem passar por eles: quem chega direto à porta da API escreve o cabeçalho inteiro e se passa por outro IP. Por isso o Compose publica a porta da API apenas em `127.0.0.1` (`API_BIND_ADDRESS`); se o Next ficar em outra máquina, informe o IP da interface privada dela, nunca `0.0.0.0`, e proteja a porta também com firewall. A tabela dos contadores do limite é criada pelo `migrate`.

**Limitação do healthcheck atual:** o Compose consulta um endpoint institucional protegido. Uma resposta `401` ou um redirecionamento HTTPS pode marcar o container como `unhealthy` mesmo com o processo ativo. Confira os logs e valide a configuração antes de usar esse sinal para reinício automático ou prontidão de produção.

### Cifragem de dados pessoais

A cifragem vem desligada. Para ativar, gere duas chaves diferentes, uma por execução:

```bash
python -c "import base64, os; print(base64.b64encode(os.urandom(32)).decode())"
```

Preencha `PII_ENCRYPTION_KEY` e `PII_HMAC_KEY`, configure `PII_ENCRYPTION_ENABLED=true` e execute, no ambiente da API:

```bash
python manage.py cifrar_dados_pessoais --simular
python manage.py cifrar_dados_pessoais
```

Em uma base existente, essa atualização também prepara os índices de busca por documentos. Preserve cópias seguras das chaves fora do servidor: sua perda impede a recuperação dos dados cifrados.

## Solução de problemas

| Sintoma | O que conferir |
| --- | --- |
| Conexão recusada em `5434` | Suba o banco com `compose.dev.yml` e confira `POSTGRES_PORT` |
| Autenticação do PostgreSQL falha | Senha de `DATABASE_URL` e `POSTGRES_PASSWORD`; mudar `.env` não altera a senha de um volume já inicializado |
| Relação/coluna inexistente | Execute `python manage.py migrate` no banco correto |
| API retorna `400` | Confira `ALLOWED_HOSTS` e o host usado pelo proxy |
| Login rejeita callback | Compare a URI exata no Keycloak e no `.env`, incluindo porta |
| Tela de aguardando liberação | A conta ainda não recebeu uma role SGCAS válida |
| Operador não vê fila/casos | Confira perfil, unidade vinculada e escopo de acesso |
| Frontend não alcança a API | Confira processo da API, porta e `SGCAS_API_URL`; refaça o build se mudou o destino em produção |
| Docker mostra `unhealthy` | Consulte logs e a limitação do healthcheck descrita acima |
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
