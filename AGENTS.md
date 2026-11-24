# Instruções para agentes de IA

## Implantar ou atualizar no servidor

- O ramo de produção é **`producao`**. O ramo padrão do GitHub (`main`) está antigo: nunca implante a partir dele.
- **Servidor onde o SGCAS já roda:** na pasta do projeto, rode `deploy/atualizar.sh` e nada mais. Ele faz o backup, baixa o `producao`, atualiza a API e o frontend, confere o Tefé Cidadão e os administradores, e confere que tudo responde.
- **Se o script parar** (`PAROU: ...`), mostre a mensagem a quem pediu e pare também. Não contorne: ele para justamente onde seguir causaria dano (backup que falhou, nenhum administrador ativo, código local divergente).
- **Servidor novo** (sem `api-sgcas/.env`): siga o README, seção "Produção". O primeiro `.env` é criado por `deploy/gerar-env.sh`.

## Nunca

- Editar, recriar ou sobrescrever `api-sgcas/.env`, rodar `deploy/gerar-env.sh --forcar` num servidor com dados ou trocar `PII_ENCRYPTION_KEY` e `PII_HMAC_KEY`: os dados pessoais cifrados ficariam ilegíveis para sempre.
- `docker compose down -v`, `docker volume rm` ou qualquer outro comando que apague o banco ou os anexos.
- Dar ou tirar o papel ADMIN pelo banco ou pelo código: os papéis vêm do Tefé Cidadão (Keycloak), client `sgcas-web`.
- Rodar `python manage.py dados_de_demonstracao` num servidor: é só para desenvolvimento.

## Desenvolvimento

- As verificações antes de propor mudanças estão no `CONTRIBUTING.md`. O frontend tem instruções próprias em `front-sgcas/AGENTS.md`.
