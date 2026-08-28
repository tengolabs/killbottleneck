// „Moje mapa" / „Zadal jsem" / pokrok stromu — unit sada bez dockeru nad
// frontend/src/lib/personalMap.js, mapProgress.js a nodePermissions.js
// (vytaženo z GoalMapEditor.jsx, nález F1-07). Deterministické kontroly:
// kořen + projekty + děti, cizí mezičlánek jako kontext, archiv a hotové ven,
// seskupení „Zadal jsem" podle lidí vs. projektů, procenta pokroku.
// Spuštění: node product/tests/personal-map.js
const path = require('path');
const { pathToFileURL } = require('url');
const { register } = require('node:module');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

const ME = 'ja@example.com';
const KOLEGA = 'kolega@example.com';
const EXT = 'ext-abc123@kontakt.invalid';
const node = (id, data, type = 'goalNode') => ({ id, type, position: { x: 0, y: 0 }, data });
const edge = (source, target) => ({ id: `${source}-${target}`, source, target });

(async () => {
  // lib tahá memberLabel → externalContacts → @/api/base44Client (PocketBase):
  // alias + stub řeší _alias-loader.mjs, jinak by node import spadl
  register(pathToFileURL(path.join(__dirname, '_alias-loader.mjs')));
  const { buildPersonalMap, buildDelegatedMap, PERSONAL_LAYOUT } =
    await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/personalMap.js')).href);
  const { buildChildrenMap, countDescendants, hiddenByCollapse, descendantCounts, computeProgressMap } =
    await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/mapProgress.js')).href);
  const { jeZadavatelNeboVlastnik, mojePracovniUzlyZ } =
    await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/nodePermissions.js')).href);

  console.log('\n— PERSONAL_LAYOUT —');
  ok(PERSONAL_LAYOUT('vertical').slot === 245 && PERSONAL_LAYOUT('vertical').step === 210, 'svisle slot 245 / step 210');
  ok(PERSONAL_LAYOUT('horizontal').slot === 120 && PERSONAL_LAYOUT('horizontal', 'titleOnly').slot === 136, 'vodorovně slot 120, „jen název" 136');

  // ---------- Moje mapa ----------
  console.log('\n— buildPersonalMap —');
  const mapA = {
    id: 'A', title: 'Mapa A', color: '#123456', created_by: ME,
    nodes: [
      node('a0', { nodeType: 'apex', apexText: 'Projekt A', status: 'todo' }, 'apexNode'),
      node('a1', { title: 'Můj s termínem', owner: ME, status: 'todo', deadline: '2026-09-10' }),
      node('a2', { title: 'Cizí mezičlánek', owner: KOLEGA, status: 'todo' }),
      node('a3', { title: 'Můj pod cizím', owner: ME, status: 'in_progress' }),
      node('a4', { title: 'Můj hotový', owner: ME, status: 'done' }),
      node('a5', { title: 'Cizí list', owner: KOLEGA, status: 'todo' }),
      node('n1', { text: 'lístek', owner: ME }, 'note'),
    ],
    edges: [edge('a0', 'a1'), edge('a0', 'a2'), edge('a2', 'a3'), edge('a0', 'a4'), edge('a0', 'a5')],
  };
  const mapB = {
    id: 'B', title: 'Mapa B', created_by: KOLEGA,
    nodes: [node('b0', { nodeType: 'apex', apexText: 'Projekt B' }, 'apexNode'), node('b1', { title: 'Cizí', owner: KOLEGA, status: 'todo' })],
    edges: [edge('b0', 'b1')],
  };
  const mapC = { id: 'C', title: 'Archiv', archived: true, created_by: ME,
    nodes: [node('c0', { nodeType: 'apex' }, 'apexNode'), node('c1', { title: 'Můj v archivu', owner: ME, status: 'todo' })], edges: [edge('c0', 'c1')] };
  const tasks = [
    { id: 't1', title: 'Úkol na B', map_id: 'B', node_id: 'b1', assignee_email: ME, created_by: KOLEGA, status: 'todo', deadline: '2026-09-01' },
    { id: 't2', title: 'Bez termínu', map_id: 'B', node_id: 'b1', assignee_email: ME, created_by: KOLEGA, status: 'todo' },
    { id: 't3', title: 'Cizí úkol', map_id: 'B', node_id: 'b1', assignee_email: KOLEGA, created_by: ME, status: 'todo', deadline: '2026-08-01' },
    { id: 't4', title: 'V archivu', map_id: 'C', node_id: 'c1', assignee_email: ME, created_by: ME, status: 'todo', deadline: '2026-08-01' },
    { id: 't5', title: 'Legacy bez mapy', assignee_email: ME, created_by: ME, status: 'todo' },
    { id: 't6', title: 'Podúkol', parent_id: 't1', map_id: 'B', assignee_email: ME, created_by: ME, status: 'todo', deadline: '2026-08-02' },
  ];
  const pm = buildPersonalMap([mapA, mapB, mapC], tasks, ME, 'Já');
  const ids = pm.nodes.map((n) => n.id);
  const parentOf = {}; for (const e of pm.edges) parentOf[e.target] = e.source;
  ok(pm.nodes[0].id === 'me' && pm.nodes[0].type === 'personalRoot' && pm.nodes[0].data.title === 'Já', 'kořen „Já" je první uzel');
  ok(parentOf['proj::A'] === 'me' && parentOf['proj::B'] === 'me', 'oba projekty visí pod kořenem');
  ok(!ids.includes('proj::C') && !ids.includes('C::c1') && !ids.includes('task::t4'), 'archivovaný projekt ani jeho úkol se neukáže');
  ok(parentOf['A::a1'] === 'proj::A', 'můj uzel pod vrcholem visí pod uzlem projektu');
  ok(parentOf['A::a2'] === 'proj::A' && parentOf['A::a3'] === 'A::a2', 'cizí mezičlánek zůstává jako kontext, můj uzel pod ním');
  ok(!ids.includes('A::a4') && !ids.includes('A::a5') && !ids.includes('A::n1'), 'hotový, cizí list a lístek ven');
  ok(parentOf['task::t1'] === 'proj::B', 'můj úkol s termínem = list pod SVÝM projektem (projekt vznikl jen kvůli němu)');
  ok(!ids.includes('task::t2') && !ids.includes('task::t3') && !ids.includes('task::t6'), 'úkol bez termínu, cizí úkol a podúkol ven');
  ok(parentOf['task::t5'] === 'me' && pm.targets['task::t5'].type === 'task', 'legacy úkol bez mapy pod kořenem, cíl = dialog úkolu');
  ok(pm.targets['A::a3'].mapId === 'A' && pm.targets['A::a3'].nodeId === 'a3' && pm.targets['proj::A'].nodeId === 'a0', 'targets vedou na uzel / vrchol projektu');
  ok(ids.indexOf('proj::B') < ids.indexOf('proj::A'), 'projekty seřazené dle nejbližšího termínu v podstromu (B 1. 9. před A 10. 9.)');
  ok(pm.nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y)), 'všechny uzly mají spočítané pozice (layoutTree)');
  ok(pm.nodes.length === pm.edges.length + 1, 'strom: hran = uzlů − 1');
  const emptyPm = buildPersonalMap([mapA], tasks, '', 'Já');
  ok(emptyPm.nodes.length === 0 && emptyPm.edges.length === 0, 'bez e-mailu prázdno');
  const a3 = pm.nodes.find((n) => n.id === 'A::a3');
  ok(a3.data.description === '' && a3.data.nodeType === 'normal' && a3.data.collapsed === false, 'uzel v přehledu: bez popisu, normal, rozbalený');

  // ---------- Zadal jsem ----------
  console.log('\n— buildDelegatedMap —');
  const members = [{ email: EXT, name: 'Účetní Jana', external: true }, { email: KOLEGA, name: 'Karel' }];
  const mapD = {
    id: 'D', title: 'Moje mapa D', created_by: ME,
    nodes: [
      node('d0', { nodeType: 'apex', apexText: 'D' }, 'apexNode'),
      node('d1', { title: 'Pro kolegu', owner: KOLEGA, status: 'todo', deadline: '2026-09-05' }),
      node('d2', { title: 'Pro účetní', owner: EXT, status: 'todo', deadline: '2026-09-02' }),
      node('d3', { title: 'Moje', owner: ME, status: 'todo' }),
      node('d4', { title: 'Hotové kolegy', owner: KOLEGA, status: 'done' }),
    ],
    edges: [edge('d0', 'd1'), edge('d0', 'd2'), edge('d0', 'd3'), edge('d0', 'd4')],
  };
  const mapE = { id: 'E', title: 'Cizí mapa E', created_by: KOLEGA,
    nodes: [node('e0', { nodeType: 'apex' }, 'apexNode'), node('e1', { title: 'Kolega v cizí', owner: KOLEGA, status: 'todo' })], edges: [edge('e0', 'e1')] };
  const dtasks = [
    { id: 'u1', title: 'Fold do uzlu', map_id: 'D', node_id: 'd1', assignee_email: KOLEGA, created_by: ME, status: 'todo', deadline: '2026-09-03' },
    { id: 'u2', title: 'Zadaný úkol', map_id: 'D', assignee_email: 'dalsi@example.com', created_by: ME, status: 'todo', deadline: '2026-09-01' },
    { id: 'u3', title: 'Sobě', map_id: 'D', assignee_email: ME, created_by: ME, status: 'todo', deadline: '2026-08-01' },
    { id: 'u4', title: 'Zadal kolega', map_id: 'D', assignee_email: ME, created_by: KOLEGA, status: 'todo', deadline: '2026-08-01' },
  ];
  const flat = buildDelegatedMap([mapD, mapE], dtasks, ME, 'Já', 'flat', members);
  const flatKids = flat.edges.filter((e) => e.source === 'me').map((e) => e.target);
  ok(flatKids.length === 3 && flat.nodes.length === 4, 'flat: 3 položky přímo pod kořenem (2 uzly + 1 úkol)');
  ok(flatKids.join() === 'task::u2,D::d2,D::d1', 'flat: seřazeno dle termínu (1. 9. → 2. 9. → 5. 9.)');
  ok(!flat.nodes.some((n) => ['D::d3', 'D::d4', 'E::e1', 'task::u1', 'task::u3', 'task::u4'].includes(n.id)), 'ven: moje, hotové, cizí mapa, úkol foldnutý do uzlu, sobě, zadané mně');

  const people = buildDelegatedMap([mapD, mapE], dtasks, ME, 'Já', 'people', members);
  const pParent = {}; for (const e of people.edges) pParent[e.target] = e.source;
  const groups = people.edges.filter((e) => e.source === 'me').map((e) => e.target);
  ok(groups.join() === `grp::dalsi@example.com,grp::${EXT},grp::${KOLEGA}`, 'people: skupiny dle nejbližšího termínu uvnitř');
  ok(pParent['D::d1'] === `grp::${KOLEGA}` && pParent['D::d2'] === `grp::${EXT}` && pParent['task::u2'] === 'grp::dalsi@example.com', 'people: položky pod svým člověkem');
  const extGrp = people.nodes.find((n) => n.id === `grp::${EXT}`);
  const kolGrp = people.nodes.find((n) => n.id === `grp::${KOLEGA}`);
  ok(extGrp.data.title === 'Účetní Jana' && extGrp.data.owner === 'Účetní Jana', 'people: externí kontakt JMÉNEM (pseudo-e-mail nikdy)');
  ok(kolGrp.data.title === KOLEGA, 'people: člen zůstává e-mailem (jméno řeší uzel)');

  const proj = buildDelegatedMap([mapD, mapE], dtasks, ME, 'Já', 'projects', members);
  const prParent = {}; for (const e of proj.edges) prParent[e.target] = e.source;
  const pGroups = proj.edges.filter((e) => e.source === 'me').map((e) => e.target);
  ok(pGroups.join() === 'grp::D', 'projects: jediná skupina = projekt D (klíč ID)');
  ok(proj.nodes.find((n) => n.id === 'grp::D').data.title === 'Moje mapa D' && proj.nodes.find((n) => n.id === 'grp::D').data.owner === '', 'projects: skupina nese název projektu, bez garanta');
  ok(['D::d1', 'D::d2', 'task::u2'].every((id) => prParent[id] === 'grp::D'), 'projects: všechny tři položky pod projektem');
  ok(proj.targets['task::u2'].type === 'task' && proj.targets['D::d2'].nodeId === 'd2', 'targets: úkol bez uzlu → dialog, uzel → mapa');

  // ---------- pokrok / sbalení ----------
  console.log('\n— mapProgress —');
  const tn = [
    node('root', { status: 'todo' }, 'apexNode'),
    node('a', { status: 'todo', collapsed: true }), node('a1', { status: 'done' }), node('a2', { status: 'todo' }),
    node('b', { status: 'done' }), node('lone', { status: 'done' }),
  ];
  const te = [edge('root', 'a'), edge('root', 'b'), edge('a', 'a1'), edge('a', 'a2')];
  const cm = buildChildrenMap(te);
  ok(cm.root.join() === 'a,b' && cm.a.join() === 'a1,a2' && cm.b === undefined, 'buildChildrenMap: děti podle hran');
  ok(countDescendants(cm, 'root') === 4 && countDescendants(cm, 'a') === 2 && countDescendants(cm, 'lone') === 0, 'countDescendants');
  const hidden = hiddenByCollapse(tn, cm);
  ok(hidden.size === 2 && hidden.has('a1') && hidden.has('a2') && !hidden.has('a'), 'hiddenByCollapse: podstrom sbaleného, ne on sám');
  const counts = descendantCounts(tn, cm);
  ok(counts.root === 4 && counts.a === 2 && counts.b === 0 && counts.lone === 0, 'descendantCounts pro každý uzel');
  const prog = computeProgressMap(tn, cm);
  ok(prog.root === 67 && prog.a === 50 && prog.b === 100 && prog.a1 === 100 && prog.a2 === 0 && prog.lone === 100, 'computeProgressMap: 2/3 listů → 67 %, 1/2 → 50 %');

  // ---------- práva ----------
  console.log('\n— nodePermissions —');
  const ctx = (o) => ({ isMapOwner: false, ownerEmail: 'vlastnik@example.com', userEmail: ME, ...o });
  ok(jeZadavatelNeboVlastnik(node('x', { title: 'bez termínu' }), ctx()), 'bez termínu smí každý');
  ok(jeZadavatelNeboVlastnik(node('x', { deadline: '2026-09-01' }), ctx({ isMapOwner: true })), 'vlastník mapy vždy');
  ok(jeZadavatelNeboVlastnik(node('x', { deadline: '2026-09-01', assignedBy: ME }), ctx()), 'zadavatel (assignedBy) ano');
  ok(!jeZadavatelNeboVlastnik(node('x', { deadline: '2026-09-01', assignedBy: KOLEGA }), ctx()), 'cizí zadání ne');
  ok(!jeZadavatelNeboVlastnik(node('x', { deadline: '2026-09-01' }), ctx()) && jeZadavatelNeboVlastnik(node('x', { deadline: '2026-09-01' }), ctx({ userEmail: 'vlastnik@example.com' })), 'starý uzel bez assignedBy: fallback na vlastníka mapy');
  ok(!jeZadavatelNeboVlastnik(node('x', { deadline: '2026-09-01', assignedBy: '' }), ctx({ ownerEmail: '', userEmail: '' })), 'bez e-mailu uživatele ne');
  const mine = mojePracovniUzlyZ(tn.concat([node('m', { owner: ME })]), [{ node_id: 'b', assignee_email: ME }, { node_id: 'a', assignee_email: KOLEGA }], ME);
  ok(mine.size === 2 && mine.has('m') && mine.has('b'), 'mojePracovniUzlyZ: garant + řešitel úkolu');
  ok(mojePracovniUzlyZ(tn, [], '').size === 0, 'mojePracovniUzlyZ: bez e-mailu prázdno');

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} PERSONAL MAP PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
