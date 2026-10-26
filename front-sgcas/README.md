# front-sgcas

Frontend Next.js do SGCAS — Sistema de Gestão de Casos da Assistência Social de Tefé.

Este projeto consome a API Django do `api-sgcas` e entrega as telas de login, cidadãos, recepção, atendimento, acompanhamentos, institucional e usuários.

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS
- Radix UI
- Lucide Icons

## Como rodar localmente

### 1. Instalar dependências

```bash
cd front-sgcas
npm install
```

### 2. Subir a API primeiro

Em outro terminal:

```bash
cd ../api-sgcas
set -a; . ./.env; set +a
.venv/bin/python manage.py runserver 0.0.0.0:8000
```

### 3. Subir o front

```bash
cd ../front-sgcas
npm run dev
```

Abra:

```txt
http://localhost:3000
```

Se a porta `3000` já estiver em uso, o Next pode subir em `3001`. Nesse caso, ajuste também o `FRONTEND_URL`, `CORS_ORIGIN` e callback do Keycloak se for testar login real.

## Configuração da API

Por padrão, o front envia chamadas `/api/*` para:

```txt
http://localhost:8000/api/*
```

Isso é feito no `next.config.ts`.

Para apontar para outra API:

```bash
SGCAS_API_URL=http://localhost:8000 npm run dev
```

Em produção, configure `SGCAS_API_URL` no ambiente do deploy.

## Login

O SGCAS usa login via Keycloak/Tefé Cidadão. O botão da tela de login chama:

```txt
/api/auth/keycloak/login
```

Como o Next faz proxy para a API, o navegador permanece no domínio do front e o callback local esperado é:

```txt
http://localhost:3000/api/auth/keycloak/callback
```

Se o usuário logar sem role SGCAS, ele cai na tela:

```txt
/waiting-approval
```

Nessa tela ele pode reenviar a solicitação e deve falar com o coordenador da unidade ou administrador.

## Perfis e menus

Roles esperadas:

```txt
ADMIN
COORDENADOR
ASSISTENTE_SOCIAL
TECNICO
RECEPCIONISTA
GESTOR_ACOES_ITINERANTES
VISUALIZADOR
```

Organização geral das abas:

```txt
Painel              todos os perfis autenticados
Cidadãos            todos os perfis autenticados
Recepção            RECEPCIONISTA, COORDENADOR, ASSISTENTE_SOCIAL, TECNICO, ADMIN
Atendimento         TECNICO, ASSISTENTE_SOCIAL, COORDENADOR, ADMIN
Acompanhamentos     todos os perfis autenticados, respeitando permissão da API
Institucional       ADMIN/COORDENADOR conforme regra do backend
Usuários            ADMIN
Ações itinerantes   ADMIN/GESTOR_ACOES_ITINERANTES
```

O front esconde telas conforme perfil, mas a segurança real fica na API.

## Fluxo de uso

### 1. Recepção

Na aba Recepção:

1. buscar cidadão por nome, CPF, NIS ou e-mail;
2. selecionar cidadão;
3. conferir casos recentes e histórico;
4. escolher serviço;
5. definir prioridade;
6. finalizar no balcão ou gerar senha para fila.

Ao gerar senha, o padrão é:

```txt
UR001 = urgente
PR001 = prioridade alta
NR001 = normal
BX001 = baixa
```

### 2. Atendimento

Na aba Atendimento:

1. clicar em `Chamar próximo`;
2. conferir modal com cidadão, serviço, prioridade e histórico;
3. iniciar atendimento;
4. registrar evolução/observação;
5. concluir, encaminhar ou marcar como não compareceu.

O registro guiado possui:

- situação identificada;
- providência tomada;
- retorno necessário;
- data prevista de retorno;
- observação/evolução livre.

### 3. Não compareceu

Se a senha for chamada e o cidadão não aparecer:

1. clicar em `Não compareceu`;
2. informar motivo opcional;
3. confirmar.

O sistema libera a fila, marca a senha como desistência e cancela o caso.

### 4. Acompanhamentos

Na aba Acompanhamentos:

- cada caso é clicável;
- o modal mostra dados diferentes conforme situação;
- casos em triagem mostram dados da recepção;
- casos em atendimento mostram técnico e relato;
- casos finalizados/encaminhados mostram o desfecho.

## Scripts

```bash
npm run dev
npm run lint
npm run build
npm run start
```

## Teste rápido antes de subir

```bash
npm run lint
npm run build
```

## Estrutura principal

```txt
src/app/login              tela de login
src/app/waiting-approval   tela de aguardando liberação
src/app/dashboard          painel
src/app/cidadaos           busca/cadastro/detalhe de cidadãos
src/app/recepcao           fluxo da recepção
src/app/fila               atendimento/fila
src/app/casos              acompanhamentos
src/app/institucional      unidades, demandas e serviços
src/app/admin              usuários e solicitações
src/components             componentes reutilizáveis
src/lib/api.ts             cliente da API
src/lib/auth.tsx           sessão, login e proteção de rotas
src/types/sgcas.ts         tipos TypeScript da API
```

## Observações

- Não commite `.env`.
- O favicon fica em `src/app/icon.svg`.
- Imagens públicas ficam em `public/`.
- Se o navegador mostrar tela antiga, faça hard refresh com `Ctrl + Shift + R`.
