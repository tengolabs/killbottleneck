// TŘÍČESTNÝ MERGE MAPY pro editor — aby zásah automatizace nesrazil rozepsanou
// práci a zároveň nevyskakoval pruh „mapa je neaktuální" tam, kde se nikdo
// nepotkal.
//
// Tři vstupy, všechny v KANONICKÉM tvaru (lib/cleanMap.js):
//   zaklad = stav serveru při posledním převzetí/uložení (co oba víme)
//   moje   = aktuální plátno včetně rozepsané změny
//   server = čerstvě stažená mapa
// Uzel/hrana změněná JEN na jedné straně se převezme z té strany. Změněná na
// OBOU stranách je skutečná kolize → `ok:false` a volající ukáže pruh/dialog.
// Bezpečná strana je vždycky pruh: tichý merge NIKDY nesmí spolknout moji
// rozepsanou změnu.
//
// ⚠️ OBSAH A POZICE UZLU SE POSUZUJÍ ZVLÁŠŤ. Pravidla ukládají mapu i s
// přerovnáním, takže server hne i uzly, kterých se obsahově nikdo nedotkl.
// Kdyby pozice patřila do obsahu, byl by každý relayout kolizí s libovolným
// rozepsaným přejmenováním — a pruh by se vrátil přesně tam, odkud ho tahle
// změna odstraňuje.

// Porovnání MUSÍ být nezávislé na pořadí klíčů: náš kanonický tvar má vlastní
// pořadí, server totéž vrací abecedně. `null` a `undefined` se srovnávají na ''.
// ⚠️ CHYBĚJÍCÍ KLÍČ ale '' NENÍ — v JSONu prostě nebude, takže {} ≠ {"a":""}
// (stejně to má serverové dvojče, helpers.js:stableJson). Proto musí VŠECHNY
// tři vstupy merge projít `cleanMapData` — jinak by starší uzel bez novějšího
// klíče vypadal jako změněný. (Funkce bydlela v GoalMapEditor.jsx; přestěhovaná
// sem, aby obě cesty slévání porovnávaly TOUTÉŽ funkcí a nerozešly se.)
export const stableJson = (v) => JSON.stringify(v, (k, val) => {
  if (val === null || val === undefined) return '';
  if (typeof val === 'object' && !Array.isArray(val)) {
    // ⚠️ Seed BEZ prototypu: `acc['__proto__'] = …` by na běžném objektu volalo
    // setter prototypu, klíč by z otisku vypadl a dva různé uzly by vyšly jako
    // shodné. Dnes to nejde zneužít (vstupy filtruje whitelist v cleanMap.js),
    // ale spoléhat na to nechceme.
    return Object.keys(val).sort().reduce((acc, kk) => {
      const x = val[kk];
      acc[kk] = (x === null || x === undefined) ? '' : x;
      return acc;
    }, Object.create(null));
  }
  return val;
});

const bezPozice = (n) => {
  const kopie = { ...n };
  delete kopie.position;
  return kopie;
};

// Rozhodnutí nad JEDNOU hodnotou, která existuje ve všech třech verzích.
// `zmenaServeru` znamená „na plátně se tím něco viditelně změní" — když už mám
// totéž co server, není co přebírat, i kdyby se verze rozešly.
function tricestne(b, m, s) {
  const jb = stableJson(b); const jm = stableJson(m); const js = stableJson(s);
  if (jm === js) return { volba: 'moje', zmenaServeru: false };
  if (js === jb) return { volba: 'moje', zmenaServeru: false };   // změnil jsem jen já
  if (jm === jb) return { volba: 'server', zmenaServeru: true };  // změnil jen server
  return { kolize: true };                                        // oba, a jinak
}

// Liší se dvě verze uzlu nanejvýš v `data.status` (pozice se nepočítá)?
// Rozlišení je podstatné dvakrát:
//  1. slévání pouhých stavů je v aplikaci od v0.27 a je odsouhlasené, takže se
//     dělá bez dalších podmínek; širší převzetí chce doklad pravidla (volající),
//  2. u stavu má při rozporu přednost MOJE volba — taky chování od v0.27.
function lisiSeJenStavem(a, b) {
  const bezStavu = (n) => {
    const d = { ...(n.data || {}) };
    delete d.status;
    return bezPozice({ ...n, data: d });
  };
  return stableJson(bezStavu(a)) === stableJson(bezStavu(b));
}

// Slití jedné sady (uzly nebo hrany). Vrací null = kolize.
function slijSadu(zaklad, moje, server, sPozici) {
  const idx = (a) => new Map((a || []).map((x) => [x.id, x]));
  const B = idx(zaklad); const M = idx(moje); const S = idx(server);

  // Pořadí výsledku drží server (aby se merge zbytečně nelišil od uložené
  // podoby), moje přírůstky jdou za ním.
  const poradi = []; const videno = new Set();
  for (const id of [...S.keys(), ...M.keys(), ...B.keys()]) {
    if (!videno.has(id)) { poradi.push(id); videno.add(id); }
  }

  const out = [];
  let prevzato = 0; let jenStavy = true; let mojeNavic = false; let prebitoMnou = 0;
  // Které položky jsme vzali ze SERVERU (mimo pouhé přerovnání pozic). Volající
  // podle nich žádá doklad, že za změnou stojí pravidlo — u hran se ptáme na
  // jejich cíl, protože „přesunutá karta" = hrana s target = ta karta.
  const prevzateIds = [];

  for (const id of poradi) {
    const b = B.get(id); const m = M.get(id); const s = S.get(id);

    if (m && s) {
      if (!b) {
        // stejné id přibylo na obou stranách — projde jen shoda
        if (stableJson(m) !== stableJson(s)) return null;
        out.push(m);
        continue;
      }
      const o = tricestne(sPozici ? bezPozice(b) : b, sPozici ? bezPozice(m) : m, sPozici ? bezPozice(s) : s);
      // Rozpor POUZE ve stavu není kolize: uživatel si kartu přepnul sám a jeho
      // volba má přednost, tiše. Tak to chodí od v0.27 (dřívější
      // `mergeServerStatuses`) a tahle změna to nesmí zpřísnit — jinak by
      // odklikání stavu na kanbanu začalo vyskakovat pruhem.
      const jenStav = sPozici && b && lisiSeJenStavem(b, m) && lisiSeJenStavem(b, s);
      if (o.kolize && !jenStav) return null;
      // moje volba zvítězila nad serverovou → na plátně se nic nezmění, ale
      // uživatel se o tom má dozvědět (jinak by cizí stav zmizel úplně potichu)
      if (o.kolize && jenStav) prebitoMnou++;
      let vysledek = (!o.kolize && o.volba === 'server') ? s : m;
      if (!o.kolize && o.zmenaServeru) {
        prevzato++; prevzateIds.push(id);
        if (!sPozici || !lisiSeJenStavem(b, s)) jenStavy = false;
      }
      if (sPozici) {
        const p = tricestne(b.position, m.position, s.position);
        if (p.kolize) return null;
        if (p.zmenaServeru) { prevzato++; jenStavy = false; }
        vysledek = { ...vysledek, position: p.volba === 'server' ? s.position : m.position };
      }
      out.push(vysledek);
      if (stableJson(vysledek) !== stableJson(s)) mojeNavic = true;
      continue;
    }

    if (m && !s) {
      if (!b) { out.push(m); mojeNavic = true; continue; }   // moje nová položka
      // server ji smazal; smím to převzít jen když jsem do ní nesáhl
      if (stableJson(m) !== stableJson(b)) return null;
      prevzato++; prevzateIds.push(id); jenStavy = false;
      continue;
    }

    if (!m && s) {
      if (!b) { out.push(s); prevzato++; prevzateIds.push(id); jenStavy = false; continue; }  // server přidal (pod-uzly pravidla)
      // smazal jsem ji já; server do ní mezitím nesměl sáhnout
      if (stableJson(s) !== stableJson(b)) return null;
      mojeNavic = true;
      continue;
    }
    // ani u mě, ani na serveru → smazáno na obou stranách, nic k řešení
  }

  return { polozky: out, prevzato, jenStavy, mojeNavic, prevzateIds, prebitoMnou };
}

// Hlavní vstup. Vrací:
//   { ok:false, duvod }  — skutečná kolize, patří před člověka
//   { ok:true, title, color, nodes, edges, prevzato, jenStavy, mojeNavic }
// `prevzato`   = kolik se toho viditelně přebralo ze serveru (0 = jen se rozešly
//                verze, obsah je shodný → převzít smí tiše vždycky)
// `jenStavy`   = všechno převzaté jsou pouhé změny `data.status`
// `mojeNavic`  = výsledek NENÍ shodný se serverem, autosave ho musí odeslat
export function trojcestnyMerge(zaklad, moje, server) {
  const t = tricestne(zaklad.title || '', moje.title || '', server.title || '');
  if (t.kolize) return { ok: false, duvod: 'nazev' };
  const c = tricestne(zaklad.color || '', moje.color || '', server.color || '');
  if (c.kolize) return { ok: false, duvod: 'barva' };

  const u = slijSadu(zaklad.nodes, moje.nodes, server.nodes, true);
  if (!u) return { ok: false, duvod: 'uzel' };
  const h = slijSadu(zaklad.edges, moje.edges, server.edges, false);
  if (!h) return { ok: false, duvod: 'hrana' };

  const title = t.volba === 'server' ? (server.title || '') : (moje.title || '');
  const color = c.volba === 'server' ? (server.color || '') : (moje.color || '');
  const hlavicka = (t.zmenaServeru ? 1 : 0) + (c.zmenaServeru ? 1 : 0);

  return {
    ok: true,
    title,
    color,
    nodes: u.polozky,
    edges: h.polozky,
    prevzato: u.prevzato + h.prevzato + hlavicka,
    prebitoMnou: u.prebitoMnou + h.prebitoMnou,
    // Název ani barvu mapy žádné pravidlo nemění — když se převzaly, stojí za
    // nimi ČLOVĚK a tiše se to slévat nemá (volající z toho dělá pruh).
    hlavickaPrevzata: hlavicka > 0,
    // hrana se doloží přes svůj CÍL (přesunutá karta), uzel sám za sebe
    prevzateUzly: [...new Set([
      ...u.prevzateIds,
      ...h.prevzateIds.map((id) => {
        const e = (server.edges || []).find((x) => x.id === id) || (zaklad.edges || []).find((x) => x.id === id);
        return e ? e.target : id;
      }),
    ])],
    jenStavy: u.jenStavy && h.jenStavy && hlavicka === 0,
    mojeNavic: u.mojeNavic || h.mojeNavic
      || title !== (server.title || '') || color !== (server.color || ''),
  };
}
