# killBottleneck — jeden kontejner: PocketBase (API + DB + auth) servíruje i frontend
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM alpine:3.22
# PocketBase: 0.39.6 → 0.39.11 kvůli CVE-2026-82410 (GHSA-84vh-m24q-wjjx, „high“ —
# panika ve worker gorutině umí shodit server; oprava v 0.39.7, 0.39.11 je poslední
# v řadě). Audit 14. 10. 2026, nález S1. PB_SHA256 = sha256 linux_amd64 ZIPu z
# oficiálního checksums.txt — stažené se proti němu ověří (dřív bez kontroly; nález S11).
ARG PB_VERSION=0.39.11
ARG PB_SHA256=08b9fcda0d5fd42cb315dc15a36dfa121c993855bd635f01d347c31b4328ec34
# tzdata: aby TZ env (napr. Europe/Prague) fungovalo — cron auto_templates zaklada
# projekty v lokalni cas klienta (jinak alpine bez tzdata spadne zpet na UTC).
RUN apk add --no-cache ca-certificates unzip tzdata \
  && wget -q https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip -O /tmp/pb.zip \
  && echo "${PB_SHA256}  /tmp/pb.zip" | sha256sum -c - \
  && unzip /tmp/pb.zip -d /app \
  && rm /tmp/pb.zip && apk del unzip

WORKDIR /app
# Verze instance. Razítkuje ji build-image.sh z gitového tagu; bez ní ("dev")
# frontend hlídání nových verzí vůbec nenabídne — ať vývojový build nehlásí,
# že je zastaralý.
ARG KB_VERSION=dev
ENV KB_VERSION=${KB_VERSION}
COPY server/pb_migrations ./pb_migrations
COPY server/pb_hooks ./pb_hooks
COPY --from=frontend /build/dist ./pb_public

EXPOSE 8090
VOLUME /app/pb_data
# --automigrate=0: schéma se mění JEN přes verzované migrace v pb_migrations. Bez toho
# PocketBase generuje migrační soubory při změnách kolekcí (i z admin UI), ty po rebuildu
# image zmizí, ale v evidenci _migrations zůstanou jako aplikované — a taková osiřelá
# entry pak blokuje aplikaci dalších reálných migrací (naráželi jsme na to u C2).
CMD ["/app/pocketbase", "serve", "--http=0.0.0.0:8090", "--automigrate=0"]
