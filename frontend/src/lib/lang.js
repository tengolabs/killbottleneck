// Jazyk UI (cs/en) — vzor lib/theme.js: volba v localStorage, jinak dle prohlížeče.
// Skutečná priorita: účet po přihlášení > localStorage > jazyk prohlížeče.
// (detectLang() při startu bere localStorage||prohlížeč; AuthContext pak po loginu
// jazyk účtu přepíše přes setLang → zapíše i do localStorage = zdroj pravdy napříč zařízeními.)
import i18next from 'i18next';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

const KEY = 'kb-lang';   // PŘECHOD: starý flowmap-lang se přebere (storageKeys.js)

export const LANGS = ['cs', 'en'];

export const getStoredLang = () => {
  const v = nactiKlic(KEY);
  return LANGS.includes(v) ? v : null;
};

// Prohlížeč česky/slovensky → čeština, jinak angličtina (rozhodnutí 2026-07-23).
export const browserLang = () => {
  const nav = (navigator.language || '').toLowerCase();
  return nav.startsWith('cs') || nav.startsWith('sk') ? 'cs' : 'en';
};

export const detectLang = () => getStoredLang() || browserLang();

// Přepne jazyk běžící aplikace + zapamatuje volbu. Persistenci na účet řeší volající
// (LanguageToggle/AuthContext) — tady žádná závislost na API klientovi.
export const setLang = (lang) => {
  if (!LANGS.includes(lang)) return;
  // Druhý jazyk není v bundlu (lite dieta) — před přepnutím ho donačíst.
  // Dynamický import místo statického: lang.js ← i18n/index.js by byl cyklus.
  // ⚠️ Volba se ukládá AŽ PO úspěchu: dřív se zapsala hned, takže při selhání
  // sítě zůstalo UI ve starém jazyce, ale localStorage tvrdil nový — a po
  // reloadu se appka nastartovala v jazyce, který se nikdy nenačetl.
  return import('@/i18n')
    .then((m) => m.loadLanguage(lang))
    .then(() => i18next.changeLanguage(lang))
    .then(() => { ulozKlic(KEY, lang); })
    .catch((e) => { console.error('jazyk se nepodařilo přepnout', e); });
};
