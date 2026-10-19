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
// Asistent (19. 10. 2026, Richard: „když nefunguje AI, není vidět celý asistent“) se ale schovávat
// nesmí — historie, Dokumenty a relax AI nepotřebují. Proto vedle `modes` ještě `nastaveneModes`
// (co server nabízí bez ohledu na zdraví) a `hosted` (cloud hlásí výpadek, vlastní instalace „AI
// ještě není připojená“).
const EMPTY = { enabled: false, configured: false, provider: 'none', modes: [], nastaveneModes: [], healthy: true }; // bez `hosted` = config nedorazil, asistent zůstane schovaný
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
        nastaveneModes: modes,
        hosted: !!cfg.hosted,
        healthy,
      });
    })
    // Nedorazil ani config (síť / server dole): když už jednou dorazil, je to výpadek — asistent
    // zůstane vidět s pruhem a doptávání běží dál; jinak (první načtení) zůstává schovaný.
    .catch(() => publish(cached && cached.hosted !== undefined
      ? { ...cached, enabled: false, modes: [], healthy: false }
      : { ...EMPTY }));
}

// ruční obnova (po uložení nastavení AI v administraci) — překreslí všechna
// AI tlačítka bez reloadu stránky
export function refreshAiModes() {
  load(true);
}

export function useAiModes() {
  const [state, setState] = useState(cached ?? { ...EMPTY });

  useEffect(() => {
    listeners.add(setState);
    if (cached === null) {
      cached = { ...EMPTY };
      load();
    } else {
      setState(cached);
    }
    return () => listeners.delete(setState);
  }, []);

  // `nacteno` = config už dorazil (dřív by asistent na vlastní instalaci na okamžik hlásil „nepřipojeno“)
  return { ...state, nacteno: state.hosted !== undefined, has: (mode) => state.modes.includes(mode), nastaveno: (mode) => (state.nastaveneModes || []).includes(mode) };
}

// Stav asistenta pro tlačítko v hlavičce, lite i panel — jedno místo pravdy:
//   funkcni     AI odpovídá
//   vypadek     asistent nastavený, AI teď neodpovídá (cloud: výpadek u nás, vlastní instalace: jejich AI)
//   nepripojeno vlastní instalace bez AI pro asistenta → pozvánka „připojte AI“
//   skryto      config ještě nedorazil, nebo cloud bez asistenta (výpadek by lhal)
export function stavAsistenta(ai) {
  if (!ai || !ai.nacteno) return 'skryto';
  if (ai.nastaveno('chat_panel')) return ai.has('chat_panel') ? 'funkcni' : 'vypadek';
  return ai.hosted ? 'skryto' : 'nepripojeno';
}

export function useAiEnabled() {
  return useAiModes().enabled;
}
