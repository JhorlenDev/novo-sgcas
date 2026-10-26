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
npm run build
```

Backend, com ambiente virtual ativo e banco de desenvolvimento configurado:

```bash
cd api-sgcas
python manage.py check
python manage.py test testes --noinput
```

## Cuidados com dados

Não inclua `.env`, tokens, credenciais, dumps do banco, anexos de cidadãos ou dados pessoais reais em commits, issues, screenshots ou logs de teste. Use `.env.example` para documentar novas variáveis com valores de exemplo.

As permissões devem ser aplicadas no backend. Ocultar um botão no frontend não substitui autorização na API. Preserve o escopo por unidade e a trilha de auditoria nas operações pertinentes.

## Descrição de pull request

Informe o comportamento anterior, o resultado esperado, as verificações executadas e eventuais passos de configuração ou migration. Se alguma verificação não foi executada, registre o motivo.
