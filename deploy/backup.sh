#!/usr/bin/env bash
# Nightly backup of Postgres and object storage (KYC files, slips — already encrypted by the app).
# Cron (as root on the VPS):  15 3 * * *  /opt/bankforall/platform/deploy/backup.sh >> /var/log/bankforall-backup.log 2>&1
# Ship $BACKUP_DIR off the machine (e.g. rclone/restic to another provider) — a backup on the same disk is not a backup.
set -euo pipefail
cd "$(dirname "$0")"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/bankforall}
KEEP_DAYS=${KEEP_DAYS:-30}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

$COMPOSE exec -T postgres pg_dump -U bankforall -Fc bankforall > "$BACKUP_DIR/db-$STAMP.dump"
$COMPOSE exec -T s3 sh -c 'tar -C /data -cf - .' | gzip > "$BACKUP_DIR/objects-$STAMP.tar.gz"
find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date -u) backup ok: $STAMP"

# Restore (into a stopped stack):
#   $COMPOSE up -d postgres && $COMPOSE exec -T postgres pg_restore -U bankforall -d bankforall --clean < db-<stamp>.dump
#   gunzip -c objects-<stamp>.tar.gz | $COMPOSE exec -T s3 sh -c 'tar -C /data -xf -'
# Chain data needs no backup: the indexer rebuilds the circle cache from the chain (DEPLOY_BLOCK).
