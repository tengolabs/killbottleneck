# Prostředí pro e2e test aplikace pro Windows na Linuxu: Electron (vývojová stavba z
# product/desktop, připojená jen ke čtení) na virtuální obrazovce Xvfb. Na plochu stroje,
# kde test běží, nic nekreslí. Windows-specifika (upozornění, ikona u hodin, instalace)
# pokrývá smoke test v CI na windows-latest a ruční test na Windows.
FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     xvfb xauth dbus dbus-x11 ca-certificates fonts-dejavu-core \
     libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libatk-bridge2.0-0 libatk1.0-0 \
     libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 \
     libcups2 libatspi2.0-0 libsecret-1-0 libnotify4 \
  && rm -rf /var/lib/apt/lists/*
ENV HOME=/tmp
WORKDIR /app
