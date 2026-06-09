#!/usr/bin/env bash
# Dump the Postgres container to a timestamped gzip file and prune old backups.
# Run from the repo root (where docker-compose.prod.yml and .env live), e.g. via cron.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a

BACKUP_DIR="${BACKUP_DIR:-$HOME/job-tracker-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/job_tracker-$STAMP.sql.gz"

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$OUT"

echo "Backup written: $OUT"

# Drop backups older than RETENTION_DAYS.
find "$BACKUP_DIR" -name 'job_tracker-*.sql.gz' -mtime +"$RETENTION_DAYS" -delete
