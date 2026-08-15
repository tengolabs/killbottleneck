/**
 * Kompaktní „tidy tree" layout (Reingold–Tilford, lineární varianta dle
 * Buchheim, Jünger & Leipert 2002). Rodič je vycentrovaný nad dětmi a
 * sourozenci se odstrčí jen o SKUTEČNÝ obrys sousedního podstromu — list vedle
 * košatého sourozence sedí těsně u jeho kořene, nedrží mezeru na celou šířku
 * jeho podstromu (ten se rozvíjí o úroveň dál a svisle nekoliduje).
 *
 * Směr (direction):
 *   'vertical'   = hlavní osa dolů (y = hloubka), sourozenci vedle sebe (x).
 *   'horizontal' = mobil — hlavní osa doprava (x = hloubka), sourozenci pod sebou (y).
 *
 * ⚠️ Server má ruční port `layoutTreeServer` v pb_hooks/helpers.js — držet v syncu
 * (týká se instancování šablon; server jede jen svisle/kanonicky).
 *
 * @param {Array} nodes - ReactFlow nodes
 * @param {Array} edges - ReactFlow edges (source -> target)
 * @param {'vertical'|'horizontal'} [direction='vertical']
 * @returns {Object} Map of nodeId -> { x, y }
 */
// Rozměry uzlu pro kolize/umístění — measured z ReactFlow, jinak default dle
// typu (musí sedět s realitou komponent: karta 220 na šířku ~170 na výšku,
// kruhový vrchol 260×260, osobní kořen 120×120).
const nodeW = (n) => n?.measured?.width ?? (n?.type === 'apexNode' ? 260 : n?.type === 'personalRoot' ? 120 : 220);
const nodeH = (n) => n?.measured?.height ?? (n?.type === 'apexNode' ? 260 : n?.type === 'personalRoot' ? 120 : 170);

/**
 * Volné místo pro NOVÝ podcíl pod rodičem — BEZ přerovnání čehokoli jiného
 * (rozhodnutí Richarda: ruční rozvržení mapy je nedotknutelné, hne se jen
 * nový uzel; žádný layoutTree přes celou mapu ani větev).
 *
 * Postup: hlavní osa podle existujících sourozenců (nový sedí v jejich řadě;
 * bez sourozenců za rodičem jako dřív), na příčné ose se začíná za posledním
 * sourozencem a posouvá se, dokud obdélník nového uzlu s někým koliduje
 * (s mezerou). Monotónní posun za blokující uzel → vždy skončí.
 *
 * Vzniklo kvůli driftu: mapNodes.js je „jedno místo" na zakládání uzlů
 * s layoutem, ale handleAddChild v editoru měl vlastní pevný offset a nové
 * uzly pokládal přes existující.
 */
export function findFreeChildSpot(nodes, edges, parentId, direction = 'vertical') {
  const horizontal = direction === 'horizontal';
  const GAP = 40; // minimální vzduch mezi uzly (SLOT 300 − karta 220 ≈ 80 na střed)
  const all = nodes.filter((n) => n && n.type !== 'note' && n.position);
  const parent = all.find((n) => n.id === parentId);
  if (!parent) return { x: 250, y: 200 };
  // rodič do kolizního testu NEPATŘÍ — visí se POD něj a pevný startovní odstup
  // 170 ho dřív „trefil" (karta je sama 170 vysoká + GAP), boční posun pak
  // odvezl nový uzel na konec řady mimo výřez (repro: list „Prototyp")
  const others = all.filter((n) => n.id !== parentId);

  const siblings = edges
    .filter((e) => e.source === parentId)
    .map((e) => others.find((n) => n.id === e.target))
    .filter(Boolean);

  const mainOf = (n) => (horizontal ? n.position.x : n.position.y);
  const crossOf = (n) => (horizontal ? n.position.y : n.position.x);
  const crossSize = (n) => (horizontal ? nodeH(n) : nodeW(n));
  const NEW_W = 220;
  const NEW_H = 170;

  let main;
  let cross;
  if (siblings.length) {
    // řada sourozenců: hlavní osa podle NEJBLIŽŠÍHO (nejmenší main — první řada),
    // příčně za POSLEDNÍM (největší cross + jeho rozměr + mezera)
    main = Math.min(...siblings.map(mainOf));
    const last = siblings.reduce((a, b) => (crossOf(a) + crossSize(a) > crossOf(b) + crossSize(b) ? a : b));
    cross = crossOf(last) + crossSize(last) + GAP;
  } else {
    // první dítě: krok LAYOUTU (APEX_STEP 380 / STEP 280 — sync s layoutTree),
    // ne pevných 170/260, které nepočítaly s výškou karty ani kruhu.
    // Pozn.: osobní mapa (PERSONAL_LAYOUT, kroky 210/300) má vlastní kroky,
    // ale je read-only agregát — podcíle se v ní nepřidávají, sem nevede.
    const step = parent.type === 'apexNode' ? 380 : 280;
    main = (horizontal ? parent.position.x : parent.position.y) + step;
    cross = crossOf(parent);
  }

  // posouvat po příčné ose, dokud nový obdélník s někým koliduje (i s mezerou)
  const overlaps = (x, y) => others.find((n) => {
    const nx = n.position.x; const ny = n.position.y;
    return x < nx + nodeW(n) + GAP && nx < x + NEW_W + GAP
      && y < ny + nodeH(n) + GAP && ny < y + NEW_H + GAP;
  });
  for (let i = 0; i < others.length + 1; i++) {
    const x = horizontal ? main : cross;
    const y = horizontal ? cross : main;
    const hit = overlaps(x, y);
    if (!hit) break;
    cross = crossOf(hit) + crossSize(hit) + GAP; // skok za blokujícího → monotónní
  }
  return horizontal ? { x: main, y: cross } : { x: cross, y: main };
}

export function layoutTree(nodes, edges, direction = 'vertical', opts = {}) {
  const horizontal = direction === 'horizontal';
  const STEP = opts.step ?? 280;        // svislý rozestup úrovní (vertikální režim)
  // krok ZA vrcholem — apex je kruh 260 px (vyšší/užší než běžná karta), takže
  // první úroveň potřebuje vlastní odstup v OBOU směrech. Bez toho sběrnice
  // hran první řady protínala kruh (Richard 31. 7.: „mezera mezi hlavním uzlem
  // a druhou řadou"). ⚠️ Držet v syncu s layoutTreeServer (helpers.js).
  const APEX_STEP = opts.apexStep ?? 380;
  const H_NODE_STEP = opts.step ?? 280; // vodorovně: krok mezi hlubšími úrovněmi
  // min. rozestup sourozenců (příčná osa); opts.slot pro těsnější layout (Moje mapa)
  // Svisle 270 (Richard 11. 8. v noci: „do šířky jsou moc velké mezery, trochu
  // je zmenši — mezera mezi řádky je dobrá"): karta je 220 široká, mezera tedy
  // klesla z 80 na 50 px. Svislý krok (STEP) zůstává.
  // ⚠️ Vodorovný směr zůstává na 250 schválně: tam je příčná osa VÝŠKA karty,
  // která roste s délkou textu, takže rezerva musí být větší.
  const SLOT = opts.slot ?? (horizontal ? 250 : 270);
  // pozice hlavní osy pro danou hloubku
  const mainAt = (depth) => {
    if (depth === 0) return 0;
    return APEX_STEP + (depth - 1) * (horizontal ? H_NODE_STEP : STEP);
  };

  // Object.create(null): uzel s id „__proto__" / „constructor" by u obyčejného
  // objektu netrefil vlastní klíč, ale zděděnou vlastnost — a layout spadl na
  // „push is not a function" (ověřeno; panel /checkup 12. 8.). Se zámkem se
  // layout pouští hned při otevření mapy, takže by taková mapa shodila editor.
  const childrenMap = Object.create(null);
  const parentMap = Object.create(null);
  for (const edge of edges) {
    (childrenMap[edge.source] = childrenMap[edge.source] || []).push(edge.target);
    parentMap[edge.target] = edge.source;
  }
  // sticky-note uzly z layoutu vynechat — drží si manuální pozici
  const layoutNodes = nodes.filter((n) => n.type !== 'note');
  const lookup = Object.create(null);
  layoutNodes.forEach((n) => { lookup[n.id] = n; });
  // příčná osa (řazení sourozenců): vodorovně = y, svisle = x
  const crossOf = (id) => { const p = lookup[id]?.position; return (horizontal ? p?.y : p?.x) ?? 0; };
  // Velikost uzlu na PŘÍČNÉ ose — algoritmus pracuje se STŘEDY (rodič nad
  // prostředním dítětem), ale ReactFlow pozice je levý horní roh. Bez převodu
  // přes skutečnou šířku byl kruhový vrchol (260) o 20 px vedle karet (220) —
  // Richard 31. 7.: „měl by být stejně s tím prostředním".
  const crossSizeOf = (id) => {
    const n = lookup[id];
    const measured = horizontal ? n?.measured?.height : n?.measured?.width;
    if (measured) return measured;
    if (n?.type === 'apexNode') return 260;
    if (n?.type === 'personalRoot') return 120;
    return horizontal ? 170 : 220;
  };

  // Rozměr uzlu na HLAVNÍ ose (svisle výška karty, vodorovně šířka) — opak
  // crossSizeOf. Používá ho rozmístění kolem vrcholu i dvouřadé balení, proto
  // stojí tady a ne uvnitř jednoho z nich.
  const hlavniSizeOf = (id) => {
    const n = lookup[id];
    const measured = horizontal ? n?.measured?.width : n?.measured?.height;
    if (measured) return measured;
    if (n?.type === 'apexNode') return 260;
    if (n?.type === 'personalRoot') return 120;
    return horizontal ? 220 : 170;
  };

  // ---- SEVŘENÉ STYLY: střídání přes neviditelné VZPĚRY ----
  // (Richard 11. 8. 2026: „úvodní mapa je hrozně široká… vymyslet něco nového"
  // + „tlačítko zarovnat ať střídá styly, ať jsou 3" — klasika = bez opts.)
  // Dva režimy nad rodičem s ≥3 LISTOVÝMI SKUPINAMI (dítě, jehož děti jsou
  // samé listy):
  //  · opts.stagger=2 — KOMPAKT: každá druhá skupina dostane vzpěru mezi sebe
  //    a své listy → listy se střídají ve dvou patrech, skupiny drží řadu.
  //  · opts.bands=2 — PO KATEGORIÍCH (Richardův návrh): každá druhá skupina
  //    dostane řetěz DVOU vzpěr mezi RODIČE a sebe → celý její blok (kategorie
  //    + cíle) spadne do spodního pásu pod první pás.
  // Tidy tree hlídá kontury jen ve společných hloubkách, takže snížené řady
  // přirozeně podsune pod mělké — šířka klesá. Vzpěry drží v horních patrech
  // volný svislý koridor, kudy vede hrana dolů (nikdy přes cizí kartu).
  // ⚠️ Sync se serverem (helpers.js:layoutTreeServer) hlídá tests/layout-parity.js.
  const stagger = Number(opts.stagger) || 0;
  const bands = Number(opts.bands) || 0;
  const isLeafId = (id) => !((childrenMap[id] || []).filter((c) => lookup[c]).length);
  const nahradniDeti = Object.create(null); // id → přepsané děti (vzpěry v řetězu)
  const swapChild = Object.create(null);    // id skupiny → hlava řetězu vzpěr (režim pásů)
  const reprOf = Object.create(null);       // id vzpěry → skupina, kterou zastupuje
  const phantoms = [];
  // Uzly, jejichž potomstvo už přeuspořádaly vzpěry. Dvouřadé balení se jich
  // NESMÍ dotknout — jinak by přepsalo rozložení schválené 11. 8. (ověřeno:
  // bez téhle množiny se změnily všechny tři styly na mapě s listovými
  // skupinami, tedy přesně to, co Richard odklikal).
  const resenoVzperami = new Set();
  // Řetěz `kolik` vzpěr mezi RODIČE a uzel `g` → celý blok uzlu spadne o tolik
  // pater níž. Délka řetězu je jediný rozdíl mezi pásem (2) a shozením
  // samotné karty o patro (1).
  const shodOPatra = (g, kolik) => {
    let hlava = null, predchozi = null;
    for (let k = 0; k < kolik; k++) {
      const ph = '::pas::' + g + '::' + k;
      reprOf[ph] = g;
      phantoms.push(ph);
      if (predchozi) nahradniDeti[predchozi] = [ph]; else hlava = ph;
      predchozi = ph;
    }
    nahradniDeti[predchozi] = [g];
    swapChild[g] = hlava;
  };
  if (stagger >= 2 || bands >= 2) for (const n of layoutNodes) {
    const kids = (childrenMap[n.id] || []).filter((c) => lookup[c]);
    // Střídá se to, co uživatel VIDÍ zleva doprava (řazení dle pozic), a tak,
    // aby dolů šla i POSLEDNÍ skupina (Richard 11. 8.: „na střídačku i ten
    // poslední") — při lichém počtu jde dolů 1., 3., 5.…, při sudém 2., 4.…
    const dlePozice = (a, b) => crossOf(a) - crossOf(b);
    const listoveSkupiny = kids
      .filter((c) => { const g = (childrenMap[c] || []).filter((x) => lookup[x]); return g.length >= 2 && g.every(isLeafId); })
      .sort(dlePozice);
    // CO SE STŘÍDÁ (Richard 11. 8. v noci: „když ho zmáčknu, musí se něco stát
    // NA KAŽDÉ MAPĚ"). Původní verze uměla jen listové skupiny, takže na mapě
    // bez nich tlačítko mlčelo a vypadalo rozbitě — na hluboké mapě (kategorie
    // mají vnoučata) i na úplně mělké (vrchol a jedna řada karet). Pořadí
    // kandidátů drží schválené chování první: kde listové skupiny jsou, mění se
    // přesně to co dřív, jinak se sáhne níž.
    const cile = listoveSkupiny;
    // ⚠️ ZMĚŘENO A ZAMÍTNUTO (11. 8. v noci): pustit pásy i na kategorie
    // s vnoučaty (aby zabraly na hluboké mapě) mapu NEZUŽUJE, ale ROZŠIŘUJE
    // — 1800 → 2400. Vzpěra drží slot v horní řadě a shozený podstrom se
    // v hlubších patrech pere s ostatními. Hluboké mapy proto řeší až
    // dvouřadé balení níž, ne pásy.
    // Samotné karty bez podcílů vzpěry taky neřeší (vzpěra by jim držela slot
    // a neušetřila nic) — ty zabalí rovněž DVOUŘADÉ BALENÍ.
    if (cile.length < 3) continue;
    const skupinovyKompakt = stagger >= 2;
    // Parita střídání (Richard 11. 8. večer):
    //  · KOMPAKT (listy do pater): první skupina dolů a střídat — u lichého
    //    počtu tak jde dolů i POSLEDNÍ („jako na mém obrázku").
    //  · PO KATEGORIÍCH (celé bloky): první nahoře a střídat — nová kategorie
    //    tak vždy jen POKRAČUJE doprava dolů/nahoru a stávající se nepřeskládají
    //    („kdyby byla další kategorie a šlo doprava dolů, je to správně").
    const dolu = (i) => (bands >= 2 ? i % 2 === 1 : i % 2 === 0);
    // celá soustava skupin je jeden schválený celek — i ta, co zůstala nahoře
    cile.forEach((g) => resenoVzperami.add(g));
    cile.forEach((g, i) => {
      if (!dolu(i)) return;
      if (skupinovyKompakt) {
        // jedna vzpěra mezi skupinu a JEJÍ LISTY (víc pater se neosvědčilo —
        // tidy tree je pakuje stejně široko, změřeno 11. 8.). Skupina drží řadu,
        // stěhují se jen její listy.
        const ph = '::mezipatro::' + g;
        nahradniDeti[g] = [ph];
        nahradniDeti[ph] = (childrenMap[g] || []).filter((x) => lookup[x]);
        phantoms.push(ph);
        return;
      }
      shodOPatra(g, 2);   // pásy: řetěz dvou vzpěr mezi rodičem a kategorií
    });
  }
  const kidsOf = (id) => {
    const base = nahradniDeti[id] ? nahradniDeti[id] : (childrenMap[id] || []).filter((c) => lookup[c]);
    // výměnu skupiny za řetěz vzpěr dělá jen SKUTEČNÝ rodič — vzpěra v řetězu
    // už vede na skupinu napřímo (jinak by se řetěz zacyklil)
    return reprOf[id] ? base : base.map((c) => swapChild[c] || c);
  };

  // stromové uzly (sourozenci seřazeni dle aktuální příčné pozice → zachová pořadí)
  const T = Object.create(null);
  layoutNodes.forEach((n) => {
    T[n.id] = { id: n.id, children: [], parent: null, number: 0, prelim: 0, mod: 0, shift: 0, change: 0, thread: null, ancestor: null };
  });
  for (const ph of phantoms) {
    T[ph] = { id: ph, phantom: true, children: [], parent: null, number: 0, prelim: 0, mod: 0, shift: 0, change: 0, thread: null, ancestor: null };
  }
  // vzpěra se řadí podle SKUPINY, kterou zastupuje (jinak by bez pozice spadla na kraj)
  const crossEff = (id) => crossOf(reprOf[id] || id);
  Object.keys(T).forEach((id) => {
    const kids = kidsOf(id)
      .filter((c) => T[c])
      .sort((a, b) => crossEff(a) - crossEff(b))
      .map((c) => T[c]);
    kids.forEach((k, i) => { k.parent = T[id]; k.number = i + 1; });
    T[id].children = kids;
  });
  const roots = layoutNodes
    .filter((n) => !parentMap[n.id] && T[n.id])
    .map((n) => T[n.id])
    .sort((a, b) => crossOf(a.id) - crossOf(b.id));
  // virtuální super-kořen, aby se více stromů poskládalo vedle sebe
  const VROOT = { id: null, children: roots, parent: null, number: 1, prelim: 0, mod: 0, shift: 0, change: 0, thread: null, ancestor: null };
  roots.forEach((r, i) => { r.parent = VROOT; r.number = i + 1; });
  Object.keys(T).forEach((id) => { T[id].ancestor = T[id]; });

  const nextLeft = (v) => (v.children.length ? v.children[0] : v.thread);
  const nextRight = (v) => (v.children.length ? v.children[v.children.length - 1] : v.thread);
  const leftSibling = (v) => (v.parent && v.number > 1 ? v.parent.children[v.number - 2] : null);

  const moveSubtree = (wm, wp, shift) => {
    const subtrees = wp.number - wm.number;
    wp.change -= shift / subtrees;
    wp.shift += shift;
    wm.change += shift / subtrees;
    wp.prelim += shift;
    wp.mod += shift;
  };
  const executeShifts = (v) => {
    let shift = 0, change = 0;
    for (let i = v.children.length - 1; i >= 0; i--) {
      const w = v.children[i];
      w.prelim += shift;
      w.mod += shift;
      change += w.change;
      shift += w.shift + change;
    }
  };
  const ancestorFn = (vim, v, defaultAncestor) => (v.parent.children.includes(vim.ancestor) ? vim.ancestor : defaultAncestor);

  const apportion = (v, defaultAncestor, distance) => {
    const w = leftSibling(v);
    if (!w) return defaultAncestor;
    let vip = v, vop = v, vim = w, vom = v.parent.children[0];
    let sip = vip.mod, sop = vop.mod, sim = vim.mod, som = vom.mod;
    // ⚠️ STROP KROKŮ. Když dva sourozenci sestoupí do sdíleného cyklu, tahle
    // smyčka se NIKDY neukončí a karta prohlížeče zatuhne na 100 % CPU
    // (ověřeno na mapě o 4 uzlech). Pojistky _fw/_sw hlídají jen rekurzi.
    // Se zámkem se layout pouští už při OTEVŘENÍ mapy, takže by uživatele
    // vyzamkla i z mapy sdílené od kolegy. Radši křivý layout než zamrznutí.
    // ⚠️ STROP JE POJISTKA, NE OPRAVA — a od 13. 8. 2026 už jen pro mapy, které
    // v databázi vznikly DŘÍV. Nové takové mapy nevzniknou (lib/mapStructure.js
    // + goalmaps hooky). Strop nechat: staré mapy musí jít otevřít a opravit.
    let kroku = 0;
    const STROP = layoutNodes.length * 4 + 16;
    while (nextRight(vim) && nextLeft(vip)) {
      if (++kroku > STROP) break;
      vim = nextRight(vim);
      vip = nextLeft(vip);
      vom = nextLeft(vom);
      vop = nextRight(vop);
      vop.ancestor = v;
      const shift = (vim.prelim + sim) - (vip.prelim + sip) + distance;
      if (shift > 0) {
        moveSubtree(ancestorFn(vim, v, defaultAncestor), v, shift);
        sip += shift;
        sop += shift;
      }
      sim += vim.mod;
      sip += vip.mod;
      som += vom.mod;
      sop += vop.mod;
    }
    if (nextRight(vim) && !nextRight(vop)) {
      vop.thread = nextRight(vim);
      vop.mod += sim - sop;
    }
    if (nextLeft(vip) && !nextLeft(vom)) {
      vom.thread = nextLeft(vip);
      vom.mod += sip - som;
      defaultAncestor = v;
    }
    return defaultAncestor;
  };

  const firstWalk = (v, distance) => {
    if (v._fw) return; // pojistka: cyklická hrana by jinak zacyklila rekurzi
    v._fw = true;
    if (v.children.length === 0) {
      const w = leftSibling(v);
      v.prelim = w ? w.prelim + distance : 0;
    } else {
      let defaultAncestor = v.children[0];
      for (const w of v.children) {
        firstWalk(w, distance);
        defaultAncestor = apportion(w, defaultAncestor, distance);
      }
      executeShifts(v);
      // Rodič nad PROSTŘEDNÍM dítětem (medián), ne nad středem rozpětí — u
      // nestejně košatých podstromů střed rozpětí tahal rodiče mimo prostřední
      // větev a svislá spojnice uhýbala (Richard 31. 7.). Sudý počet dětí =
      // průměr dvou prostředních. ⚠️ Sync s layoutTreeServer (helpers.js).
      const k = v.children.length;
      const midpoint = k % 2
        ? v.children[(k - 1) / 2].prelim
        : (v.children[k / 2 - 1].prelim + v.children[k / 2].prelim) / 2;
      const w = leftSibling(v);
      if (w) {
        v.prelim = w.prelim + distance;
        v.mod = v.prelim - midpoint;
      } else {
        v.prelim = midpoint;
      }
    }
  };

  const positions = Object.create(null);
  const secondWalk = (v, m, depth) => {
    if (v._sw) return; // pojistka proti cyklu
    v._sw = true;
    if (v.id != null && !v.phantom) { // vzpěra je jen výplň — pozici nedostává
      const cross = v.prelim + m - crossSizeOf(v.id) / 2; // střed → levý horní roh
      const main = mainAt(depth);
      positions[v.id] = horizontal ? { x: main, y: cross } : { x: cross, y: main };
    }
    for (const w of v.children) secondWalk(w, m + v.mod, depth + 1);
  };

  if (roots.length) {
    firstWalk(VROOT, SLOT);
    secondWalk(VROOT, -VROOT.prelim, -1);
  }

  // ---- DVOUŘADÉ BALENÍ ŘADY KARET ----
  // Řada karet BEZ podcílů (typicky čerstvě založená mapa: vrchol a šest
  // bodů vedle sebe) je nejširší možný tvar a zároveň jediný, kde vzpěry
  // nepomůžou: vzpěra by v horní řadě držela slot a šířka by zůstala stejná
  // (změřeno 11. 8. — 1500 → 1500, tlačítko vypadalo rozbitě).
  // Zabalí se proto až po výpočtu: každá druhá karta spadne o patro a krok
  // se zmenší na polovinu, takže spodní karty sedí v mezerách horních
  // (Richardův obrázek z 11. 8. v noci). Rozestup KARET V TÉŽE ŘADĚ zůstává
  // plný SLOT, takže se nikde nepřekrývají, a hrana rodiče vede dolů mezerou.
  // ⚠️ Sync se serverem (helpers.js:layoutTreeServer) hlídá tests/layout-parity.js.
  // ---- KOLEM VRCHOLU (jen „po kategoriích" na mapě o jedné řadě) ----
  // Richard 11. 8. v noci nakreslil, jak by čerstvá mapa měla vypadat: karty
  // obcházejí vrchol do „U" — levý sloupec shora dolů, spodní řada zleva
  // doprava, pravý sloupec shora dolů (14. 8.: dřív zdola nahoru „po dráze U",
  // ale číslované kroky se pak četly pozpátku — šablona 8D měla D8 nad D7).
  // Pouští se JEN když je pod vrcholem jedna řada karet bez podcílů; jakmile
  // mapa dostane hloubku, platí zase pásy („o kategorie v hloubce nechci
  // přijít, to fungovalo dobře").
  // ⚠️ KRAJNÍ MEZE „U" MUSÍ DRŽET POŘADÍ ČTENÍ. Layout čte pořadí sourozenců
  // z pozic (crossEff výš) — jakmile jedna karta „přeskočí" přes jinou skupinu
  // (spodní řada dřív podjížděla sloupce), další přerovnání pořadí prohodí
  // a autosave ho zapeče do mapy napořád (nález Richarda 14. 8., šablona 8D:
  // D3 před D1). Proto: sloupce stojí až ZA krajem spodní řady a karty v témže
  // sloupci sdílejí JEDNOTNOU příčnou pozici (shodné hodnoty řadí stabilní
  // sort v pořadí hran). Hlídá layout-parity, sekce „čitelné pořadí".
  if (bands >= 2 && roots.length === 1) {
    const vrchol = roots[0].id;
    const deti = (childrenMap[vrchol] || []).filter((c) => lookup[c] && positions[c]);
    const jednaRada = deti.length >= 3 && deti.every(isLeafId) && deti.length === layoutNodes.length - 1;
    if (jednaRada) {
      const serazene = deti.slice().sort((a, b) =>
        (horizontal ? positions[a].y - positions[b].y : positions[a].x - positions[b].x));
      const n = serazene.length;
      const vlevo = Math.floor(n / 3);
      const vpravo = Math.floor(n / 3);
      const dole = n - vlevo - vpravo;
      const stred = positions[vrchol];
      // Mezery se měří od OKRAJE kruhu ke kartě, ne od rohu vrcholu — jinak
      // vyjdou zbytečně velké (Richard 11. 8. v noci: „zmenšil bych všechny
      // mezery", vlastní kresba měla karty těsně u vrcholu).
      const MEZERA = 80;
      // Střed „U" je STŘED kruhu, ne jeho levý horní roh (pozice je roh) —
      // s rohem bylo celé rozmístění o půl vrcholu ujeté a spodní řada
      // začínala vlevo před levým sloupcem.
      const stredDx = crossSizeOf(vrchol) / 2;
      const stredDy = hlavniSizeOf(vrchol) / 2;
      // ⚠️ Rozestupy se počítají ze SKUTEČNÝCH rozměrů karet, ne z pevných
      // čísel. Původní konstanty (rada = SLOT−50, spodek = APEX_STEP−40)
      // nerostly s délkou sloupce, takže se karty překrývaly — běžná mapa od
      // 9 karet, „Moje mapa" (slot 120) už od 4 (panel /checkup 12. 8.).
      // Sloupec běží po HLAVNÍ ose (svisle výška karty, vodorovně šířka),
      // proto se rozměr bere z opačné osy než crossSizeOf.
      const maxHlavni = Math.max(...serazene.map(hlavniSizeOf), 0);
      const maxPricny = Math.max(...serazene.map(crossSizeOf), 0);
      const rada = maxHlavni + MEZERA;                 // rozestup karet ve sloupci
      // Poslední řada musí být ZA koncem nejdelšího sloupce, jinak se s ním
      // potká v rohu (u dlouhých sloupců se to dřív překrývalo).
      const nejdelsiSloupec = Math.max(vlevo, vpravo);
      const dosahSloupce = ((nejdelsiSloupec - 1) / 2) * rada + maxHlavni / 2;
      const spodek = Math.max(APEX_STEP - 40, dosahSloupce + MEZERA + maxHlavni / 2);
      const krokDole = Math.max(SLOT, maxPricny + 50);
      // Sloupce až ZA krajem spodní řady (viz pořadí čtení výš); u krátké
      // spodní řady zůstávají těsně u kruhu jako dřív.
      const dosahRady = ((dole - 1) / 2) * krokDole + maxPricny / 2;
      const odsazeniSloupce = Math.max(stredDx + MEZERA, dosahRady + MEZERA);
      const doleva = -(odsazeniSloupce + maxPricny);
      const doprava = odsazeniSloupce;
      const umisti = (id, dx, dy) => {
        positions[id] = horizontal
          ? { x: stred.x + dy, y: stred.y + dx }
          : { x: stred.x + dx, y: stred.y + dy };
      };
      const sloupec = (pocet) => Array.from({ length: pocet }, (_, i) => (i - (pocet - 1) / 2) * rada);
      const ylevo = sloupec(vlevo), ypravo = sloupec(vpravo);
      const xdole = Array.from({ length: dole }, (_, i) => (i - (dole - 1) / 2) * krokDole);
      serazene.forEach((id, i) => {
        if (i < vlevo) return umisti(id, stredDx + doleva, stredDy + ylevo[i] - hlavniSizeOf(id) / 2);
        if (i < vlevo + dole) return umisti(id, stredDx + xdole[i - vlevo] - crossSizeOf(id) / 2, stredDy + spodek - hlavniSizeOf(id) / 2);
        // pravý sloupec SHORA DOLŮ — číslované kroky se čtou očima, ne po dráze
        return umisti(id, stredDx + doprava, stredDy + ypravo[i - vlevo - dole] - hlavniSizeOf(id) / 2);
      });
      return positions;
    }
  }

  if (stagger >= 2 || bands >= 2) {
    const hlavniOsa = (id) => (horizontal ? positions[id].x : positions[id].y);
    const pricnaOsa = (id) => (horizontal ? positions[id].y : positions[id].x);
    for (const n of layoutNodes) {
      if (resenoVzperami.has(n.id)) continue; // schválené rozložení nepřepisovat
      const kids = (childrenMap[n.id] || []).filter((c) => lookup[c] && positions[c]);
      // jen ucelená řada listů — kdyby mezi nimi byla větev, zabalením by se
      // karty dostaly nad její podstrom
      if (kids.length < 3 || !kids.every(isLeafId)) continue;
      const radaOd = kids.slice().sort((a, b) => pricnaOsa(a) - pricnaOsa(b));
      const kroky = radaOd.map(pricnaOsa);
      const stred = (kroky[0] + kroky[kroky.length - 1]) / 2;
      // Karty v TÉŽE řadě jsou od sebe 2×krok — musí se vejít vedle sebe.
      // `SLOT` je rozestup pro JEDNU řadu; v „Moje mapě" je 120, takže
      // SLOT/2 = 60 pokládalo karty přes sebe (panel /checkup 12. 8.).
      const nejsirsi = Math.max(...radaOd.map((c) => crossSizeOf(c)), 0);
      const krok = Math.max(SLOT, nejsirsi + 50) / 2;
      const start = stred - ((radaOd.length - 1) * krok) / 2;
      // Spodní řada jde blíž než celý krok úrovně (Richard 11. 8. v noci:
      // „maličko zmenšit mezeru mezi 2. a 3. řadou"). Míň už ne — sousední
      // karty z obou řad se vodorovně překrývají o půl kroku, takže svislá
      // mezera je jediné, co je drží čitelné.
      // ⚠️ A NIKDY MÍŇ, NEŽ JE KARTA VYSOKÁ. Pevných 240 stačilo jen na běžné
      // karty; karta s dlouhým názvem, termínem, garantem a pruhem pokroku
      // přes 240 přeleze a řady se překryjí (nález panelu 12. 8. 2026).
      // Rezerva u pevného kroku byla jen 13 px proti reálně nejvyšší kartě
      // (227 px, změřeno v sadě čitelnosti), takže to bylo blíž, než se zdálo.
      const nejvyssiKarta = Math.max(...radaOd.map(hlavniSizeOf), 0);
      const patro = Math.max((horizontal ? H_NODE_STEP : STEP) - 40, nejvyssiKarta + 40);
      radaOd.forEach((c, i) => {
        // Parita jde po sémantice stylů: KOMPAKT nechává první kartu nahoře
        // (Richardův obrázek), PÁSY shazují první dolů. Bez toho rozdílu vyšly
        // oba styly na hluboké mapě IDENTICKY a druhý stisk zase „nic nedělal"
        // — chytila to sada „žádný styl nesmí mlčet".
        const posun = (bands >= 2 ? i % 2 === 0 : i % 2 === 1) ? patro : 0;
        const cross = start + i * krok;
        const main = hlavniOsa(c) + posun;
        positions[c] = horizontal ? { x: main, y: cross } : { x: cross, y: main };
      });
    }
  }
  return positions;
}
