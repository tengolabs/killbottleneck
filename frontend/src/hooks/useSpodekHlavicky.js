import { useEffect, useState } from 'react';

// Spodní hrana hlavičky aplikace (AppHeader + zkušební proužek nad ní) v px od horního
// okraje okna. Ouška levé lišty (zásobník, stopky, hlášení chyby) jsou na rolujících
// stránkách `fixed` a měla pevné odsazení 64/112/160 px — počítané pro jednořádkovou
// hlavičku (56 px) bez proužku. Na telefonu je hlavička dvouřádková a nad ní proužek
// „Zkušební verze“, takže zásobník seděl přes tlačítko „+ Nový“ (Richard 29. 9. 2026).
// Měří se skutečná výška (ResizeObserver), ne odhad — proužek se objevuje jen někdy.
const VYCHOZI = 56;

export function useSpodekHlavicky(aktivni = true) {
  const [spodek, setSpodek] = useState(VYCHOZI);
  useEffect(() => {
    if (!aktivni) return undefined;
    const el = document.querySelector('[data-app-header]');
    if (!el) return undefined;
    const zmer = () => setSpodek(Math.round(el.getBoundingClientRect().bottom + window.scrollY));
    zmer();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(zmer) : null;
    // Proužek „Zkušební verze" nad hlavičkou přijde až po načtení configu (a ještě doroste
    // s překladem) → hlavičku posune, aniž by ona sama změnila velikost. Proto se sledují
    // i sourozenci PŘED ní a jejich příchod (childList rodiče, bez subtree).
    const sleduj = () => { if (!ro) return; ro.disconnect(); ro.observe(el); for (let s = el.previousElementSibling; s; s = s.previousElementSibling) ro.observe(s); zmer(); };
    sleduj();
    const mo = typeof MutationObserver !== 'undefined' && el.parentElement ? new MutationObserver(sleduj) : null;
    if (mo) mo.observe(el.parentElement, { childList: true });
    window.addEventListener('resize', zmer);
    return () => { if (ro) ro.disconnect(); if (mo) mo.disconnect(); window.removeEventListener('resize', zmer); };
  }, [aktivni]);
  return spodek;
}
