// Interní automatizační motor „když X → udělej Y" (automation_rules) — e2e jádra:
//  - diffové triggery (stav změněn / uzel odblokován / uzel založen / příloha)
//  - AND podmínky, akce (set_owner/set_status/set_deadline/create_subnodes/notify/run_agent)
//  - pojistky: smyčka (MAX_RULE_DEPTH), lavina (MAX_RULE_FIRINGS_PER_SAVE),
//    vypnuté pravidlo, celoinstanční brzda KB_RULES_DISABLED
//  - rozbité pravidlo → vlastníkovi mapy mail JEDNOU (error_notified)
//  - RLS: rule_runs čte jen kdo vidí mapu; automation_rules je zamčená
//
// Pravidla se v této sadě zakládají SUPERUSEREM přímo do kolekce (routy CRUD
// jsou samostatná vrstva testovaná v rules-schedule.js / v1-api). Motor sám
// o routách nic neví — přesně to se tu testuje.
const { execSync } = require('child_process');

const NAME = 'kb-e2e-rules';
const PORT = 20721;
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
    await reg('a@example.com'); // první registrace = admin, vlastník mapy
    await reg('b@example.com');
    await reg('c@example.com'); // cizí — mapu nevidí
    const A = await login('a@example.com');
    const C = await login('c@example.com');

    // „dnes" v LOKÁLNÍM čase KONTEJNERU — hostitel může mít jinou TZ
    const dnes = execSync(`docker exec ${NAME} date +%F`).toString().trim();
    const plusDny = (n) => {
      const [y, m, d] = dnes.split('-').map(Number);
      const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };

    const NODES = [
      node('root', { apexText: 'Proces', title: 'Proces', status: 'todo' }, 'apexNode'),
      node('X', { title: 'Dokončit návrh', status: 'todo', owner: 'a@example.com' }),
      node('Y', { title: 'Uzel bez podmínky', status: 'todo', owner: 'c@example.com' }),
      node('Z', { title: 'Uzel s podmínkou', status: 'todo', owner: 'b@example.com' }),
      node('W', { title: 'Čekající rodič', status: 'todo', owner: 'b@example.com', waitForChildren: true }),
      node('K', { title: 'Dítě', status: 'todo', owner: 'a@example.com' }),
      node('L', { title: 'Smyčkový uzel', status: 'todo', owner: 'a@example.com' }),
      node('F', { title: 'Uzel s přílohou', status: 'todo', owner: 'b@example.com' }),
      node('G', { title: 'Uzel pro agenta', status: 'todo', owner: 'a@example.com' }),
      node('H', { title: 'Uzel rozbitého pravidla', status: 'todo', owner: 'a@example.com' }),
    ];
    const EDGES = [
      { id: 'e1', source: 'root', target: 'X' }, { id: 'e2', source: 'root', target: 'Y' },
      { id: 'e3', source: 'root', target: 'Z' }, { id: 'e4', source: 'root', target: 'W' },
      { id: 'e5', source: 'W', target: 'K' }, { id: 'e6', source: 'root', target: 'L' },
      { id: 'e7', source: 'root', target: 'F' }, { id: 'e8', source: 'root', target: 'G' },
      { id: 'e9', source: 'root', target: 'H' },
    ];
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Mapa s pravidly', nodes: NODES, edges: EDGES } })).json;

    const mkRule = async (body) => (await api('POST', '/api/collections/automation_rules/records', { token: ST, body: Object.assign({ map: map.id, enabled: true }, body) })).json;
    const runs = async (filter) => (await api('GET', `/api/collections/rule_runs/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token: ST })).json.items || [];
    const notifs = async (token, type) => ((await api('GET', `/api/collections/notifications/records?perPage=200&filter=${encodeURIComponent(`type="${type}"`)}`, { token })).json.items || []);

    console.log('== trigger „stav změněn" + akce set_owner + notify ==');
    const r1 = await mkRule({
      name: 'Hotovo → předat', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'b@example.com' }, { type: 'notify', to: 'map_owner', message: 'uzel dokončen' }],
    });
    expect(!!r1.id, 'pravidlo založeno superuserem');
    let nodes = NODES.map((n) => (n.id === 'X' ? node('X', Object.assign({}, n.data, { status: 'done' })) : n));
    let r = await patchMap(A, map, nodes, EDGES);
    expect(r.status === 200, `uložení mapy s pravidlem prošlo (${r.status})`);
    let m = await freshMap(A, map.id);
    expect(findNode(m, 'X').data.owner === 'b@example.com', 'akce set_owner přepsala garanta uzlu');
    let rr = await runs(`rule = "${r1.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok', `běh zapsán do rule_runs jako ok (${rr.length})`);
    expect(rr[0].trigger_type === 'node_status_changed' && rr[0].node_id === 'X', 'log nese trigger i uzel');
    let na = await notifs(A, 'rule_notice');
    expect(na.length === 1 && na[0].text.includes('uzel dokončen'), 'akce notify doručila map_owner notifikaci s textem');

    console.log('== vypnuté pravidlo nefiruje; AND podmínka filtruje ==');
    await api('PATCH', `/api/collections/automation_rules/records/${r1.id}`, { token: ST, body: { enabled: false } });
    const r2 = await mkRule({
      name: 'Jen pro b', trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'owner', op: 'eq', value: 'b@example.com' }],
      actions: [{ type: 'notify', to: 'node_owner', message: 'tvůj uzel je hotový' }],
    });
    nodes = nodes.map((n) => (n.id === 'Y' ? node('Y', Object.assign({}, n.data, { status: 'done' })) : n)); // owner c ≠ b
    await patchMap(A, map, nodes, EDGES);
    nodes = nodes.map((n) => (n.id === 'Z' ? node('Z', Object.assign({}, n.data, { status: 'done' })) : n)); // owner b
    await patchMap(A, map, nodes, EDGES);
    rr = await runs(`rule = "${r2.id}"`);
    expect(rr.length === 1 && rr[0].node_id === 'Z', `podmínka owner=b pustila jen uzel Z (${rr.length})`);
    expect((await runs(`rule = "${r1.id}"`)).length === 1, 'vypnuté pravidlo nový běh nepřidalo');
    await api('PATCH', `/api/collections/automation_rules/records/${r2.id}`, { token: ST, body: { enabled: false } });

    console.log('== trigger „uzel odblokován" + set_status ==');
    const r4 = await mkRule({
      name: 'Odblokováno → rozjet', node_id: 'W', trigger: { type: 'node_unblocked' },
      actions: [{ type: 'set_status', status: 'in_progress' }, { type: 'notify', to: 'node_owner', message: 'můžeš začít' }],
    });
    nodes = nodes.map((n) => (n.id === 'K' ? node('K', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nodes, EDGES);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'W').data.status === 'in_progress', 'odblokovaný čekající uzel pravidlo přepnulo na „pracuje se"');
    const B = await login('b@example.com');
    expect((await notifs(B, 'rule_notice')).some((n) => n.text.includes('můžeš začít')), 'garant uzlu dostal notifikaci pravidla');
    await api('PATCH', `/api/collections/automation_rules/records/${r4.id}`, { token: ST, body: { enabled: false } });
    nodes = (await freshMap(A, map.id)).nodes; // stav po zásahu pravidla

    console.log('== trigger „uzel založen" + set_deadline(+N) + strop laviny ==');
    const r3 = await mkRule({
      name: 'Nový uzel → termín +3', trigger: { type: 'node_created' },
      actions: [{ type: 'set_deadline', relative_days: 3 }],
    });
    const dvanact = Array.from({ length: 12 }, (_, i) => node(`n-${i}`, { title: `Nový ${i}`, status: 'todo' }));
    const dvanactEdges = dvanact.map((n, i) => ({ id: `en-${i}`, source: 'root', target: n.id }));
    r = await patchMap(A, map, nodes.concat(dvanact), EDGES.concat(dvanactEdges));
    expect(r.status === 200, `hromadné vložení 12 uzlů prošlo (${r.status})`);
    rr = await runs(`rule = "${r3.id}"`);
    const ok3 = rr.filter((x) => x.status === 'ok').length;
    const skip3 = rr.filter((x) => x.status === 'skipped').length;
    expect(ok3 === 10 && skip3 === 2, `strop 10 spuštění na uložení: 10 ok + 2 PŘIZNANĚ skipped (${ok3}/${skip3})`);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'n-0').data.deadline === plusDny(3), `relativní termín +3 dny sedí (${findNode(m, 'n-0').data.deadline})`);
    expect((m.nodes || []).filter((n) => n.id.startsWith('n-') && n.data.deadline).length === 10, 'termín dostalo přesně 10 uzlů (2 nad strop ne)');
    await api('PATCH', `/api/collections/automation_rules/records/${r3.id}`, { token: ST, body: { enabled: false } });
    nodes = m.nodes;

    console.log('== create_subnodes: totéž pravidlo vystřelí i PODRUHÉ ==');
    // Regrese: id podstromu se skládala jen z rule.id + pořadí akce, takže druhá
    // karta (druhá reklamace, druhý kus) narazila na "Duplicitní id uzlu",
    // pravidlo se označilo za rozbité a akce fungovala právě jednou za život.
    m = await freshMap(A, map.id);
    r = await patchMap(A, map, m.nodes.concat([node('P', { title: 'Kontejner', status: 'todo' })]),
      m.edges.concat([{ id: 'eP', source: 'root', target: 'P' }]));
    expect(r.status === 200, `kontejner P založen (${r.status})`);
    const rs = await mkRule({
      name: 'Nová karta → rozbal kroky', trigger: { type: 'node_created' },
      conditions: [{ field: 'parent', op: 'eq', value: 'P' }],
      actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [{ title: 'Krok 1' }, { title: 'Krok 2' }] }],
    });
    for (const karta of ['c1', 'c2', 'c3']) {
      m = await freshMap(A, map.id);
      await patchMap(A, map, m.nodes.concat([node(karta, { title: `Karta ${karta}`, status: 'todo' })]),
        m.edges.concat([{ id: `e-${karta}`, source: 'P', target: karta }]));
    }
    m = await freshMap(A, map.id);
    const kroku = (id) => (m.edges || []).filter((e) => e.source === id).length;
    expect(kroku('c1') === 2 && kroku('c2') === 2 && kroku('c3') === 2,
      `kroky dostaly VŠECHNY tři karty, ne jen první (${kroku('c1')}/${kroku('c2')}/${kroku('c3')})`);
    rr = await runs(`rule = "${rs.id}"`);
    expect(rr.length === 3 && rr.every((x) => x.status === 'ok'),
      `všechny tři běhy ok, žádné "Duplicitní id uzlu" (${rr.map((x) => x.status).join(',') || 'nic'})`);
    const vsechnaId = (m.nodes || []).map((n) => n.id);
    expect(new Set(vsechnaId).size === vsechnaId.length, 'v mapě nejsou duplicitní id uzlů');
    expect(kroku('c1') === 2 && (m.edges || []).filter((e) => e.source === (m.edges.find((x) => x.source === 'c1') || {}).target).length === 0,
      'pravidlo nespustilo samo sebe nad kroky, které právě založilo');
    await api('PATCH', `/api/collections/automation_rules/records/${rs.id}`, { token: ST, body: { enabled: false } });
    nodes = m.nodes;

    console.log('== smyčka dvou pravidel → pojistka hloubky, server nezamrzne ==');
    const la = await mkRule({
      name: 'Smyčka A', node_id: 'L', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'set_status', status: 'done' }],
    });
    const lb = await mkRule({
      name: 'Smyčka B', node_id: 'L', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_status', status: 'in_progress' }],
    });
    nodes = nodes.map((n) => (n.id === 'L' ? node('L', Object.assign({}, n.data, { status: 'in_progress' })) : n));
    r = await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    expect(r.status === 200, `uložení se smyčkou pravidel doběhlo (${r.status})`);
    rr = await runs(`(rule = "${la.id}" || rule = "${lb.id}")`);
    const skipped = rr.filter((x) => x.status === 'skipped');
    expect(rr.filter((x) => x.status === 'ok').length === 3, `řetěz A→B→A proběhl přesně do hloubky 3 (${rr.filter((x) => x.status === 'ok').length})`);
    expect(skipped.length >= 1 && skipped.some((x) => x.detail.includes('pojistce') || x.detail.includes('pojistka')), 'utnutí smyčky je PŘIZNANÉ řádkem skipped');
    await api('PATCH', `/api/collections/automation_rules/records/${la.id}`, { token: ST, body: { enabled: false } });
    await api('PATCH', `/api/collections/automation_rules/records/${lb.id}`, { token: ST, body: { enabled: false } });
    nodes = (await freshMap(A, map.id)).nodes;

    console.log('== trigger „příloha nahrána" (jen skutečný soubor) ==');
    const r5 = await mkRule({
      name: 'Příloha → ohlásit', node_id: 'F', trigger: { type: 'file_uploaded' },
      actions: [{ type: 'notify', to: 'b@example.com', message: 'přišla příloha' }],
    });
    const form = new FormData();
    form.append('map', map.id); form.append('node_id', 'F'); form.append('name', 'podklady.txt');
    form.append('size', '5'); form.append('file', new Blob(['ahoj!'], { type: 'text/plain' }), 'podklady.txt');
    let up = await fetch(`${BASE}/api/collections/node_files/records`, { method: 'POST', headers: { Authorization: A }, body: form });
    expect(up.status === 200, `nahrání přílohy prošlo (${up.status})`);
    rr = await runs(`rule = "${r5.id}"`);
    expect(rr.length === 1 && rr[0].trigger_type === 'file_uploaded', 'nahraný soubor pravidlo spustil');
    await api('POST', '/api/collections/node_files/records', { token: A, body: { map: map.id, node_id: 'F', name: 'odkaz', url: 'https://example.com/x' } });
    rr = await runs(`rule = "${r5.id}"`);
    expect(rr.length === 1, 'přidání ODKAZU pravidlo nespouští (odkaz je poznámka)');
    await api('PATCH', `/api/collections/automation_rules/records/${r5.id}`, { token: ST, body: { enabled: false } });

    console.log('== akce run_agent: jen zařadí do fronty agent_runs ==');
    r = await api('POST', '/api/flowmap/ai-agents/save', { token: A, body: { name: 'testovaci', enabled: true, secret: 'x'.repeat(20), webhook_url: 'http://host.docker.internal:1/nikam' } });
    expect(r.status === 200, `admin založil agenta v registru (${r.status})`);
    const r6 = await mkRule({
      name: 'Rozjeto → agent', node_id: 'G', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'run_agent', agent_name: 'testovaci' }],
    });
    nodes = nodes.map((n) => (n.id === 'G' ? node('G', Object.assign({}, n.data, { status: 'in_progress' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    rr = await runs(`rule = "${r6.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok' && !!rr[0].agent_run, 'běh pravidla drží vazbu na založený agent_run');
    const ar = (await api('GET', `/api/collections/agent_runs/records?filter=${encodeURIComponent(`map = "${map.id}" && node_id = "G"`)}`, { token: ST })).json.items || [];
    expect(ar.length === 1 && ar[0].agent_name === 'testovaci', `agent_run založen na LIDSKÉM uzlu přes opts.agentName (${ar.length})`);
    await api('PATCH', `/api/collections/automation_rules/records/${r6.id}`, { token: ST, body: { enabled: false } });

    console.log('== SEC: allowed_emails se vyhodnocuje podle AUTORA pravidla ==');
    // Nález panelu: řetěz set_owner→run_agent obcházel allowed_emails podle
    // přepsaného ownera. Teď rozhoduje created_by pravidla. Agent povolí jen a@.
    await api('POST', '/api/flowmap/ai-agents/save', { token: A, body: { name: 'hlidany', enabled: true, secret: 'y'.repeat(20), webhook_url: 'http://host.docker.internal:1/nikam', allowed_emails: ['a@example.com'] } });
    // uzel Y (owner c@, bez existujícího agent_runu → guard nefalšuje) na todo
    nodes = (await freshMap(A, map.id)).nodes;
    nodes = nodes.map((n) => (n.id === 'Y' ? node('Y', Object.assign({}, n.data, { status: 'todo', owner: 'c@example.com' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    // pravidlo s autorem c@ (mimo allowed) + set_owner na a@ (v allowed) → dřív by prošlo
    const secRule = await mkRule({
      name: 'Obchvat allowed', node_id: 'Y', created_by: 'c@example.com',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'a@example.com' }, { type: 'run_agent', agent_name: 'hlidany' }],
    });
    nodes = (await freshMap(A, map.id)).nodes;
    nodes = nodes.map((n) => (n.id === 'Y' ? node('Y', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    await sleep(200);
    const secAr = (await api('GET', `/api/collections/agent_runs/records?filter=${encodeURIComponent(`agent_name = "hlidany"`)}`, { token: ST })).json.items || [];
    expect(secAr.length === 0, `agent NEspuštěn — autor pravidla (c@) není v allowed_emails, přestože set_owner přepsal ownera na a@ (${secAr.length})`);
    await api('PATCH', `/api/collections/automation_rules/records/${secRule.id}`, { token: ST, body: { enabled: false } });

    console.log('== rozbité pravidlo: failed + mail vlastníkovi JEDNOU ==');
    const r7 = await mkRule({
      name: 'Rozbité', node_id: 'H', trigger: { type: 'node_status_changed' },
      actions: [{ type: 'create_subnodes', parent: 'neexistujici-uzel', items: [{ title: 'x' }] }],
    });
    nodes = (await freshMap(A, map.id)).nodes;
    nodes = nodes.map((n) => (n.id === 'H' ? node('H', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    nodes = nodes.map((n) => (n.id === 'H' ? node('H', Object.assign({}, n.data, { status: 'todo' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    rr = await runs(`rule = "${r7.id}"`);
    expect(rr.length === 2 && rr.every((x) => x.status === 'failed'), `oba běhy rozbitého pravidla jsou failed (${rr.length})`);
    expect((await notifs(A, 'rule_broken')).length === 1, 'vlastník dostal „pravidlo selhalo" PRÁVĚ JEDNOU, ne spam');
    const r7rec = (await api('GET', `/api/collections/automation_rules/records/${r7.id}`, { token: ST })).json;
    expect(!!r7rec.last_error && r7rec.error_notified === true, 'pravidlo nese last_error + error_notified');
    await api('PATCH', `/api/collections/automation_rules/records/${r7.id}`, { token: ST, body: { enabled: false } });

    console.log('== RLS: log vidí jen kdo vidí mapu; kolekce pravidel zamčená ==');
    r = await api('GET', '/api/collections/rule_runs/records', { token: C });
    expect(r.status === 200 && r.json.totalItems === 0, `cizí uživatel nevidí žádný běh (${r.json && r.json.totalItems})`);
    r = await api('GET', '/api/collections/automation_rules/records', { token: A });
    expect(r.status === 403, `automation_rules je zamčená i pro admina — jen server (${r.status})`);
    r = await api('POST', '/api/collections/automation_rules/records', { token: A, body: { map: map.id, name: 'podvrh', trigger: { type: 'schedule' }, actions: [] } });
    expect(r.status === 403 || r.status === 400, `pravidlo nejde založit přímým zápisem do kolekce (${r.status})`);

    console.log('== celoinstanční brzda KB_RULES_DISABLED=1 ==');
    execSync(`docker rm -f ${NAME}-off 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME}-off -p ${PORT + 1}:8090 -e KB_RULES_DISABLED=1 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    const BASE2 = `http://127.0.0.1:${PORT + 1}`;
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE2}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    execSync(`docker exec ${NAME}-off /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const api2 = async (method, path, { token, body } = {}) => {
      const res = await fetch(BASE2 + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
      return { status: res.status, json };
    };
    const ST2 = (await api2('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    await api2('POST', '/api/collections/users/records', { body: { email: 'a@example.com', password: PW, passwordConfirm: PW } });
    const A2 = (await api2('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@example.com', password: PW } })).json.token;
    const map2 = (await api2('POST', '/api/collections/goalmaps/records', { token: A2, body: { title: 'Brzda', nodes: [node('root', { apexText: 'x', title: 'x', status: 'todo' }, 'apexNode'), node('Q', { title: 'q', status: 'todo' })], edges: [{ id: 'e', source: 'root', target: 'Q' }] } })).json;
    await api2('POST', '/api/collections/automation_rules/records', { token: ST2, body: { map: map2.id, enabled: true, name: 'nesmí běžet', trigger: { type: 'node_status_changed' }, actions: [{ type: 'set_owner', owner: 'a@example.com' }] } });
    const f2 = (await api2('GET', `/api/collections/goalmaps/records/${map2.id}`, { token: A2 })).json;
    await api2('PATCH', `/api/collections/goalmaps/records/${map2.id}`, { token: A2, body: { nodes: f2.nodes.map((n) => (n.id === 'Q' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)), edges: f2.edges, base_updated: f2.updated } });
    r = await api2('GET', '/api/collections/rule_runs/records', { token: ST2 });
    expect(r.json.totalItems === 0, 'brzda KB_RULES_DISABLED=1 motor úplně vypnula');

    console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    code = 1;
  } finally {
    // ⚠️ process.exit AŽ ZA úklidem — uvnitř try by finally přeskočil a
    // kontejnery kb-e2e-rules* by zůstaly viset (nález panelu 14. 8.)
    execSync(`docker rm -f ${NAME} ${NAME}-off 2>/dev/null; true`);
  }
  process.exit(code);
})();
