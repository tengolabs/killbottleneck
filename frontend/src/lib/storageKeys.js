// Klíče v prohlížeči (localStorage) — s přechodem po přejmenování na killBottleneck.
//
// PŘECHOD (28. 7. 2026): klíče se nově jmenují `kb-*`, ale lidem v prohlížeči leží
// staré `flowmap-*` — jazyk, otevřené panely, směr mapy, naposledy otevřený projekt.
// Kdyby se jen přejmenovaly, uživatel by po aktualizaci přišel o nastavení a vypadalo
// by to jako chyba. Čte se proto nový klíč, a když není, sáhne se jednou po starém
// a hodnota se rovnou přepíše pod nové jméno.
//
// Až se přechod odstraní (vydání po zveřejnění repa), zůstane z tohohle souboru
// jen `localStorage` napřímo — hledat „PŘECHOD".

const STARA_PREDPONA = 'flowmap-';
const NOVA_PREDPONA = 'kb-';

const stareJmeno = (klic) => STARA_PREDPONA + klic.slice(NOVA_PREDPONA.length);

export function nactiKlic(klic, vychozi = null) {
  try {
    const nove = localStorage.getItem(klic);
    if (nove !== null) return nove;
    if (!klic.startsWith(NOVA_PREDPONA)) return vychozi;
    const stare = localStorage.getItem(stareJmeno(klic));
    if (stare === null) return vychozi;
    localStorage.setItem(klic, stare);   // převzato — příště už jen nový klíč
    return stare;
  } catch (err) {
    return vychozi;   // soukromé okno / zakázané úložiště
  }
}

export function ulozKlic(klic, hodnota) {
  try {
    localStorage.setItem(klic, hodnota);
  } catch (err) { /* úložiště nedostupné — nastavení se prostě nezapamatuje */ }
}

export function smazKlic(klic) {
  try {
    localStorage.removeItem(klic);
    if (klic.startsWith(NOVA_PREDPONA)) localStorage.removeItem(stareJmeno(klic));
  } catch (err) { /* nevadí */ }
}
