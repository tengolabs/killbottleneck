// ZÁSTUPCE (vlna 1) — users.deputy + dynamický cíl „zástupce zodpovědné osoby":
//  - deputy nastavuje jen ADMIN (users update hook); překlep/sebe-zástupce = 400
//  - set_owner/notify s deputy_of_node_owner se rozřeší AŽ ZA BĚHU pravidla
//  - chybějící zástupce = PŘIZNANÝ skipped/přeskočeno v rule_runs, NIKDY
//    failed + mail „rozbité pravidlo"
//  - validace routy /rules/save: dynamický cíl bez trigger uzlu se odmítne
//  - /api/kb/members vrací deputy (kreslí ho UI zastupování)
const { execSync } = require('child_process');

const NAME = 'kb-e2e-rules-deputy';
const PORT = 20771;
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

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    await reg('a@example.com'); // první registrace = admin
    await reg('b@example.com'); // zodpovědná osoba se zástupcem
    await reg('c@example.com'); // zástupce b
    await reg('d@example.com'); // BEZ zástupce
    const A = await login('a@example.com');
    const B = await login('b@example.com');
    const C = await login('c@example.com');
    const uid = async (email) => (await api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email="${email}"`)}`, { token: ST })).json.items[0].id;
    const bId = await uid('b@example.com');

    console.log('== users.deputy: zapisuje jen admin, validuje se ==');
    let r = await api('PATCH', `/api/collections/users/records/${bId}`, { token: A, body: { deputy: 'c@example.com' } });
    expect(r.status === 200 && r.json.deputy === 'c@example.com', 'admin nastavil b zástupce c');
    r = await api('PATCH', `/api/collections/users/records/${bId}`, { token: B, body: { deputy: 'd@example.com' } });
    expect((r.json && r.json.deputy) !== 'd@example.com', 'člen si zástupce sám nezmění (hodnota se tiše drží)');
    const bRec = (await api('GET', `/api/collections/users/records/${bId}`, { token: ST })).json;
    expect(bRec.deputy === 'c@example.com', 'po pokusu člena zůstal zástupce c');
    r = await api('PATCH', `/api/collections/users/records/${bId}`, { token: A, body: { deputy: 'neznamy@example.com' } });
    expect(r.status === 400, `zástupce-nečlen se odmítne 400 (${r.status})`);
    r = await api('PATCH', `/api/collections/users/records/${bId}`, { token: A, body: { deputy: 'b@example.com' } });
    expect(r.status === 400, `sebe-zástupce se odmítne 400 (${r.status})`);

    console.log('== /api/kb/members nese deputy ==');
    r = await api('GET', '/api/kb/members', { token: B });
    const mb = (r.json.members || []).find((x) => x.email === 'b@example.com');
    expect(mb && mb.deputy === 'c@example.com', 'members vrací deputy u člena b');

    console.log('== běh pravidla: deputy_of_node_owner se rozřeší na zástupce ==');
    const NODES = [
      node('root', { apexText: 'Proces', title: 'Proces', status: 'todo' }, 'apexNode'),
      node('X', { title: 'Úkol b', status: 'todo', owner: 'b@example.com' }),
      node('Y', { title: 'Úkol d (bez zástupce)', status: 'todo', owner: 'd@example.com' }),
      node('Z', { title: 'Úkol bez garanta', status: 'todo' }),
    ];
    const EDGES = [
      { id: 'e1', source: 'root', target: 'X' },
      { id: 'e2', source: 'root', target: 'Y' },
      { id: 'e3', source: 'root', target: 'Z' },
    ];
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Zastupování', nodes: NODES, edges: EDGES } })).json;
    const mkRule = async (body) => (await api('POST', '/api/collections/automation_rules/records', { token: ST, body: Object.assign({ map: map.id, enabled: true, created_by: 'a@example.com' }, body) })).json;
    const runs = async (filter) => (await api('GET', `/api/collections/rule_runs/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token: ST })).json.items || [];
    const notifs = async (token) => ((await api('GET', `/api/collections/notifications/records?perPage=200&filter=${encodeURIComponent('type="rule_notice"')}`, { token })).json.items || []);

    const r1 = await mkRule({
      name: 'Hotovo → zástupci', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'deputy_of_node_owner' }, { type: 'notify', to: 'deputy_of_node_owner', message: 'přebíráš za kolegu' }],
    });
    let nodes = NODES.map((n) => (n.id === 'X' ? node('X', Object.assign({}, n.data, { status: 'done' })) : n));
    r = await patchMap(A, map, nodes, EDGES);
    expect(r.status === 200, `uložení mapy prošlo (${r.status})`);
    const m1 = await freshMap(A, map.id);
    expect(findNode(m1, 'X').data.owner === 'c@example.com', 'set_owner předal uzel ZÁSTUPCI (c), ne literálu');
    let rr = await runs(`rule = "${r1.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok', `běh je ok (${rr.length}, ${rr[0] && rr[0].status})`);
    expect(JSON.stringify(rr[0].actions_done || []).includes('c@example.com'), 'actions_done loguje ROZŘEŠENÝ e-mail zástupce');
    const nc = await notifs(C);
    expect(nc.length === 1 && nc[0].text.includes('přebíráš za kolegu'), 'notify doručila zástupci c');

    console.log('== chybějící zástupce = přiznaný skip, žádný failed/mail ==');
    nodes = nodes.map((n) => (n.id === 'Y' ? node('Y', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nodes, EDGES);
    const m2 = await freshMap(A, map.id);
    expect(findNode(m2, 'Y').data.owner === 'd@example.com', 'uzel bez zástupce garanta NEZMĚNIL');
    rr = await runs(`rule = "${r1.id}" && node_id = "Y"`);
    expect(rr.length === 1 && rr[0].status === 'skipped', `běh je skipped (${rr[0] && rr[0].status})`);
    expect(String(rr[0].detail || '').includes('nemá zástupce'), 'detail vysvětluje důvod lidsky');
    const ruleRec = (await api('GET', `/api/collections/automation_rules/records/${r1.id}`, { token: ST })).json;
    expect(!ruleRec.error_notified && !ruleRec.last_error, 'pravidlo NENÍ označeno jako rozbité (skip ≠ chyba)');

    console.log('== smíšený běh: provedené akce se nezahodí kvůli skipu ==');
    const r2 = await mkRule({
      name: 'Bez garanta → stav + zástupce', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'set_status', status: 'in_progress' }, { type: 'set_owner', owner: 'deputy_of_node_owner' }, { type: 'notify', to: 'map_owner', message: 'jede se' }],
    });
    nodes = nodes.map((n) => (n.id === 'Z' ? node('Z', Object.assign({}, n.data, { status: 'in_progress' })) : n));
    await patchMap(A, map, nodes, EDGES);
    rr = await runs(`rule = "${r2.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok', `smíšený běh je ok (${rr[0] && rr[0].status})`);
    expect(String(rr[0].detail || '').includes('přeskočeno') && String(rr[0].detail || '').includes('zodpovědnou osobu'), 'detail přiznává přeskočený set_owner s důvodem');
    expect((await notifs(A)).some((n) => n.text.includes('jede se')), 'notify map_owner ze smíšeného běhu doručena');

    console.log('== validace routy /rules/save ==');
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Denně zástupci', trigger: { type: 'schedule', freq: 'daily' },
      actions: [{ type: 'notify', to: 'deputy_of_node_owner', message: 'x' }],
    } });
    expect(r.status === 400, `notify.to=deputy_of_node_owner bez trigger uzlu = 400 (${r.status})`);
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Se scope zástupci', node_id: 'X', trigger: { type: 'schedule', freq: 'daily' },
      actions: [{ type: 'set_owner', owner: 'deputy_of_node_owner' }, { type: 'notify', to: 'deputy_of_node_owner', message: 'x' }],
    } });
    expect(r.status === 200, `se scope uzlem dynamické cíle projdou (${r.status})`);

    console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    code = 1;
  } finally {
    // ⚠️ process.exit AŽ ZA úklidem (vzor rules-engine, nález panelu 14. 8.)
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  process.exit(code);
})();
