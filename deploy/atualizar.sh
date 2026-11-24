#!/usr/bin/env bash
# Atualiza o SGCAS no servidor para a versão do ramo `producao`, do backup à conferência final.
#
#   deploy/atualizar.sh
#
# Rode na pasta do projeto, num servidor onde o SGCAS já está instalado (a primeira instalação
# está no README, seção "Produção"). Faz, nesta ordem, e PARA no primeiro erro:
#   1. confere o servidor (.env, Docker, npm, nenhuma alteração local no código);
#   2. backup do banco e dos anexos (deploy/backup.sh);
#   3. baixa o ramo `producao` do GitHub e continua com a versão nova deste script;
#   4. API: build da imagem, migrations e catálogo de unidades e serviços (cadastrar_servicos);
#   5. confere o Tefé Cidadão e lista os administradores (verificar_keycloak --mostrar-admins).
#      Sem nenhum administrador ativo, para ANTES de pôr a versão nova no ar: o sistema
#      abriria sem ninguém para aprovar os acessos, como já aconteceu;
#   6. põe a API nova no ar e espera ela ficar saudável;
#   7. frontend: npm ci, build e reinício do serviço sgcas-front;
#   8. confere que a API e a tela de login respondem.
#
# O que ele NUNCA faz: mexer no api-sgcas/.env ou nas chaves da cifragem (trocá-las deixa os dados
# pessoais ilegíveis), apagar volumes do Docker ou dados do banco.
#
# Opcionais:  SGCAS_RAMO (padrão producao), SGCAS_BACKUP_DESTINO (padrão ~/backups-sgcas),
#             SGCAS_API_URL (padrão http://localhost:8000, o destino da API no build do frontend).
set -euo pipefail

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ramo="${SGCAS_RAMO:-producao}"
api_url="${SGCAS_API_URL:-http://localhost:8000}"
destino_backup="${SGCAS_BACKUP_DESTINO:-$HOME/backups-sgcas}"

passo() { printf '\n== %s\n' "$*"; }
falha() { printf '\nPAROU: %s\n' "$*" >&2; exit 1; }

# Como administrador: direto se já for root (o `sudo` pode nem existir), senão com `sudo`.
administrador() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

# Como outro usuário (o dono do serviço do frontend).
como_usuario() {
  local usuario="$1"
  shift
  if command -v sudo >/dev/null 2>&1; then
    sudo -u "$usuario" "$@"
  elif [ "$(id -u)" -eq 0 ] && command -v runuser >/dev/null 2>&1; then
    runuser -u "$usuario" -- "$@"
  else
    falha "preciso rodar o build do frontend como $usuario (o dono do serviço sgcas-front), mas não há sudo nem runuser."
  fi
}

antes_de_baixar() {
  passo "1/8 Conferindo o servidor"
  command -v docker >/dev/null 2>&1 || falha "o Docker não está instalado ou não está no PATH."
  command -v npm >/dev/null 2>&1 || falha "o npm (Node.js 22) não está instalado ou não está no PATH."
  [ -f "$raiz/api-sgcas/.env" ] || falha "não existe api-sgcas/.env: o SGCAS ainda não foi instalado neste servidor. A primeira instalação está no README, seção \"Produção\"."
  if [ -n "$(git -C "$raiz" status --porcelain --untracked-files=no)" ]; then
    falha "há alterações locais no código do projeto (git status). Elas se misturariam à versão nova; resolva antes de atualizar."
  fi

  passo "2/8 Backup do banco e dos anexos"
  "$raiz/deploy/backup.sh" "$destino_backup" || falha "o backup falhou. Nada foi alterado."

  passo "3/8 Baixando o ramo $ramo"
  git -C "$raiz" fetch origin "$ramo"
  git -C "$raiz" checkout "$ramo"
  git -C "$raiz" merge --ff-only "origin/$ramo" \
    || falha "o ramo $ramo deste servidor tem commits que o GitHub não tem; não vou misturar. Confira com git log."
  echo "versão: $(git -C "$raiz" log -1 --format='%h %s')"

  # O pull pode ter trocado este próprio arquivo: os próximos passos vêm da versão nova dele.
  exec "$raiz/deploy/atualizar.sh" --depois-de-baixar
}

depois_de_baixar() {
  cd "$raiz/api-sgcas"

  passo "4/8 API: imagem, migrations e catálogo"
  docker compose build api
  docker compose up -d --wait postgres
  docker compose run --rm api python manage.py migrate --noinput
  docker compose run --rm api python manage.py cadastrar_servicos

  passo "5/8 Tefé Cidadão e administradores"
  docker compose run --rm api python manage.py verificar_keycloak --mostrar-admins \
    || falha "o Tefé Cidadão não está como o SGCAS exige (veja acima). A versão nova NÃO foi posta no ar: a anterior continua atendendo. Corrija no Keycloak e rode este script de novo."

  passo "6/8 Pondo a API nova no ar"
  docker compose up -d --wait api || falha "a API nova não ficou saudável. Veja: docker compose logs api"

  passo "7/8 Frontend"
  cd "$raiz/front-sgcas"
  local servico="" usuario=""
  if command -v systemctl >/dev/null 2>&1 && systemctl cat sgcas-front >/dev/null 2>&1; then
    servico="sgcas-front"
    usuario="$(systemctl show -p User --value sgcas-front)"
  fi
  # O build é feito pelo mesmo usuário que roda o serviço, dono da pasta (ver sgcas-front.service).
  if [ -n "$usuario" ] && [ "$usuario" != "$(id -un)" ]; then
    como_usuario "$usuario" env SGCAS_API_URL="$api_url" npm ci
    como_usuario "$usuario" env SGCAS_API_URL="$api_url" npm run build
  else
    SGCAS_API_URL="$api_url" npm ci
    SGCAS_API_URL="$api_url" npm run build
  fi
  if [ -n "$servico" ]; then
    administrador systemctl restart sgcas-front
  else
    echo "AVISO: o serviço sgcas-front não está no systemd. Reinicie o frontend do jeito que ele roda neste servidor."
  fi

  passo "8/8 Conferindo"
  curl -fsS -o /dev/null "$api_url/api/health" || falha "a API não respondeu em $api_url/api/health."
  local tentativa
  for tentativa in $(seq 1 30); do
    if curl -fsS -o /dev/null http://127.0.0.1:3000/login/; then
      printf '\nSGCAS atualizado: %s\n' "$(git -C "$raiz" log -1 --format='%h %s')"
      echo "Backup desta atualização em $destino_backup."
      return 0
    fi
    sleep 2
  done
  falha "o frontend não respondeu em http://127.0.0.1:3000/login/. Veja: journalctl -u sgcas-front -n 50"
}

if [ "${1:-}" = "--depois-de-baixar" ]; then
  depois_de_baixar
else
  antes_de_baixar
fi
