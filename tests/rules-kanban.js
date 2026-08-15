// KANBAN POSUN (Richard 14. 8. 2026): stálá mapa (8D/FMEA), reklamace jako
// karty pod disciplínami. Pravidlo „karta pod D1 dokončena → přesuň pod D2,
// předej člověku, vrať na Založeno". E2E přesně dle zadaného scénáře:
//  - nová AND podmínka `parent` (eq/ne) — „karta POD sloupcem"
//  - nová akce `move_node {to}` — přepis rodičovské hrany + konec řady
//  - řetěz D1→D2→D3 přes samostatná uložení; návrat na todo NESPUSTÍ další krok
//  - pojistky: cyklus / zmizelý cíl = přiznaný skip; ping-pong dvou pravidel
//    se zastaví sám (stav se přestane měnit)
//  - „Co se změnilo": přesun se loguje (field parent → skupina moved)
//  - validace routy /rules/save + šablona nesmí nést konkrétní id
const { execSync } = require('child_process');

const NAME = 'kb-e2e-kanban';
const PORT = 20991;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0, code = 1;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });
const freshMap = async (token, id) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token })).json;
const patchMap = async (token, map, nodes, edges) => {
  const f = await freshMap(token, map.id);
  return api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token, body: { nodes, edges, base_updated: f.updated } });
};
const findNode = (m, id) => (m.nodes || []).find((n) => n.id === id);
const parentOf = (m, id) => { const e = (m.edges || []).find((x) => x.target === id); return e ? e.source : ''; };
// nastavit stav karty přes ČERSTVÝ stav mapy (pravidla mezitím hýbou hranami
// i pozicemi — stavět na zastaralých polích by testovalo něco jiného než UI)
const setStatus = async (token, map, nodeId, status) => {
  const m = await freshMap(token, map.id);
  const nodes = m.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n));
  return patchMap(token, map, nodes, m.edges);
};

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    await reg('a@example.com'); // první registrace = admin, vlastník mapy
    await reg('b@example.com');
    await reg('c@example.com');
    const A = await login('a@example.com');

    // 8D mapa: disciplíny jako sloupce, reklamace jako karty pod D1.
    // S1 pod D2 existuje předem — ověří „přesun na KONEC řady sourozenců".
    const NODES = [
      node('root', { apexText: '8D report', title: '8D report', status: 'todo' }, 'apexNode'),
      node('D1', { title: 'D1 – Sestavení týmu', status: 'todo' }),
      node('D2', { title: 'D2 – Popis problému', status: 'todo' }),
      node('D3', { title: 'D3 – Okamžitá opatření', status: 'todo' }),
      node('R1', { title: 'Reklamace1', status: 'todo', owner: 'a@example.com' }),
      node('R2', { title: 'Reklamace2', status: 'todo', owner: 'a@example.com' }),
      node('S1', { title: 'Stávající karta pod D2', status: 'todo' }),
    ];
    const EDGES = [
      { id: 'e1', source: 'root', target: 'D1' }, { id: 'e2', source: 'root', target: 'D2' },
      { id: 'e3', source: 'root', target: 'D3' },
      { id: 'e4', source: 'D1', target: 'R1' }, { id: 'e5', source: 'D1', target: 'R2' },
      { id: 'e6', source: 'D2', target: 'S1' },
    ];
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: '8D kanban', nodes: NODES, edges: EDGES } })).json;
    const runs = async (filter) => (await api('GET', `/api/collections/rule_runs/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token: ST })).json.items || [];
    // pravidla přes SESSION ROUTU (validace = stejná cesta jako builder v UI)
    const saveRule = (body) => api('POST', '/api/kb/rules/save', { token: A, body: Object.assign({ map: map.id }, body) });

    console.log('== kanban řetěz: D1 → D2 → D3 (posun + předání + Založeno) ==');
    const k1 = (await saveRule({
      name: 'Kanban: D1 → D2', trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'parent', op: 'eq', value: 'D1' }],
      actions: [{ type: 'move_node', to: 'D2' }, { type: 'set_owner', owner: 'b@example.com' }, { type: 'set_status', status: 'todo' }],
    })).json;
    expect(!!(k1 && k1.rule && k1.rule.id), 'pravidlo D1→D2 prošlo validací routy (builderova cesta)');
    const k2 = (await saveRule({
      name: 'Kanban: D2 → D3', trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'parent', op: 'eq', value: 'D2' }],
      actions: [{ type: 'move_node', to: 'D3' }, { type: 'set_owner', owner: 'c@example.com' }, { type: 'set_status', status: 'todo' }],
    })).json;
    expect(!!(k2 && k2.rule && k2.rule.id), 'pravidlo D2→D3 založeno');

    let r = await setStatus(A, map, 'R1', 'done');
    expect(r.status === 200, `dokončení Reklamace1 prošlo (${r.status})`);
    let m = await freshMap(A, map.id);
    expect(parentOf(m, 'R1') === 'D2', `Reklamace1 se přesunula pod D2 (je pod ${parentOf(m, 'R1')})`);
    expect(findNode(m, 'R1').data.owner === 'b@example.com', 'nová zodpovědná osoba dle sloupce D2');
    expect(findNode(m, 'R1').data.status === 'todo', 'stav se vrátil na Založeno');
    expect(parentOf(m, 'R2') === 'D1', 'Reklamace2 zůstala pod D1 (podmínka parent cílí jen tu pravou)');
    expect((await runs(`rule = "${k1.rule.id}"`)).length === 1, 'běh D1→D2 zapsán v logu');
    expect((await runs(`rule = "${k2.rule.id}"`)).length === 0, 'návrat na Založeno NESPUSTIL krok D2→D3 (trigger jen na Hotovo)');

    console.log('== druhé dokončení posune dál; druhá karta jede nezávisle ==');
    await setStatus(A, map, 'R1', 'done');
    m = await freshMap(A, map.id);
    expect(parentOf(m, 'R1') === 'D3', 'Reklamace1 po druhém Hotovo pod D3');
    expect(findNode(m, 'R1').data.owner === 'c@example.com', 'předána dle sloupce D3');
    expect((await runs(`rule = "${k2.rule.id}"`)).length === 1, 'krok D2→D3 v logu');
    await setStatus(A, map, 'R2', 'done');
    m = await freshMap(A, map.id);
    expect(parentOf(m, 'R2') === 'D2', 'Reklamace2 dojela pod D2 nezávisle na první');
    expect(parentOf(m, 'R1') === 'D3', 'Reklamace1 přitom zůstala pod D3');

    console.log('== „Co se změnilo": přesun je vidět ve skupině Přesunuto ==');
    const ch = (await api('GET', `/api/kb/map-changes?map=${map.id}&range=7`, { token: A })).json;
    const moved = (ch.groups && ch.groups.moved) || [];
    expect(moved.length >= 3, `přesuny zapsané v historii (${moved.length})`);
    expect(moved.some((x) => x.id === 'R1' && x.from.includes('D1') && x.to.includes('D2')), 'řádek nese NÁZVY sloupců od→kam');

    console.log('== konec řady: přesunutá karta se řadí ZA stávající sourozence ==');
    // R2 je čerstvě pod D2 vedle S1 — po relayoutu musí být S1 v pořadí čtení první
    const xS1 = findNode(m, 'S1').position.x, xR2 = findNode(m, 'R2').position.x;
    expect(xR2 > xS1, `Reklamace2 přišla NA KONEC řady pod D2 (S1 ${Math.round(xS1)} < R2 ${Math.round(xR2)})`);

    console.log('== pojistky: cyklus a zmizelý cíl = přiznaný skip, nic nespadne ==');
    const c1 = (await saveRule({
      name: 'Cyklus: D1 pod vlastní kartu', node_id: 'D1', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'move_node', to: 'R2' }],
    })).json; // R2 je teď pod D2, ale pravidlo míří na D1 → v čase exekuce cyklus není…
    // …tak ho vyrobíme: cílem je karta POD D1 (R2 vrátíme šéfovsky pod D1)
    m = await freshMap(A, map.id);
    let nodesZpet = m.nodes; let edgesZpet = m.edges.map((e) => (e.target === 'R2' ? { ...e, source: 'D1' } : e));
    await patchMap(A, map, nodesZpet, edgesZpet);
    r = await setStatus(A, map, 'D1', 'done');
    expect(r.status === 200, 'uložení s cyklovým pravidlem nespadlo');
    m = await freshMap(A, map.id);
    expect(parentOf(m, 'D1') === 'root', 'D1 se pod vlastní kartu NEpřesunul (cyklus)');
    let rr = await runs(`rule = "${c1.rule.id}"`);
    expect(rr.length === 1 && rr[0].status === 'skipped' && rr[0].detail.includes('cykl'), `cyklus přiznán jako skip (${rr[0] && rr[0].status})`);

    const c2 = (await saveRule({
      name: 'Cíl zmizí', node_id: 'D3', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'move_node', to: 'S1' }],
    })).json;
    m = await freshMap(A, map.id);
    // S1 smazat (i s hranou) — cíl pravidla zmizel; R1 visí pod D3, tu nechat
    await patchMap(A, map, m.nodes.filter((n) => n.id !== 'S1'), m.edges.filter((e) => e.target !== 'S1'));
    r = await setStatus(A, map, 'D3', 'done');
    expect(r.status === 200, 'uložení se zmizelým cílem nespadlo');
    rr = await runs(`rule = "${c2.rule.id}"`);
    expect(rr.length === 1 && rr[0].status === 'skipped' && rr[0].detail.includes('není'), 'zmizelý cíl přiznán jako skip');

    console.log('== vrchol přes celomapové pravidlo = přiznaný skip, ne failed ==');
    // validace chytí jen pravidlo přišpendlené na apex; celomapový trigger se
    // na vrcholu spustí legitimně a failed by lhal (nález panelu /checkup)
    const cApex = (await saveRule({
      name: 'Celomapový posun', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'move_node', to: 'D1' }],
    })).json;
    r = await setStatus(A, map, 'root', 'in_progress');
    expect(r.status === 200, 'změna stavu vrcholu prošla');
    m = await freshMap(A, map.id);
    expect(parentOf(m, 'root') === '', 'vrchol se nikam nepřesunul');
    rr = await runs(`rule = "${cApex.rule.id}" && node_id = "root"`);
    expect(rr.length === 1 && rr[0].status === 'skipped' && rr[0].detail.includes('vrchol'),
      `vrchol = skipped s lidským důvodem (${rr[0] && rr[0].status})`);
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: cApex.rule.id, enabled: false } });

    console.log('== přesun pod SOUČASNÉHO rodiče = ok bez zápisu (noop) ==');
    const cNoop = (await saveRule({
      name: 'Noop posun', trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'parent', op: 'eq', value: 'D3' }],
      actions: [{ type: 'move_node', to: 'D3' }],
    })).json;
    r = await setStatus(A, map, 'R1', 'done'); // R1 už je pod D3
    expect(r.status === 200, 'uložení s noop pravidlem prošlo');
    m = await freshMap(A, map.id);
    expect(parentOf(m, 'R1') === 'D3', 'karta zůstala pod D3');
    rr = await runs(`rule = "${cNoop.rule.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok', 'noop běh je ok (nic se nerozbilo)');
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: cNoop.rule.id, enabled: false } });

    console.log('== org mapa: strukturální akce pravidel jsou zakázané ==');
    // přímý PATCH org struktury je admin-only — pravidlo běží právy autora
    // a stráž by obešlo (nález bezpečnostního panelu)
    r = await api('POST', '/api/kb/org-map', { token: A });
    expect(r.status === 200, `admin založil org mapu (${r.status})`);
    const orgId = r.json.map.id;
    const orgNode = (r.json.map.nodes || []).find((n) => n.type !== 'note' && n.type !== 'apexNode');
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: orgId, name: 'x', trigger: { type: 'node_status_changed' },
      actions: [{ type: 'move_node', to: orgNode ? orgNode.id : 'root' }],
    } });
    expect(r.status === 400, `move_node na org mapě → 400 (${r.status})`);
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: orgId, name: 'x', trigger: { type: 'node_status_changed' },
      actions: [{ type: 'create_subnodes', items: [{ title: 'Pozice' }] }],
    } });
    expect(r.status === 400, `create_subnodes na org mapě → 400 (${r.status})`);

    console.log('== ping-pong dvou kanban pravidel se zastaví sám ==');
    // vypnout řetěz k1/k2, ať do ping-pongu nemluví
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: k1.rule.id, enabled: false } });
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: k2.rule.id, enabled: false } });
    const p1 = (await saveRule({
      name: 'PingPong tam', trigger: { type: 'node_status_changed' },
      conditions: [{ field: 'parent', op: 'eq', value: 'D1' }],
      actions: [{ type: 'move_node', to: 'D2' }, { type: 'set_status', status: 'todo' }],
    })).json;
    const p2 = (await saveRule({
      name: 'PingPong zpět', trigger: { type: 'node_status_changed' },
      conditions: [{ field: 'parent', op: 'eq', value: 'D2' }],
      actions: [{ type: 'move_node', to: 'D1' }, { type: 'set_status', status: 'todo' }],
    })).json;
    r = await setStatus(A, map, 'R2', 'in_progress'); // R2 je pod D1 → tam → zpět → klid
    expect(r.status === 200, 'ping-pong uložení nespadlo (řetěz se utnul sám)');
    m = await freshMap(A, map.id);
    expect(['D1', 'D2'].includes(parentOf(m, 'R2')), 'karta po ping-pongu stojí (žádné nekonečné stěhování)');
    const pp = (await runs(`rule = "${p1.rule.id}"`)).length + (await runs(`rule = "${p2.rule.id}"`)).length;
    expect(pp >= 2 && pp <= 6, `ping-pong proběhl jen omezeně (${pp} běhů)`);
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: p1.rule.id, enabled: false } });
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: p2.rule.id, enabled: false } });

    console.log('== validace: co builder ani API nesmí pustit ==');
    r = await saveRule({ name: 'x', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node' }] });
    expect(r.status === 400, `move_node bez cíle → 400 (${r.status})`);
    r = await saveRule({ name: 'x', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node', to: 'neexistuje' }] });
    expect(r.status === 400, 'move_node na neexistující uzel → 400');
    r = await saveRule({ name: 'x', node_id: 'D1', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node', to: 'D1' }] });
    expect(r.status === 400, 'move_node sám pod sebe → 400');
    r = await saveRule({ name: 'x', node_id: 'root', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node', to: 'D1' }] });
    expect(r.status === 400, 'přesun vrcholu → 400');
    r = await saveRule({ name: 'x', trigger: { type: 'schedule', freq: 'daily' }, actions: [{ type: 'move_node', to: 'D1' }] });
    expect(r.status === 400, 'celomapový schedule s move_node (bez uzlu) → 400');
    r = await saveRule({ name: 'x', trigger: { type: 'node_status_changed' }, conditions: [{ field: 'parent', op: 'eq', value: 'neexistuje' }], actions: [{ type: 'set_status', status: 'done' }] });
    expect(r.status === 400, 'podmínka parent na neexistující uzel → 400');
    r = await saveRule({ name: 'x', trigger: { type: 'node_status_changed' }, conditions: [{ field: 'parent', op: 'empty' }], actions: [{ type: 'set_status', status: 'done' }] });
    expect(r.status === 400, 'podmínka parent s op empty → 400');
    r = await api('POST', '/api/kb/rule-templates/save', { token: A, body: { name: 'šablona s move', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node', to: 'D1' }] } });
    expect(r.status === 400, 'šablona pravidla nesmí nést konkrétní cíl přesunu → 400');
    r = await api('POST', '/api/kb/rule-templates/save', { token: A, body: { name: 'šablona s parent', trigger: { type: 'node_status_changed' }, conditions: [{ field: 'parent', op: 'eq', value: 'D1' }], actions: [{ type: 'set_status', status: 'done' }] } });
    expect(r.status === 400, 'šablona pravidla nesmí nést podmínku parent s konkrétním id → 400');

    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error('SADA SPADLA:', err);
    code = 1;
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} RULES-KANBAN PASS ${pass} / FAIL ${fail}`);
  process.exit(code);
})();
