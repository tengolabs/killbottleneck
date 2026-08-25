// Parita kanonického tvaru mapy: frontend lib/cleanMap.js (cleanMapData, autosave
// editoru) MUSÍ vracet shodný tvar jako serverová normalizace
// pb_hooks/helpers.js:normalizeMapData (v1 API zápisy). Chrání proti tichému driftu
// dvou kopií (à la 576×1024, vzor layout-parity.js). + unit sémantiky serveru
// (duplicitní id, hrany, cyklus, deadline, status fallback) a tree helperů
// (treeItemsToNodes → mapToTree roundtrip). Bez dockeru.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

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

// realistické uzly z editoru (plná data + smetí navíc, které se MUSÍ ořezat)
const EDITOR_NODES = [
  { id: 'apex1', type: 'apexNode', position: { x: 100, y: -280 }, selected: true, measured: { width: 340 },
    data: { title: 'Projekt X', status: 'todo', description: '', collapsed: false, color: '', icon: '',
      nodeType: 'apex', goalType: '', apexText: 'Vybudovat projekt X', deadline: '', owner: '',
      waitForChildren: false, __junk: 'nepatří sem', onOpen: 'fn' } },
  { id: 'n1', type: 'goalNode', position: { x: 0, y: 0 }, dragging: false,
    data: { title: 'První krok', status: 'in_progress', description: 'popis', collapsed: false,
      color: '#fff', icon: 'star', nodeType: 'normal', goalType: '', apexText: '',
      deadline: '2026-08-01', owner: 'a@x.cz', plannedOn: '2026-07-28', tour: true, waitForChildren: true,
      executorKind: 'automation', executorName: 'n8n reporty',
      automationWanted: false, automationNote: '', automationRequestedBy: '', extra: 42 } },
  // LEGACY uzel: uložený před zavedením vykonavatele, nová pole vůbec nemá —
  // musí projít oběma cestami shodně a doplnit se defaulty (human/'')
  { id: 'n2', type: 'goalNode', position: { x: 300, y: 0 },
    data: { title: 'Druhý krok', status: 'done', description: '', collapsed: true, color: '', icon: '',
      nodeType: 'normal', goalType: '', apexText: '', deadline: '', owner: '', waitForChildren: false } },
  { id: 'note1', type: 'note', position: { x: 500, y: 100 }, width: 240, height: 200,
    data: { text: 'poznámka', color: '#ffee88', width: 240, height: 200, junk: true } },
];
const EDITOR_EDGES = [
  { id: 'e1', source: 'apex1', target: 'n1', type: 'deletable', animated: false },
  { id: 'e2', source: 'apex1', target: 'n2', type: 'deletable' },
];

(async () => {
  const feMod = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/cleanMap.js')).href);
  const cleanMapData = feMod.cleanMapData;
  const helpersSrc = fs.readFileSync(path.join(__dirname, '../server/pb_hooks/helpers.js'), 'utf8');
  // __hooks referencuje require i18n uvnitř normalizeMapData (jen chybové větve)
  // eslint-disable-next-line no-unused-vars
  const __hooks = path.join(__dirname, '../server/pb_hooks');
  // normalizeMapData i treeItemsToNodes volají normalizeExecutorKind — musí být
  // ve stejném scope, jinak eval'ované funkce spadnou na ReferenceError
  // eslint-disable-next-line no-eval, no-unused-vars
  const normalizeExecutorKind = eval('(' + extractFn(helpersSrc, 'normalizeExecutorKind') + ')');
  // kanonický tvar data je sdílená funkce — musí být ve stejném scope
  // eslint-disable-next-line no-eval, no-unused-vars
  const canonicalNodeData = eval('(' + extractFn(helpersSrc, 'canonicalNodeData') + ')');
  // eslint-disable-next-line no-eval
  const normalizeMapData = eval('(' + extractFn(helpersSrc, 'normalizeMapData') + ')');
  // eslint-disable-next-line no-eval
  const treeItemsToNodes = eval('(' + extractFn(helpersSrc, 'treeItemsToNodes') + ')');
  // eslint-disable-next-line no-eval
  const mapToTree = eval('(' + extractFn(helpersSrc, 'mapToTree') + ')');

  // MAPA JE STROM — dvojče lib/mapStructure.js ↔ helpers.js
  const strMod = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/mapStructure.js')).href);
  // eslint-disable-next-line no-eval, no-unused-vars
  const jePredekMapy = eval('(' + extractFn(helpersSrc, 'jePredekMapy') + ')');
  // eslint-disable-next-line no-eval, no-unused-vars
  const duvodOdmitnutiMapy = eval('(' + extractFn(helpersSrc, 'duvodOdmitnutiMapy') + ')');
  // eslint-disable-next-line no-eval
  // POZOR na jméno: eval'ovaná strukturaZhorsena volá `poskozeneHrany` podle
  // jména, takže serverová kopie musí být ve scope právě pod ním
  const poskozeneHrany = eval('(' + extractFn(helpersSrc, 'poskozeneHrany') + ')');
  // eslint-disable-next-line no-eval
  const strukturaZhorsena = eval('(' + extractFn(helpersSrc, 'strukturaZhorsena') + ')');

  // ⚠️ MUTAČNĚ OVĚŘENO 13. 8. 2026 (dvakrát): (a) povolením druhého rodiče jen
  // na FE zčervenaly 3 kontroly parity — drift dvou kopií se tedy chytí;
  // (b) `strukturaZhorsena` vrácenou na `return null` zčervenaly 4 kontroly.
  console.log('== strukturální pravidlo „mapa je strom" FE == server ==');
  {
    const u = (...ids) => ids.map((id) => ({ id, type: id === 'R' ? 'apexNode' : 'goalNode', position: { x: 0, y: 0 } }));
    const h = (...dvojice) => dvojice.map(([s, t2], i) => ({ id: 'e' + (i + 1), source: s, target: t2 }));
    const PRIPADY = [
      ['čistý strom', u('R', 'a', 'b', 'c'), h(['R', 'a'], ['R', 'b'], ['a', 'c'])],
      ['prázdná mapa', [], []],
      ['druhý rodič', u('R', 'a', 'b'), h(['R', 'a'], ['R', 'b'], ['b', 'a'])],
      ['kruh přes 2', u('a', 'b'), h(['a', 'b'], ['b', 'a'])],
      ['kruh přes 3', u('a', 'b', 'c'), h(['a', 'b'], ['b', 'c'], ['c', 'a'])],
      ['smyčka na sebe', u('a'), h(['a', 'a'])],
      ['odpojený podstrom', u('R', 'a', 'b', 'c'), h(['R', 'a'], ['b', 'c'])],
      // ⭐ přesné repro ze zadání (13. 8. 2026) — 4 uzly stačily na zamrznutí
      ['repro: 4 uzly', u('R', 'n2', 'n3', 'n4'),
        h(['n2', 'n3'], ['n3', 'R'], ['n4', 'n3'], ['R', 'n3'])],
    ];
    for (const [jmeno, nodes, edges] of PRIPADY) {
      const fe = strMod.poskozeneHrany(nodes, edges);
      const sv = poskozeneHrany(nodes, edges);
      ok(JSON.stringify(fe) === JSON.stringify(sv),
        `${jmeno}: FE == server (${JSON.stringify(fe.edgeIds)} vs ${JSON.stringify(sv.edgeIds)})`);
    }
    const cisty = PRIPADY[0], kruh3 = PRIPADY[4], repro = PRIPADY[7];
    ok(strMod.poskozeneHrany(cisty[1], cisty[2]).edgeIds.length === 0, 'čistý strom nemá co odpojovat');
    ok(strMod.poskozeneHrany(repro[1], repro[2]).edgeIds.length > 0, 'repro ze zadání je rozpoznané jako poškozené');
    // spojeniPovoleno = totéž pravidlo pro JEDNO chystané spojení (isValidConnection)
    ok(strMod.spojeniPovoleno(cisty[2], { source: 'b', target: 'a' }) === 'multiParent', 'druhý rodič se nepovolí');
    ok(strMod.spojeniPovoleno(cisty[2], { source: 'c', target: 'R' }) === 'cycle', 'kruh se nepovolí');
    ok(strMod.spojeniPovoleno(cisty[2], { source: 'a', target: 'a' }) === 'self', 'spojení sám se sebou se nepovolí');
    // POZITIVNÍ protikontrola: kdyby kód zakazoval všechno, sada by prošla taky
    ok(strMod.spojeniPovoleno(cisty[2], { source: 'b', target: 'd' }) === null, 'povolené spojení PROJDE');
    ok(strMod.spojeniPovoleno([], { source: 'x', target: 'y' }) === null, 'první hrana v prázdné mapě PROJDE');

    console.log('== server odmítá jen NOVÉ poškození (nikdo se nezamkne ven) ==');
    const kruhN = kruh3[1], kruhE = kruh3[2];
    ok(strukturaZhorsena([], [], cisty[1], cisty[2], 'cs') === null, 'nová čistá mapa projde');
    ok(!!strukturaZhorsena([], [], kruhN, kruhE, 'cs'), 'nová mapa s kruhem NEprojde');
    ok(!!strukturaZhorsena(cisty[1], cisty[2], kruhN, kruhE, 'cs'), 'kruh přidaný do čisté mapy NEprojde');
    ok(strukturaZhorsena(kruhN, kruhE, kruhN, kruhE, 'cs') === null,
      'už poškozená mapa se dál uloží beze změny struktury');
    ok(strukturaZhorsena(kruhN, kruhE, kruhN, [kruhE[0]], 'cs') === null,
      'oprava už poškozené mapy projde');
    const horsi = [...kruhE, { id: 'e3', source: 'a', target: 'c' }, { id: 'e4', source: 'c', target: 'b' }];
    ok(!!strukturaZhorsena(kruhN, kruhE, kruhN, horsi, 'cs'),
      'zhoršení už poškozené mapy NEprojde');
    ok(/strom/.test(strukturaZhorsena([], [], kruhN, kruhE, 'cs') || ''),
      'hláška je přeložená (ne holý klíč)');
  }

  console.log('== PARITA kanonického tvaru FE(cleanMap) ↔ server(normalizeMapData) ==');
  {
    const fe = cleanMapData(EDITOR_NODES, EDITOR_EDGES);
    const sv = normalizeMapData(EDITOR_NODES, EDITOR_EDGES);
    ok(!sv.error, `server normalizace bez chyby${sv.error ? ' — ' + sv.error : ''}`);
    ok(JSON.stringify(fe.cleanNodes) === JSON.stringify(sv.nodes),
      'uzly bit-identické (18 data polí, note s rozměry, smetí ořezáno)');
    ok(JSON.stringify(fe.cleanEdges) === JSON.stringify(sv.edges),
      'hrany bit-identické (jen id/source/target)');
    ok(fe.cleanNodes[1].data.extra === undefined && sv.nodes[0].data.__junk === undefined,
      'neznámá data pole nepřežijí (žádný smuggling)');
    ok(fe.cleanNodes[1].data.executorKind === 'automation' && fe.cleanNodes[1].data.executorName === 'n8n reporty',
      'vykonavatel (automatizace + název) přežije kanonizaci');
    ok(fe.cleanNodes[2].data.executorKind === 'human' && sv.nodes[2].data.executorKind === 'human'
      && fe.cleanNodes[2].data.executorName === '' && fe.cleanNodes[2].data.automationWanted === false,
      'legacy uzel bez nových polí → default human/prázdno na obou stranách');
    ok(fe.cleanNodes[1].data.plannedOn === '2026-07-28' && sv.nodes[1].data.plannedOn === '2026-07-28'
      && fe.cleanNodes[2].data.plannedOn === '' && sv.nodes[2].data.plannedOn === '',
      'plannedOn („kdy to chci řešit") přežije kanonizaci, legacy uzel dostane ""');
    // pole se 27. 7. 2026 přejmenovalo z `pinnedOn` — starý zápis se musí načíst,
    // jinak by lidem zmizely plány zapsané den předtím
    const legacyPin = cleanMapData([{ id: 'p1', type: 'goalNode', position: { x: 0, y: 0 },
      data: { title: 'a', status: 'todo', pinnedOn: '2026-07-29' } }], []);
    const legacyPinSv = normalizeMapData([{ id: 'p1', type: 'goalNode', position: { x: 0, y: 0 },
      data: { title: 'a', status: 'todo', pinnedOn: '2026-07-29' } }], []);
    ok(legacyPin.cleanNodes[0].data.plannedOn === '2026-07-29' && legacyPinSv.nodes[0].data.plannedOn === '2026-07-29',
      'starý pinnedOn se načte jako plannedOn (obě strany)');
    // uzly z mezistavu vývoje nesou 'ai'/'cron' — obojí je automatizace
    const legacyKinds = cleanMapData([
      { id: 'k1', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'a', status: 'todo', executorKind: 'ai' } },
      { id: 'k2', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'b', status: 'todo', executorKind: 'cron' } },
    ], []);
    const legacySv = normalizeMapData([
      { id: 'k1', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'a', status: 'todo', executorKind: 'ai' } },
      { id: 'k2', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'b', status: 'todo', executorKind: 'cron' } },
    ], []);
    ok(legacyKinds.cleanNodes.every((n) => n.data.executorKind === 'automation')
      && legacySv.nodes.every((n) => n.data.executorKind === 'automation'),
    'starší ai/cron se na obou stranách překlopí na automation');
  }

  console.log('== serverová sémantika navíc (LLM = nespolehlivý klient) ==');
  {
    let r = normalizeMapData([EDITOR_NODES[1], EDITOR_NODES[1]], []);
    ok(!!r.error && /n1/.test(r.error), `duplicitní id → chyba (${(r.error || '').slice(0, 40)})`);
    r = normalizeMapData([EDITOR_NODES[1]], [{ id: 'e', source: 'n1', target: 'ghost' }]);
    ok(!!r.error, 'hrana na neexistující uzel → chyba');
    r = normalizeMapData(
      [EDITOR_NODES[0], EDITOR_NODES[1], EDITOR_NODES[2]],
      [{ id: 'a', source: 'apex1', target: 'n1' }, { id: 'b', source: 'n2', target: 'n1' }]);
    ok(!!r.error, 'dva rodiče téhož uzlu → chyba');
    r = normalizeMapData(
      [EDITOR_NODES[1], EDITOR_NODES[2]],
      [{ id: 'a', source: 'n1', target: 'n2' }, { id: 'b', source: 'n2', target: 'n1' }]);
    ok(!!r.error, 'cyklus → chyba');
    // normalizace je k HODNOTÁM tolerantní (parita s FE autosave — legacy data
    // v nedotčených uzlech musí projít beze změny); sémantiku hlídá treeItemsToNodes
    r = normalizeMapData([{ id: 'x', type: 'goalNode',
      data: { title: 't', status: 'hotovo-asi', description: '', deadline: '15.8.2026' } }], []);
    ok(!r.error && r.nodes[0].data.status === 'hotovo-asi' && r.nodes[0].data.deadline === '15.8.2026'
      && r.nodes[0].position.x === 0,
      'legacy hodnoty projdou beze změny, chybějící pozice → {0,0}');
    r = normalizeMapData([{ id: 'x', type: 'apex', data: { title: 't', status: 'todo', description: '' } }], []);
    ok(!r.error && r.nodes[0].type === 'apexNode', 'alias type apex → apexNode');
  }

  console.log('== tree helpery (v1 zápis/čtení) ==');
  {
    const items = [
      { title: 'Fáze 1', deadline: '2026-08-10', children: [
        { title: 'Krok 1a', owner: 'a@x.cz' },
        { title: 'Krok 1b', status: 'done' },
      ] },
      { title: 'Fáze 2', wait_for_children: true, children: [{ title: 'Krok 2a' }] },
    ];
    const conv = treeItemsToNodes(items, 'T');
    ok(conv.count === 5 && conv.nodes.length === 5 && conv.rootIds.length === 2,
      `treeItemsToNodes: 5 uzlů, 2 kořeny (${conv.count})`);
    ok(conv.edges.length === 3, `hrany jen uvnitř podstromů (${conv.edges.length})`);
    ok(conv.nodes.every((n) => n.type === 'goalNode' && n.data.nodeType === 'normal'),
      'položky = goalNode/normal (apex řeší routa)');
    ok(conv.nodes[3].data.waitForChildren === true && conv.nodes[2].data.status === 'done',
      'wait_for_children a status se přenesly');
    const convBad = treeItemsToNodes([{ title: 'Špatný termín', deadline: '15.8.' }], 'T');
    ok(!!convBad.error, `nový vstup s deadline mimo RRRR-MM-DD → chyba (${(convBad.error || '').slice(0, 40)})`);
    // strop hloubky rekurze: hluboce vnořený vstup NEsmí přetéct zásobník, vrátí chybu
    let deep = { title: 'x' }; for (let i = 0; i < 5000; i++) deep = { title: 'x', children: [deep] };
    let convDeep, crashed = false;
    try { convDeep = treeItemsToNodes([deep], 'T'); } catch (e) { crashed = true; }
    ok(!crashed && convDeep && !!convDeep.error, `hluboká vnořenost → chyba, ne pád (crashed=${crashed})`);
    // strop počtu: >200 uzlů (i naplocho) vrátí chybu, ne tichý ořez
    const flat = Array.from({ length: 250 }, (_, i) => ({ title: 't' + i }));
    ok(!!treeItemsToNodes(flat, 'T').error, 'nad 200 položek → chyba');
    const convStatus = treeItemsToNodes([{ title: 'x', status: 'hotovo-asi' }], 'T');
    ok(!convStatus.error && convStatus.nodes[0].data.status === 'todo', 'neznámý status NOVÉ položky → todo');
    // roundtrip: apex + podstromy → mapToTree vrátí stejnou strukturu v pořadí
    const apex = { id: 'apexT', type: 'apexNode', position: { x: 0, y: -280 },
      data: { title: 'P', status: 'todo', description: '', nodeType: 'apex', apexText: 'Projekt P' } };
    const allNodes = [apex].concat(conv.nodes);
    const allEdges = conv.edges.concat(conv.rootIds.map((rid, i) => ({ id: 'ea' + i, source: 'apexT', target: rid })));
    const tr = mapToTree(allNodes, allEdges);
    ok(tr.tree.length === 1 && tr.tree[0].type === 'apex' && tr.tree[0].title === 'Projekt P',
      'mapToTree: jeden kořen = apex s apexText titulem');
    const phases = tr.tree[0].children;
    ok(phases.length === 2 && phases[0].title === 'Fáze 1' && phases[1].title === 'Fáze 2',
      'pořadí sourozenců drží (dle position.x)');
    ok(phases[0].children.length === 2 && phases[0].children[0].title === 'Krok 1a'
      && phases[0].children[1].status === 'done' && phases[1].wait_for_children === true,
      'vnořené položky vč. statusu a wait_for_children');
    // note se nemíchá do stromu
    const tr2 = mapToTree(allNodes.concat([{ id: 'nt', type: 'note', position: { x: 0, y: 0 }, data: { text: 'pozn' } }]), allEdges);
    ok(tr2.tree.length === 1 && tr2.notes.length === 1 && tr2.notes[0].text === 'pozn',
      'note jde do notes[], ne do stromu');
  }

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} CLEANMAP PARITY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
