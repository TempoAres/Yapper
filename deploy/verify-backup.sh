#!/bin/sh
set -eu

backup_file="${1:-}"

case "$backup_file" in
  /backups/yapper_*.dump) ;;
  *)
    echo "Usage: verify-backup.sh /backups/yapper_TIMESTAMP.dump" >&2
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

verification_database="yapper_verify_$(date -u +%Y%m%d%H%M%S)_$$"

drop_verification_database() {
  dropdb \
    --if-exists \
    --host "$POSTGRES_HOST" \
    --port "$POSTGRES_PORT" \
    --username "$POSTGRES_USER" \
    "$verification_database" >/dev/null 2>&1 || true
}

trap drop_verification_database EXIT INT TERM

createdb \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  "$verification_database"

pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$verification_database" \
  "$backup_file"

member_count="$(psql \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$verification_database" \
  --tuples-only \
  --no-align \
  --command 'SELECT COUNT(*) FROM guild_members;')"

echo "Backup restored successfully into a temporary database ($member_count member rows)."
echo "The temporary verification database will now be removed."
