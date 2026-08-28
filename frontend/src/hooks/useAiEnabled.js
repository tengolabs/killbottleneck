import { useState, useEffect } from 'react';
import { loadKbConfig } from '@/hooks/useKbConfig';

// Stav AI zástrčky ze serveru (/api/kb/config).
// ai_modes = tarifní gating per funkce (questions/generate/expand/chat/from_text/transcribe);
// server (gateway) módy vynucuje tak jako tak — tady jde jen o schování tlačítek.
//
// ⚠️ Rozlišujeme DVĚ různé věci, které se dřív mylně slévaly do „enabled":
//   - `configured` = admin AI zapnul (provider ≠ none),
//   - `healthy`    = služba právě odpovídá.
// V hostovaném provozu běží AI u nás doma, appka na pronajatém boxu — výpadek
// domácí strany je normální provozní stav, ne chyba zákazníka. Když je AI dole,
// vyprázdníme `modes`, takže se všechna AI tlačítka schovají sama (těží z toho
// všech 7 míst, co hook používají), a `healthy:false` dovolí jednomu místu
// slušně vysvětlit proč.
const EMPTY = { enabled: false, configured: false, provider: 'none', modes: [], healthy: true };
let cached = null;
const listeners = new Set();
let recheckTimer = null;

function publish(next) {
  cached = next;
  for (const fn of listeners) fn(cached);
  // Dokud je služba dole, tiše se doptáváme — až se vrátí, tlačítka naskočí
  // sama, bez reloadu stránky. Zdravý stav se nepolluje.
  clearTimeout(recheckTimer);
  if (next.configured && !next.healthy) recheckTimer = setTimeout(() => load(true), 120000);
}

// fresh=true obejde sdílenou cache (ruční obnova, doptávání při výpadku)
function load(fresh = false) {
  loadKbConfig({ fresh })
    .then((cfg) => {
      const configured = (cfg.ai_provider || 'none') !== 'none';
      const healthy = cfg.ai_healthy !== false;
      const modes = Array.isArray(cfg.ai_modes) ? cfg.ai_modes : (cfg.ai_enabled ? ['questions', 'generate', 'expand', 'chat', 'from_text', 'transcribe'] : []);
      publish({
        enabled: !!cfg.ai_enabled && healthy,
        configured,
        provider: cfg.ai_provider || 'none',
        modes: healthy ? modes : [],
        healthy,
      });
    })
    .catch(() => publish({ ...EMPTY }));
}

// ruční obnova (po uložení nastavení AI v administraci) — překreslí všechna
// AI tlačítka bez reloadu stránky
export function refreshAiModes() {
  load(true);
}

export function useAiModes() {
  const [state, setState] = useState(cached ?? { enabled: false, provider: 'none', modes: [] });

  useEffect(() => {
    listeners.add(setState);
    if (cached === null) {
      cached = { enabled: false, provider: 'none', modes: [] };
      load();
    } else {
      setState(cached);
    }
    return () => listeners.delete(setState);
  }, []);

  return { ...state, has: (mode) => state.modes.includes(mode) };
}

export function useAiEnabled() {
  return useAiModes().enabled;
}
