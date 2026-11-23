# Contribuindo com o Novo SGCAS

## Preparação

Siga o [README](README.md) para configurar banco, API, frontend e autenticação. Use dados fictícios no desenvolvimento e nos testes.

## Organização

- `front-sgcas/`: interface, sessão no navegador e integração HTTP.
- `api-sgcas/`: regras de negócio, permissões, persistência e integrações.
- Mudanças nos contratos da API devem atualizar os tipos e os consumidores do frontend.
- Mudanças no esquema precisam de migrations versionadas.
- Leia as instruções de `front-sgcas/AGENTS.md` antes de alterar o frontend com agentes de código.

## Fluxo de trabalho

1. Crie uma branch a partir de `main`.
2. Implemente uma alteração de escopo definido.
3. Atualize a documentação quando mudar instalação, configuração ou comportamento.
4. Execute as verificações adequadas à alteração.
5. Abra um pull request com problema, solução e resultados das verificações.

```bash
git switch -c feat/minha-alteracao
```

Frontend:

```bash
cd front-sgcas
npm run lint
npm run typecheck
npm run build
npm run test:e2e
```

Backend, com ambiente virtual ativo e banco de desenvolvimento configurado:

```bash
cd api-sgcas
pip install -r requirements-dev.txt   # ruff, uma vez
ruff check .
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test testes --noinput
```

### Verificação automática (CI)

Não é preciso lembrar de tudo isso sozinho: o GitHub roda as mesmas verificações em todo envio para `main`, `desenvolvimento` e `producao` e em todo pull request ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). São duas tarefas:

- **API (Django)**: sobe um PostgreSQL só para o teste, gera chaves descartáveis e roda o `ruff`, o `check`, a conferência das migrations e a suíte de testes.
- **Frontend (Next.js)**: confere que as dependências de produção não têm falha de segurança conhecida, roda o lint, os tipos e o build, e testa as telas num navegador.

O resultado aparece no pull request, com um ✓ verde ou um ✗ vermelho em cada tarefa. **Só junte a mudança com as duas verdes.** Se uma ficar vermelha, clique nela para ver qual passo falhou; nos testes de navegador, o relatório com o retrato da tela fica em *Artifacts* (`relatorio-playwright`). Para impedir que alguém junte com o CI vermelho, o administrador do repositório pode exigir as duas tarefas em *Settings → Branches → Branch protection rules*.

## Cuidados com dados

Não inclua `.env`, tokens, credenciais, dumps do banco, anexos de cidadãos ou dados pessoais reais em commits, issues, screenshots ou logs de teste. Use `.env.example` para documentar novas variáveis com valores de exemplo.

As permissões devem ser aplicadas no backend. Ocultar um botão no frontend não substitui autorização na API. Preserve o escopo por unidade e a trilha de auditoria nas operações pertinentes.

## Descrição de pull request

Informe o comportamento anterior, o resultado esperado, as verificações executadas e eventuais passos de configuração ou migration. Se alguma verificação não foi executada, registre o motivo.
