// Volba mezi PLNÝM a ZJEDNODUŠENÝM (lite) režimem.
//
// Lite režim se od plného liší tím, co v něm CHYBÍ, ne tím, že je menší:
// jen „co mám dělat" a „co jsem zadal", žádné nastavování. Tvrdé jádro
// (mapa, sdílení, AI, správa) zůstává v plné verzi beze změny.
//
// Pravidlo, které se nesmí porušit: uživatele NIKDY neuvěznit. Na úzkém
// displeji lite naskočí sám, ale přepnutí je vždycky po ruce v obou směrech
// a volba se pamatuje. Právě uvěznění v ořezaném mobilu je to, za co lidi
// nadávají Asaně a Notionu.
import { nactiKlic, ulozKlic, smazKlic } from '@/lib/storageKeys';

const KEY = 'kb-mode';   // PŘECHOD: starý flowmap-mode se přebere // '' = automaticky podle šířky | 'lite' | 'full'

export const MODE_AUTO = '';
export const MODE_LITE = 'lite';
export const MODE_FULL = 'full';

export const savedMode = () => {
  try {
    // 'light' = starší název téhož režimu (přejmenováno 27. 7. 2026: „light"
    // v rozhraních znamená SVĚTLÝ MOTIV, a ten killBottleneck má taky). Kdo měl volbu
    // uloženou, nesmí o ni přejmenováním přijít.
    const v = nactiKlic(KEY) || MODE_AUTO;
    return v === 'light' ? MODE_LITE : v;
  } catch { return MODE_AUTO; }
};

export const saveMode = (mode) => {
  try {
    if (mode === MODE_AUTO) smazKlic(KEY);
    else ulozKlic(KEY, mode);
  } catch { /* soukromé okno — volba prostě nepřežije */ }
};

// stejný práh jako lib/useMapDirection.js — jeden „tohle je mobil" v celé appce
export const isNarrowScreen = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

export const shouldUseLite = () => {
  const m = savedMode();
  if (m === MODE_LITE) return true;
  if (m === MODE_FULL) return false;
  return isNarrowScreen();
};
