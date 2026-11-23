# Melhorias do SGCAS

Levantamento de 23/11/2026, sobre o ramo `producao`, e o que foi feito no ramo
`melhorias/lista-de-melhorias`. Cada item aponta o commit que o resolve.

## Pendências que dependem de outras pessoas

- [ ] **Encarregado de dados (DPO).** Quem o designa é a Prefeitura Municipal de Tefé, a controladora dos dados (LGPD, art. 5º, VI e VIII, e art. 41), por ato formal. Pode ser o mesmo encarregado que a Prefeitura já tenha para os outros sistemas. Ao ser designado, preencha `ENCARREGADO` em `front-sgcas/src/lib/controlador.ts` e a seção do encarregado em `api-sgcas/docs/aviso-de-privacidade.md` e `api-sgcas/docs/termo-consentimento.md`. Até lá, o termo diz que ele será designado e indica a sede da Prefeitura.
- [ ] **Conferir os administradores no Tefé Cidadão.** Rodar `python manage.py verificar_keycloak` com o segredo real do client (no servidor ou no `.env` local): ele diz quantas pessoas ativas têm ADMIN. Devem ser pelo menos duas.
- [ ] **Exigir o CI verde para juntar mudanças.** Quem administra o repositório no GitHub ativa em *Settings → Branches → Branch protection rules*, marcando as tarefas "API (Django)" e "Frontend (Next.js)".

## Resolvido

### 1. Versionamento
- [x] A pasta virou repositório git ligado a `github.com/JhorlenDev/novo-sgcas`, no ramo `melhorias/lista-de-melhorias`, criado a partir de `producao`. A pasta era exatamente o ramo `producao`.

### 2. Next.js com falhas de segurança conhecidas
- [x] Next.js e `eslint-config-next` de 16.4.3 para 16.4.6, e `minimatch` atualizado: `npm audit` sem nenhuma vulnerabilidade (`29f7d3f`). O gerenciador de pacotes continua o npm: a falha era da versão do Next, não do npm, e trocar para pnpm mudaria o lockfile, a implantação e a documentação sem corrigir nada.

### 3. Defeitos nas telas
- [x] O filtro "Ação itinerante" de Acompanhamentos chamava uma rota que não existe e ficava sempre vazio (`5ba9c1c`).
- [x] O histórico da tela de Atendimento mostrava o título e a unidade grudados (`5ba9c1c`).
- [x] Falhas de carga apareciam como lista vazia, igual a "não há nada": 24 pontos em 9 telas. Agora aparecem como aviso. O 403 continua silencioso, porque é o perfil que não vê aquele dado (`5ba9c1c`).

Achados durante o trabalho, também corrigidos:
- [x] Na tela de Atendimento, o erro de uma ação aparecia atrás da janela aberta, onde ninguém o via (`5900533`).
- [x] A Recepção oferecia prioridade "Urgente", que a API transforma em Normal em silêncio: a pessoa ia para a fila comum com a recepcionista achando que era urgente (`e727583`).
- [x] Na Institucional, a unidade era cadastrada, mas a tela dizia "Não foi possível cadastrar" e não atualizava a lista; e os erros de cadastro apareciam atrás da janela (`8537096`).
- [x] Um teste de segurança da API só passava onde houvesse um `.env` com chaves, e falhava no CI (`b688f5e`).
- [x] O `verificar_keycloak` dizia "Tudo certo" mesmo com **nenhum administrador**, o cenário em que o sistema já ficou trancado. Agora falha sem admin ativo, avisa com um só, desconta contas desativadas e conta quem tem ADMIN por grupo (`3b2b14d`).

### 4. Textos legais
- [x] O termo exibido ao cidadão e os textos de `docs/` têm o CNPJ (04.426.383/0001-15, dígitos verificadores conferidos) e o endereço da Prefeitura, sem nenhum campo entre colchetes (`6cd913b`). Falta só o encarregado, acima.

### 5. Verificações obrigatórias
- [x] CI no GitHub Actions para a API e o frontend, `ruff` no Python e `npm run typecheck` (`2e8577d`). A tarefa da API foi rodada num container Linux igual ao do CI: 696 testes, todos passando. O CONTRIBUTING explica, sem jargão, o que é o CI e o que fazer quando fica vermelho.

### 6. Testes do frontend
- [x] Playwright com runner, API simulada e 59 testes de navegador cobrindo as telas e os fluxos principais (`fdc9bc9`, `5900533`, `b3b6a80`, `8537096`). Com o código de antes das correções, os testes dos defeitos falham, um por defeito. O teste de login real fica pulado sem credenciais.

### 7. Arquivos grandes
- [x] Atendimento: de 932 para 417 linhas (`5c252ea`). Recepção: de 902 para 370 (`4737213`). Ações itinerantes: de 507 para 252 (`d1528e0`). Institucional: de 497 para 231 (`df08dad`).
- [x] API: `atendimentos/api.py` (885 linhas) e `cidadaos/api.py` (877) divididos por assunto, com a árvore sintática de cada função idêntica à original (`e00b1c4`).
- [x] O prontuário (500 linhas) ficou como está: já são 17 componentes pequenos, e o principal tem cerca de 100 linhas.
- Peso do site: 1016,4 KB de JavaScript antes e 1025,0 KB depois (327 KB comprimidos, que é o que o navegador baixa). Dividir arquivos organiza o código, mas não muda o peso.

### 8. Limpezas
- [x] Comentário desatualizado do `settings.py`, IP fixo de uma máquina no `next.config.ts` (agora `SGCAS_DEV_ORIGINS`), linha comentada e cinco SVGs sem uso (`f6c02ff`). `docs/api.md` descrevia errado a prioridade da recepção (`e727583`).

### 9. Ambiente local
- [x] `127.0.0.1` em vez de `localhost` no banco e no destino da API: no Windows, `localhost` deixava cada conexão 20 segundos mais lenta (`f6c02ff`).
- [x] `python manage.py dados_de_demonstracao` cria dados fictícios e uma sessão de administrador para ver as telas sem o Tefé Cidadão. Só roda com `DEBUG=True` (`d82734f`).

### Extra
- [x] CRAS II Abial no catálogo de unidades (`15da3f3`).

## Ao implantar esta versão

1. `docker compose build api` e `docker compose up -d api`. Não há migration nova (`makemigrations --check` confirma).
2. `docker compose run --rm api python manage.py cadastrar_servicos`, que cria o CRAS II Abial.
3. No frontend, `npm ci` e `npm run build` (o Next mudou de versão) e reiniciar o serviço.
4. Antes, confira se ninguém cadastrou o Abial à mão na tela Institucional com outra sigla; se cadastrou, ele ficaria duplicado.
