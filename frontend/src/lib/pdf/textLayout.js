// Text stránky z pdf.js (`getTextContent`) → řádky → hledání řetězce → obdélníky.
// Čisté funkce nad daty, bez pdf.js a bez DOMu (unit test product/tests/pdf-jadro.js).
//
// pdf.js vrací „items“: kousky textu s maticí [a,b,c,d,e,f] (e,f = počátek
// účaří v souřadnicích stránky, bod vlevo dole), šířkou a jménem fontu. Jedno
// slovo bývá v jednom itemu, ale cena „12 500 Kč“ klidně ve třech, a věta
// pokračuje na dalším řádku. Tady se items skládají do řádků se zpětnou mapou
// znak → item, aby šel nalezený řetězec vrátit na obdélník ke „přelepce“.

// Velikost písma z matice: svislá škála (b,d); vodorovná (a,b) se liší jen při
// stlačení Tz — na hledání nemá vliv.
const velikost = (t) => Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]) || 1;
const jeRotovany = (t) => Math.abs(t[1]) > 0.01 * Math.abs(t[0]) || Math.abs(t[2]) > 0.01 * Math.abs(t[3]);

// znaky, které se při hledání berou jako obyčejná mezera (pevná mezera v ceně,
// úzká mezera z Wordu, tabulátor) — NAHRAZENÍ 1:1, indexy zůstávají
const MEZERY = /[\u00a0\u202f\u2009\u2007\t\n\r]/g; // i konec řádku: model opisuje z textu stran, kde jsou řádky pod sebou
// uvozovky a pomlčky sjednotit 1:1 (model opisuje text z přepisu, kde už jsou sjednocené)
const UVOZOVKY = /[\u2018\u2019\u201a\u201b]/g;
const DVOJITE = /[\u201c\u201d\u201e\u201f\u00ab\u00bb]/g;
const POMLCKY = /[\u2013\u2014\u2212]/g;
const norm1 = (s) => String(s).replace(MEZERY, ' ').replace(UVOZOVKY, "'").replace(DVOJITE, '"').replace(POMLCKY, '-');

// Normalizace pro hledání se zachovanou mapou indexů: vícenásobné mezery se
// sbalí (mapa říká, který PŮVODNÍ index každý znak normalizovaného textu má).
export function normalizuj(text) {
  const t = norm1(text);
  let out = '';
  const mapa = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === ' ' && out.endsWith(' ')) continue;
    out += ch;
    mapa.push(i);
  }
  return { text: out, mapa };
}
const normHledany = (s) => normalizuj(String(s || '')).text.trim();

// items pdf.js → řádky {y, size, text, znaky[{item, off}], items[{i, x0, x1, ...}]}
// styles = getTextContent().styles (ascent/descent/fontFamily podle fontName)
export function sestavRadky(items, styles) {
  const st = styles || {};
  const pouzitelne = [];
  (items || []).forEach((it, i) => {
    if (!it || typeof it.str !== 'string') return;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    if (jeRotovany(t)) return; // otočený text (svislé popisky) v1 neumí — vynechat
    if (!it.str.trim() && !(it.width > 0)) return; // prázdný kousek bez šířky = nic
    const size = velikost(t);
    const s = st[it.fontName] || {};
    pouzitelne.push({
      i, str: it.str, x0: t[4], x1: t[4] + (it.width || 0), y: t[5], size,
      // s.nazev = skutečné jméno fontu (např. „ABCDEF+Calibri-Bold“), když ho volající zjistil
      // z pdf.js commonObjs; jinak jen interní g_d0_f1 (řez pak nejde poznat)
      fontName: s.nazev || it.fontName || '', fontFamily: s.fontFamily || '',
      ascent: typeof s.ascent === 'number' && s.ascent > 0 ? s.ascent : 0.9,
      descent: typeof s.descent === 'number' && s.descent < 0 ? s.descent : -0.22,
    });
  });
  // seskupit podle účaří (shora dolů), tolerance podle velikosti písma
  pouzitelne.sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const radky = [];
  for (const it of pouzitelne) {
    const posl = radky[radky.length - 1];
    if (posl && Math.abs(posl.y - it.y) <= 0.35 * Math.max(posl.size, it.size)) posl.items.push(it);
    else radky.push({ y: it.y, size: it.size, items: [it] });
  }
  for (const r of radky) {
    r.items.sort((a, b) => a.x0 - b.x0);
    r.size = Math.max(...r.items.map((it) => it.size));
    r.text = '';
    r.znaky = [];   // pro každý znak r.text: {item: index do r.items nebo -1 (doplněná mezera), off}
    let konec = null;
    r.items.forEach((it, idx) => {
      if (konec !== null) {
        const mezera = it.x0 - konec;
        const mezeraJe = r.text.endsWith(' ') || it.str.startsWith(' ');
        // díra mezi kousky (kerning slova ji nedělá, mezera mezi slovy ano) nebo skok
        // kurzoru zpět (tabulka/zarovnání) → oddělit mezerou
        if (!mezeraJe && r.text && (mezera > 0.15 * it.size || mezera < -0.5 * it.size)) { r.text += ' '; r.znaky.push({ item: -1, off: -1 }); }
      }
      for (let k = 0; k < it.str.length; k++) { r.text += it.str[k]; r.znaky.push({ item: idx, off: k }); }
      konec = Math.max(konec ?? -Infinity, it.x1);
    });
  }
  return { radky };
}

// Text stránky pro model = řádky pod sebou (stejná normalizace jako při hledání,
// aby model opsal přesně to, co pak najdeme).
export function textStranky(radky) {
  return radky.map((r) => normalizuj(r.text).text.trim()).filter(Boolean).join('\n');
}

// všechny výskyty `hledany` v `text` (indexy)
function vyskyty(text, hledany, bezVelikosti) {
  const out = [];
  if (!hledany) return out;
  const a = bezVelikosti ? text.toLowerCase() : text;
  const b = bezVelikosti ? hledany.toLowerCase() : hledany;
  let i = a.indexOf(b);
  while (i >= 0) { out.push(i); i = a.indexOf(b, i + 1); }
  return out;
}

// Najde `find` v řádcích: nejdřív přesně, pak bez rozlišení velikosti písmen;
// v jednom řádku i přes hranici až 4 řádků (věta). Vrací výskyty jako
// fragmenty {radek, od, do} v indexech PŮVODNÍHO textu řádku (do = exkluzivní).
export function najdiText(radky, find, { maxRadku = 4 } = {}) {
  const h = normHledany(find);
  if (!h) return [];
  const N = radky.map((r) => normalizuj(r.text));
  const out = [];
  const klic = new Set();
  const pridej = (fragmenty) => { const k = JSON.stringify(fragmenty); if (!klic.has(k)) { klic.add(k); out.push({ fragmenty }); } };
  for (const bezVelikosti of [false, true]) {
    // v jednom řádku
    N.forEach((n, ri) => {
      for (const i of vyskyty(n.text, h, bezVelikosti)) pridej([{ radek: ri, od: n.mapa[i], do: n.mapa[i + h.length - 1] + 1 }]);
    });
    // přes řádky: okno 2..maxRadku řádků slepené mezerou; výskyt musí začínat
    // v prvním a končit v posledním řádku okna
    for (let okno = 2; okno <= maxRadku; okno++) {
      for (let ri = 0; ri + okno <= N.length; ri++) {
        const casti = N.slice(ri, ri + okno).map((n) => n.text);
        const varianty = [{ sep: ' ', bezSpojovniku: false }];
        // slovo rozdělené spojovníkem na konci řádku: „pro-“ + „dukt“
        if (casti[0].endsWith('-')) varianty.push({ sep: '', bezSpojovniku: true });
        for (const v of varianty) {
          const prvni = v.bezSpojovniku ? casti[0].slice(0, -1) : casti[0];
          const cely = [prvni, ...casti.slice(1)].join(v.sep);
          const zacatky = [];   // začátek každého řádku v `cely`
          let poz = 0;
          zacatky.push(0); poz += prvni.length + v.sep.length;
          for (let k = 1; k < okno; k++) { zacatky.push(poz); poz += casti[k].length + v.sep.length; }
          const posledniZac = zacatky[okno - 1];
          for (const i of vyskyty(cely, h, bezVelikosti)) {
            const konec = i + h.length; // exkluzivní
            if (i >= prvni.length || konec <= posledniZac) continue;
            const fr = [];
            for (let k = 0; k < okno; k++) {
              const zac = zacatky[k];
              const del = k === 0 ? prvni.length : casti[k].length;
              const od = Math.max(i, zac) - zac;
              const doo = Math.min(konec, zac + del) - zac;
              if (doo <= od) continue;
              const n = N[ri + k];
              fr.push({ radek: ri + k, od: n.mapa[od], do: n.mapa[doo - 1] + 1 });
            }
            pridej(fr);
          }
        }
      }
    }
    if (out.length) break;
  }
  return out;
}

// Zúžení náhrady na to, co se opravdu mění: model často pošle celý řádek („Kuchyňská linka
// dub, 4 m 12 500 Kč“ → „… 13 200 Kč“); přelepit jen „12 500 Kč“ zachová zarovnání sloupce
// i původní písmo okolo. Společný začátek a konec se odřízne po celých slovech. Jen pro
// výskyt v jednom řádku (přes řádky by se posunuly indexy).
export function zuzNahradu(radky, vyskyt, replace) {
  if (!vyskyt || vyskyt.fragmenty.length !== 1) return { fragmenty: vyskyt.fragmenty, replace };
  const fr = vyskyt.fragmenty[0];
  const orig = radky[fr.radek].text.slice(fr.od, fr.do);
  const a = norm1(orig);
  const b = norm1(String(replace ?? ''));
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (p > 0 && a[p - 1] !== ' ') p--;           // zpět na hranici slova
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  while (q > 0 && a[a.length - q] !== ' ') q--;
  // částka: jednotku hned za číslem (Kč, EUR, %, ks, m) nechat v jádru — jinak by se
  // kratší číslo zarovnalo doleva a mezi ním a jednotkou zůstala díra
  const jadro = a.slice(p, a.length - q);
  const zaJadrem = a.slice(a.length - q).trim().split(' ')[0] || '';
  if (q > 0 && /\d/.test(jadro) && zaJadrem && zaJadrem.length <= 4 && !/\d/.test(zaJadrem)) {
    const i = a.indexOf(zaJadrem, a.length - q);
    if (i >= 0) q = a.length - (i + zaJadrem.length);
  }
  if (p + q === 0) return { fragmenty: vyskyt.fragmenty, replace };
  const od = fr.od + p;
  const doo = fr.do - q;
  if (doo <= od) return { fragmenty: vyskyt.fragmenty, replace };
  return { fragmenty: [{ radek: fr.radek, od, do: doo }], replace: String(replace ?? '').slice(p, String(replace ?? '').length - q).trim(), zuzeno: true };
}

// Obdélník fragmentu řádku. `sirka(text, size, item)` měří text náhradním fontem
// (přesnější než počet znaků); bez ní se bere podíl znaků.
export function bboxFragmentu(radek, od, doo, sirka) {
  const podil = (it, k) => {
    if (k <= 0) return 0;
    if (k >= it.str.length) return 1;
    if (sirka) {
      const cely = sirka(it.str, it.size, it) || 0;
      return cely > 0 ? Math.min(1, (sirka(it.str.slice(0, k), it.size, it) || 0) / cely) : k / it.str.length;
    }
    return k / it.str.length;
  };
  let x0 = Infinity, x1 = -Infinity, prvni = null;
  for (let i = od; i < doo; i++) {
    const z = radek.znaky[i];
    if (!z || z.item < 0) continue;
    const it = radek.items[z.item];
    if (!prvni) prvni = it;
    const sir = it.x1 - it.x0;
    x0 = Math.min(x0, it.x0 + sir * podil(it, z.off));
    x1 = Math.max(x1, it.x0 + sir * podil(it, z.off + 1));
  }
  if (!prvni) return null;
  // volné místo vpravo: k dalšímu znaku na řádku (i uvnitř téhož kousku — delší jméno
  // uprostřed věty nesmí přepsat zbytek věty), jinak k dalšímu kousku, jinak okraj
  let volnoDo = Infinity;
  let dalsiZnak = -1;
  for (let j = doo; j < radek.text.length; j++) { const z = radek.znaky[j]; if (z && z.item >= 0 && radek.text[j] !== ' ') { dalsiZnak = j; break; } }
  if (dalsiZnak >= 0) {
    const z = radek.znaky[dalsiZnak];
    const it = radek.items[z.item];
    volnoDo = it.x0 + (it.x1 - it.x0) * podil(it, z.off);
  } else {
    for (const it of radek.items) if (it.x0 > x1 + 0.01 && it.x0 < volnoDo) volnoDo = it.x0;
  }
  return {
    x0, x1, baseline: radek.y, size: prvni.size,
    y0: radek.y + prvni.descent * prvni.size, y1: radek.y + Math.max(prvni.ascent, 0.85) * prvni.size, // aspoň 0,85 em: ascent z pdf.js bývá bez výšky diakritiky
    fontName: prvni.fontName, fontFamily: prvni.fontFamily, volnoDo,
    posledniNaRadku: dalsiZnak < 0,
    konecRadku: dalsiZnak < 0 ? doo : -1,
  };
}
// index za posledním neprázdným znakem řádku (pro překreslení zbytku řádku)
export function konecTextu(radek) {
  let k = radek.text.length;
  while (k > 0 && radek.text[k - 1] === ' ') k--;
  return k;
}
