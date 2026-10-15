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

// Klíče ranní porady v asistentovi — VÁZANÉ NA ÚČET: panel je čte/zapisuje jako
// `${KEY}:${user.id}` (analýza kódu 2, F4-06). Staré klíče bez sufixu se nemigrují.
export const KEY_PORADA_NE = 'kb-chat-porada-ne';    // den, kdy uživatel poradu odmítl
export const KEY_PORADA_DEN = 'kb-chat-porada-den';  // den, kdy nabídka vznikla
export const KEY_AKTIVITA = 'kb-chat-aktivita';      // razítko poslední aktivity (ms)
export const KEY_AI_BLOK = 'kb-chat-ai-blok';        // blok AI pomocníků na telefonu rozbalený ('1')
// Relax (14. 10. 2026): běžící pauza (scéna, konec odpočtu, rozložení, PIN zámku) — VÁZANÁ NA ÚČET
// (`${KEY_RELAX}:${user.id}`), přežije reload: zamčená obrazovka se po F5 musí zakrýt dřív, než je vidět mapa.
// Scéna a rozložení jsou předvolby prohlížeče (bez sufixu, při odhlášení zůstávají jako šířka panelu).
export const KEY_RELAX = 'kb-relax';
export const KEY_RELAX_SCENA = 'kb-relax-scena';          // 'akvarium' | 'ul' | 'mraveniste'
export const KEY_RELAX_ROZLOZENI = 'kb-relax-rozlozeni';  // 'cela' | 'vedle'
export const KEY_RELAX_AKTIVITA = 'kb-relax-aktivita';    // + ':uid' {start, posledni, nabidnuto, posledniRelax} — hlídač 50 min práce
export const KEY_RELAX_RANO = 'kb-relax-rano';            // + ':uid' den, kdy se ráno samo spustilo akvárium (Richard 15. 10. 2026)

// Při odhlášení / vypršení session smazat všechny klíče asistenta (`kb-chat-*`):
// rozhovor, model, porada, aktivita — patří k účtu, další člověk u téhož
// prohlížeče je zdědit nesmí (F4-06).
export function smazKliceAsistenta() {
  try {
    const smazat = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Stav a šířka panelu a volba modelu jsou předvolby prohlížeče, ne data účtu — ty
      // zůstávají; klíče s `:` jsou vázané na id účtu (porada, aktivita), mezi účty
      // uniknout nemůžou a smazat je by znamenalo nabídnout poradu podruhé (panel 28. 9.).
      if (k && k.startsWith('kb-chat-') && !k.includes(':') && k !== 'kb-chat-open' && k !== 'kb-chat-width' && k !== 'kb-chat-model') smazat.push(k);
      // relax (/checkup 15. 10.): stav pauzy s otiskem PINu, hlídač aktivity a ranní razítko patří k účtu → po odhlášení pryč
      // (otisk 4 číslic jde offline projít za milisekundy a lidé PIN recyklují); předvolby scény/rozložení (bez `:`) zůstávají
      if (k && (k.startsWith('kb-relax:') || k.startsWith('kb-relax-aktivita:') || k.startsWith('kb-relax-rano:'))) smazat.push(k);
    }
    smazat.forEach((k) => localStorage.removeItem(k));
  } catch (err) { /* úložiště nedostupné — není co mazat */ }
}
