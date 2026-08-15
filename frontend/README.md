# killBottleneck — frontend

React (Vite) frontend produktu killBottleneck. Běží proti lokálnímu PocketBase backendu
(`../server`) přes adaptér `src/api/base44Client.js` — stejné rozhraní jako Base44 SDK,
takže velké komponenty zůstaly beze změny.

## Vývoj

```bash
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

Vite proxy (`vite.config.js`) posílá `/api/*` na běžící backend (`127.0.0.1:8090`).
Nastartujte tedy nejdřív backend: `cd .. && docker compose up -d`.

## Build

Produkční build (`npm run build`) vzniká automaticky v Dockeru — viz `../Dockerfile`,
který výsledek kopíruje do `server/pb_public`. Ručně stavět netřeba.

Zákaznická instalace a konfigurace: viz `../README.md`.
