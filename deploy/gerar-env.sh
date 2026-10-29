#!/usr/bin/env bash
# Gera o .env de PRODUÇÃO da API, com todos os segredos aleatórios.
#
#   deploy/gerar-env.sh sgcas.tefe.am.gov.br
#
# Por que existe: montar o .env à mão é onde as implantações tropeçam (variável repetida, senha do
# banco diferente nos dois lugares, chave de cifra igual à do índice). Este script escreve o
# arquivo inteiro, sem repetição e com tudo coerente. Não imprime nenhum segredo.
#
# Só o segredo do Keycloak vem de fora: informe pela variável KEYCLOAK_CLIENT_SECRET ou digite quando
# o script perguntar (a digitação não aparece na tela). Sem ele o arquivo sai com a linha vazia, e a
# API só consegue conceder acessos depois que ela for preenchida.
#
# Se o arquivo já existe o script recusa: trocar as chaves PII_* de uma base que já tem cadastros
# torna os dados pessoais ilegíveis. `--forcar` sobrescreve (guardando uma cópia do antigo).
set -euo pipefail

uso() {
  echo "Uso: deploy/gerar-env.sh DOMINIO [--forcar]" >&2
  echo "  DOMINIO  o endereço público do sistema, sem https:// e sem barra (ex.: sgcas.tefe.am.gov.br)" >&2
  exit 2
}

dominio=""
forcar=0
for argumento in "$@"; do
  case "$argumento" in
    --forcar) forcar=1 ;;
    -*) echo "Opção desconhecida: $argumento" >&2; uso ;;
    *)
      [ -z "$dominio" ] || { echo "Informe só um domínio." >&2; uso; }
      dominio="$argumento"
      ;;
  esac
done
[ -n "$dominio" ] || uso

dominio="$(printf '%s' "$dominio" | tr 'A-Z' 'a-z')"
if ! [[ "$dominio" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo "Domínio inválido: use só o nome, como sgcas.tefe.am.gov.br (sem https://, sem barra, sem espaço)." >&2
  exit 2
fi

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destino="${SGCAS_ENV_DESTINO:-$raiz/api-sgcas/.env}"

if [ -e "$destino" ] && [ "$forcar" -ne 1 ]; then
  echo "Já existe um arquivo em $destino e não vou sobrescrevê-lo." >&2
  echo "Trocar as chaves PII_ENCRYPTION_KEY e PII_HMAC_KEY de uma base com cadastros torna os dados" >&2
  echo "pessoais ilegíveis. Se tem certeza (base nova, sem dados), rode de novo com --forcar." >&2
  exit 1
fi

# ── o segredo do Keycloak ────────────────────────────────────────
segredo_keycloak="${KEYCLOAK_CLIENT_SECRET:-}"
if [ -z "$segredo_keycloak" ] && [ -t 0 ]; then
  read -r -s -p "Client secret do Keycloak (Clients > sgcas-web > Credentials; Enter para deixar vazio): " segredo_keycloak
  echo
fi
if [ "$segredo_keycloak" = "SEGREDO_CLIENTE_AQUI" ]; then
  echo "KEYCLOAK_CLIENT_SECRET é o texto de exemplo: informe o segredo de verdade." >&2
  exit 2
fi
if [ -n "$segredo_keycloak" ] && ! [[ "$segredo_keycloak" =~ ^[A-Za-z0-9._~-]+$ ]]; then
  echo "KEYCLOAK_CLIENT_SECRET tem caracteres inesperados (esperado: letras, números e . _ ~ -). Confira o que foi copiado." >&2
  exit 2
fi

# ── os segredos aleatórios (nunca impressos) ─────────────────────
base64_sem_quebra() { head -c "$1" /dev/urandom | base64 | tr -d '\n'; }
chave_secreta="$(base64_sem_quebra 48 | tr -d '=' | tr '+/' '-_')"
senha_do_banco="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
chave_de_cifra="$(base64_sem_quebra 32)"
chave_do_indice="$(base64_sem_quebra 32)"

if [ -e "$destino" ]; then
  copia="$destino.anterior-$(date +%Y%m%d%H%M%S)"
  cp -p "$destino" "$copia"
  echo "O arquivo antigo foi guardado em $copia (tem segredos: guarde em lugar seguro ou apague)."
fi

keycloak_url="${KEYCLOAK_URL:-https://sso.tefe.am.gov.br}"
keycloak_realm="${KEYCLOAK_REALM:-prefeitura}"
keycloak_client="${KEYCLOAK_CLIENT_ID:-sgcas-web}"

temporario="$destino.novo.$$"
(
  umask 077
  cat > "$temporario" <<ENV
# Gerado por deploy/gerar-env.sh em $(date +%Y-%m-%d) para $dominio. NUNCA publique este arquivo.

DEBUG=False
# O Next troca o Host ao encaminhar para a API: aqui vai o host dele (localhost), NÃO o domínio público.
ALLOWED_HOSTS=localhost,127.0.0.1
DJANGO_SECRET_KEY=$chave_secreta

POSTGRES_USER=sgcas
POSTGRES_PASSWORD=$senha_do_banco
POSTGRES_DB=sgcas
DATABASE_URL=postgresql://sgcas:$senha_do_banco@postgres:5432/sgcas

# A origem pública, com https: também define a origem aceita pela proteção CSRF.
FRONTEND_URL=https://$dominio
CORS_ORIGIN=https://$dominio

KEYCLOAK_URL=$keycloak_url
KEYCLOAK_REALM=$keycloak_realm
KEYCLOAK_CLIENT_ID=$keycloak_client
KEYCLOAK_CLIENT_SECRET=$segredo_keycloak
KEYCLOAK_REDIRECT_URI=https://$dominio/api/auth/keycloak/callback

# Cifragem dos dados pessoais. GUARDE ESTAS DUAS CHAVES FORA DO SERVIDOR e longe do backup do banco:
# sem elas os dados cifrados não voltam. Nunca troque depois de gravar cadastros.
PII_ENCRYPTION_ENABLED=true
PII_ENCRYPTION_KEY=$chave_de_cifra
PII_HMAC_KEY=$chave_do_indice

PRECADASTRO_ENABLED=false
ENV
)
chmod 600 "$temporario"
mv "$temporario" "$destino"

echo "Pronto: .env de produção gravado em $destino (só o dono lê)."
echo "  Domínio .............. $dominio"
echo "  Segredos ............. gerados agora; não aparecem aqui (nem no histórico do terminal)"
if [ -n "$segredo_keycloak" ]; then
  echo "  KEYCLOAK_CLIENT_SECRET  preenchido"
else
  echo "  KEYCLOAK_CLIENT_SECRET  VAZIO: preencha antes de subir (Clients > sgcas-web > Credentials)"
fi
echo
echo "IMPORTANTE: copie PII_ENCRYPTION_KEY e PII_HMAC_KEY para um cofre de senhas, fora do servidor"
echo "e longe do backup do banco. Perdê-las torna os dados pessoais cifrados irrecuperáveis."
echo "Próximo passo: README, seção \"Produção\"."
