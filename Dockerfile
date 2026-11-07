# killBottleneck — one container: PocketBase (API + DB + auth) also serves the frontend
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM alpine:3.22
# PocketBase: 0.39.6 → 0.39.11 because of CVE-2026-82410 (GHSA-84vh-m24q-wjjx, "high" —
# a panic in a worker goroutine can bring the server down; fixed in 0.39.7, 0.39.11 is the
# last of the line). Security audit 14 Oct 2026, finding S1. PB_SHA256 = sha256 of the
# linux_amd64 ZIP from the official checksums.txt — the download is verified against it.
ARG PB_VERSION=0.39.11
ARG PB_SHA256=08b9fcda0d5fd42cb315dc15a36dfa121c993855bd635f01d347c31b4328ec34
# tzdata: so that the TZ env (e.g. Europe/Prague) works — the auto_templates cron creates
# projects in the client's local time (without tzdata alpine falls back to UTC).
RUN apk add --no-cache ca-certificates unzip tzdata sqlite \
  && wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip -O /tmp/pb.zip \
  && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
  && unzip /tmp/pb.zip -d /app \
  && rm /tmp/pb.zip && apk del unzip

WORKDIR /app
# Instance version. Stamped by build-image.sh from the git tag; without it ("dev")
# the frontend does not offer the new-version check at all — a development build
# must not report itself as outdated.
ARG KB_VERSION=dev
ENV KB_VERSION=${KB_VERSION}
COPY server/pb_migrations ./pb_migrations
COPY server/pb_hooks ./pb_hooks
COPY --from=frontend /build/dist ./pb_public
# License texts travel with every copy (MIT + third-party list): the instance serves them
# at /LICENSE.txt and /THIRD-PARTY-LICENSES.txt and the About dialog links to both.
COPY LICENSE ./pb_public/LICENSE.txt
COPY THIRD-PARTY-LICENSES.md ./pb_public/THIRD-PARTY-LICENSES.txt

EXPOSE 8090
VOLUME /app/pb_data
# --automigrate=0: the schema changes ONLY through versioned migrations in pb_migrations.
# Without it PocketBase generates migration files on collection changes (admin UI too); they
# vanish after an image rebuild but stay recorded in _migrations as applied — and such an
# orphaned entry then blocks the real migrations that follow.
CMD ["/app/pocketbase", "serve", "--http=0.0.0.0:8090", "--automigrate=0"]
