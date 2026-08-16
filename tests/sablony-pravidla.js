// ŠABLONY S PRAVIDLY + PŘENOS PRAVIDEL EXPORTEM/IMPORTEM (Richard 15. 8. 2026):
//  - parity: FE remapRuleIds (lib/ruleRemap.js) ≡ server remapRuleIdsServer
//    (helpers.js) na fixturách — dvě kopie, drift = tichá nekonzistence
//  - seed: „8D report — kanban" (7 pravidel) a „FMEA — kanban" (5) VEDLE klasik
//  - cron cesta instantiateTemplate: pravidla se přemapují na reálná id a
//    kanban FUNGUJE (karta pod D1 → done → pod D2 + Založeno) — mutační
//    ověření čerstvým GETem mapy, ne echem odpovědi
//  - round-trip: export s pravidly → /map-import → pravidla remapnutá a funkční
//  - přiznané přeskočení: nevalidní pravidlo, strop 50, cizí e-maily,
//    starý export bez pole rules projde beze změny
// ⚠️ rate-limit importu je 3/min/uživatele → importy se střídají mezi B a C.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const NAME = 'kb-e2e-sablony-pravidla';
const PORT = 20992;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0, code = 1;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
const freshMap = async (token, id) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token })).json;
const findByTitle = (m, prefix) => (m.nodes || []).find((n) => String((n.data || {}).title || '').startsWith(prefix));
const parentOf = (m, id) => { const e = (m.edges || []).find((x) => x.target === id); return e ? e.source : ''; };
const listRules = async (token, mapId) => (await api('GET', `/api/kb/rules?map=${encodeURIComponent(mapId)}`, { token })).json.rules || [];

// ---------- 1) PARITY FE ↔ server remapu (bez dockeru, vzor cleanmap-parity) ----------
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

const ID_MAP = { d1: 'node-9-d1', d2: 'node-9-d2', root: 'node-9-root' };
const FIXTURES = [
  { popis: 'kanban krok (parent + move_node + set_status)',
    rule: { id: 'r1', name: 'Kanban: D1 → D2', name_en: 'x', trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'parent', op: 'eq', value: 'd1' }],
      actions: [{ type: 'move_node', to: 'd2' }, { type: 'set_status', status: 'todo' }] } },
  { popis: 'scope node_id + target setru na id',
    rule: { name: 'x', node_id: 'd1', trigger: { type: 'node_status_changed' },
      actions: [{ type: 'set_owner', owner: 'a@b.cz', target: 'd2' }] } },
  { popis: 'pseudo-cíle trigger_node/parent se NEpřekládají',
    rule: { name: 'x', trigger: { type: 'node_status_changed' },
      conditions: [{ field: 'status', op: 'eq', value: 'done' }],
      actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [{ title: 'A' }] },
        { type: 'set_deadline', target: 'parent', relative_days: 3 }] } },
  { popis: 'create_subnodes.parent na id + odkaz MIMO idMap se ponechá',
    rule: { name: 'x', node_id: 'neznamy', trigger: { type: 'node_status_changed' },
      conditions: [{ field: 'parent', op: 'ne', value: 'd2' }],
      actions: [{ type: 'create_subnodes', parent: 'd1', items: [{ title: 'A' }] },
        { type: 'move_node', to: 'cizi-id' }] } },
  { popis: 'prázdné/chybějící kolekce nespadnou',
    rule: { name: '', trigger: { type: 'schedule', freq: 'daily' } } },
];

(async () => {
  console.log('== parity: FE remapRuleIds ≡ server remapRuleIdsServer ==');
  const feMod = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/ruleRemap.js')).href);
  const helpersSrc = fs.readFileSync(path.join(__dirname, '../server/pb_hooks/helpers.js'), 'utf8');
  // eslint-disable-next-line no-eval
  const remapServer = eval('(' + extractFn(helpersSrc, 'remapRuleIdsServer') + ')');
  for (const f of FIXTURES) {
    const a = feMod.remapRuleIds(f.rule, ID_MAP);
    const b = remapServer(f.rule, ID_MAP);
    expect(JSON.stringify(a) === JSON.stringify(b), `parity: ${f.popis}`);
  }
  // šablonová pole se nepřenáší a odkazy se přeložily
  const r0 = feMod.remapRuleIds(FIXTURES[0].rule, ID_MAP);
  expect(!('id' in r0) && !('name_en' in r0), 'remap zahazuje šablonová pole id a name_en');
  expect(r0.conditions[0].value === 'node-9-d1' && r0.actions[0].to === 'node-9-d2', 'remap přeložil parent.value i move_node.to');

  console.log('== export „bez lidí": role zůstávají, e-maily ven (checkup 15. 8.) ==');
  const mp = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/mapPortable.js')).href);
  const bezLidi = mp.buildMapExport({
    map: { title: 'x', description: '' }, nodes: [], edges: [], tasks: [], includePeople: false,
    rules: [
      { name: 'osoba+posun', trigger: { type: 'node_status_changed' },
        actions: [{ type: 'set_owner', owner: 'a@b.cz' }, { type: 'move_node', to: 'n1' }] },
      { name: 'role zůstává', trigger: { type: 'node_status_changed' },
        actions: [{ type: 'set_owner', owner: 'position:abc' }] },
      { name: 'jen notify osobě', trigger: { type: 'node_status_changed' },
        actions: [{ type: 'notify', to: 'a@b.cz' }] },
      { name: 'notify roli', trigger: { type: 'node_status_changed' },
        actions: [{ type: 'notify', to: 'map_owner' }] },
      { name: 'osobní podmínka', trigger: { type: 'node_status_changed' },
        conditions: [{ field: 'owner', op: 'eq', value: 'a@b.cz' }],
        actions: [{ type: 'set_status', status: 'todo' }] },
      { name: 'checklist s lidmi', trigger: { type: 'node_status_changed' },
        actions: [{ type: 'create_subnodes', items: [{ title: 'A', owner: 'a@b.cz', children: [{ title: 'B', owner: 'c@d.cz' }] }] }] },
    ],
  }).rules;
  const jmena = bezLidi.map((x) => x.name);
  expect(jmena.join('|') === 'osoba+posun|role zůstává|notify roli|checklist s lidmi',
    `bez lidí: zůstala správná pravidla (${jmena.join('|')})`);
  expect(bezLidi[0].actions.length === 1 && bezLidi[0].actions[0].type === 'move_node',
    'set_owner s e-mailem dropnut, move_node zůstal');
  expect(bezLidi[1].actions[0].owner === 'position:abc', 'set_owner na pozici (role) přežil');
  const chk = bezLidi[3].actions[0].items[0];
  expect(chk.owner === '' && chk.children[0].owner === '', 'garanti v checklistu vyprázdněni rekurzivně');

  // ---------- 2) e2e proti čerstvé instanci ----------
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    await reg('a@example.com'); // první registrace = admin
    await reg('b@example.com');
    await reg('c@example.com');
    const A = await login('a@example.com');
    const B = await login('b@example.com');
    const C = await login('c@example.com');
    const uidA = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@example.com', password: PW } })).json.record.id;

    console.log('== seed: kanban šablony existují VEDLE klasik a nesou pravidla ==');
    const tpls = (await api('GET', '/api/collections/templates/records?perPage=200', { token: ST })).json.items || [];
    const tpl8d = tpls.find((t) => t.title === '8D report — kanban');
    const tplFmea = tpls.find((t) => t.title === 'FMEA — kanban');
    expect(!!tpls.find((t) => t.title === '8D report (8 disciplín)'), 'klasická 8D šablona zůstala');
    expect(!!tpl8d, 'šablona „8D report — kanban" v seedu');
    expect(!!tplFmea, 'šablona „FMEA — kanban" v seedu');
    expect(tpl8d && Array.isArray(tpl8d.rules) && tpl8d.rules.length === 7, `8D kanban nese 7 pravidel (${tpl8d && (tpl8d.rules || []).length})`);
    expect(tplFmea && Array.isArray(tplFmea.rules) && tplFmea.rules.length === 5, `FMEA kanban nese 5 pravidel (${tplFmea && (tplFmea.rules || []).length})`);
    const nodeIds = new Set((tpl8d.ai_nodes || []).map((n) => n.id));
    const refsOk = (tpl8d.rules || []).every((r) =>
      r.conditions.every((c) => c.field !== 'parent' || nodeIds.has(c.value)) &&
      r.actions.every((a) => a.type !== 'move_node' || nodeIds.has(a.to)));
    expect(refsOk, 'odkazy pravidel míří jen na šablonová id uzlů (d1…d8)');
    const enIds = new Set((tpl8d.ai_nodes_en || []).map((n) => n.id));
    expect(nodeIds.size === enIds.size && [...nodeIds].every((x) => enIds.has(x)), 'ai_nodes_en má STEJNÁ id (pravidla platí pro oba jazyky)');
    expect((tpl8d.rules || []).every((r) => r.name && r.name_en), 'pravidla nesou name i name_en');
    expect((tpl8d.rules || []).every((r) => r.actions.every((a) => a.type !== 'set_owner')), 'šablonová pravidla bez osob (žádný set_owner)');
    expect(tpl8d.category === 'kanban' && tplFmea.category === 'kanban', 'kanban šablony mají VLASTNÍ kategorii kanban (sekce v galerii)');

    console.log('== cron cesta: instantiateTemplate založí pravidla přemapovaná na reálná id ==');
    // vlastnictví šablony NEJDE přepsat (update hook „autorství nejde přepsat",
    // ani superuserem) → uživatel si založí VLASTNÍ kopii kanban šablony
    // (ai_nodes + rules ze seedu) s auto-zakládáním — pokrývá i uživatelské
    // šablony s pravidly, ne jen seedové
    // ⚠️ Den v týdnu MUSÍ být ten kontejnerový, ne hostitelský. Cron uvnitř
    // kontejnera jede v UTC, hostitel v Europe/Prague — mezi půlnocí a druhou
    // ranní se rozcházejí o celý den a sada padala na „založila 0 projektů".
    // Stejný důvod i řešení jako v rules-engine.js (`docker exec … date`).
    const dow = Number(execSync(`docker exec ${NAME} date +%u`).toString().trim());
    let r = await api('POST', '/api/collections/templates/records', { token: A, body: {
      title: 'Můj 8D kanban', description: '', category: 'kvalita', icon: 'ClipboardList',
      goal: tpl8d.goal, node_type: tpl8d.node_type, ai_nodes: tpl8d.ai_nodes, rules: tpl8d.rules,
      auto_create: 'weekly', auto_day: dow,
    } });
    expect(r.status === 200, `uživatel založil vlastní šablonu s pravidly (${r.status})`);
    r = await api('POST', '/api/kb/run-auto-templates', { token: ST });
    expect(r.status === 200 && r.json.created === 1, `auto-instantiace založila 1 projekt (${r.json && r.json.created})`);
    const maps = (await api('GET', `/api/collections/goalmaps/records?perPage=50&filter=${encodeURIComponent(`owner = "${uidA}"`)}`, { token: ST })).json.items || [];
    // pozor: nový uživatel má i úvodní mapu — auto-projekt se pozná podle názvu šablony
    const autoMap = maps.find((x) => String(x.title || '').startsWith('Můj 8D kanban'));
    expect(!!autoMap, 'projekt z šablony existuje (název nese jméno šablony + datum)');
    const autoRules = await listRules(A, autoMap.id);
    expect(autoRules.length === 7, `mapa má 7 pravidel (${autoRules.length})`);
    let m = await freshMap(A, autoMap.id);
    const d1 = findByTitle(m, 'D1'), d2 = findByTitle(m, 'D2');
    const idSet = new Set((m.nodes || []).map((n) => n.id));
    expect(autoRules.every((x) => x.conditions.every((cc) => cc.field !== 'parent' || idSet.has(cc.value))
      && x.actions.every((a) => a.type !== 'move_node' || idSet.has(a.to))), 'odkazy pravidel míří na REÁLNÁ id uzlů mapy (remap proběhl)');
    expect(autoRules.every((x) => x.enabled), 'pravidla jsou zapnutá');
    const dbRule = (await api('GET', `/api/collections/automation_rules/records?perPage=1&filter=${encodeURIComponent(`map = "${autoMap.id}"`)}`, { token: ST })).json.items[0];
    expect(dbRule && dbRule.created_by === 'a@example.com', `created_by = vlastník šablony (${dbRule && dbRule.created_by})`);
    // kanban šablona se otevírá jako DESKA: sloupce v jedné řadě (žádný kompakt)
    const yUrovne = [...new Set((m.nodes || [])
      .filter((n) => /^D\d/.test(String((n.data || {}).title || '')))
      .map((n) => Math.round(n.position.y)))];
    expect(yUrovne.length === 1, `sloupce D1–D8 v JEDNÉ řadě i z cron cesty (${yUrovne.length} úrovní y)`);

    console.log('== kanban ze šablony FUNGUJE: karta pod D1 → done → pod D2 + Založeno ==');
    const karta = { id: 'karta1', type: 'goalNode', position: { x: 0, y: 400 }, data: { title: 'Reklamace 1', status: 'todo' } };
    let f = await freshMap(A, autoMap.id);
    r = await api('PATCH', `/api/collections/goalmaps/records/${autoMap.id}`, { token: A, body: {
      nodes: f.nodes.concat([karta]), edges: f.edges.concat([{ id: 'ek1', source: d1.id, target: 'karta1' }]), base_updated: f.updated,
    } });
    expect(r.status === 200, `karta pod D1 založena (${r.status})`);
    f = await freshMap(A, autoMap.id);
    r = await api('PATCH', `/api/collections/goalmaps/records/${autoMap.id}`, { token: A, body: {
      nodes: f.nodes.map((n) => (n.id === 'karta1' ? { ...n, data: { ...n.data, status: 'done' } } : n)), edges: f.edges, base_updated: f.updated,
    } });
    expect(r.status === 200, `dokončení karty prošlo (${r.status})`);
    m = await freshMap(A, autoMap.id);
    expect(parentOf(m, 'karta1') === d2.id, `karta se přesunula pod D2 (je pod ${parentOf(m, 'karta1')})`);
    expect(findByTitle(m, 'Reklamace 1').data.status === 'todo', 'stav se vrátil na Založeno');

    console.log('== round-trip: export s pravidly → /map-import → remapnutá a funkční ==');
    // zdrojová mapa uživatele B s vlastním kanban pravidlem
    const srcNodes = [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Zdroj', title: 'Zdroj', status: 'todo' } },
      { id: 'S1', type: 'goalNode', position: { x: 0, y: 100 }, data: { title: 'Sloupec 1', status: 'todo' } },
      { id: 'S2', type: 'goalNode', position: { x: 200, y: 100 }, data: { title: 'Sloupec 2', status: 'todo' } },
      { id: 'K1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Karta', status: 'todo' } },
    ];
    const srcEdges = [
      { id: 'e1', source: 'root', target: 'S1' }, { id: 'e2', source: 'root', target: 'S2' },
      { id: 'e3', source: 'S1', target: 'K1' },
    ];
    const srcMap = (await api('POST', '/api/collections/goalmaps/records', { token: B, body: { title: 'Zdroj', nodes: srcNodes, edges: srcEdges } })).json;
    r = await api('POST', '/api/kb/rules/save', { token: B, body: {
      map: srcMap.id, name: 'Kanban: S1 → S2', trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'parent', op: 'eq', value: 'S1' }],
      actions: [{ type: 'move_node', to: 'S2' }, { type: 'set_status', status: 'todo' }],
    } });
    expect(r.status === 200, `zdrojové pravidlo založeno (${r.status})`);
    const exportRules = await listRules(B, srcMap.id);
    const fSrc = await freshMap(B, srcMap.id);
    const exportJson = (rules) => ({
      format: 'killbottleneck.map/1', exported_at: '2026-08-15T00:00:00Z', exported_by: '',
      map: { title: 'Round-trip', description: '', nodes: fSrc.nodes, edges: fSrc.edges },
      tasks: [],
      ...(rules !== undefined ? { rules } : {}),
    });
    r = await api('POST', '/api/kb/map-import', { token: B, body: exportJson(exportRules.map((x) => ({ name: x.name, node_id: x.node_id || '', trigger: x.trigger, conditions: x.conditions, actions: x.actions, enabled: x.enabled }))) });
    expect(r.status === 200 && r.json.rules_imported === 1 && r.json.rules_skipped === 0,
      `import: rules_imported=1, skipped=0 (${r.json && r.json.rules_imported}/${r.json && r.json.rules_skipped})`);
    const impId = r.json.id;
    const impRules = await listRules(B, impId);
    m = await freshMap(B, impId);
    const impS1 = findByTitle(m, 'Sloupec 1'), impS2 = findByTitle(m, 'Sloupec 2'), impK1 = findByTitle(m, 'Karta');
    expect(impRules.length === 1 && impRules[0].conditions[0].value === impS1.id && impRules[0].actions[0].to === impS2.id,
      'importované pravidlo remapnuté na NOVÁ id (žádný odkaz do zdrojové mapy)');
    f = await freshMap(B, impId);
    r = await api('PATCH', `/api/collections/goalmaps/records/${impId}`, { token: B, body: {
      nodes: f.nodes.map((n) => (n.id === impK1.id ? { ...n, data: { ...n.data, status: 'done' } } : n)), edges: f.edges, base_updated: f.updated,
    } });
    m = await freshMap(B, impId);
    expect(parentOf(m, impK1.id) === impS2.id, 'kanban na importované mapě FUNGUJE (karta pod Sloupec 2)');

    console.log('== přiznané přeskočení a zpětná kompatibilita ==');
    // nevalidní pravidlo (cíl mimo mapu) → mapa vznikne, pravidlo přiznaně přeskočeno
    r = await api('POST', '/api/kb/map-import', { token: C, body: exportJson([
      { name: 'Vadné', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node', to: 'id-z-jine-mapy' }] },
      { name: 'Dobré', trigger: { type: 'node_status_changed', status: 'done' }, conditions: [{ field: 'parent', op: 'eq', value: 'S1' }], actions: [{ type: 'set_status', status: 'todo' }] },
    ]) });
    expect(r.status === 200 && r.json.rules_imported === 1 && r.json.rules_skipped === 1,
      `nevalidní pravidlo = skip, mapa i dobré pravidlo vznikly (${r.json && r.json.rules_imported}/${r.json && r.json.rules_skipped})`);
    // starý export bez pole rules projde
    r = await api('POST', '/api/kb/map-import', { token: C, body: exportJson(undefined) });
    expect(r.status === 200 && r.json.rules_imported === 0 && r.json.rules_skipped === 0, 'starý export bez rules projde (0/0)');
    // cizí e-maily: set_owner na neznámého → akce dropnuta, pravidlo zbylé projde;
    // notify na neznámý e-mail jako JEDINÁ akce → pravidlo přiznaně přeskočeno
    r = await api('POST', '/api/kb/map-import', { token: B, body: exportJson([
      { name: 'S duchem', trigger: { type: 'node_status_changed', status: 'done' }, conditions: [{ field: 'parent', op: 'eq', value: 'S1' }],
        actions: [{ type: 'move_node', to: 'S2' }, { type: 'set_owner', owner: 'duch@jina-instance.example' }] },
      { name: 'Jen notify duchovi', trigger: { type: 'node_status_changed' }, actions: [{ type: 'notify', to: 'duch2@jina-instance.example' }] },
      { name: 'Notify roli', trigger: { type: 'node_status_changed' }, actions: [{ type: 'notify', to: 'map_owner' }] },
    ]) });
    expect(r.status === 200 && r.json.rules_imported === 2 && r.json.rules_skipped === 1 && r.json.assignments_dropped >= 2,
      `cizí e-maily dropnuty a spočítány (${r.json && r.json.rules_imported}/${r.json && r.json.rules_skipped}, dropped ${r.json && r.json.assignments_dropped})`);
    const ghostRules = await listRules(B, r.json.id);
    const sDuchem = ghostRules.find((x) => x.name === 'S duchem');
    expect(sDuchem && sDuchem.actions.every((a) => a.type !== 'set_owner'), 'set_owner na ducha v pravidle NENÍ (žádný cizí e-mail v instanci)');
    expect(!!ghostRules.find((x) => x.name === 'Notify roli'), 'notify na ROLI (map_owner) prošlo — role není osoba');
    // checkup 15. 8.: enabled:false drží, osobní podmínka na ducha = skip celého
    // pravidla, neplatná pozice = skip (validace, NE počítání mezi lidi),
    // duchové v checklistu se vyprázdní a spočítají
    r = await api('POST', '/api/kb/map-import', { token: A, body: exportJson([
      { name: 'Vypnuté', enabled: false, trigger: { type: 'node_status_changed', status: 'done' },
        conditions: [{ field: 'parent', op: 'eq', value: 'S1' }], actions: [{ type: 'set_status', status: 'todo' }] },
      { name: 'Podmínka na ducha', trigger: { type: 'node_status_changed' },
        conditions: [{ field: 'owner', op: 'eq', value: 'duch3@jina-instance.example' }],
        actions: [{ type: 'set_status', status: 'todo' }] },
      { name: 'Neplatná pozice', trigger: { type: 'node_status_changed' },
        actions: [{ type: 'set_owner', owner: 'position:neexistujici-uzel' }] },
      { name: 'Checklist s duchy', trigger: { type: 'node_status_changed' },
        actions: [{ type: 'create_subnodes', items: [{ title: 'A', owner: 'duch4@x.example', children: [{ title: 'B', owner: 'duch5@x.example' }] }] }] },
    ]) });
    expect(r.status === 200 && r.json.rules_imported === 2 && r.json.rules_skipped === 2,
      `enabled/duchové: 2 založena, 2 přiznaně přeskočena (${r.json && r.json.rules_imported}/${r.json && r.json.rules_skipped})`);
    expect(r.json.assignments_dropped === 2, `duchové z checklistu spočítáni (dropped ${r.json && r.json.assignments_dropped})`);
    const aRules = await listRules(A, r.json.id);
    const vyp = aRules.find((x) => x.name === 'Vypnuté');
    expect(vyp && vyp.enabled === false, 'importované pravidlo drží enabled:false');
    const chkImp = aRules.find((x) => x.name === 'Checklist s duchy');
    const it0 = chkImp && chkImp.actions[0].items[0];
    expect(it0 && it0.owner === '' && it0.children[0].owner === '', 'garanti-duchové v checklistu vyprázdněni');
    // strop 50/mapa: 60 pravidel → 50 založeno, 10 přiznaně přeskočeno
    const many = Array.from({ length: 60 }, (_, i) => ({
      name: `Pravidlo ${i + 1}`, trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'parent', op: 'eq', value: 'S1' }], actions: [{ type: 'set_status', status: 'in_progress' }],
    }));
    r = await api('POST', '/api/kb/map-import', { token: C, body: exportJson(many) });
    expect(r.status === 200 && r.json.rules_imported === 50 && r.json.rules_skipped === 10,
      `strop 50/mapa drží i pro import (${r.json && r.json.rules_imported}/${r.json && r.json.rules_skipped})`);

    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error('SADA SPADLA:', err);
    code = 1;
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} SABLONY-PRAVIDLA PASS ${pass} / FAIL ${fail}`);
  process.exit(code);
})();
