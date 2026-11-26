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
// Pole uzlu, která plní VÝHRADNĚ server (goalmaps hook stampAssignedBy):
// plátno je u uzlu založeného v téže relaci nemá — základna (odpověď PATCHe)
// ano. Prázdná hodnota na plátně proto NENÍ moje úprava; bez tohohle se
// každý nový krok s termínem tvářil „změněný mnou" a první zásah pravidla
// (opakování, kanban) skončil pruhem „Mapu změnil někdo jiný" místo tichého
// slití (nalezeno klik-testem stylu Proces 25. 10. 2026).
const SERVEROVA_POLE_UZLU = ['assignedBy'];
const doplnServerova = (m, b) => {
  if (!m || !b || !m.data || !b.data) return m;
  let d = null;
  for (const k of SERVEROVA_POLE_UZLU) {
    if (!m.data[k] && b.data[k]) { d = d || { ...m.data }; d[k] = b.data[k]; }
  }
  return d ? { ...m, data: d } : m;
};

function slijSadu(zaklad, moje, server, sPozici) {
  const idx = (a) => new Map((a || []).map((x) => [x.id, x]));
  const B = idx(zaklad); const S = idx(server);
  const M = idx(sPozici ? (moje || []).map((x) => doplnServerova(x, B.get(x.id))) : moje);

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
  // Nodes and edges are merged independently: my new edge can point to a node the other side deleted
  // meanwhile (or the other way round). An edge into nothing is a broken tree — that is a real
  // collision for a person, not something to merge silently (finding F1-11).
  // Only what the MERGE broke counts: a map that already carried such an edge on one side (older damage,
  // the editor offers a repair for it) must keep merging as before.
  const visici = (nodes, edges) => {
    const ids = new Set((nodes || []).map((n) => n.id));
    return (edges || []).filter((e) => !ids.has(e.source) || !ids.has(e.target)).map((e) => e.id);
  };
  const uzZnicene = new Set([...visici(moje.nodes, moje.edges), ...visici(server.nodes, server.edges)]);
  if (visici(u.polozky, h.polozky).some((id) => !uzZnicene.has(id))) return { ok: false, duvod: 'hrana' };

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

// ---------------------------------------------------------------------------------------------
// THREE-WAY MERGE THAT ALWAYS HAS A RESULT (analysis 5, c5-1) — for the save that ran into 409.
//
// `trojcestnyMerge` above answers "may this be merged without asking?" and gives up at the first
// thing both sides touched. That left two people who each edited a DIFFERENT step of one map
// with a dialog whose "Keep my changes" overwrote everything the colleague had saved. This
// function merges node by node and edge by edge and reports where the two sides really cross:
//   · changed on one side only → that side's version;
//   · changed on both sides, differently (the same node edited by both, a node deleted by one
//     and edited by the other, the same connection, the same node re-plugged under two parents,
//     a loop made of both sides' connections) → a CONFLICT; the result carries MY version there.
// The caller merges silently when `conflicts` is empty, and otherwise asks the person — "Keep my
// changes" then saves exactly this result: mine at the disputed places, every other change of
// the colleague kept.
// Not a conflict, by decision:
//   · position — a node moved by both keeps MY position (the canvas the person is looking at
//     must not jump under the cursor; a position is cheap to redo, unlike a text). A node that
//     one side only moved and the other deleted is deleted;
//   · status alone — my choice wins quietly, as it has since v0.27 (`overridden` counts it).
// Inputs in the canonical shape (lib/cleanMap.js), as for trojcestnyMerge.
// Returns { title, color, nodes, edges,
//   conflicts: [{ id, title, kind }]  kind: 'node' | 'deleted' | 'connection' | 'title' | 'color'
//   foreign:   [{ id, title }]        what the other side changed (content, not mere positions)
//   foreignIds, taken, statusOnly, overridden, mineExtra }
export function mergeKeepMine(zaklad, moje, server) {
  const eq = (a, b) => stableJson({ v: a }) === stableJson({ v: b });
  const idx = (a) => new Map((a || []).map((x) => [x.id, x]));
  const titleOf = (n) => String((n && n.data && (n.data.title || n.data.apexText)) || '');
  const order = (...maps) => { const seen = new Set(); const out = []; for (const m of maps) for (const id of m.keys()) if (!seen.has(id)) { seen.add(id); out.push(id); } return out; };

  const conflicts = new Map();
  const foreign = new Map();
  let taken = 0; let statusOnly = true; let overridden = 0;

  const B = idx(zaklad.nodes); const S = idx(server.nodes);
  const M = idx((moje.nodes || []).map((x) => doplnServerova(x, B.get(x.id))));
  const nameOf = (id) => titleOf(M.get(id) || S.get(id) || B.get(id));
  const conflict = (id, kind) => { if (!conflicts.has(id)) conflicts.set(id, { id, title: nameOf(id), kind }); };
  const theirs = (id) => { if (!foreign.has(id)) foreign.set(id, { id, title: titleOf(S.get(id) || B.get(id) || M.get(id)) }); };

  // ---- header ----
  const head = (key, kind) => {
    const o = tricestne(zaklad[key] || '', moje[key] || '', server[key] || '');
    if (o.kolize) { conflicts.set(`#${kind}`, { id: `#${kind}`, title: '', kind }); foreign.set(`#${kind}`, { id: `#${kind}`, title: '', kind }); return moje[key] || ''; }
    if (o.zmenaServeru) { taken++; statusOnly = false; foreign.set(`#${kind}`, { id: `#${kind}`, title: '', kind }); }
    return o.volba === 'server' ? (server[key] || '') : (moje[key] || '');
  };
  const title = head('title', 'title');
  const color = head('color', 'color');

  // ---- nodes ----
  const nodes = [];
  const revived = new Set(); // deleted by the other side, kept because I edited them
  for (const id of order(S, M, B)) {
    const b = B.get(id); const m = M.get(id); const s = S.get(id);
    if (m && s) {
      if (!b) {
        // the same id added on both sides
        if (!eq(m, s)) { conflict(id, 'node'); theirs(id); }
        nodes.push(m);
        continue;
      }
      const mineChanged = !eq(bezPozice(b), bezPozice(m));
      const theirsChanged = !eq(bezPozice(b), bezPozice(s));
      let out = m;
      if (theirsChanged && !eq(bezPozice(m), bezPozice(s))) {
        if (!mineChanged) {
          out = s; taken++; theirs(id);
          if (!lisiSeJenStavem(b, s)) statusOnly = false;
        } else if (lisiSeJenStavem(b, m) && lisiSeJenStavem(b, s)) {
          overridden++;
        } else {
          conflict(id, 'node'); theirs(id);
        }
      }
      const p = tricestne(b.position, m.position, s.position);
      const takeTheirPosition = !p.kolize && p.volba === 'server';
      if (takeTheirPosition && p.zmenaServeru) { taken++; statusOnly = false; }
      nodes.push({ ...out, position: takeTheirPosition ? s.position : m.position });
      continue;
    }
    if (m && !s) {
      if (!b) { nodes.push(m); continue; }              // my new node
      theirs(id);
      if (eq(bezPozice(m), bezPozice(b))) { taken++; statusOnly = false; continue; } // deleted by the other side, untouched by me
      conflict(id, 'deleted'); nodes.push(m); revived.add(id);
      continue;
    }
    if (!m && s) {
      if (!b) { nodes.push(s); taken++; statusOnly = false; theirs(id); continue; } // added by the other side
      if (!eq(bezPozice(s), bezPozice(b))) { conflict(id, 'deleted'); theirs(id); } // I deleted what the other side edited → stays deleted
    }
  }

  // ---- edges ----
  const BE = idx(zaklad.edges); const ME = idx(moje.edges); const SE = idx(server.edges);
  let edges = [];
  for (const id of order(SE, ME, BE)) {
    const b = BE.get(id); const m = ME.get(id); const s = SE.get(id);
    if (m && s) {
      if (!b) { if (!eq(m, s)) { conflict(m.target, 'connection'); theirs(s.target); } edges.push(m); continue; }
      const o = tricestne(b, m, s);
      if (o.kolize) { conflict(m.target, 'connection'); theirs(s.target); edges.push(m); continue; }
      if (o.zmenaServeru) { taken++; statusOnly = false; theirs(s.target); }
      edges.push(o.volba === 'server' ? s : m);
      continue;
    }
    if (m && !s) {
      if (!b) { edges.push(m); continue; }
      if (eq(m, b)) { taken++; statusOnly = false; if (S.has(b.target)) theirs(b.target); continue; } // removed by the other side
      conflict(m.target, 'connection'); edges.push(m);
      continue;
    }
    if (!m && s) {
      if (!b) { edges.push(s); taken++; statusOnly = false; theirs(s.target); continue; }
      if (!eq(s, b)) conflict(s.target, 'connection'); // I removed what the other side re-plugged → stays removed
    }
  }

  // ---- structure: the merged map must stay a tree where each side alone was one ----
  const has = (id) => nodes.some((n) => n.id === id);
  const dangling = (ns, es) => { const ids = new Set((ns || []).map((n) => n.id)); return new Set((es || []).filter((e) => !ids.has(e.source) || !ids.has(e.target)).map((e) => e.id)); };
  const damagedBefore = new Set([...dangling(moje.nodes, moje.edges), ...dangling(server.nodes, server.edges)]);
  const putBackMyEdgesOf = (nodeId) => {
    for (const e of ME.values()) {
      if ((e.source === nodeId || e.target === nodeId) && !edges.some((x) => x.id === e.id)) edges.push(e);
    }
  };
  for (const id of revived) putBackMyEdgesOf(id);
  // a connection must not end in nothing: my connection brings back the node the other side
  // deleted (with my connections of it); the other side's connection to a node I deleted goes
  for (let round = 0; round < 1000; round++) {
    const bad = edges.find((e) => !damagedBefore.has(e.id) && (!has(e.source) || !has(e.target)));
    if (!bad) break;
    const missing = !has(bad.source) ? bad.source : bad.target;
    if (ME.has(bad.id) && M.has(missing)) {
      nodes.push(M.get(missing)); revived.add(missing);
      conflict(missing, 'deleted'); theirs(missing);
      putBackMyEdgesOf(missing);
    } else {
      edges = edges.filter((e) => e.id !== bad.id);
      conflict(missing, 'deleted');
    }
  }
  // one parent only: where both sides plugged the same node somewhere, my connection stays
  const incoming = new Map();
  for (const e of edges) { if (!incoming.has(e.target)) incoming.set(e.target, []); incoming.get(e.target).push(e); }
  for (const [target, list] of incoming) {
    if (list.length < 2) continue;
    const mine = list.filter((e) => ME.has(e.id));
    if (!mine.length || mine.length === list.length) continue; // damage one side already carried — not made by the merge
    const drop = new Set(list.filter((e) => !ME.has(e.id)).map((e) => e.id));
    edges = edges.filter((e) => !drop.has(e.id));
    conflict(target, 'connection'); theirs(target);
  }
  // no loops: a loop closed by the other side's connection loses that connection
  const loopEdges = () => {
    const parent = new Map();
    for (const e of edges) if (!parent.has(e.target)) parent.set(e.target, e);
    for (const start of parent.keys()) {
      const path = []; const seen = new Set(); let cur = start;
      while (parent.has(cur) && !seen.has(cur)) { seen.add(cur); const e = parent.get(cur); path.push(e); cur = e.source; }
      if (cur === start && path.length) return path;
    }
    return null;
  };
  for (let round = 0; round < 1000; round++) {
    const loop = loopEdges();
    if (!loop) break;
    const their = loop.find((e) => !ME.has(e.id));
    if (!their) break; // my own loop (older damage) — the editor offers a repair for it
    edges = edges.filter((e) => e.id !== their.id);
    conflict(their.target, 'connection'); theirs(their.target);
  }

  const result = { title, color, nodes, edges };
  return {
    ...result,
    conflicts: [...conflicts.values()],
    foreign: [...foreign.values()],
    foreignIds: [...foreign.keys()].filter((id) => !id.startsWith('#')),
    taken,
    statusOnly,
    overridden,
    mineExtra: stableJson(result) !== stableJson({ title: server.title || '', color: server.color || '', nodes: server.nodes || [], edges: server.edges || [] }),
  };
}
