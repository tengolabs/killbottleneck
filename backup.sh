#!/usr/bin/env bash
# Backup / restore of killBottleneck data. Everything (maps, users, uploaded files)
# lives in ./pb_data — this script packs that folder, or restores it from an archive.
#
#   ./backup.sh                 → creates kb-backup-YYYY-MM-DD.tgz
#   ./backup.sh restore FILE    → restores data from the given archive (replaces pb_data)
#
# Messages are English so the script works the same for everyone; `obnovit` is kept
# as an alias for `restore` so older Czech instructions keep working.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ "${1:-}" = "restore" ] || [ "${1:-}" = "obnovit" ]; then
  [ -f "${2:-}" ] || { echo "Usage: ./backup.sh restore kb-backup-....tgz"; exit 1; }
  echo "Stopping killBottleneck…"; docker compose stop
  echo "Restoring data from $2 …"; rm -rf pb_data && tar xzf "$2"
  echo "Starting killBottleneck…"; docker compose start
  echo "Done."
else
  OUT="kb-backup-$(date +%F).tgz"
  tar czf "$OUT" pb_data
  echo "Backup created: $OUT ($(du -h "$OUT" | cut -f1))"
fi
