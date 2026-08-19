// Formátování popisu uzlu — značkovaný text (podmnožina markdownu).
//
// PROČ ZNAČKY A NE HTML: popis se v aplikaci čte na dvou desítkách míst, která
// s ním nezacházejí jako s HTML — AI prompty (pb_hooks/ollama.js, n8n advisor),
// MCP výpis pro model, fulltext v tabulce úkolů, veřejně sdílené mapy a
// obrázkový export mapy. Značkovaný text zůstane čitelný člověku i modelu,
// kdežto HTML by do všech těch míst vyteklo. Navíc server popis ořezává na
// 10 000 znaků (helpers.js normalizeNodeShapes) — useknutá značka nevadí,
// useknuté HTML by rozbilo strukturu.
//
// DATOVÝ MODEL SE NEMĚNÍ. Popis je pořád obyčejný text v node.data.description,
// takže všechny dosavadní popisy jsou platné beze změny a nic se nemigruje.
//
// BEZPEČNOST: parser vrací STROM, ne HTML řetězec. Komponenta FormatovanyPopis
// z něj skládá React prvky, takže tu není žádné dangerouslySetInnerHTML a XSS
// je vyloučené konstrukcí — což je podstatné, protože popis jde přes
// PUBLIC_NODE_DATA ven i nepřihlášenému návštěvníkovi veřejné mapy.

// Adresy: jen http(s). `javascript:` a `data:` se do odkazu nesmí dostat ani
// v [popisek](adresa) — jinak by stačilo napsat popis a čekat na kliknutí.
const BEZPECNA_ADRESA = /^https?:\/\//i;

// Řádkové značky. Pořadí je závazné: odkaz musí jít PRVNÍ, jinak by hvězdička
// uvnitř adresy rozbila text na kurzívu.
const ZNACKY = [
  { druh: 'odkaz', vzor: /\[([^\]\n]*)\]\(([^)\s]+)\)/g },
  { druh: 'tucne', vzor: /\*\*([^\n]+?)\*\*/g },
  { druh: 'skrtnute', vzor: /~~([^\n]+?)~~/g },
  // Zvětšení VYBRANÉHO textu — nadpis umí jen celý řádek, ale lidé chtějí
  // zvýraznit i jedno slovo uprostřed věty (Richard 18. 8. 2026: „nešlo by
  // zvětšovat označené slovo na 2 nebo 3 velikosti?"). Stříška se v běžném
  // textu skoro nevyskytuje a musí být párová, takže „2^3" nic nerozbije.
  { druh: 'vetsi2', vzor: /\^\^([^\n]+?)\^\^/g },
  { druh: 'vetsi1', vzor: /(?<!\^)\^([^^\n]+?)\^(?!\^)/g },
  { druh: 'kurziva', vzor: /(?<![*\w])\*([^*\n]+?)\*(?!\*)/g },
];

// Strop délky rozebíraného textu.
//
// ⚠️ BEZPEČNOSTNÍ POJISTKA, ne kosmetika. Vzory se navzájem překrývají a
// nespárovaná „[" nutí odkazový vzor prohledávat zbytek řádku znovu a znovu;
// vstup „**a**"×1000 + „["×5000 (10 000 znaků, tedy PŘESNĚ serverový strop)
// blokoval hlavní vlákno 8,7 s — a popis vidí i nepřihlášený návštěvník
// veřejné mapy (nález bezpečnostního panelu 19. 8. 2026).
// Nad stropem se text ukáže tak, jak je: bez formátování, ale hned.
const MAX_ROZBOR = 10000;

/**
 * Rozloží JEDEN řádek na úseky textu, tučného, kurzívy, přeškrtnutí a odkazů.
 * Vrací pole { druh, text, adresa? }.
 */
export function parsujRadek(radek) {
  const text = String(radek == null ? '' : radek);
  if (!text) return [];
  if (text.length > MAX_ROZBOR) return [{ druh: 'text', text }];

  const casti = [];
  // Jeden průchod zleva doprava. Dřív se na každé nalezené značce volala
  // rekurze na CELÝ zbytek řádku, takže se všech šest vzorů spouštělo znovu
  // a znovu nad pořád stejným textem — odtud kvadratické chování a zatuhnutí.
  // Poslední nález každého vzoru si držíme a přepočítáváme ho, teprve když
  // ho průchod mine.
  const nalezy = new Array(ZNACKY.length).fill(undefined);
  let pos = 0;

  while (pos < text.length) {
    let nejI = -1;
    for (let i = 0; i < ZNACKY.length; i++) {
      if (nalezy[i] === undefined || (nalezy[i] !== null && nalezy[i].index < pos)) {
        ZNACKY[i].vzor.lastIndex = pos;
        nalezy[i] = ZNACKY[i].vzor.exec(text) || null;
      }
      if (nalezy[i] && (nejI === -1 || nalezy[i].index < nalezy[nejI].index)) nejI = i;
    }
    if (nejI === -1) break;

    const m = nalezy[nejI];
    const druh = ZNACKY[nejI].druh;
    if (m.index > pos) casti.push({ druh: 'text', text: text.slice(pos, m.index) });

    if (druh === 'odkaz') {
      const adresa = m[2];
      const popisek = m[1] || adresa;
      if (BEZPECNA_ADRESA.test(adresa)) {
        casti.push({ druh: 'odkaz', text: popisek, adresa });
      } else {
        // nebezpečná nebo relativní adresa: ukáže se jako holý text, ne odkaz
        casti.push({ druh: 'text', text: m[0] });
      }
    } else {
      // uvnitř tučného může být odkaz i kurzíva — vnitřek je krátký, rekurze ok
      const vnitrek = parsujRadek(m[1]);
      casti.push(...vnitrek.map((c) => ({ ...c, styl: [...(c.styl || []), druh] })));
    }
    pos = m.index + m[0].length;
  }

  if (pos < text.length) casti.push({ druh: 'text', text: text.slice(pos) });
  return casti;
}

/**
 * Rozloží celý popis na bloky: nadpis, odrážkový/číslovaný seznam, odstavec.
 * Vrací pole { druh, uroven?, radky?/casti? }.
 */
export function parsujPopis(text) {
  const zdroj = String(text == null ? '' : text);
  if (!zdroj.trim()) return [];
  // nad stropem se nic nerozebírá — viz MAX_ROZBOR
  if (zdroj.length > MAX_ROZBOR) return [{ druh: 'odstavec', radky: [[{ druh: 'text', text: zdroj }]] }];
  const radky = zdroj.split('\n');
  const bloky = [];

  for (const radek of radky) {
    const nadpis = /^(#{1,2})\s+(.*)$/.exec(radek);
    const odrazka = /^\s*[-*]\s+(.*)$/.exec(radek);
    const cislovana = /^\s*(\d+)[.)]\s+(.*)$/.exec(radek);
    const posledni = bloky[bloky.length - 1];

    if (nadpis) {
      bloky.push({ druh: 'nadpis', uroven: nadpis[1].length, casti: parsujRadek(nadpis[2]) });
    } else if (odrazka) {
      if (posledni?.druh === 'seznam' && !posledni.cislovany) posledni.polozky.push(parsujRadek(odrazka[1]));
      else bloky.push({ druh: 'seznam', cislovany: false, polozky: [parsujRadek(odrazka[1])] });
    } else if (cislovana) {
      if (posledni?.druh === 'seznam' && posledni.cislovany) posledni.polozky.push(parsujRadek(cislovana[2]));
      // číslo, kterým seznam začíná, se NESMÍ zahodit: popis „3. Odeslat" psaný
      // dřív by se po téhle vlně vykreslil jako „1. Odeslat" — tichá změna
      // zobrazení starých dat (nález panelu 19. 8. 2026)
      else bloky.push({ druh: 'seznam', cislovany: true, zacatek: parseInt(cislovana[1], 10) || 1, polozky: [parsujRadek(cislovana[2])] });
    } else if (!radek.trim()) {
      // prázdný řádek ukončuje odstavec i seznam
      if (posledni && posledni.druh !== 'mezera') bloky.push({ druh: 'mezera' });
    } else if (posledni?.druh === 'odstavec') {
      posledni.radky.push(parsujRadek(radek));
    } else {
      bloky.push({ druh: 'odstavec', radky: [parsujRadek(radek)] });
    }
  }
  return bloky.filter((b) => b.druh !== 'mezera');
}

/**
 * Popis bez značek — pro místa, kam formátování nepatří: karta uzlu v mapě
 * (line-clamp na jeden až dva řádky, navíc ji obrázkový export snímá tak,
 * jak je), nativní title, dvouřádkové výpisy a hledání v tabulce úkolů.
 * U odkazu zůstane popisek, ne adresa — o to celé jde.
 */
export function popisJakoText(text) {
  return parsujPopis(text)
    .map((b) => {
      if (b.druh === 'seznam') return b.polozky.map((p) => castiNaText(p)).join(' ');
      if (b.druh === 'nadpis') return castiNaText(b.casti);
      return b.radky.map((r) => castiNaText(r)).join(' ');
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function castiNaText(casti) {
  return casti.map((c) => c.text).join('');
}

/**
 * Je v textu vůbec nějaká značka? Používá se v testech jako rychlá kontrola
 * a v editoru k rozhodnutí, jestli má text co ukazovat v náhledu.
 * ⚠️ Musí pokrýt VŠECHNY značky, které umí parser — jinak by tvrdila „holý
 * text" o něčem, co se ve skutečnosti vykreslí formátovaně (kurzíva chyběla,
 * nález panelu 19. 8. 2026).
 */
export function maZnacky(text) {
  const s = String(text || '');
  if (/^#{1,2}\s|^\s*[-*]\s|^\s*\d+[.)]\s/m.test(s)) return true;
  return parsujPopis(s).some((b) => {
    const rady = b.druh === 'seznam' ? b.polozky : (b.radky || [b.casti || []]);
    return rady.some((r) => r.some((c) => c.druh === 'odkaz' || (c.styl && c.styl.length)));
  });
}

// ---------- vkládání značek z lišty ----------

const OBALY = {
  tucne: '**',
  kurziva: '*',
  skrtnute: '~~',
};

/**
 * Obalí (nebo odobalí) vybraný úsek značkou. Čistá funkce — textarea si pak
 * jen nastaví novou hodnotu a výběr.
 * Vrací { text, od, konec } s novou pozicí výběru.
 */
// Písmena a číslice včetně diakritiky — hranice slova pro dotažení výběru.
const SLOVO = /[\p{L}\p{N}]/u;

/**
 * Rozšíří výběr na celá slova. Kdo označí myší „á psát postu", chtěl skoro
 * jistě „dá psát postup" — a `**` uprostřed slova navíc vypadá jako chyba
 * (Richard 18. 8. 2026: „dal jsem to na jedno slovo"). Bez výběru se obalí
 * slovo, na kterém stojí kurzor.
 */
export function dotahniNaSlova(s, zacatek, konec) {
  let a = zacatek;
  let b = konec;
  while (a > 0 && SLOVO.test(s[a - 1])) a--;
  while (b < s.length && SLOVO.test(s[b])) b++;
  return { a, b };
}

export function vlozZnacku(text, od, do_, druh) {
  const s = String(text || '');
  let zacatek = Math.min(od, do_);
  let konec = Math.max(od, do_);
  if (druh === 'tucne' || druh === 'kurziva' || druh === 'skrtnute'
      || ((druh === 'nadpis1' || druh === 'nadpis2') && zacatek !== konec)) {
    // Kurzor v mezeře = „chci začít psát tučně", ne „obal sousední slovo".
    const vSlove = zacatek !== konec
      || (zacatek > 0 && SLOVO.test(s[zacatek - 1]) && SLOVO.test(s[zacatek] || ''));
    if (vSlove) {
      const roz = dotahniNaSlova(s, zacatek, konec);
      zacatek = roz.a;
      konec = roz.b;
    }
  }
  const vybrano = s.slice(zacatek, konec);

  if (druh === 'nadpis1' || druh === 'nadpis2') {
    // Označený ÚSEK uvnitř řádku = „zvětši tohle slovo"; nic neoznačeno nebo
    // označený celý řádek = „udělej z řádku nadpis". Jedno tlačítko, dvě
    // odpovědi na to, co člověk právě dělá.
    const odRadku = s.lastIndexOf('\n', zacatek - 1) + 1;
    const konecRadku = s.indexOf('\n', konec) === -1 ? s.length : s.indexOf('\n', konec);
    const celyRadek = zacatek <= odRadku && konec >= konecRadku;
    if (zacatek !== konec && !celyRadek) {
      const obal = druh === 'nadpis1' ? '^^' : '^';
      return obalUsek(s, zacatek, konec, obal);
    }
    return vlozNaZacatekRadku(s, zacatek, konec, druh);
  }
  if (druh === 'odrazka' || druh === 'cislovana') {
    return vlozNaZacatekRadku(s, zacatek, konec, druh);
  }

  const obal = OBALY[druh];
  if (!obal) return { text: s, od: zacatek, konec };
  return obalUsek(s, zacatek, konec, obal);
}

// Obalí úsek značkou; druhý klik ji zase sundá.
function obalUsek(s, zacatek, konec, obal) {
  const vybrano = s.slice(zacatek, konec);
  const pred = s.slice(Math.max(0, zacatek - obal.length), zacatek);
  const za = s.slice(konec, konec + obal.length);
  if (vybrano && pred === obal && za === obal) {
    const novy = s.slice(0, zacatek - obal.length) + vybrano + s.slice(konec + obal.length);
    return { text: novy, od: zacatek - obal.length, konec: konec - obal.length };
  }
  const novy = s.slice(0, zacatek) + obal + vybrano + obal + s.slice(konec);
  return vybrano
    ? { text: novy, od: zacatek + obal.length, konec: konec + obal.length }
    // bez výběru se kurzor postaví doprostřed, ať se rovnou píše
    : { text: novy, od: zacatek + obal.length, konec: zacatek + obal.length };
}

const PREFIXY = { nadpis1: '# ', nadpis2: '## ', odrazka: '- ', cislovana: '1. ' };

function vlozNaZacatekRadku(s, zacatek, konec, druh) {
  let prefix = PREFIXY[druh];
  if (druh === 'cislovana') {
    // navázat na číslo předchozího řádku, ať nevznikne „1. 1. 1."
    const odRadku0 = s.lastIndexOf('\n', Math.min(zacatek, konec) - 1) + 1;
    const predchozi = odRadku0 > 0 ? s.slice(s.lastIndexOf('\n', odRadku0 - 2) + 1, odRadku0 - 1) : '';
    const m = /^\s*(\d+)[.)]\s+\S/.exec(predchozi);
    if (m) prefix = `${parseInt(m[1], 10) + 1}. `;
  }
  const odRadku = s.lastIndexOf('\n', zacatek - 1) + 1;
  const konecRadku = s.indexOf('\n', konec) === -1 ? s.length : s.indexOf('\n', konec);
  const blok = s.slice(odRadku, konecRadku);
  const radky = blok.split('\n');
  // Prázdný řádek: odrážka se na něj MUSÍ dát, jinak nejde seznam vůbec začít
  // (Richard 18. 8. 2026: „odrážky fungují divně nebo vůbec" — na prázdném
  // řádku tlačítko nedělalo nic, protože se prázdné řádky přeskakovaly).
  const jenPrazdny = radky.every((r) => !r.trim());
  // celý blok už prefix má → sundat
  const vsechnyMaji = !jenPrazdny && radky.every((r) => r.startsWith(prefix) || !r.trim());
  const nove = radky.map((r) => {
    if (!r.trim() && !jenPrazdny) return r;
    if (vsechnyMaji) return r.slice(prefix.length);
    // starý prefix jiného druhu nejdřív pryč, ať nevznikne „- ## text"
    const bez = r.replace(/^(#{1,2}\s+|[-*]\s+|\d+[.)]\s+)/, '');
    return prefix + bez;
  }).join('\n');
  const novy = s.slice(0, odRadku) + nove + s.slice(konecRadku);
  const posun = nove.length - blok.length;
  // ⚠️ Bez výběru se musí vrátit KURZOR, ne označený řádek. Označený „- " první
  // napsané písmeno přepíše — odrážka zmizí a vypadá to, že tlačítko nefunguje.
  // (Nález kontrolního panelu 19. 8. 2026; přesně tím se rušila oprava prázdných
  // řádků z téhož dne.) Výběr přes blok dává smysl jen u víceřádkového výběru.
  if (zacatek === konec) {
    const kurzor = Math.max(odRadku, Math.min(zacatek + posun, novy.length));
    return { text: novy, od: kurzor, konec: kurzor };
  }
  return { text: novy, od: odRadku, konec: konecRadku + posun };
}

/**
 * Enter uvnitř seznamu pokračuje seznamem — jako v každém editoru, na který
 * jsou lidé zvyklí. Bez tohohle se musí tlačítko mačkat na každém řádku znovu
 * a číslování zůstane na jedničce (Richard 18. 8. 2026: „nedokážu psát a dělat
 * číslování, aby číslovalo... musí se na každou řádku vložit zvlášť").
 *
 * Vrací { text, od, konec } pro nový stav, nebo null = ať Enter proběhne běžně.
 * Prázdná položka (jen odrážka, nic za ní) seznam UKONČÍ — jinak by z něj
 * nešlo vystoupit jinak než mazáním.
 */
export function pokracujSeznam(text, pozice) {
  const s = String(text || '');
  const odRadku = s.lastIndexOf('\n', pozice - 1) + 1;
  const konecRadku = s.indexOf('\n', pozice) === -1 ? s.length : s.indexOf('\n', pozice);
  const radek = s.slice(odRadku, pozice);
  // ⚠️ Prázdnost se posuzuje podle CELÉ položky, ne jen podle textu před kurzorem.
  // Jinak Enter uprostřed „- b" (kurzor za odrážkou) položku považoval za prázdnou
  // a odrážku smazal, místo aby řádek rozdělil. Nález panelu 19. 8. 2026.
  const cely = s.slice(odRadku, konecRadku);

  const cislovana = /^(\s*)(\d+)([.)])(\s+)(.*)$/.exec(radek);
  const odrazka = /^(\s*)([-*])(\s+)(.*)$/.exec(radek);
  if (!cislovana && !odrazka) return null;

  const celyObsah = /^\s*(?:\d+[.)]|[-*])\s+(.*)$/.exec(cely);
  if (!(celyObsah ? celyObsah[1] : '').trim()) {
    // prázdná položka → konec seznamu: řádek se vyprázdní
    const novy = s.slice(0, odRadku) + s.slice(pozice);
    return { text: novy, od: odRadku, konec: odRadku };
  }

  const prefix = cislovana
    ? `${cislovana[1]}${parseInt(cislovana[2], 10) + 1}${cislovana[3]}${cislovana[4]}`
    : `${odrazka[1]}${odrazka[2]}${odrazka[3]}`;
  const vlozeno = '\n' + prefix;
  const novy = s.slice(0, pozice) + vlozeno + s.slice(pozice);
  const kurzor = pozice + vlozeno.length;
  return { text: novy, od: kurzor, konec: kurzor };
}

/** Vloží pojmenovaný odkaz na pozici kurzoru (nebo obalí výběr popiskem). */
export function vlozOdkaz(text, od, do_, adresa, popisek) {
  const s = String(text || '');
  // bez adresy nemá co vzniknout — „[]()" je jen smetí v textu
  if (!String(adresa || '').trim()) return { text: s, od, konec: do_ };
  const zacatek = Math.min(od, do_);
  const konec = Math.max(od, do_);
  const vybrano = s.slice(zacatek, konec);
  const jmeno = (popisek || vybrano || adresa).trim();
  const znacka = `[${jmeno}](${adresa})`;

  // Mezera, ať se odkaz neslepí se sousedním slovem („aaaaaVzhled najdete…" —
  // Richard 18. 8. 2026). Přidává se jen tam, kde vedle opravdu text stojí.
  const pred = s.slice(0, zacatek);
  const za = s.slice(konec);
  const mezeraPred = pred && !/\s$/.test(pred) ? ' ' : '';
  const mezeraZa = za && !/^[\s.,;:!?)]/.test(za) ? ' ' : '';

  const vlozeno = mezeraPred + znacka + mezeraZa;
  const novy = pred + vlozeno + za;
  const kurzor = zacatek + mezeraPred.length + znacka.length;
  return { text: novy, od: kurzor, konec: kurzor };
}
