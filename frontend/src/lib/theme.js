// Tmavý režim: class "dark" na <html> (tailwind darkMode: class).
// Bez volby uživatele se řídí systémem; volba se ukládá do localStorage.
// ⚠️ Hodnota je 'light' — SVĚTLÝ MOTIV. Nesouvisí se zjednodušeným (lite)
// režimem; hromadné přejmenování „light"→„lite" to 27. 7. 2026 omylem přepsalo.
//
// SKINY: skin = validovaný JSON s hodnotami CSS proměnných (viz skinValidator.js).
// Aplikuje se generovaným <style id="kb-skin"> na KONCI <head> — vyhraje nad
// index.css pořadím, ale kaskáda light/dark zůstává v CSS, takže toggle třídy
// `dark` funguje beze změny. Záměrně NE style.setProperty na <html>: inline styl
// by přebil OBĚ větve (:root i .dark) a tmavý režim by přestal přepínat.
// Resolved skin se cachuje v localStorage → initTheme ho aplikuje synchronně
// před renderem (žádný flash výchozích barev); účet je zdroj pravdy (syncSkin).
import { nactiKlic, ulozKlic, smazKlic } from '@/lib/storageKeys';
import { SKIN_COLOR_TOKENS, SKIN_FONT_TOKENS, fontStack, validateSkin } from '@/lib/skinValidator';
import { getBuiltinSkin, DEFAULT_SKIN_ID } from '@/lib/skins';
import { loadKbConfig } from '@/hooks/useKbConfig';

const KEY = 'kb-theme';   // PŘECHOD: starý flowmap-theme se přebere
const SKIN_KEY = 'kb-skin-cache';   // resolved skin (celý JSON, kvůli anti-FOUC)

export const getStoredTheme = () => nactiKlic(KEY); // 'light' | 'dark' | null

export const effectiveTheme = () =>
  getStoredTheme() ||
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

export const applyTheme = (t) => {
  document.documentElement.classList.toggle('dark', t === 'dark');
  updateThemeColorMeta();
};

export const setTheme = (t) => {
  ulozKlic(KEY, t);
  applyTheme(t);
};

// ---- skiny ----

// Adresní lišta / PWA title bar sleduje skutečné pozadí (index.html má
// napevno tmavou — v světlém režimu byla vždycky špatně).
const updateThemeColorMeta = () => {
  try {
    const m = document.querySelector('meta[name="theme-color"]');
    if (!m) return;
    const v = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
    if (v) m.setAttribute('content', 'hsl(' + v + ')');
  } catch (e) { /* meta je jen kosmetika */ }
};

// Sekce → CSS řádky. Iteruje se WHITELIST tokenů, ne vstup (obrana i kdyby se
// do cache/DB dostal nevalidovaný objekt). Fonty skládá fontStack — jediné
// místo, kde se z dat stává CSS hodnota.
const sectionLines = (section, { colorsOnly = false } = {}) => {
  const out = [];
  if (!section) return out;
  SKIN_COLOR_TOKENS.forEach((k) => {
    if (typeof section[k] === 'string') out.push(`  --${k}: ${section[k]};`);
  });
  if (colorsOnly) return out;
  SKIN_FONT_TOKENS.forEach((k) => {
    if (Array.isArray(section[k])) out.push(`  --${k}: ${fontStack(section[k])};`);
  });
  if (typeof section.radius === 'string') out.push(`  --radius: ${section.radius};`);
  return out;
};

// Světlé barvy jen pro :root:not(.dark) — prostý :root by (stejná specificita,
// pozdější pořadí) přebil i .dark hodnoty z index.css a rozbil tmavý režim.
// Radius + fonty ze sekce light platí globálně (index.css je v .dark nedefinuje;
// dark sekce je může přebít). Co skin nedefinuje, padá na index.css po tokenech.
export const skinToCss = (skin) => {
  const global = sectionLines({ radius: skin.light?.radius, ...pickFonts(skin.light) });
  const light = sectionLines(skin.light, { colorsOnly: true });
  const dark = sectionLines(skin.dark);
  let css = '';
  if (global.length) css += `:root {\n${global.join('\n')}\n}\n`;
  if (light.length) css += `:root:not(.dark) {\n${light.join('\n')}\n}\n`;
  if (dark.length) css += `:root.dark {\n${dark.join('\n')}\n}\n`;
  return css;
};

const pickFonts = (section) => {
  const out = {};
  if (!section) return out;
  SKIN_FONT_TOKENS.forEach((k) => { if (section[k]) out[k] = section[k]; });
  return out;
};

// Poslední aplikovaný skin — pro spotřebitele DAT skinu mimo CSS (LitePattern
// čte token `pattern`). Nikdy se nevrací nevalidovaný objekt: sem se dostane
// jen to, co prošlo applySkin (cache je validovaná v initTheme, zbytek přes
// resolveSkin/validateSkin).
let activeSkin = null;
export const getActiveSkin = () => activeSkin;

export const applySkin = (skin) => {
  activeSkin = skin || null;
  // memo() komponenty čtoucí getActiveSkin() (ApexGoalNode — ozdoba v kruhu)
  // se bez signálu nepřekreslí; event je nejlevnější reaktivita bez kontextu
  try { window.dispatchEvent(new Event('kb-skin-changed')); } catch (e) { /* SSR/test */ }
  let el = document.getElementById('kb-skin');
  if (!skin) {
    if (el) el.remove();
    updateThemeColorMeta();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'kb-skin';
  }
  el.textContent = skinToCss(skin);
  document.head.appendChild(el);   // vždy až ZA bundlovaný CSS (HMR umí pořadí rozházet)
  updateThemeColorMeta();
};

// Aplikuje + zapamatuje pro příští start. Persistenci na účet řeší volající
// (SkinDialog) — tady žádná závislost na API klientovi (vzor lang.js).
export const setSkin = (skin) => {
  if (skin) ulozKlic(SKIN_KEY, JSON.stringify(skin));
  else smazKlic(SKIN_KEY);
  applySkin(skin);
};

// Priorita: vlastní skin účtu > vestavěný dle volby účtu > instanční default
// > vestavěný Les (DEFAULT_SKIN_ID). Richard 6. 8. 2026: výchozí vzhled je
// les — konstanta existovala, ale tady v řetězci chyběla, takže default byl
// ve skutečnosti holé Indigo z index.css.
export const resolveSkin = ({ user, instanceSkin } = {}) => {
  if (user && user.skin_id === 'custom') {
    const r = validateSkin(user.skin_custom);
    if (r.ok) return r.clean;
  } else if (user && user.skin_id) {
    const b = getBuiltinSkin(user.skin_id);
    if (b) return b;
  }
  if (instanceSkin) {
    const r = validateSkin(instanceSkin);
    if (r.ok) return r.clean;
  }
  return getBuiltinSkin(DEFAULT_SKIN_ID) || null;
};

// Zdroj pravdy po startu: volba účtu + instanční default z /api/kb/config
// (veřejný endpoint — skin obarví i přihlašovací obrazovku). Při výpadku sítě
// se nechá poslední známý stav z cache.
export const syncSkin = async (user = null) => {
  let instanceSkin = null;
  try {
    const cfg = await loadKbConfig();
    instanceSkin = cfg && cfg.skin ? cfg.skin : null;
  } catch (e) {
    return;
  }
  setSkin(resolveSkin({ user, instanceSkin }));
};

// Exporty (PNG/PDF) jsou VŽDY ve výchozím vzhledu na bílé — sdílený artefakt
// musí být čitelný u příjemce bez ohledu na vkus odesílatele (rozhodnutí 31. 7.).
// Na dobu snímku se odpojí skin (<style disabled>) i tmavý režim a hned se vrátí.
// Jen ZMRAZENÍ pohybu na dobu snímku (transition/animation) — vzhled se
// nemění. Pro „PDF v mém vzhledu": bez toho se prvky s transition-colors
// fotí napůl přebarvené (stejný nález jako u světlého tisku, 2. 9. 2026).
export const withFrozenMotion = async (fn) => {
  const klid = document.createElement('style');
  klid.id = 'kb-freeze-motion';
  klid.textContent = '* { transition: none !important; animation: none !important; }';
  document.head.appendChild(klid);
  try {
    return await fn();
  } finally {
    klid.remove();
  }
};

export const withDefaultLook = async (fn) => {
  const el = document.getElementById('kb-skin');
  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  // ⚠️ Pouhé vypnutí skinu už NEznamená světlý podklad: od skinové vlny je
  // výchozí vzhled „Půlnoc" a :root tokeny jsou s ním 1:1 (tmavě modré).
  // Export tak vycházel tmavý s bledým nadpisem na bílém papíře — nečitelný
  // (nález vlastníka 2. 9. 2026 u PDF reportu Organizace, dashboard projektu
  // měl totéž). Na dobu snímku se proto NAVÍC přiloží vestavěný SVĚTLÝ skin
  // (Indigo, světlá varianta) — sdílený artefakt zůstává na bílé a čitelný.
  const tisk = document.createElement('style');
  tisk.id = 'kb-print-look';
  // ⚠️ Bez vypnutí přechodů se snímek fotí UPROSTŘED transition-colors (150 ms):
  // dlaždice a karty s přechodem vyšly tmavé, sekce bez něj světlé — „napůl
  // obarvené" PDF (nález vlastníka 2. 9. 2026). Animace pryč i kvůli pulzům.
  tisk.textContent = skinToCss(getBuiltinSkin('indigo'))
    + '\n* { transition: none !important; animation: none !important; }';
  if (el) el.disabled = true;
  if (wasDark) root.classList.remove('dark');
  document.head.appendChild(tisk);
  try {
    return await fn();
  } finally {
    tisk.remove();
    if (el) el.disabled = false;
    if (wasDark) root.classList.add('dark');
  }
};

export const initTheme = () => {
  applyTheme(effectiveTheme());
  try {
    const raw = nactiKlic(SKIN_KEY);
    if (raw) {
      // cache PŘES VALIDÁTOR — whitelist v sectionLines drží jen klíče, hodnoty
      // vkládá do CSS surově. Kdyby cache popsalo XSS odjinud, bez validace by
      // se z něj stala perzistentní CSS injection přežívající opravu původní díry.
      const r = validateSkin(JSON.parse(raw));
      if (r.ok) applySkin(r.clean);
      else smazKlic(SKIN_KEY);
    }
  } catch (e) {
    smazKlic(SKIN_KEY);   // poškozená cache nesmí shodit start
  }
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!getStoredTheme()) applyTheme(effectiveTheme());
  });
};
