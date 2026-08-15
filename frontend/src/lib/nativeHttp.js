// HTTP na CIZÍ origin z nativního obalu. WebView má origin http://localhost,
// který veřejná API (kb-signup) v CORS whitelistu nemají — fetch by spadl na
// preflightu. CapacitorHttp jde nativní vrstvou, kde CORS neexistuje.
//
// ⚠️ NEZAPÍNAT `CapacitorHttp.enabled` v capacitor.config.json — globální
// patch fetch/XHR by prohnal nativní vrstvou i PocketBase a rozbil realtime
// (SSE). Plugin se volá přímo a jen tady.
//
// Mimo obal (web, testy) se použije obyčejný fetch — Puppeteer sady si tak
// můžou endpoint podvrhnout přes request interception.
import { isNativeShell } from '@/lib/nativeShell';

const parseData = (data) => {
  if (typeof data !== 'string') return data || {};
  try { return JSON.parse(data); } catch { return {}; }
};

// Mrtvá síť nesmí nechat uživatele koukat na spinner donekonečna —
// stejná filozofie jako 8s probe v ServerPickeru, tady velkoryseji (POST).
const TIMEOUT_MS = 15000;

// POST JSON → { status, data }. Nehází na 4xx/5xx (chybové texty se čtou
// z těla odpovědi); hází jen na síťovou chybu / nedostupnost / timeout.
export const postJson = async (url, body) => {
  if (isNativeShell() && window.Capacitor?.isPluginAvailable?.('CapacitorHttp')) {
    const { CapacitorHttp } = await import('@capacitor/core');
    const res = await CapacitorHttp.post({
      url,
      headers: { 'Content-Type': 'application/json' },
      data: body,
      connectTimeout: TIMEOUT_MS,
      readTimeout: TIMEOUT_MS,
    });
    return { status: res.status, data: parseData(res.data) };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  } finally {
    clearTimeout(timer);
  }
};
