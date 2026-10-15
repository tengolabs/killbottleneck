// Aplikace pro Windows (product/desktop): napojení stránky na rám. Načítá se líně jen
// uvnitř aplikace (main.jsx), web v prohlížeči si tenhle chunk nikdy nestáhne.
// Upozornění Windows a počet nepřečtených hlídá rám SÁM (funguje i se staršími servery);
// tady jsou jen věci, které bez stránky nejdou:
//  · uložení rozdělané mapy, než rám okno zavře, přepne organizaci nebo stránku obnoví;
//  · klik na upozornění → otevřít, kam notifikace vede, a označit ji přečtenou.
// Smlouva s rámem je window.kbDesktop (product/desktop/preload.cjs, api 1).
import { base44 } from '@/api/base44Client';
import { notifyTarget } from '@/lib/notifyMeta';

const STROP_ULOZENI_MS = 3000;

// Rám → „ulož, co máš“. Ukladače (useMapAutosave) se přihlásí přes událost
// `kb-desktop-flush` voláním e.detail.wait(promise) — událost vzniká TADY, ve světě
// stránky, takže detail je pro ně čitelný (z preloadu by nebyl).
async function ulozRozdelane(kbDesktop) {
  const cekam = [];
  window.dispatchEvent(new CustomEvent('kb-desktop-flush', {
    detail: { wait: (p) => { cekam.push(Promise.resolve(p).catch(() => {})); } },
  }));
  await Promise.race([
    Promise.all(cekam),
    new Promise((hotovo) => { setTimeout(hotovo, STROP_ULOZENI_MS); }),
  ]);
  kbDesktop.flushDone();
}

// Přechod uvnitř webu bez znovunačtení (BrowserRouter reaguje na popstate).
function prejdi(cesta) {
  if (typeof cesta !== 'string' || !cesta.startsWith('/') || cesta.startsWith('//')) return;
  window.history.pushState(null, '', cesta);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

async function otevriNotifikaci(kbDesktop) {
  const pozadavek = kbDesktop.takeOpenRequest();
  if (!pozadavek || !pozadavek.id) return;
  try {
    const n = await base44.entities.Notification.get(pozadavek.id);
    if (!n) return prejdi('/notifications');
    if (!n.read) base44.entities.Notification.update(n.id, { read: true }).catch(() => {});
    return prejdi(notifyTarget(n));
  } catch {
    return prejdi('/notifications');
  }
}

export function initDesktopApp() {
  const kbDesktop = window.kbDesktop;
  if (!kbDesktop || kbDesktop.api < 1) return;
  window.addEventListener('kb-desktop-flush-request', () => { ulozRozdelane(kbDesktop); });
  window.addEventListener('kb-desktop-open', () => { otevriNotifikaci(kbDesktop); });
  kbDesktop.supportsFlush();
}
