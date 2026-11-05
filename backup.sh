#!/usr/bin/env bash
# Backup / restore of killBottleneck data. Everything (maps, users, uploaded files)
# lives in ./pb_data — this script packs that folder, or restores it from an archive.
#
#   ./backup.sh                 → creates kb-backup-YYYY-MM-DD.tgz (consistent even while the instance runs)
#   ./backup.sh restore FILE    → restores data from the given archive (replaces pb_data)
#
# Encryption: export KB_BACKUP_PASSPHRASE and the backup is written as
# kb-backup-YYYY-MM-DD.tgz.gpg (gpg --symmetric, AES256). Keep the passphrase
# outside the repo (env var, password manager) — a lost passphrase means the
# archive cannot be opened by anyone, including you. Restore accepts both plain
# .tgz and .tgz.gpg archives, so older unencrypted backups keep working.
#
# Messages are English so the script works the same for everyone; `obnovit` is kept
# as an alias for `restore` so older Czech instructions keep working.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ "${1:-}" = "restore" ] || [ "${1:-}" = "obnovit" ]; then
  [ -f "${2:-}" ] || { echo "Usage: ./backup.sh restore kb-backup-....tgz[.gpg]"; exit 1; }
  ARCHIVE="$2"
  DECRYPTED=""
  if [ "${ARCHIVE%.gpg}" != "${ARCHIVE}" ]; then
    DECRYPTED="pb_data.restore-tmp.tgz"
    rm -f "$DECRYPTED"
    echo "Decrypting $ARCHIVE …"
    if [ -n "${KB_BACKUP_PASSPHRASE:-}" ]; then
      # --passphrase-fd keeps the passphrase out of `ps` output, unlike --passphrase
      gpg --batch --yes --passphrase-fd 3 -o "$DECRYPTED" -d "$ARCHIVE" 3<<<"${KB_BACKUP_PASSPHRASE}"
    else
      gpg --yes -o "$DECRYPTED" -d "$ARCHIVE"
    fi
    ARCHIVE="$DECRYPTED"
  fi
  # The live data must never be deleted before the archive has proven itself:
  # a corrupted download or a hand-crafted archive (absolute paths, ..) would
  # otherwise take the running instance's data with it. So: list & check first,
  # unpack next to the live folder, and only then swap the folders.
  echo "Checking archive $2 …"
  LIST=$(tar tzf "$ARCHIVE")
  BAD=$(printf '%s\n' "$LIST" | awk '$0 !~ /^pb_data(\/|$)/ || /(^|\/)\.\.(\/|$)/')
  # Symbolic links have no business in a data folder: PocketBase runs as root inside the
  # container and would follow them (storage/<x> -> ../../data.db), so a hand-crafted archive is refused.
  LINKS=$(tar tvzf "$ARCHIVE" | awk '$1 ~ /^[lh]/')
  if [ -n "$BAD" ] || [ -n "$LINKS" ]; then
    echo "Refusing to restore: archive contains entries outside pb_data/ or symbolic links:" >&2
    printf '%s\n' "$BAD" "$LINKS" | sed -n '1,5p' >&2
    [ -z "$DECRYPTED" ] || rm -f "$DECRYPTED"
    exit 1
  fi
  STAGE="pb_data.restore-tmp"
  rm -rf "$STAGE"; mkdir -m 700 "$STAGE"
  tar xzf "$ARCHIVE" -C "$STAGE" --no-same-owner
  [ -d "$STAGE/pb_data" ] || { echo "Refusing to restore: archive has no pb_data folder." >&2; rm -rf "$STAGE"; [ -z "$DECRYPTED" ] || rm -f "$DECRYPTED"; exit 1; }
  # The database must prove itself too, still before the live data is touched: an archive
  # taken by an older version of this script from a running instance can carry a silently
  # broken index (see the backup branch below), and PocketBase would start on it without a
  # word. sqlite3 comes from the instance image (same one as the snapshot), the live
  # instance keeps running meanwhile.
  if [ -f "$STAGE/pb_data/data.db" ]; then
    IMG=$(docker compose images -q killbottleneck 2>/dev/null | head -n1)
    [ -n "$IMG" ] || IMG=$(docker compose config --images 2>/dev/null | head -n1)
    echo "Checking database integrity …"
    # stderr apart from the result: a docker warning (platform, pull) must not make a sound archive look damaged
    CHECK=$(docker run --rm -v "$PWD/$STAGE/pb_data:/d" "$IMG" sqlite3 /d/data.db "PRAGMA integrity_check;" \
      "SELECT name FROM sqlite_master WHERE type='table' AND name='_collections';" 2>"$STAGE/.check-err") && RC=0 || RC=$?
    [ "$RC" -lt 125 ] || CHECK=$(tail -n1 "$STAGE/.check-err" 2>/dev/null)
    if [ "$RC" -ge 125 ]; then
      # docker could not run the check (no image yet, or an image without sqlite3) — say so, go on as before
      echo "Warning: could not check the database (${CHECK##*$'\n'}) — restoring unchecked." >&2
    elif [ "$RC" -ne 0 ] || [ "$CHECK" != "$(printf 'ok\n_collections')" ]; then
      echo "Refusing to restore: the archive's database is damaged or not a killBottleneck database:" >&2
      printf '%s\n' "$CHECK" | sed -n '1,5p' >&2
      echo "Live data untouched. Try an older backup." >&2
      rm -rf "$STAGE"; [ -z "$DECRYPTED" ] || rm -f "$DECRYPTED"
      exit 1
    fi
  fi
  echo "Stopping killBottleneck…"; docker compose stop
  echo "Restoring data from $2 …"
  rm -rf pb_data.old
  [ ! -e pb_data ] || mv pb_data pb_data.old
  mv "$STAGE/pb_data" pb_data
  rm -rf "$STAGE"
  [ -z "$DECRYPTED" ] || rm -f "$DECRYPTED"
  echo "Starting killBottleneck…"; docker compose start
  echo "Done. Previous data kept in pb_data.old — delete it once you have checked the restore."
else
  OUT="kb-backup-$(date +%F).tgz"
  # PocketBase keeps its SQLite databases in WAL mode, so a plain tar of a RUNNING instance
  # reads data.db and data.db-wal at different moments. Under write load 4 of 35 such
  # archives had a broken primary-key index (count(*) fine, record by id gone) and nothing
  # noticed — not the backup, not the restore (code analysis 3, S8-09, 4 Nov 2026). While
  # the container runs, the databases are therefore snapshotted with sqlite3 ".backup"
  # (one consistent moment, no -wal/-shm) and packed from a staging folder together with
  # the rest of pb_data. The archive keeps the pb_data/… layout, so old archives restore
  # the same way. A stopped container writes nothing — plain tar is fine then.
  TARDIR="."
  STAGE=""
  SNAP=".kb-backup-snapshot"   # inside the volume: the container writes it, the host only reads it
  # Clean up whatever this run left behind — the staging folder on the host and the snapshot
  # inside the volume (a failed cp/tar would otherwise leave a second full copy of the database there).
  uklid() {
    [ -z "$STAGE" ] || rm -rf "$STAGE"
    [ ! -e "pb_data/$SNAP" ] || docker compose exec -T killbottleneck rm -rf "/app/pb_data/$SNAP" 2>/dev/null || rm -rf "pb_data/$SNAP" 2>/dev/null || true
  }
  trap uklid EXIT
  if [ -n "$(docker compose ps --status running -q killbottleneck 2>/dev/null)" ]; then
    STAGE="pb_data.backup-tmp"
    rm -rf "$STAGE"; mkdir -m 700 "$STAGE"; mkdir "$STAGE/pb_data"
    echo "Taking a consistent database snapshot (the instance keeps running) …"
    docker compose exec -T killbottleneck sh -c "rm -rf /app/pb_data/$SNAP && mkdir /app/pb_data/$SNAP \
        && sqlite3 /app/pb_data/data.db \".backup '/app/pb_data/$SNAP/data.db'\" \
        && { [ ! -f /app/pb_data/auxiliary.db ] || sqlite3 /app/pb_data/auxiliary.db \".backup '/app/pb_data/$SNAP/auxiliary.db'\"; }" \
      || { echo "Snapshot failed — an image older than 4 Nov 2026 has no sqlite3; rebuild with: docker compose up -d --build" >&2; exit 1; }
    # Everything else (uploaded files in storage/, …) goes next to the snapshot: hard links
    # where the system allows them (no second copy of the uploads), a real copy otherwise.
    for f in pb_data/* pb_data/.[!.]*; do
      [ -e "$f" ] || continue
      case "${f#pb_data/}" in data.db|data.db-*|auxiliary.db|auxiliary.db-*|"$SNAP") continue;; esac
      cp -al "$f" "$STAGE/pb_data/" 2>/dev/null || { rm -rf "$STAGE/pb_data/${f#pb_data/}"; cp -a "$f" "$STAGE/pb_data/"; }
    done
    cp "pb_data/$SNAP"/*.db "$STAGE/pb_data/"
    docker compose exec -T killbottleneck rm -rf "/app/pb_data/$SNAP" || rm -rf "pb_data/$SNAP" || true
    TARDIR="$STAGE"
  fi
  if [ -n "${KB_BACKUP_PASSPHRASE:-}" ]; then
    OUT="${OUT}.gpg"
    tar cz -C "$TARDIR" pb_data | gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase-fd 3 -o "$OUT" 3<<<"${KB_BACKUP_PASSPHRASE}"
  else
    tar czf "$OUT" -C "$TARDIR" pb_data
    echo "Note: the archive is NOT encrypted — export KB_BACKUP_PASSPHRASE to encrypt backups."
  fi
  chmod 600 "$OUT"
  echo "Backup created: $OUT ($(du -h "$OUT" | cut -f1))"
fi
