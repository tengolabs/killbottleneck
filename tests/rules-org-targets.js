// DYNAMICKÉ CÍLE NA POZICE org struktury (position:<id> / deputy_of_position:<id>)
// + přednost org struktury v deputy_of_node_owner:
//  - set_owner na držitele pozice; výměna držitele → pravidlo BEZE ZMĚNY cílí nového
//  - zástupce pozice; neobsazená/zmizelá pozice = přiznaný skip, nikdy failed
//  - owner drží 2 pozice s různými zástupci: notify VŠEM, set_owner skip s radou
//  - owner bez pozice → osobní fallback users.deputy
//  - validace při uložení: neexistující pozice = 400; position: nezávisí na
//    trigger uzlu → projde i u celomapového schedule
const { execSync } = require('child_process');

const NAME = 'kb-e2e-rules-org';
const PORT = 20811;
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
const patchMap = async (token, mapId, nodes, edges) => {
  const f = await freshMap(token, mapId);
  return api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token, body: { nodes, edges, base_updated: f.updated } });
};
const findNode = (m, id) => (m.nodes || []).find((n) => n.id === id);

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    for (const em of ['a', 'b', 'c', 'd', 'e']) await reg(`${em}@example.com`); // a = admin
    const A = await login('a@example.com');

    // org struktura: pos1 Kvalitář (b, zástupce c), pos2 Auditor (b, zástupce d), pos3 neobsazená
    const org = (await api('POST', '/api/kb/org-map', { token: A })).json.map;
    const apexId = org.nodes.find((n) => n.type === 'apexNode').id;
    await patchMap(A, org.id, org.nodes.concat([
      node('pos1', { title: 'Kvalitář', status: 'todo', positionKind: 'position', holder: 'b@example.com', deputy: 'c@example.com' }),
      node('pos2', { title: 'Interní auditor', status: 'todo', positionKind: 'function', holder: 'b@example.com', deputy: 'd@example.com' }),
      node('pos3', { title: 'Bezpečnost výrobku', status: 'todo', positionKind: 'function' }),
    ]), [
      { id: 'e1', source: apexId, target: 'pos1' },
      { id: 'e2', source: apexId, target: 'pos2' },
      { id: 'e3', source: apexId, target: 'pos3' },
    ]);

    // pracovní mapa
    const NODES = [
      node('root', { apexText: 'Výroba', title: 'Výroba', status: 'todo' }, 'apexNode'),
      node('X', { title: 'Kontrola šarže', status: 'todo', owner: 'a@example.com' }),
      node('Y', { title: 'Audit záznamů', status: 'todo', owner: 'b@example.com' }), // b drží 2 pozice
      node('Z', { title: 'Bez pozice', status: 'todo', owner: 'e@example.com' }),   // e nemá pozici
    ];
    const EDGES = [
      { id: 'e1', source: 'root', target: 'X' },
      { id: 'e2', source: 'root', target: 'Y' },
      { id: 'e3', source: 'root', target: 'Z' },
    ];
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Výroba', nodes: NODES, edges: EDGES } })).json;
    const mkRule = async (body) => (await api('POST', '/api/collections/automation_rules/records', { token: ST, body: Object.assign({ map: map.id, enabled: true, created_by: 'a@example.com' }, body) })).json;
    const runs = async (filter) => (await api('GET', `/api/collections/rule_runs/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token: ST })).json.items || [];
    const notifs = async (email) => {
      const T = await login(email);
      return (await api('GET', `/api/collections/notifications/records?perPage=200&filter=${encodeURIComponent('type="rule_notice"')}`, { token: T })).json.items || [];
    };

    console.log('== position:<id> → držitel; výměna lidí pravidlo nerozbije ==');
    const r1 = await mkRule({
      name: 'Hotovo → kvalitáři', node_id: 'X', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'position:pos1' }],
    });
    let nodes = NODES.map((n) => (n.id === 'X' ? node('X', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map.id, nodes, EDGES);
    let m = await freshMap(A, map.id);
    expect(findNode(m, 'X').data.owner === 'b@example.com', 'uzel předán DRŽITELI pozice Kvalitář (b)');
    // výměna: kvalitářem se stává e — pravidlo se NEMĚNÍ
    let r = await api('POST', '/api/kb/org-structure/assign', { token: A, body: { node_id: 'pos1', holder: 'e@example.com' } });
    expect(r.status === 200, `výměna držitele pozice (${r.status})`);
    nodes = (await freshMap(A, map.id)).nodes.map((n) => (n.id === 'X' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'todo' }) }) : n));
    await patchMap(A, map.id, nodes, EDGES);
    nodes = nodes.map((n) => (n.id === 'X' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n));
    await patchMap(A, map.id, nodes, EDGES);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'X').data.owner === 'e@example.com', 'po výměně lidí TOTÉŽ pravidlo cílí nového držitele (e)');
    await api('PATCH', `/api/collections/automation_rules/records/${r1.id}`, { token: ST, body: { enabled: false } });
    // vrátit kvalitáře b — další testy počítají s b na DVOU pozicích a e bez pozice
    await api('POST', '/api/kb/org-structure/assign', { token: A, body: { node_id: 'pos1', holder: 'b@example.com' } });

    console.log('== deputy_of_position + neobsazená pozice ==');
    const r2 = await mkRule({
      name: 'Připomeň zástupci auditora', node_id: 'Y', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'notify', to: 'deputy_of_position:pos2', message: 'audit běží' },
        { type: 'notify', to: 'position:pos3', message: 'nikomu nedojde' }],
    });
    nodes = (await freshMap(A, map.id)).nodes.map((n) => (n.id === 'Y' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'in_progress' }) }) : n));
    await patchMap(A, map.id, nodes, EDGES);
    expect((await notifs('d@example.com')).some((n) => n.text.includes('audit běží')), 'zástupce pozice Auditor (d) dostal notifikaci');
    let rr = await runs(`rule = "${r2.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok' && String(rr[0].detail).includes('neobsazená'),
      `neobsazená pozice = přiznaný skip v detailu (${rr[0] && rr[0].detail})`);
    await api('PATCH', `/api/collections/automation_rules/records/${r2.id}`, { token: ST, body: { enabled: false } });

    console.log('== dvě pozice s různými zástupci: notify všem, set_owner skip ==');
    const r3 = await mkRule({
      name: 'Hotovo → zástupci osoby', node_id: 'Y', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'deputy_of_node_owner' }, { type: 'notify', to: 'deputy_of_node_owner', message: 'přebíráte' }],
    });
    nodes = (await freshMap(A, map.id)).nodes.map((n) => (n.id === 'Y' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n));
    await patchMap(A, map.id, nodes, EDGES);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'Y').data.owner === 'b@example.com', 'úkol se NEPŘEDAL (nejednoznačné = zůstává b)');
    rr = await runs(`rule = "${r3.id}"`);
    expect(String(rr[0] && rr[0].detail).includes('více pozic') || String(rr[0] && rr[0].detail).includes('konkrétní pozice'),
      `detail radí vybrat konkrétní pozici (${rr[0] && rr[0].detail})`);
    const nc3 = await notifs('c@example.com');
    const nd3 = await notifs('d@example.com');
    expect(nc3.some((n) => n.text.includes('přebíráte')), 'notify došla zástupci c');
    // d už měl k témuž uzlu notifikaci „audit běží" → SLÉVÁNÍ DÁVEK (standard
    // notify()) druhou jen přičte jako ×2; důkaz doručení je čítač, ne text
    expect(nd3.some((n) => n.text.includes('přebíráte') || n.text.includes('×2')),
      'notify došla i zástupci d (sloučená dávka ×2)');
    await api('PATCH', `/api/collections/automation_rules/records/${r3.id}`, { token: ST, body: { enabled: false } });

    console.log('== owner bez pozice → osobní fallback users.deputy ==');
    const eId = (await api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="e@example.com"')}`, { token: ST })).json.items[0].id;
    await api('PATCH', `/api/collections/users/records/${eId}`, { token: A, body: { deputy: 'd@example.com' } });
    const r4 = await mkRule({
      name: 'Bez pozice → osobní zástupce', node_id: 'Z', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'deputy_of_node_owner' }],
    });
    nodes = (await freshMap(A, map.id)).nodes.map((n) => (n.id === 'Z' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n));
    await patchMap(A, map.id, nodes, EDGES);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'Z').data.owner === 'd@example.com', 'bez pozice zabral osobní zástupce (users.deputy)');

    console.log('== kaskáda: podkrok hotový → NADŘAZENÝ krok se rozběhne a obsadí ==');
    // přesně scénář Richardova klik-testu 15. 8.: „když D2 bude hotovo, samo to
    // změní uzel NAD na probíhá a tím to přiřadí člověka — ať tam úkol nesvítí rok"
    let fk = await freshMap(A, map.id);
    await patchMap(A, map.id, fk.nodes.concat([
      node('P', { title: 'Krok', status: 'todo' }),
      node('C', { title: 'Podkrok', status: 'todo' }),
    ]), fk.edges.concat([{ id: 'ep', source: 'root', target: 'P' }, { id: 'ec', source: 'P', target: 'C' }]));
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Podkrok hotov → rozběhni krok', node_id: 'C',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_status', status: 'in_progress', target: 'parent' }],
    } });
    expect(r.status === 200, `pravidlo s cílem parent projde validací (${r.status})`);
    const rc = r.json.rule;
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Krok běží → obsadit auditorem', node_id: 'P',
      trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'set_owner', owner: 'position:pos2' }],
    } });
    const rp = r.json.rule;
    fk = await freshMap(A, map.id);
    await patchMap(A, map.id, fk.nodes.map((n) => (n.id === 'C' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)), fk.edges);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'P').data.status === 'in_progress', 'rodič se rozběhl (cíl akce = nadřazený uzel)');
    expect(findNode(m, 'P').data.owner === 'b@example.com', 'a řetězem se rovnou obsadil držitelem pozice');
    rr = await runs(`rule = "${rp.id}"`);
    expect(rr.length === 1 && rr[0].depth === 1, `pravidlo rodiče běželo v řetězu (depth ${rr[0] && rr[0].depth})`);
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: rc.id, enabled: false } });
    await api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, id: rp.id, enabled: false } });
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Cíl neexistuje', node_id: 'C', trigger: { type: 'node_status_changed' },
      actions: [{ type: 'set_status', status: 'done', target: 'neexistujici-uzel' }],
    } });
    expect(r.status === 400, `neexistující cílový uzel se odmítne při uložení (${r.status})`);

    console.log('== validace při uložení pravidla ==');
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Překlep pozice', node_id: 'X', trigger: { type: 'node_status_changed' },
      actions: [{ type: 'set_owner', owner: 'position:neexistuje' }],
    } });
    expect(r.status === 400, `neexistující pozice se odmítne při ULOŽENÍ (${r.status})`);
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Denní hlášení držiteli', trigger: { type: 'schedule', freq: 'daily' },
      actions: [{ type: 'notify', to: 'position:pos2', message: 'denní stav' }],
    } });
    expect(r.status === 200, `position: nezávisí na trigger uzlu → celomapový schedule projde (${r.status})`);

    console.log('== smazaná pozice za běhu = skip, ne pád ==');
    const r5 = await mkRule({
      name: 'Na smazanou pozici', node_id: 'X', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'notify', to: 'position:pos3', message: 'x' }],
    });
    const of = await freshMap(A, org.id);
    await patchMap(A, org.id, of.nodes.filter((n) => n.id !== 'pos3'), (of.edges || []).filter((ed) => ed.target !== 'pos3'));
    nodes = (await freshMap(A, map.id)).nodes.map((n) => (n.id === 'X' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'in_progress' }) }) : n));
    await patchMap(A, map.id, nodes, EDGES);
    rr = await runs(`rule = "${r5.id}"`);
    expect(rr.length === 1 && rr[0].status === 'skipped' && String(rr[0].detail).includes('už v organizační struktuře není'),
      `zmizelá pozice = skipped s lidským detailem (${rr[0] && rr[0].status})`);
    const rec5 = (await api('GET', `/api/collections/automation_rules/records/${r5.id}`, { token: ST })).json;
    expect(!rec5.error_notified, 'pravidlo není označeno za rozbité');
    await api('PATCH', `/api/collections/automation_rules/records/${r5.id}`, { token: ST, body: { enabled: false } });

    console.log('== archivovaná org mapa: cíle na pozice se přiznaně vypnou ==');
    const r6 = await mkRule({
      name: 'Na archivovanou strukturu', node_id: 'Z', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'notify', to: 'position:pos1', message: 'x' }],
    });
    const of2 = await freshMap(A, org.id);
    await api('PATCH', `/api/collections/goalmaps/records/${org.id}`, { token: A, body: { archived: true, base_updated: of2.updated } });
    nodes = (await freshMap(A, map.id)).nodes.map((n) => (n.id === 'Z' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'in_progress' }) }) : n));
    await patchMap(A, map.id, nodes, EDGES);
    rr = await runs(`rule = "${r6.id}"`);
    expect(rr.length === 1 && rr[0].status === 'skipped' && String(rr[0].detail).includes('struktura neexistuje'),
      `archivovaná struktura = přiznaný skip (${rr[0] && rr[0].status}: ${rr[0] && rr[0].detail})`);

    console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    code = 1;
  } finally {
    // ⚠️ process.exit AŽ ZA úklidem (vzor rules-engine)
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  process.exit(code);
})();
