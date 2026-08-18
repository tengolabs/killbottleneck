import { useEffect, useState } from 'react';
import i18n from 'i18next';

// Líně načítané namespace MIMO jazykový balík (cs.js/en.js). Důvod: lite dieta
// — jazykový balík se celý veze i do /lite (jeden chunk po jazycích, viz
// index.js) a texty košíku/fakturace/účtu tam nemají co dělat; právě ony
// přelily lite přes rozpočet 480 kB (lite-bundle.js, 8. 8. 2026).
// Načítají se OBA jazyky najednou (pár kB) — přepnutí jazyka pak nemusí nic
// dotahovat a loadLanguage v index.js o těchhle ns nemusí vědět.
const LOADERS = {
  billing: {
    cs: () => import('./cs/billing.json'),
    en: () => import('./en/billing.json'),
  },
  // texty stránky Správa organizace — vidí je jen admin a správce struktury,
  // v lite nemají co dělat. ⚠️ Lite má rozpočet 490 kB a je PŘESNĚ na prahu:
  // pár delších vět v hlavním jazykovém balíku ho shodilo už dvakrát
  // (18. 8. 2026). Nové texty správcovské stránky patří sem, ne do auth.json.
  admin: {
    cs: () => import('./cs/admin.json'),
    en: () => import('./en/admin.json'),
  },
  // texty automatizačních pravidel — jen v plném editoru mapy (builder, přehled,
  // šablony), lite je nemá kde použít; mimo jazykový balík kvůli lite dietě
  // (přetáhly by lite přes rozpočet, lite-bundle.js 14. 8. 2026)
  rules: {
    cs: () => import('./cs/rules.json'),
    en: () => import('./en/rules.json'),
  },
};
const nactene = new Set();

export async function ensureNs(ns) {
  if (nactene.has(ns) || !LOADERS[ns]) return;
  const [cs, en] = await Promise.all([LOADERS[ns].cs(), LOADERS[ns].en()]);
  i18n.addResourceBundle('cs', ns, cs.default, true, true);
  i18n.addResourceBundle('en', ns, en.default, true, true);
  nactene.add(ns);
}

// Hook pro komponenty: vrátí true, až je namespace v paměti (do té doby
// komponenta nevykresluje — bliknutí klíčů místo textů je horší než frame
// čekání na pár kB).
export function useLazyNs(ns) {
  const [ready, setReady] = useState(nactene.has(ns));
  useEffect(() => {
    let zivy = true;
    ensureNs(ns).then(() => { if (zivy) setReady(true); });
    return () => { zivy = false; };
  }, [ns]);
  return ready;
}
