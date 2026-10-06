// Dočasné zvýraznění rizik v mapě (5. 10. 2026): karta asistenta (nástroj map_risks) uloží položky do sessionStorage
// a pošle událost; editor mapy podle nich obarví uzly (outline přes data-id, nic se nezapisuje do mapy). Platí hodinu
// nebo do „Zrušit zvýraznění“; jen v tomto okně prohlížeče.
const KLIC = (mapId) => `kb-rizika:${mapId}`;
const PLATNOST_MS = 60 * 60 * 1000;
export const BARVY = { po_terminu: '#dc2626', blokuje: '#f97316', nehybe: '#7c3aed', ceka: '#d97706' };
export const PORADI_DRUHU = ['po_terminu', 'blokuje', 'nehybe', 'ceka'];
export function barvaRizika(druhy) {
  for (const d of PORADI_DRUHU) if ((druhy || []).includes(d)) return BARVY[d];
  return BARVY.ceka;
}
const oznam = (mapId) => { try { window.dispatchEvent(new CustomEvent('kb-rizika', { detail: { mapId } })); } catch { /* bez událostí (SSR/test) */ } };
export function ulozRizika(mapId, data) {
  try { sessionStorage.setItem(KLIC(mapId), JSON.stringify({ ...data, ts: Date.now() })); } catch { /* soukromé okno */ }
  oznam(mapId);
}
export function nactiRizika(mapId) {
  try {
    const r = JSON.parse(sessionStorage.getItem(KLIC(mapId)) || 'null');
    if (!r || !Array.isArray(r.items) || Date.now() - (r.ts || 0) > PLATNOST_MS) return null;
    return r;
  } catch { return null; }
}
export function zrusRizika(mapId) {
  try { sessionStorage.removeItem(KLIC(mapId)); } catch { /* nic */ }
  oznam(mapId);
}
