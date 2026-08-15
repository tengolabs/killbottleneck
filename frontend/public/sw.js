/* Service worker — kvůli tomu, aby se FlowMap dal přidat na plochu telefonu
 * a aby se poslední „Můj den" dal přečíst i bez signálu.
 *
 * ZÁMĚRNĚ MINIMÁLNÍ. Tři pravidla a nic víc:
 *   1) hashované soubory z /assets/ = cache-first (jméno nese hash, nikdy se nemění),
 *   2) navigace a index.html = network-first, cache jen jako záchrana offline
 *      (jinak by po nasazení lidem zůstala stará appka — server proto index
 *      taky zakazuje cachovat, viz pb_hooks/main.pb.js),
 *   3) GET /api/kb/my-day = network-first s uloženou poslední odpovědí,
 *      takže offline vidím poslední stav místo prázdné obrazovky.
 *
 * ZÁPIS OFFLINE SE NEŘEŠÍ. Fronta změn a řešení konfliktů je přesně ten druh
 * složitosti, kvůli které nástroje ztloustnou — a lite režim je o opaku.
 * Bez signálu se akce prostě nepovede a uživatel to pozná hned.
 */
// ⚠️ Zvednout při KAŽDÉ výměně souboru, který se cachuje jménem bez hashe —
// tedy /icon-*.png a manifest. Aktivace maže všechny cache s jinou verzí,
// takže bez zvednutí by lidem s nainstalovanou PWA zůstala stará ikona napořád
// (pravidlo /icon-* je cache-first). v2 = nasazení značky killBottleneck 2026-08-04.
const VERSION = 'v2';
const SHELL = `kb-shell-${VERSION}`;
const DATA = `kb-data-${VERSION}`;

self.addEventListener('install', (e) => {
  self.skipWaiting(); // nová verze nesmí čekat na zavření všech karet
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest'])).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const cacheFirst = async (req) => {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
  return res;
};

const networkFirst = async (req, cacheName, fallbackReq) => {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(fallbackReq || req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(fallbackReq || req);
    if (hit) return hit;
    throw err;
  }
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // zápisy jdou vždy rovnou na server
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req, SHELL, new Request('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icon-')) {
    e.respondWith(cacheFirst(req));
    return;
  }
  // PŘECHOD: service worker může běžet ze staré verze i po aktualizaci,
  // proto zná obě cesty — jinak by offline „Můj den" po vydání zmizel
  if (url.pathname === '/api/kb/my-day' || url.pathname === '/api/flowmap/my-day') {
    // klíč bez ?today= — offline chceme poslední známý stav, ne miss kvůli datu
    e.respondWith(networkFirst(req, DATA, new Request(url.origin + url.pathname)));
  }
});
