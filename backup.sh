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
  # The live data must never be deleted before the archive has proven itself:
  # a corrupted download or a hand-crafted archive (absolute paths, ..) would
  # otherwise take the running instance's data with it. So: list & check first,
  # unpack next to the live folder, and only then swap the folders.
  echo "Checking archive $2 …"
  LIST=$(tar tzf "$2")
  BAD=$(printf '%s\n' "$LIST" | awk '$0 !~ /^pb_data(\/|$)/ || /(^|\/)\.\.(\/|$)/')
  if [ -n "$BAD" ]; then
    echo "Refusing to restore: archive contains entries outside pb_data/:" >&2
    printf '%s\n' "$BAD" | sed -n '1,5p' >&2
    exit 1
  fi
  STAGE="pb_data.restore-tmp"
  rm -rf "$STAGE"; mkdir "$STAGE"
  tar xzf "$2" -C "$STAGE" --no-same-owner
  [ -d "$STAGE/pb_data" ] || { echo "Refusing to restore: archive has no pb_data folder." >&2; rm -rf "$STAGE"; exit 1; }
  echo "Stopping killBottleneck…"; docker compose stop
  echo "Restoring data from $2 …"
  rm -rf pb_data.old
  [ ! -e pb_data ] || mv pb_data pb_data.old
  mv "$STAGE/pb_data" pb_data
  rm -rf "$STAGE"
  echo "Starting killBottleneck…"; docker compose start
  echo "Done. Previous data kept in pb_data.old — delete it once you have checked the restore."
else
  OUT="kb-backup-$(date +%F).tgz"
  tar czf "$OUT" pb_data
  echo "Backup created: $OUT ($(du -h "$OUT" | cut -f1))"
fi
