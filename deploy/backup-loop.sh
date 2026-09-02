#!/bin/sh
set -eu

require_positive_integer() {
  variable_name="$1"
  eval "variable_value=\${$variable_name:-}"

  case "$variable_value" in
    ""|*[!0-9]*)
      echo "$variable_name must be a positive whole number." >&2
      exit 1
      ;;
    0)
      echo "$variable_name must be greater than zero." >&2
      exit 1
      ;;
  esac
}

: "${POSTGRES_HOST:?POSTGRES_HOST is required}"
: "${POSTGRES_PORT:?POSTGRES_PORT is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD_FILE:?POSTGRES_PASSWORD_FILE is required}"
: "${BACKUP_INTERVAL_SECONDS:?BACKUP_INTERVAL_SECONDS is required}"
: "${BACKUP_RETENTION_DAYS:?BACKUP_RETENTION_DAYS is required}"

require_positive_integer BACKUP_INTERVAL_SECONDS
require_positive_integer BACKUP_RETENTION_DAYS

PGPASSWORD="$(tr -d '\r\n' < "$POSTGRES_PASSWORD_FILE")"
export PGPASSWORD

create_backup() {
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  temporary_file="/backups/.yapper_${timestamp}.dump.tmp"
  backup_file="/backups/yapper_${timestamp}.dump"

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Creating PostgreSQL backup."
  rm -f "$temporary_file"

  if ! pg_dump \
    --host "$POSTGRES_HOST" \
    --port "$POSTGRES_PORT" \
    --username "$POSTGRES_USER" \
    --dbname "$POSTGRES_DB" \
    --format custom \
    --compress 6 \
    --exclude-table-data personal_journal_sessions \
    --exclude-table-data personal_journal_messages \
    --file "$temporary_file"; then
    rm -f "$temporary_file"
    return 1
  fi

  if ! pg_restore --list "$temporary_file" >/dev/null; then
    echo "Backup validation failed; incomplete file removed." >&2
    rm -f "$temporary_file"
    return 1
  fi

  mv "$temporary_file" "$backup_file"
  (
    cd /backups
    sha256sum "$(basename "$backup_file")" > "$(basename "$backup_file").sha256"
  )

  find /backups -type f -name 'yapper_*.dump' -mtime "+$BACKUP_RETENTION_DAYS" -delete
  find /backups -type f -name 'yapper_*.dump.sha256' -mtime "+$BACKUP_RETENTION_DAYS" -delete
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup ready: $backup_file"
}

if [ "${1:-loop}" = "once" ]; then
  create_backup
  exit 0
fi

while :; do
  if ! create_backup; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup failed; retrying after the normal interval." >&2
  fi

  sleep "$BACKUP_INTERVAL_SECONDS"
done
