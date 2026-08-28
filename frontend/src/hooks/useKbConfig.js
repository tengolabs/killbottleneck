import { useState, useEffect } from 'react';
import { pb } from '@/api/pb';

// /api/kb/config — JEDEN loader pro celou aplikaci (analýza kódu 27. 8. 2026, F2-03:
// 17 nezávislých míst, na jedno načtení Home až 6 GET na tentýž endpoint, tři
// hooky se třemi strategiemi cache). Vzor = `base44.org.get`: sdílí se ROZPRACOVANÝ
// slib, chyba se nedrží (příště se zkusí znovu), zápisy, které config mění,
// volají `invalidateKbConfig()` a všechny přihlášené komponenty se překreslí.
//
// ⚠️ Cache je jen v paměti (ne localStorage) a část odpovědi závisí na
// přihlášení (`purpose` jen s e.auth) — AuthContext ji zahazuje při přihlášení
// i odhlášení, stejně jako `org.forget()`.
let slib = null;
let cached = null;
const listeners = new Set();

function publish(cfg) {
  cached = cfg;
  for (const fn of listeners) fn(cfg);
}

// Slib s aktuálním configem; `fresh: true` obejde cache (ruční obnova).
export function loadKbConfig({ fresh = false } = {}) {
  if (fresh || !slib) {
    // `p` vs `slib`: starší odpověď (např. nepřihlášený dotaz z Login před forgetKbConfig,
    // nebo GET rozběhnutý před invalidateKbConfig) nesmí přepsat novější cache ani
    // probudit posluchače zastaralým stavem (nález panelu 28. 8. 2026).
    const p = pb.send('/api/kb/config', { method: 'GET' })
      .then((cfg) => { if (slib === p) publish(cfg || {}); return cfg || {}; })
      .catch((err) => { if (slib === p) slib = null; throw err; });
    slib = p;
  }
  return slib;
}

// Po zápisu, který config mění (účel, registrace, AI nastavení, odhlášení):
// zahodí cache a rovnou načte znovu — komponenty dostanou nový stav bez reloadu.
export function invalidateKbConfig() {
  slib = null;
  cached = null;
  return loadKbConfig().catch(() => null);
}

// Jen zapomenout (odhlášení) — bez dalšího dotazu.
export function forgetKbConfig() {
  slib = null;
  cached = null;
}

// { config, error } — config je null, dokud nedorazí (nebo při chybě, pak error=true).
// `aktivni=false` = neptat se (lazy sekce).
export function useKbConfig(aktivni = true) {
  const [config, setConfig] = useState(cached);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!aktivni) return undefined;
    let zivy = true;
    listeners.add(setConfig);
    loadKbConfig()
      .then((c) => { if (zivy) { setConfig(c); setError(false); } })
      .catch(() => { if (zivy) setError(true); });
    return () => { zivy = false; listeners.delete(setConfig); };
  }, [aktivni]);
  return { config, error };
}
