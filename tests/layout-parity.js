// Parita layoutu: frontend lib/treeLayout.js (svisle) MUSÍ vracet shodné pozice jako
// serverový port pb_hooks/helpers.js:layoutTreeServer (instancování šablon). Chrání
// proti tichému driftu dvou ručních kopií (à la 576×1024). + kontrola vodorovného směru.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

// vytáhni samostatnou funkci ze zdroje (balancování složených závorek)
function extractFn(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('funkce nenalezena: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

// stromy k porovnání: [id, parentId|null]
const TREES = {
  'list vedle košatého (R→A,B(3),C)': [['R', null], ['A', 'R'], ['B', 'R'], ['C', 'R'], ['B1', 'B'], ['B2', 'B'], ['B3', 'B']],
  'hluboký řetěz': [['R', null], ['A', 'R'], ['B', 'A'], ['C', 'B'], ['D', 'C']],
  'více kořenů': [['R1', null], ['a', 'R1'], ['b', 'R1'], ['R2', null], ['c', 'R2']],
  'jeden uzel': [['R', null]],
  'košatý (R→5×(2))': [['R', null],
    ['c1', 'R'], ['c2', 'R'], ['c3', 'R'], ['c4', 'R'], ['c5', 'R'],
    ['c1a', 'c1'], ['c1b', 'c1'], ['c3a', 'c3'], ['c3b', 'c3'], ['c5a', 'c5'], ['c5b', 'c5']],
  'nevyvážený': [['R', null], ['A', 'R'], ['B', 'R'], ['A1', 'A'], ['A1a', 'A1'], ['A1a1', 'A1a']],
};

// Stromy s NETYPICKÝM kořenem. Parita dlouho porovnávala jen `goalNode`, takže
// přehlédla, že server neznal `personalRoot` (kruh 120 vs. 220 = 50 px drift).
// Nález panelu 12. 8. 2026 — test, který typy nerozliší, tuhle třídu nevidí.
const TREES_TYPY = {
  'osobní kořen (Moje mapa)': { koren: 'personalRoot', pary: [['R', null], ['a', 'R'], ['b', 'R'], ['c', 'R']] },
  'kruhový vrchol projektu': { koren: 'apexNode', pary: [['R', null], ['a', 'R'], ['b', 'R'], ['c', 'R']] },
};

function build(pairs) {
  // position.x = pořadí sourozence (deterministické řazení crossOf)
  const orderByParent = {};
  const nodes = pairs.map(([id, parent]) => {
    orderByParent[parent] = (orderByParent[parent] || 0);
    const x = orderByParent[parent]++;
    return { id, type: 'goalNode', position: { x: x * 10, y: 0 } };
  });
  const edges = pairs.filter(([, p]) => p).map(([id, p]) => ({ id: p + '-' + id, source: p, target: id }));
  return { nodes, edges };
}

(async () => {
  const layoutTree = (await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/treeLayout.js')).href)).layoutTree;
  const helpersSrc = fs.readFileSync(path.join(__dirname, '../server/pb_hooks/helpers.js'), 'utf8');
  // eslint-disable-next-line no-eval
  const layoutTreeServer = eval('(' + extractFn(helpersSrc, 'layoutTreeServer') + ')');

  console.log('== PARITA frontend(svisle) ↔ server ==');
  for (const [name, pairs] of Object.entries(TREES)) {
    const { nodes, edges } = build(pairs);
    const fe = layoutTree(nodes, edges, 'vertical');
    const sv = layoutTreeServer(nodes, edges);
    const ids = nodes.map((n) => n.id);
    let bad = null;
    for (const id of ids) {
      const a = fe[id], b = sv[id];
      if (!a || !b || Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001) { bad = `${id}: FE(${a && Math.round(a.x)},${a && Math.round(a.y)}) ≠ SRV(${b && Math.round(b.x)},${b && Math.round(b.y)})`; break; }
    }
    ok(!bad, `„${name}" bit-identická parita FE↔server${bad ? ' — ' + bad : ''}`);
  }

  console.log('== PARITA i pro netypické kořeny (apexNode / personalRoot) ==');
  for (const [jmeno, def] of Object.entries(TREES_TYPY)) {
    const { nodes, edges } = build(def.pary);
    const sTypem = nodes.map((n) => (n.id === 'R' ? { ...n, type: def.koren } : n));
    for (const [styl, opts] of [['klasika', {}], ['kompakt', { stagger: 2 }], ['kolem středu', { bands: 2 }]]) {
      const fe = layoutTree(sTypem, edges, 'vertical', opts);
      const sv = layoutTreeServer(sTypem, edges, opts);
      let bad = null;
      for (const n of sTypem) {
        const a = fe[n.id], b = sv[n.id];
        if (!a || !b || Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001) {
          bad = `${n.id}: FE(${Math.round(a.x)}) ≠ SRV(${Math.round(b.x)})`; break;
        }
      }
      ok(!bad, `${jmeno} / ${styl}: parita FE↔server${bad ? ' — ' + bad : ''}`);
    }
  }

  console.log('== SEVŘENÉ styly (opts.stagger 2/3): parita + užší mapa + volné koridory ==');
  {
    // 5 listových skupin à 4 listy — vzor úvodní mapy admina (Richard 11. 8.)
    const pairs = [['R', null]];
    for (let s = 1; s <= 5; s++) {
      pairs.push([`s${s}`, 'R']);
      for (let l = 1; l <= 4; l++) pairs.push([`s${s}l${l}`, `s${s}`]);
    }
    const { nodes, edges } = build(pairs);
    // třetí styl „po kategoriích" (Richardův návrh 11. 8.): celé skupiny
    // střídavě do dvou pásů přes řetěz dvou vzpěr mezi rodičem a skupinou
    const BANDS = { bands: 2 };
    for (const [name, opts] of [['klasika', {}], ['kompakt', { stagger: 2 }], ['po kategoriích', BANDS]]) {
      const fe = layoutTree(nodes, edges, 'vertical', opts);
      const sv = layoutTreeServer(nodes, edges, opts);
      let bad = null;
      for (const n of nodes) {
        const a = fe[n.id], b = sv[n.id];
        if (!a || !b || Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001) { bad = n.id; break; }
      }
      ok(!bad, `parita FE↔server i pro styl ${name}${bad ? ' — ' + bad : ''}`);
    }
    const sirka = (p) => {
      const xs = Object.values(p).map((q) => q.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    const klas = layoutTree(nodes, edges, 'vertical');
    const komp = layoutTree(nodes, edges, 'vertical', { stagger: 2 });
    const pasy = layoutTree(nodes, edges, 'vertical', BANDS);
    // vzpěry si v horním patře nechávají slot pro svislý koridor, takže
    // teoretická polovina to není — hlídá se, že úspora nezmizí
    ok(sirka(komp) <= sirka(klas) * 0.75, `kompakt je znatelně užší (${Math.round(sirka(komp))} vs ${Math.round(sirka(klas))})`);
    ok(sirka(pasy) <= sirka(klas) * 0.75, `pásy jsou znatelně užší (${Math.round(sirka(pasy))} vs ${Math.round(sirka(klas))})`);
    // kompakt: sekce v JEDNÉ řadě; PRVNÍ skupina dolů a střídat, u lichého
    // počtu jde dolů i POSLEDNÍ (Richard: „na střídačku i ten poslední")
    ok(komp.s1.y === komp.s2.y && komp.s2.y === komp.s3.y && komp.s3.y === komp.s4.y && komp.s4.y === komp.s5.y,
      'kompakt: sekce zůstávají v jedné řadě');
    ok(komp.s1l1.y === komp.s3l1.y && komp.s3l1.y === komp.s5l1.y && komp.s2l1.y === komp.s4l1.y && komp.s1l1.y > komp.s2l1.y,
      `kompakt: dolů 1./3./5. včetně poslední (${komp.s2l1.y} / ${komp.s1l1.y})`);
    // pásy: CELÉ kategorie ve dvou pásech (s1/s3/s5 nahoře, s2/s4 dole i s listy)
    ok(pasy.s1.y === pasy.s3.y && pasy.s3.y === pasy.s5.y && pasy.s2.y === pasy.s4.y && pasy.s2.y > pasy.s1.y,
      `pásy: kategorie ve dvou pásech (${pasy.s1.y} / ${pasy.s2.y})`);
    ok(pasy.s2l1.y > pasy.s1l1.y && pasy.s2.y > pasy.s1l1.y,
      `pásy: spodní kategorie začíná až POD listy horního pásu (${pasy.s2.y} > ${pasy.s1l1.y})`);
    // volné koridory: svislice pod sníženou sekcí nesmí protínat kartu VÝŠE
    // položeného patra (karta 220 ⇒ |Δstředů| ≥ 110 + rezerva)
    const koridorOk = (p, snizene) => {
      for (const s of snizene) {
        const cx = p[s].x + 110;
        for (let q = 1; q <= 5; q++) for (let l = 1; l <= 4; l++) {
          const jine = p[`s${q}l${l}`];
          if (jine.y >= p[`${s}l1`].y) continue; // hlídáme jen patra NAD listy snížené skupiny
          if (Math.abs(cx - (jine.x + 110)) < 115) return `${s}↓ přes s${q}l${l}`;
        }
      }
      return null;
    };
    const k1 = koridorOk(komp, ['s1', 's3', 's5']);
    ok(!k1, `kompakt: koridory volné${k1 ? ' (' + k1 + ')' : ''}`);
    // pásy: svislice ke snížené KATEGORII nesmí protínat sekce ani listy
    // horního pásu (vše, co je nad y snížené sekce)
    let k2 = null;
    for (const dolni of ['s2', 's4']) {
      const cx = pasy[dolni].x + 110;
      for (const id of ['s1', 's3', 's5', 's1l1', 's1l2', 's1l3', 's1l4', 's3l1', 's3l2', 's3l3', 's3l4', 's5l1', 's5l2', 's5l3', 's5l4']) {
        if (pasy[id].y >= pasy[dolni].y) continue;
        if (Math.abs(cx - (pasy[id].x + 110)) < 115) k2 = `${dolni}↓ přes ${id}`;
      }
    }
    ok(!k2, `pásy: koridory volné${k2 ? ' (' + k2 + ')' : ''}`);
    // klasika beze změny: bez opts se patra NEZAPÍNAJÍ
    ok(klas.s1l1.y === klas.s2l1.y, 'bez opts.stagger zůstává původní layout');
    // vzpěry jsou interní — do výstupu NESMÍ prosakovat (FE ani server)
    const maPhantom = (p) => Object.keys(p).some((k) => k.startsWith('::'));
    const svKomp = layoutTreeServer(nodes, edges, { stagger: 2 });
    const svPasy = layoutTreeServer(nodes, edges, BANDS);
    ok(![komp, pasy, svKomp, svPasy].some(maPhantom), 'klíče vzpěr neprosakují do pozic');
  }

  console.log('== VODOROVNÝ směr (frontend) — kompaktní, bez překrytí ==');
  {
    const { nodes, edges } = build(TREES['list vedle košatého (R→A,B(3),C)']);
    const p = layoutTree(nodes, edges, 'horizontal');
    // sourozenci (A,B,C = děti R) stackují svisle → rozestup ~SLOT 250, ne roztažené
    const ys = ['A', 'B', 'C'].map((k) => p[k].y).sort((a, b) => a - b);
    const g1 = ys[1] - ys[0], g2 = ys[2] - ys[1];
    ok(Math.abs(g1 - 250) <= 2 && Math.abs(g2 - 250) <= 2, `vodorovně: sourozenci těsně po SLOT (${Math.round(g1)},${Math.round(g2)})`);
    // hloubka doprava: R=0, děti=APEX_STEP(380), vnuci=380+280 — krok za
    // kruhovým vrcholem se 31. 7. sjednotil na 380 v obou směrech
    ok(p.R.x === 0 && p.A.x === 380 && p.B1.x === 660, `vodorovně: úrovně doprava (R=${p.R.x}, děti=${p.A.x}, vnuci=${p.B1.x})`);
    // žádné překrytí ve stejném sloupci (x)
    let overlap = null;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = p[nodes[i].id], b = p[nodes[j].id];
      if (Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 249) overlap = nodes[i].id + '×' + nodes[j].id;
    }
    ok(!overlap, `vodorovně: žádné překrytí${overlap ? ' (' + overlap + ')' : ''}`);
  }

  console.log('== ŽÁDNÝ STYL NESMÍ MLČET (Richard 11. 8. v noci) ==');
  {
    // „Když tlačítko zmáčknu, musí se něco stát NA KAŽDÉ MAPĚ." Dřív uměly
    // sevřené styly jen listové skupiny, takže na čerstvé i na hluboké mapě
    // nedělaly NIC — a tlačítko vypadalo rozbitě. Sada proto jede přes tvary,
    // které v příkladech opravdu byly.
    const TVARY = {
      'čerstvá mapa (vrchol + 6 karet)': [['R', null], ['a', 'R'], ['b', 'R'], ['c', 'R'], ['d', 'R'], ['e', 'R'], ['f', 'R']],
      'hluboká mapa (kategorie mají vnoučata)': [['R', null],
        ['K1', 'R'], ['K2', 'R'], ['K3', 'R'],
        ['K1a', 'K1'], ['K1b', 'K1'], ['K2a', 'K2'], ['K3a', 'K3'], ['K3b', 'K3'],
        ['K1a1', 'K1a'], ['K1a2', 'K1a'], ['K1a3', 'K1a'],
        ['K3a1', 'K3a'], ['K3a2', 'K3a'], ['K3a3', 'K3a']],
    };
    const sirkaP = (p) => { const xs = Object.values(p).map((v) => v.x); return Math.max(...xs) - Math.min(...xs); };
    for (const [jmeno, pairs] of Object.entries(TVARY)) {
      const { nodes, edges } = build(pairs);
      const klas = layoutTree(nodes, edges, 'vertical', {});
      const komp = layoutTree(nodes, edges, 'vertical', { stagger: 2 });
      const pasy = layoutTree(nodes, edges, 'vertical', { bands: 2 });
      ok(JSON.stringify(komp) !== JSON.stringify(klas), `${jmeno}: kompakt mapou pohne`);
      ok(JSON.stringify(pasy) !== JSON.stringify(klas), `${jmeno}: pásy mapou pohnou`);
      // dva různé styly nesmí dát tentýž obrázek — jinak druhý stisk „nic nedělá"
      ok(JSON.stringify(komp) !== JSON.stringify(pasy), `${jmeno}: kompakt a pásy se liší navzájem`);
      // parita se serverem i pro nové tvary (jinak by AI kreslila jinak než tlačítko)
      for (const [styl, o] of [['kompakt', { stagger: 2 }], ['pásy', { bands: 2 }]]) {
        const fe = layoutTree(nodes, edges, 'vertical', o);
        const sv = layoutTreeServer(nodes, edges, o);
        let bad = null;
        for (const n of nodes) {
          const a = fe[n.id], b = sv[n.id];
          if (!a || !b || Math.abs(a.x - b.x) > 0.001 || Math.abs(a.y - b.y) > 0.001) { bad = n.id; break; }
        }
        ok(!bad, `${jmeno}: parita FE↔server (${styl})${bad ? ' — ' + bad : ''}`);
      }
    }
    // Čerstvá mapa: kompakt ji musí opravdu ZÚŽIT, ne jen přeskládat
    {
      const { nodes, edges } = build(TVARY['čerstvá mapa (vrchol + 6 karet)']);
      const klas = layoutTree(nodes, edges, 'vertical', {});
      const komp = layoutTree(nodes, edges, 'vertical', { stagger: 2 });
      ok(sirkaP(komp) <= sirkaP(klas) * 0.6, `čerstvá mapa: kompakt zúží na polovinu (${Math.round(sirkaP(komp))} vs ${Math.round(sirkaP(klas))})`);
      // druhá řada sedí v mezerách první (proto se ušetří šířka)
      const ys = [...new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((k) => komp[k].y))].sort((x, y) => x - y);
      ok(ys.length === 2, `čerstvá mapa: kompakt dělá dvě patra (${ys.length})`);
      ok(komp.a.y === ys[0] && komp.b.y === ys[1], 'čerstvá mapa: první karta zůstává v horní řadě');
      // karty v TÉŽE řadě se nesmí překrývat (jinak by se text schoval)
      let prekryv = null;
      for (const r of ys) {
        const vRade = ['a', 'b', 'c', 'd', 'e', 'f'].filter((k) => komp[k].y === r).map((k) => komp[k].x).sort((x, y) => x - y);
        for (let i = 1; i < vRade.length; i++) if (vRade[i] - vRade[i - 1] < 260) prekryv = `${r}: ${Math.round(vRade[i] - vRade[i - 1])}`;
      }
      ok(!prekryv, `čerstvá mapa: karty v řadě se nepřekrývají${prekryv ? ' (' + prekryv + ')' : ''}`);
    }
    // Čerstvá mapa + pásy = Richardův obrázek: karty OBCHÁZEJÍ vrchol
    {
      const { nodes, edges } = build(TVARY['čerstvá mapa (vrchol + 6 karet)']);
      const p = layoutTree(nodes, edges, 'vertical', { bands: 2 });
      const listy = ['a', 'b', 'c', 'd', 'e', 'f'];
      ok(listy.some((k) => p[k].y < p.R.y), 'kolem vrcholu: část karet je VEDLE vrcholu, ne pod ním');
      ok(listy.some((k) => p[k].x < p.R.x) && listy.some((k) => p[k].x > p.R.x), 'kolem vrcholu: karty jsou po obou stranách');
      ok(listy.some((k) => p[k].y > p.R.y + 300), 'kolem vrcholu: spodní řada je pod vrcholem');
      // pořadí zůstává čitelné: levý sloupec shora dolů
      ok(p.a.y < p.b.y && Math.abs(p.a.x - p.b.x) < 1, 'kolem vrcholu: levý sloupec drží pořadí shora dolů');
    }
    // Kolem vrcholu i dvouřadé balení MUSÍ držet PRO KAŽDÝ POČET KARET a v obou
    // směrech, včetně „Moje mapy" (PERSONAL_LAYOUT má slot 120, ne 270).
    // ⚠️ Původní verze zkoušela JEN 6 karet na běžné mapě — jediné okno, kde to
    // vycházelo. Panel /checkup 12. 8. změřil překryv od 9 karet (běžná mapa)
    // a od 4 v Moje mapě. Test bez rozsahu tuhle třídu vad nemůže chytit.
    {
      const PERSONAL = (dir) => (dir === 'horizontal'
        ? { slot: 120, step: 300, apexStep: 200 } : { slot: 120, step: 300, apexStep: 210 });
      const rozmery = (id, koren) => (id === 'R'
        ? { w: koren, h: koren } : { w: 220, h: 170 });
      const najdiPrekryv = (p, ids, koren) => {
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
          const a = p[ids[i]], b = p[ids[j]];
          if (!a || !b) continue;
          const ra = rozmery(ids[i], koren), rb = rozmery(ids[j], koren);
          const dx = Math.abs(a.x - b.x) >= (ra.w + rb.w) / 2;
          const dy = Math.abs(a.y - b.y) >= (ra.h + rb.h) / 2;
          if (!dx && !dy) return `${ids[i]}×${ids[j]}`;
        }
        return null;
      };
      for (const [jmenoMapy, osobni] of [['běžná mapa', false], ['Moje mapa', true]]) {
        const koren = osobni ? 120 : 260;
        for (const smer of ['vertical', 'horizontal']) {
          for (const styl of [['kolem středu', { bands: 2 }], ['kompakt', { stagger: 2 }]]) {
            let selhalo = null;
            for (let n = 3; n <= 15 && !selhalo; n++) {
              const ids = ['R', ...Array.from({ length: n }, (_, i) => 'c' + i)];
              const nodes = ids.map((id, i) => ({
                id,
                type: id === 'R' ? (osobni ? 'personalRoot' : 'apexNode') : 'goalNode',
                position: { x: i * 300, y: id === 'R' ? 0 : 380 },
              }));
              const edges = ids.slice(1).map((t) => ({ id: 'R-' + t, source: 'R', target: t }));
              const opts = osobni ? { ...PERSONAL(smer), ...styl[1] } : styl[1];
              const kolize = najdiPrekryv(layoutTree(nodes, edges, smer, opts), ids, koren);
              if (kolize) selhalo = `${n} karet: ${kolize}`;
            }
            ok(!selhalo, `${jmenoMapy} / ${styl[0]} / ${smer}: 3–15 karet bez překryvu${selhalo ? ' — ' + selhalo : ''}`);
          }
        }
      }
    }
  }

  // ⚠️ ČITELNÉ POŘADÍ — layout čte pořadí sourozenců z POZIC (crossEff),
  // takže každý styl musí vracet rozmístění, ze kterého další přerovnání
  // přečte TOTÉŽ pořadí. „Kolem vrcholu" to porušoval: od 6 karet převracel
  // pravý sloupec (D8 nad D7) a od 8 karet spodní řada podjela sloupce
  // (D3 před D1) — špatné pořadí pak autosave ZAPEKL do mapy napořád
  // (Richard 14. 8. 2026, šablona 8D). Druhá půlka tvrzení je idempotence:
  // běh nad ULOŽENÝMI pozicemi nesmí nic pohnout, jinak se mapa při každém
  // otevření tiše přeskládá.
  console.log('== čitelné pořadí: žádný styl nesmí pořadí karet prohodit ani zapéct ==');
  {
    const PERSONAL = (dir) => (dir === 'horizontal'
      ? { slot: 120, step: 300, apexStep: 200 } : { slot: 120, step: 300, apexStep: 210 });
    for (const [jmenoMapy, osobni] of [['běžná mapa', false], ['Moje mapa', true]]) {
      for (const smer of ['vertical', 'horizontal']) {
        for (const [stylName, stylOpts] of [['kolem středu', { bands: 2 }], ['kompakt', { stagger: 2 }], ['klasika', {}]]) {
          let spatnePoradi = null, zapeceno = null;
          for (let n = 3; n <= 12 && !spatnePoradi && !zapeceno; n++) {
            const ids = ['R', ...Array.from({ length: n }, (_, i) => 'c' + i)];
            const nodes = ids.map((id, i) => ({
              id,
              type: id === 'R' ? (osobni ? 'personalRoot' : 'apexNode') : 'goalNode',
              position: { x: id === 'R' ? 0 : (i - 1) * 300, y: id === 'R' ? 0 : 380 },
            }));
            const edges = ids.slice(1).map((t) => ({ id: 'R-' + t, source: 'R', target: t }));
            const opts = osobni ? { ...PERSONAL(smer), ...stylOpts } : stylOpts;
            const p1 = layoutTree(nodes, edges, smer, opts);
            const cross = (id) => (smer === 'horizontal' ? p1[id].y : p1[id].x);
            const main = (id) => (smer === 'horizontal' ? p1[id].x : p1[id].y);
            // pořadí, jak by ho přečetlo DALŠÍ přerovnání (stabilní sort dle příčné osy)
            const ctene = ids.slice(1).sort((a, b) => cross(a) - cross(b));
            if (ctene.join() !== ids.slice(1).join()) { spatnePoradi = `${n} karet: ${ctene.join(' ')}`; break; }
            // …a OČIMA: karty na stejné příčné pozici (sloupec „U") se čtou po
            // hlavní ose — převrácený sloupec (D8 nad D7) měl shodné x, takže
            // samotný sort podle příčné osy ho neviděl
            for (let i = 2; i < ids.length; i++) {
              const a = ids[i - 1], b = ids[i];
              if (cross(a) > cross(b) + 0.001 || (Math.abs(cross(a) - cross(b)) < 0.001 && main(a) > main(b) + 0.001)) {
                spatnePoradi = `${n} karet: ${a} se čte až po ${b}`; break;
              }
            }
            if (spatnePoradi) break;
            // …a ze zapsaných pozic musí druhý běh vyjít bit po bitu stejně
            const ulozene = nodes.map((nd) => ({ ...nd, position: p1[nd.id] }));
            const p2 = layoutTree(ulozene, edges, smer, opts);
            for (const id of ids) {
              if (Math.abs(p1[id].x - p2[id].x) > 0.001 || Math.abs(p1[id].y - p2[id].y) > 0.001) { zapeceno = `${n} karet: ${id} se hnul`; break; }
            }
          }
          ok(!spatnePoradi, `${jmenoMapy} / ${stylName} / ${smer}: 3–12 karet drží pořadí čtení${spatnePoradi ? ' — ' + spatnePoradi : ''}`);
          ok(!zapeceno, `${jmenoMapy} / ${stylName} / ${smer}: přerovnání uložených pozic nic nehne${zapeceno ? ' — ' + zapeceno : ''}`);
        }
      }
    }
    // server čte totéž pořadí (šablony se instancují na serveru)
    for (const n of [6, 7, 8, 10, 12]) {
      const ids = ['R', ...Array.from({ length: n }, (_, i) => 'c' + i)];
      const nodes = ids.map((id, i) => ({ id, type: id === 'R' ? 'apexNode' : 'goalNode', position: { x: id === 'R' ? 0 : (i - 1) * 300, y: id === 'R' ? 0 : 380 } }));
      const edges = ids.slice(1).map((t) => ({ id: 'R-' + t, source: 'R', target: t }));
      const sv = layoutTreeServer(nodes, edges, { bands: 2 });
      const ctene = ids.slice(1).sort((a, b) => sv[a].x - sv[b].x);
      let ocima = null;
      for (let i = 2; i < ids.length; i++) {
        const a = ids[i - 1], b = ids[i];
        if (sv[a].x > sv[b].x + 0.001 || (Math.abs(sv[a].x - sv[b].x) < 0.001 && sv[a].y > sv[b].y + 0.001)) { ocima = `${a} až po ${b}`; break; }
      }
      ok(ctene.join() === ids.slice(1).join() && !ocima,
        `server / kolem středu / ${n} karet: pořadí čtení drží${ocima ? ' — ' + ocima : ctene.join() === ids.slice(1).join() ? '' : ' — ' + ctene.join(' ')}`);
    }
  }

  // ⚠️ Sekce výš staví uzly BEZ `measured`, takže layoutu podstrčí výchozích
  // 220×170 — jenže skutečná karta s odznaky a pruhem pokroku má přes 220 px
  // a stupně Čitelnosti k tomu ještě přidají. Rozestupy přitom šířky ani výšky
  // karet nepočítají (SLOT/STEP jsou pevná čísla), takže bez téhle sekce by
  // sada zůstala ZELENÁ i nad kartami, které se reálně překrývají.
  //
  // ⚠️ Výšky se sem NEOPISUJÍ ručně. Leží ve sdíleném `vysky-karet.js` a
  // `ui-citelnost.js` je proměřuje v prohlížeči — když se karta změní (stačí
  // přidat odznak), zčervená TAM a nikdo tady nebude počítat s neplatnými čísly.
  // Panel /checkup 13. 8. 2026: první verze měla čísla opsaná a navíc tvrzení
  // `h <= STROP` porovnávající dvě konstanty z téhož souboru — to nemohla
  // shodit ŽÁDNÁ změna kódu. Stropy proto hlídá ui-citelnost.js proti skutečně
  // naměřené kartě; tady zůstává jen to, co má sílu: prohnat layout těmi
  // výškami a hledat překryv.
  console.log('== skutečné výšky karet (stupně Čitelnosti) — nic se nesmí překrýt ==');
  {
    const { VYSKY_KARET, VYSKY_MOJE_MAPA } = require('./vysky-karet');
    for (const [stupen, h] of Object.entries(VYSKY_KARET)) {
      for (const [name, pairs] of Object.entries(TREES)) {
        const { nodes, edges } = build(pairs);
        // měřená velikost, jakou by ReactFlow dodal po vykreslení
        const merene = nodes.map((n) => ({ ...n, measured: { width: 220, height: h } }));
        for (const smer of ['vertical', 'horizontal']) {
          for (const [stylName, opts] of Object.entries({ klasika: {}, kompakt: { stagger: 2 }, pásy: { bands: 2 } })) {
            const p = layoutTree(merene, edges, smer, opts);
            let kolize = null;
            const ids = Object.keys(p);
            // ⚠️ Kotva: kdyby layoutTree vrátil prázdno, projde všech ~108
            // tvrzení téhle sekce zeleně (nález panelu 13. 8.).
            ok(ids.length === nodes.length, `${stupen} · ${smer} · ${stylName} · ${name}: layout vrátil ${ids.length} pozic (čekáno ${nodes.length})`);
            for (let i = 0; i < ids.length && !kolize; i++) {
              for (let j = i + 1; j < ids.length; j++) {
                const a = p[ids[i]], b = p[ids[j]];
                if (a.x < b.x + 220 && b.x < a.x + 220 && a.y < b.y + h && b.y < a.y + h) { kolize = `${ids[i]}×${ids[j]}`; break; }
              }
            }
            ok(!kolize, `${stupen} · ${smer} · ${stylName} · ${name}${kolize ? ' — ' + kolize : ''}`);
          }
        }
      }
    }

    // ⚠️ Sekce výš staví VŠECHNY uzly jako `goalNode`, takže se nikdy nepotká
    // s kruhovým vrcholem (260) ani s osobním kořenem (120) — a hlavně ne
    // s „Moje mapou", kde `PERSONAL_LAYOUT` má JINÉ rozestupy, a tedy JINÝ
    // rozpočet: svisle `step 210 − ELBOW 44 = 166 px`, ne 236 (nález panelu
    // 13. 8.). Je to nejtěsnější rozvržení v aplikaci a nikdo ho neměřil.
    // ⚠️ OPSAT PŘESNĚ z GoalMapEditor.jsx:117-121 — svisle je slot 245, ne 120.
    // Špatně opsaná hodnota tady vyrobí FALEŠNÉ selhání (karty 220 široké
    // v slotu 120 se pochopitelně překrývají) a člověk pak hodinu hledá vadu
    // v produktu, který je v pořádku.
    const PERSONAL = (dir) => (dir === 'horizontal'
      ? { slot: 120, step: 300, apexStep: 200 }
      : { slot: 245, step: 210, apexStep: 210 });
    for (const [stupen, h] of Object.entries(VYSKY_KARET)) {
      for (const [jmeno, def] of Object.entries(TREES_TYPY)) {
        const { nodes, edges } = build(def.pary);
        const osobni = def.koren === 'personalRoot';
        const korenR = osobni ? 120 : 260;
        // kořen si drží SVŮJ rozměr, měřená výška platí jen pro karty
        // ⚠️ V „Moje mapě" jsou karty KOMPAKTNÍ (název 1 řádek, bez pruhu
        // pokroku), takže se do ní NESMÍ cpát výška běžné karty — vyšlo by
        // z toho falešné selhání. Skutečné naměřené hodnoty leží vedle.
        const vyskaKarty = osobni ? VYSKY_MOJE_MAPA[stupen] : h;
        const merene = nodes.map((n) => (n.id === 'R'
          ? { ...n, type: def.koren, measured: { width: korenR, height: korenR } }
          : { ...n, measured: { width: 220, height: vyskaKarty } }));
        for (const smer of ['vertical', 'horizontal']) {
          const p = layoutTree(merene, edges, smer, osobni ? PERSONAL(smer) : {});
          ok(Object.keys(p).length === nodes.length, `${stupen} · ${jmeno} · ${smer}: layout vrátil ${Object.keys(p).length} pozic`);
          const rozmer = (id) => (id === 'R' ? { w: korenR, h: korenR } : { w: 220, h: vyskaKarty });
          let kolize = null;
          const ids = Object.keys(p);
          for (let i = 0; i < ids.length && !kolize; i++) {
            for (let j = i + 1; j < ids.length; j++) {
              const a = p[ids[i]], b = p[ids[j]], ra = rozmer(ids[i]), rb = rozmer(ids[j]);
              if (a.x < b.x + rb.w && b.x < a.x + ra.w && a.y < b.y + rb.h && b.y < a.y + ra.h) { kolize = `${ids[i]}×${ids[j]}`; break; }
            }
          }
          ok(!kolize, `${stupen} · ${jmeno} · ${smer}: bez překryvu${kolize ? ' — ' + kolize : ''}`);
        }
      }
    }
  }

  console.log('== VYSOKÁ KARTA: dvouřadé balení se nesmí překrýt ==');
  {
    // Panel 12. 8. 2026: balení mělo PEVNÝ krok 240 px a `measured` nečetlo,
    // takže karta vyšší než 240 přelezla do spodní řady. Sousední karty obou
    // řad se vodorovně překrývají o půl kroku ZÁMĚRNĚ (aby se ušetřila šířka),
    // takže svislá mezera je jediné, co je drží od sebe.
    // ⚠️ Sada čitelnosti tenhle případ NEPOKRYJE — měří karty 217–227 px, tedy
    // všechny POD prahem 240; rozbité balení by jí prošlo (ověřeno s druhou
    // session 13. 8.). Test proto patří sem, k opravě.
    const pary = [['R', null], ['n1', 'R'], ['n2', 'R'], ['n3', 'R'], ['n4', 'R'], ['n5', 'R']];
    for (const vyska of [170, 240, 300, 420]) {
      const { nodes, edges } = build(pary);
      const sVyskou = nodes.map((n) => (n.id === 'R' ? n : { ...n, measured: { width: 220, height: vyska } }));
      for (const [styl, opts] of [['kompakt', { stagger: 2 }], ['kolem středu', { bands: 2 }]]) {
        const p = layoutTree(sVyskou, edges, 'vertical', opts);
        const ids = sVyskou.map((n) => n.id).filter((id) => id !== 'R');
        let prekryv = null;
        for (let i = 0; i < ids.length && !prekryv; i++) {
          for (let j = i + 1; j < ids.length; j++) {
            const a = p[ids[i]], b = p[ids[j]];
            if (!a || !b) continue;
            if (Math.abs(a.x - b.x) < 220 && Math.abs(a.y - b.y) < vyska) { prekryv = `${ids[i]}×${ids[j]}`; break; }
          }
        }
        ok(!prekryv, `karta ${vyska} px / ${styl}: řady se nepřekrývají${prekryv ? ' — ' + prekryv : ''}`);
      }
    }
  }

  console.log('== mapa s CYKLEM nesmí ZAMRZNOUT (ne jen „nespadnout") ==');
  {
    // Panel /checkup 12. 8. 2026: `apportion` se u dvou sourozenců sestupujících
    // do sdíleného cyklu točila DONEKONEČNA — karta prohlížeče na 100 % CPU.
    // Pojistky _fw/_sw hlídaly jen rekurzi, ne tuhle smyčku. Takovou mapu jde
    // uložit i naklikat (validace cyklus nekontroluje) a se zámkem se layout
    // pouští už při otevření mapy. Kontrola měří ČAS, ne jen že to nespadlo.
    const nodes = [
      { id: 'R', type: 'apexNode', position: { x: 0, y: 0 } },
      { id: 'n2', type: 'goalNode', position: { x: 100, y: 300 } },
      { id: 'n3', type: 'goalNode', position: { x: 300, y: 300 } },
      { id: 'n4', type: 'goalNode', position: { x: 500, y: 300 } },
    ];
    const edges = [
      { id: 'e1', source: 'n2', target: 'n3' }, { id: 'e2', source: 'n3', target: 'R' },
      { id: 'e3', source: 'n4', target: 'n3' }, { id: 'e4', source: 'R', target: 'n3' },
    ];
    for (const [jmeno, opts] of [['klasika', {}], ['kompakt', { stagger: 2 }], ['kolem středu', { bands: 2 }]]) {
      const t0 = Date.now();
      let spadlo = null;
      try { layoutTree(nodes, edges, 'vertical', opts); } catch (e) { spadlo = e.message; }
      const ms = Date.now() - t0;
      ok(!spadlo && ms < 1000, `cyklus / ${jmeno}: doběhlo za ${ms} ms${spadlo ? ' — spadlo: ' + spadlo : ''}`);
    }
    const t1 = Date.now();
    try { layoutTreeServer(nodes, edges, { stagger: 2 }); } catch { /* pád je horší než pomalost, ale hlídá to řádek níž */ }
    ok(Date.now() - t1 < 1000, `cyklus / server: doběhlo za ${Date.now() - t1} ms`);
  }

  console.log('== cycle-guard: cyklická hrana neshodí (žádná nekonečná rekurze) ==');
  {
    const nodes = ['R', 'A', 'B'].map((id) => ({ id, type: 'goalNode', position: { x: 0, y: 0 } }));
    const edges = [{ id: 'e1', source: 'R', target: 'A' }, { id: 'e2', source: 'A', target: 'B' }, { id: 'e3', source: 'B', target: 'A' }];
    let crashed = false, res = null;
    try { res = layoutTree(nodes, edges, 'vertical'); } catch (e) { crashed = e.message.slice(0, 40); }
    ok(!crashed && res, `frontend: cyklus nezpůsobil pád${crashed ? ' (' + crashed + ')' : ''}`);
    let crashed2 = false;
    try { layoutTreeServer(nodes, edges); } catch (e) { crashed2 = e.message.slice(0, 40); }
    ok(!crashed2, `server: cyklus nezpůsobil pád${crashed2 ? ' (' + crashed2 + ')' : ''}`);
  }

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} PARITY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
