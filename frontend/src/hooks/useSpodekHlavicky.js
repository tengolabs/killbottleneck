import { useLayoutEffect, useSyncExternalStore } from 'react';

// Spodní hrana horní lišty aplikace (AppHeader / lišta editoru + zkušební proužek nad ní)
// v px od HORNÍHO OKRAJE OKNA. Lišta je od 27. 10. 2026 ukotvená (sticky) přes celou šířku
// a všechno „fixed“ (panel asistenta, akvárium vedle chatu, Dokumenty, zásobník, stopky,
// dialogy z menu panáčka) začíná pod ní — Richard: „ať pořád máš notifikace a víš, kde jsi“.
//
// Producent/sklad: výšku OHLAŠUJE sama lišta (useOhlasSpodekHlavicky na ukotveném obalu,
// který obsahuje i proužek „Zkušební verze“, takže jeho pozdní příchod je zachycen
// ResizeObserverem). Odběratelé jen čtou sklad (useSpodekHlavicky). Dřív si hook prvek
// `[data-app-header]` hledal sám při montáži — panel asistenta ale přežívá přechody stránek
// (Home s proužkem → editor mapy, který se kreslí až po spinneru) a držel starou výšku.
// Souřadnice okna, ne dokumentu: lišta je sticky, takže její spodní hrana se s rolováním
// nemění; dřívější přičítání scrollY by odběratele při rolování odsouvalo.
// Bez lišty (lite, přihlášení, /stranka) je hodnota 0 = panel od horního okraje.
// ⚠️ Lištu posouvají i SOUROZENCI nad ní (pruhy editoru „mapa se změnila jinde“, „archivovaný
// projekt“ — ConflictBanners, přicházejí za běhu): její velikost se nemění, jen poloha, takže
// ResizeObserver na samotné liště mlčí. Proto hlídáme i předchozí sourozence a přibývání/ubývání
// dětí rodiče (nález panelu kvality 27. 10. 2026).
let spodek = 0;
let producent = null;
const posluchaci = new Set();
const zapis = (v) => {
  if (v === spodek) return;
  spodek = v;
  posluchaci.forEach((f) => f());
};
const odebirej = (f) => { posluchaci.add(f); return () => posluchaci.delete(f); };
const cti = () => spodek;
const nula = () => 0;

export function useOhlasSpodekHlavicky(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    producent = el;
    const zmer = () => zapis(Math.max(0, Math.round(el.getBoundingClientRect().bottom)));
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(zmer) : null;
    const sleduj = () => {
      if (ro) {
        ro.disconnect();
        ro.observe(el);
        for (let s = el.previousElementSibling; s; s = s.previousElementSibling) ro.observe(s);
      }
      zmer();
    };
    sleduj();
    const mo = typeof MutationObserver !== 'undefined' && el.parentElement ? new MutationObserver(sleduj) : null;
    if (mo) mo.observe(el.parentElement, { childList: true });
    window.addEventListener('resize', zmer);
    return () => {
      if (ro) ro.disconnect();
      if (mo) mo.disconnect();
      window.removeEventListener('resize', zmer);
      // jen vlastní odchod nuluje sklad — kdyby někdy byly dvě lišty naráz, cizí odchod tu druhou nevymaže
      if (producent === el) { producent = null; zapis(0); }
    };
  }, [ref]);
}

export function useSpodekHlavicky(aktivni = true) {
  return useSyncExternalStore(odebirej, aktivni ? cti : nula, nula);
}
