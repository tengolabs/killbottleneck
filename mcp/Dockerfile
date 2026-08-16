# MCP server killBottlenecku jako kontejner.
#
# ⚠️ NENÍ to obraz aplikace — ten se staví z Dockerfile v kořeni repozitáře.
# Tenhle staví JEN MCP server (mcp/), který mluví po stdio a připojuje se
# k vaší běžící instanci killBottlenecku.
#
# Sestavení a spuštění (z kořene repozitáře):
#   docker build -t killbottleneck-mcp ./mcp
#   docker run -i --rm -e KB_URL=https://firma.killbottleneck.com \
#     -e KB_API_KEY=kb_user_... killbottleneck-mcp
#
# ⚠️ `-i` je POVINNÉ: MCP mluví po standardním vstupu/výstupu, bez něj server
# nemá s kým mluvit. Port se nevystavuje — žádný se neposlouchá.
#
# Bez KB_URL/KB_API_KEY server naběhne a nabídne nástroje; teprve jejich volání
# řekne, co chybí (kvůli klientům a katalogům, které server spouštějí bez konfigurace).
FROM node:22-alpine

WORKDIR /app
# Nejdřív jen manifesty — vrstva s závislostmi se pak nepřestavuje při každé změně kódu.
COPY package.json package-lock.json* ./
# Bez dev závislostí; `npm ci` když je lockfile, jinak install.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY index.js README.md LICENSE ./

# Server nepotřebuje práva roota — node uživatel je v obrazu předpřipravený.
USER node

ENTRYPOINT ["node", "/app/index.js"]
