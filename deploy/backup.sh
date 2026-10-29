#!/usr/bin/env bash
# Backup do banco (PostgreSQL) e dos anexos (RG, comprovantes) do SGCAS.
#
#   deploy/backup.sh [PASTA_DE_DESTINO]        (padrão: ~/backups-sgcas)
#
# Cria dois arquivos com a data no nome: banco-AAAAMMDD-HHMMSS.sql.gz e anexos-AAAAMMDD-HHMMSS.tar.gz,
# confere que ficaram íntegros e apaga os backups com mais de 30 dias (SGCAS_BACKUP_DIAS muda isso).
# Rode na máquina do servidor, de qualquer pasta. Para agendar todo dia às 2h da manhã:
#
#   0 2 * * *  /caminho/do/projeto/deploy/backup.sh /caminho/dos/backups >> /var/log/sgcas-backup.log 2>&1
#
# O QUE NÃO ENTRA, DE PROPÓSITO: o .env e as chaves de cifragem (PII_ENCRYPTION_KEY e PII_HMAC_KEY).
# Os dados pessoais do banco são cifrados; um backup guardado junto com as chaves anularia a cifragem.
# Guarde as chaves em outro lugar (um cofre de senhas): sem elas este backup não devolve CPF, RG, e-mail...
#
# Copie os arquivos para FORA do servidor (outra máquina ou nuvem): backup no mesmo disco não protege
# de disco queimado nem de ransomware. Treine a restauração (README, seção "Backup e restauração").
set -euo pipefail

command -v docker >/dev/null 2>&1 || { echo "O Docker não está instalado ou não está no PATH." >&2; exit 1; }

raiz="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destino="${1:-$HOME/backups-sgcas}"
dias="${SGCAS_BACKUP_DIAS:-30}"
agora="$(date +%Y%m%d-%H%M%S)"

umask 077
mkdir -p "$destino"
chmod 700 "$destino"
cd "$raiz/api-sgcas"

# ── banco ────────────────────────────────────────────────────────
banco="$destino/banco-$agora.sql.gz"
# O usuário e o nome do banco vêm de dentro do container: não depende do .env do servidor.
if ! docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' | gzip > "$banco.parcial"; then
  rm -f "$banco.parcial"
  echo "FALHOU: não consegui copiar o banco (o container do PostgreSQL está de pé? docker compose ps)." >&2
  exit 1
fi
# Um dump completo termina com essa linha: sem ela o arquivo foi cortado no meio.
if ! gzip -dc "$banco.parcial" | tail -n 5 | grep -q "PostgreSQL database dump complete"; then
  rm -f "$banco.parcial"
  echo "FALHOU: o backup do banco saiu incompleto e foi descartado." >&2
  exit 1
fi
mv "$banco.parcial" "$banco"

# ── anexos ───────────────────────────────────────────────────────
api="$(docker compose ps -a -q api)"
volume=""
if [ -n "$api" ]; then
  volume="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/armazenamento"}}{{.Name}}{{end}}{{end}}' "$api")"
fi
if [ -z "$volume" ]; then
  echo "FALHOU: não achei o volume dos anexos (o container da API existe? docker compose ps -a)." >&2
  exit 1
fi
anexos="$destino/anexos-$agora.tar.gz"
if ! docker run --rm -v "$volume":/dados:ro -v "$destino":/backup alpine sh -c \
  "tar czf /backup/anexos-$agora.tar.gz.parcial -C /dados . && chown $(id -u):$(id -g) /backup/anexos-$agora.tar.gz.parcial && chmod 600 /backup/anexos-$agora.tar.gz.parcial"; then
  rm -f "$anexos.parcial"
  echo "FALHOU: não consegui copiar os anexos." >&2
  exit 1
fi
if ! tar tzf "$anexos.parcial" >/dev/null 2>&1; then
  rm -f "$anexos.parcial"
  echo "FALHOU: o backup dos anexos saiu corrompido e foi descartado." >&2
  exit 1
fi
mv "$anexos.parcial" "$anexos"

# ── retenção ─────────────────────────────────────────────────────
apagados="$(find "$destino" -maxdepth 1 -type f \( -name 'banco-*.sql.gz' -o -name 'anexos-*.tar.gz' \) -mtime +"$dias" -print -delete | wc -l)"

echo "Backup concluído em $destino:"
echo "  $(basename "$banco")   $(du -h "$banco" | cut -f1)"
echo "  $(basename "$anexos")  $(du -h "$anexos" | cut -f1)"
echo "  apagados por terem mais de $dias dias: $apagados"
echo "Lembrete: as chaves PII_* não estão aqui (de propósito). Guarde-as num cofre, fora do servidor."
