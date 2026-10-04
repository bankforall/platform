#!/usr/bin/env bash
# Nightly encrypted backup of Postgres and object storage (KYC files and slips are additionally
# encrypted by the app). Requires BACKUP_PASSPHRASE in .env.production — keep a copy off this server.
# Cron (as root on the VPS):  15 3 * * *  /opt/bankforall/platform/deploy/backup.sh >> /var/log/bankforall-backup.log 2>&1
# Ship $BACKUP_DIR off the machine (rclone/restic to another provider): a backup on the same disk is not a backup.
set -euo pipefail
umask 077
cd "$(dirname "$0")"
BACKUP_DIR=${BACKUP_DIR:-/var/backups/bankforall}
KEEP_DAYS=${KEEP_DAYS:-30}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
PASSPHRASE=$(grep -E '^BACKUP_PASSPHRASE=' .env.production | cut -d= -f2-)
[ -n "$PASSPHRASE" ] || { echo "BACKUP_PASSPHRASE is not set in .env.production" >&2; exit 1; }
export PASSPHRASE
mkdir -p "$BACKUP_DIR"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"
encrypt() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:PASSPHRASE -out "$1"; }

$COMPOSE exec -T postgres pg_dump -U bankforall -Fc bankforall | encrypt "$BACKUP_DIR/db-$STAMP.dump.enc"
$COMPOSE exec -T s3 sh -c 'tar -C /data -cf - .' | gzip | encrypt "$BACKUP_DIR/objects-$STAMP.tar.gz.enc"
find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date -u) backup ok: $STAMP"

# Restore (into a stopped stack):
#   decrypt() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:PASSPHRASE -in "$1"; }
#   $COMPOSE up -d postgres && decrypt db-<stamp>.dump.enc | $COMPOSE exec -T postgres pg_restore -U bankforall -d bankforall --clean
#   decrypt objects-<stamp>.tar.gz.enc | gunzip | $COMPOSE exec -T s3 sh -c 'tar -C /data -xf -'
# Chain data needs no backup: the indexer rebuilds the circle cache from the chain (DEPLOY_BLOCK).
