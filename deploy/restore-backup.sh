#!/bin/sh
set -eu

backup_file="${1:-}"

if [ "${CONFIRM_RESTORE:-}" != "RESTORE_YAPPER" ]; then
  echo "Restore refused. Set CONFIRM_RESTORE=RESTORE_YAPPER after stopping the bot and backup services." >&2
  exit 1
fi

case "$backup_file" in
  /backups/yapper_*.dump) ;;
  *)
    echo "Usage: restore-backup.sh /backups/yapper_TIMESTAMP.dump" >&2
    exit 1
    ;;
esac

if [ ! -f "$backup_file" ]; then
  echo "Backup does not exist: $backup_file" >&2
  exit 1
fi

: "${POSTGRES_PASSWORD_FILE:?POSTGRES_PASSWORD_FILE is required}"
PGPASSWORD="$(tr -d '\r\n' < "$POSTGRES_PASSWORD_FILE")"
export PGPASSWORD

checksum_file="$backup_file.sha256"
if [ -f "$checksum_file" ]; then
  (cd /backups && sha256sum -c "$(basename "$checksum_file")")
fi

pg_restore --list "$backup_file" >/dev/null
pg_restore \
  --clean \
  --if-exists \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  "$backup_file"

echo "Restore completed successfully. Start the bot and backup services again."
