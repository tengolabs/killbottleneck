// v1 API + MCP (HTTP i stdio): NEZNÁMÁ POLE = CHYBA s výčtem povolených + nápovědou pro cizí pojmy; PLÁN (planned_on) přes API = tentýž plán jako v aplikaci.
//
// Proč: 28. 8. 2026 agent (Hermes) na pokyn „nastav prioritu vysoká" poslal MCP
// update_node s klíčem `priority`; server vrátil 200, klíč tiše zahodil a agent
// ohlásil „hotovo, ověřeno" nad nezměněnou mapou. Odteď: v1 400 / MCP -32602 s
// výčtem povolených polí a nápovědou (priority → planned_on, tags → struktura/color,
// reminder → create_rule, due_date → deadline, assignee → owner). Priorita jako
// pole zůstává zamítnutá (model §3, 27. 7. 2026); agentům patří plán `planned_on`
// (dnes…+7 dní, jako lišta v aplikaci) — a Můj den ho zařadí stejně jako z UI.
//
// Předpoklady: KB_TEST_IMAGE (harness), stdio server product/mcp/index.js s nainstalovanými
// node_modules. Mutační důkaz: KB_TEST_IMAGE=kb-analyza-e2 (kód před změnou) → 🔴
// (server neznámé klíče tiše přijímá, planned_on nezná).
const H = require('./_harness');
const { expect } = H;
const { spawn } = require('child_process');
const path = require('path');

// dny počítané v UTC — kontejner i validace plánu žijí v UTC
const day = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const findNode = (tree, title) => {
  for (const n of tree || []) { if (n.title === title) return n; const c = findNode(n.children, title); if (c) return c; }
  return null;
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'neznama-pole', env: { KB_UVODNI_MAPA: 0 } });
  const reg = async (email) => {
    await inst.register(email);
    const token = await inst.login(email);
    const k = await inst.api('POST', '/api/kb/api-keys', { token, body: { label: 'rw', scope: 'read_write' } });
    return { email, token, key: k.json.token };
  };
  const A = await reg('vlastnik@e2e.local'); // první = admin, vlastník map
  // zápisový limit je 30/min NA KLÍČ (i odmítnuté 400 se počítají) → nový klíč na každou sekci
  const novyKlic = async (u) => { u.key = (await inst.api('POST', '/api/kb/api-keys', { token: u.token, body: { label: 'rw-' + Date.now(), scope: 'read_write' } })).json.token; };
  const R = await reg('ctenar@e2e.local');   // sdílení „číst" + vlastní práce
  const v1 = (u, p, body, method) => inst.api(method || (body ? 'POST' : 'GET'), `/api/kb/v1${p}`, { bearer: u.key, body });
  const ver = async (u, id) => (await v1(u, `/maps/${id}`)).json.updated;
  const errOf = (r) => String((r.json || {}).error || '');
  let rpcId = 1;
  const mcp = async (u, name, args) => {
    const r = await inst.api('POST', '/mcp', { bearer: u.key, body: { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args || {} } } });
    const res = (r.json || {}).result || {};
    return { status: r.status, err: (r.json || {}).error || null, isError: !!res.isError, text: (res.content || []).map((c) => c.text || '').join('\n') };
  };

  // ---------------------------------------------------------------- v1 create_map
  console.log('== v1 POST /v1/maps — neznámá pole ==');
  let r = await v1(A, '/maps', { title: 'Mapa', priority: 'high', tree: [{ title: 'A' }] });
  expect(r.status === 400, `neznámé pole nahoře → 400 (${r.status})`);
  expect(/priority/.test(errOf(r)) && /apex_text/.test(errOf(r)), `hláška jmenuje pole i povolená (${errOf(r).slice(0, 120)})`);
  expect(/planned_on/.test(errOf(r)), 'nápověda: priorita → planned_on');
  r = await v1(A, '/maps', { title: 'Mapa', tree: [{ title: 'A', children: [{ title: 'B', tags: ['x'] }] }] });
  expect(r.status === 400 && /„B“|"B"/.test(errOf(r)) && /tags/.test(errOf(r)) && /color/.test(errOf(r)),
    `neznámé pole ve VNOŘENÉ položce → 400 s názvem položky a nápovědou (${errOf(r).slice(0, 140)})`);
  r = await v1(A, '/maps', { title: 'Mapa', tree: [{ title: 'A', waitForChildren: true }] });
  expect(r.status === 400 && /wait_for_children/.test(errOf(r)), `camelCase → 400 s nápovědou na snake_case (${errOf(r).slice(0, 120)})`);
  r = await v1(A, '/maps', { title: 'Mapa', tree: [{ title: 'A', planned_on: day(9) }] });
  expect(r.status === 400 && /planned_on/.test(errOf(r)), `plán za 9 dní v položce → 400 (${errOf(r).slice(0, 100)})`);
  r = await v1(A, '/maps', { title: 'Mapa', tree: [{ title: 'A', planned_on: '2026-13-45' }] });
  expect(r.status === 400, `nesmyslné datum plánu → 400 (${r.status})`);

  r = await v1(A, '/maps', { title: 'Projekt', tree: [{ title: 'Krok 1', planned_on: day(1), deadline: day(20) }, { title: 'Krok 2' }] });
  expect(r.status === 200 && r.json.id, `validní mapa s planned_on v položce → 200 (${r.status} ${errOf(r)})`);
  const mapId = r.json.id;
  let tree = (await v1(A, `/maps/${mapId}`)).json.tree;
  const k1 = findNode(tree, 'Krok 1'), k2 = findNode(tree, 'Krok 2');
  expect(k1 && k1.planned_on === day(1), `GET map vrací planned_on položky (${k1 && k1.planned_on})`);
  expect(k2 && k2.planned_on === '', 'položka bez plánu má planned_on = ""');

  // ---------------------------------------------------------------- v1 add_nodes
  console.log('== v1 POST /v1/maps/{id}/nodes — neznámá pole ==');
  r = await v1(A, `/maps/${mapId}/nodes`, { parent_id: k1.id, items: [{ title: 'X', due_date: day(3) }], base_updated: await ver(A, mapId) });
  expect(r.status === 400 && /due_date/.test(errOf(r)) && /deadline/.test(errOf(r)), `due_date → 400 s nápovědou deadline (${errOf(r).slice(0, 120)})`);
  r = await v1(A, `/maps/${mapId}/nodes`, { parent_id: k1.id, items: [{ title: 'X' }], foo: 1, base_updated: await ver(A, mapId) });
  expect(r.status === 400 && /foo/.test(errOf(r)) && /parent_id, items, base_updated/.test(errOf(r)), `neznámé pole nahoře → 400 s výčtem (${errOf(r).slice(0, 120)})`);
  r = await v1(A, `/maps/${mapId}/nodes`, { parent_id: k1.id, items: [{ title: 'Podkrok', planned_on: day(0) }], base_updated: await ver(A, mapId) });
  expect(r.status === 200 && findNode(r.json.tree, 'Podkrok') && findNode(r.json.tree, 'Podkrok').planned_on === day(0),
    `validní add_nodes s planned_on → 200 a strom ho vrací (${r.status} ${errOf(r)})`);

  // ---------------------------------------------------------------- v1 update_node
  console.log('== v1 POST /v1/maps/{id}/nodes/{nodeId} — neznámá pole + nápověda ==');
  r = await v1(A, `/maps/${mapId}/nodes/${k2.id}`, { priority: 'high', base_updated: await ver(A, mapId) });
  expect(r.status === 400, `priority → 400, ne tiché 200 (${r.status})`);
  expect(/priority/.test(errOf(r)) && /planned_on/.test(errOf(r)) && /deadline/.test(errOf(r)),
    `hláška: jmenuje priority, radí planned_on a varuje před posunem termínu (${errOf(r).slice(0, 160)})`);
  for (const [k, hint] of [['assignee', /owner/], ['estimate', /odhad|estimate/], ['reminder', /deadline_approaching/], ['labels', /color/], ['plannedOn', /planned_on/]]) {
    const body = { base_updated: await ver(A, mapId) }; body[k] = 'x';
    r = await v1(A, `/maps/${mapId}/nodes/${k2.id}`, body);
    expect(r.status === 400 && hint.test(errOf(r)), `${k} → 400 + nápověda ${hint} (${errOf(r).slice(0, 100)})`);
  }
  // po sérii 400 se mapa NEZMĚNILA (to je celý smysl: žádné falešné „hotovo")
  tree = (await v1(A, `/maps/${mapId}`)).json.tree;
  expect(findNode(tree, 'Krok 2').planned_on === '' && findNode(tree, 'Krok 2').status === 'todo', 'odmítnuté zápisy nic nezměnily');

  console.log('== v1 update_node — planned_on ==');
  r = await v1(A, `/maps/${mapId}/nodes/${k2.id}`, { planned_on: day(0), base_updated: await ver(A, mapId) });
  expect(r.status === 200 && r.json.node && r.json.node.planned_on === day(0), `planned_on = dnes → 200 a odpověď ho vrací (${r.status} ${errOf(r)})`);
  tree = (await v1(A, `/maps/${mapId}`)).json.tree;
  expect(findNode(tree, 'Krok 2').planned_on === day(0), 'GET map ukazuje plán');
  r = await v1(A, `/maps/${mapId}/nodes/${k2.id}`, { planned_on: day(7), base_updated: await ver(A, mapId) });
  expect(r.status === 200, `planned_on = +7 dní (nejbližší pondělí z lišty) → 200 (${r.status})`);
  for (const [v, popis] of [[day(10), '+10 dní'], [day(-3), 'před 3 dny'], ['zítra', 'slovy'], ['2026-02-30', 'neexistující datum']]) {
    r = await v1(A, `/maps/${mapId}/nodes/${k2.id}`, { planned_on: v, base_updated: await ver(A, mapId) });
    expect(r.status === 400 && /planned_on/.test(errOf(r)), `planned_on ${popis} → 400 (${r.status} ${errOf(r).slice(0, 60)})`);
  }
  tree = (await v1(A, `/maps/${mapId}`)).json.tree;
  expect(findNode(tree, 'Krok 2').planned_on === day(7), 'odmítnutý plán nepřepsal ten platný');
  r = await v1(A, `/maps/${mapId}/nodes/${k2.id}`, { planned_on: '', base_updated: await ver(A, mapId) });
  tree = (await v1(A, `/maps/${mapId}`)).json.tree;
  expect(r.status === 200 && findNode(tree, 'Krok 2').planned_on === '', `prázdný řetězec plán ruší (${r.status})`);

  // ---------------------------------------------------------------- čtenář s vlastní prací
  console.log('== čtenář s vlastní prací: jen status, neznámé pole = 403 (ne 400) ==');
  r = await inst.api('POST', '/api/kb/share', { token: A.token, body: { mapId, action: 'share', email: R.email, permission: 'read' } });
  expect(r.status === 200, `sdílení ke čtení (${r.status})`);
  r = await v1(A, `/maps/${mapId}/nodes/${k2.id}`, { owner: R.email, base_updated: await ver(A, mapId) });
  expect(r.status === 200, `řešitel = čtenář (${r.status} ${errOf(r)})`);
  r = await v1(R, `/maps/${mapId}/nodes/${k2.id}`, { status: 'in_progress', priority: 'high', base_updated: await ver(R, mapId) });
  expect(r.status === 403, `čtenář + priority → 403 (práva před tvarem; nedostane výčet polí, která psát nesmí) (${r.status})`);
  r = await v1(R, `/maps/${mapId}/nodes/${k2.id}`, { status: 'in_progress', planned_on: day(0), base_updated: await ver(R, mapId) });
  expect(r.status === 403, `čtenář + planned_on → 403 (plán přes klíč jen editor) (${r.status})`);
  r = await v1(R, `/maps/${mapId}/nodes/${k2.id}`, { status: 'in_progress', base_updated: await ver(R, mapId) });
  expect(r.status === 200, `čtenář jen status svého uzlu → 200 (${r.status} ${errOf(r)})`);

  // ---------------------------------------------------------------- Můj den
  console.log('== plán z API = tentýž plán jako v aplikaci (Můj den) ==');
  r = await v1(A, `/maps/${mapId}/nodes/${k1.id}`, { owner: A.email, planned_on: day(0), base_updated: await ver(A, mapId) });
  expect(r.status === 200, `Krok 1: řešitel já, termín za 20 dní, plán dnes (${r.status} ${errOf(r)})`);
  r = await inst.api('GET', `/api/kb/my-day?today=${day(0)}`, { token: A.token });
  const sekce = (r.json || {}).sections || {};
  const titles = (arr) => (arr || []).map((i) => i.title);
  expect(titles(sekce.today).includes('Krok 1'), `Můj den: Krok 1 v sekci Dnes díky plánu z API (dnes=${titles(sekce.today)}, později=${titles(sekce.later)})`);
  expect(findNode((await v1(A, `/maps/${mapId}`)).json.tree, 'Krok 1').deadline === day(20), 'termín zůstal (plán ≠ termín)');

  // ---------------------------------------------------------------- v1 pravidla
  await novyKlic(A);
  console.log('== v1 pravidla — neznámá pole nahoře i uvnitř ==');
  const rule = { name: 'Oznam', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'hotovo' }] };
  r = await v1(A, `/maps/${mapId}/rules`, Object.assign({ priority: 1 }, rule));
  expect(r.status === 400 && /priority/.test(errOf(r)) && /enabled/.test(errOf(r)), `neznámé pole nahoře → 400 s výčtem (${errOf(r).slice(0, 120)})`);
  r = await v1(A, `/maps/${mapId}/rules`, Object.assign({}, rule, { trigger: { type: 'node_status_changed', foo: 1 } }));
  expect(r.status === 400 && /trigger has unknown fields: foo/.test(errOf(r)), `neznámé pole v trigger → 400 (${errOf(r).slice(0, 120)})`);
  r = await v1(A, `/maps/${mapId}/rules`, Object.assign({}, rule, { actions: [{ type: 'notify', to: 'map_owner', urgency: 'high' }] }));
  expect(r.status === 400 && /actions\[0\] has unknown fields: urgency/.test(errOf(r)) && /planned_on/.test(errOf(r)), `neznámé pole v akci → 400 s nápovědou (${errOf(r).slice(0, 140)})`);
  r = await v1(A, `/maps/${mapId}/rules`, Object.assign({}, rule, { actions: [{ type: 'create_subnodes', items: [{ title: 'Pod', tags: ['a'] }] }] }));
  expect(r.status === 400 && /items item "Pod"/.test(errOf(r)) && /tags/.test(errOf(r)), `neznámé pole v create_subnodes.items → 400 (${errOf(r).slice(0, 140)})`);
  r = await v1(A, `/maps/${mapId}/rules`, rule);
  expect(r.status === 200 && r.json.rule && r.json.rule.id, `validní pravidlo → 200 (${r.status} ${errOf(r)})`);
  const ruleId = r.json.rule && r.json.rule.id;
  r = await v1(A, `/maps/${mapId}/rules/${ruleId}`, { enabled: false, priority: 1 });
  expect(r.status === 400, `update pravidla s neznámým polem → 400 (${r.status})`);
  r = await v1(A, `/maps/${mapId}/rules/${ruleId}`, { enabled: false });
  expect(r.status === 200, `update pravidla (jen enabled) → 200 (${r.status})`);
  r = await v1(A, '/rule-templates', { name: 'Šablona', trigger: rule.trigger, actions: rule.actions, map_id: mapId });
  expect(r.status === 400 && /map_id/.test(errOf(r)), `šablona s neznámým polem → 400 (${errOf(r).slice(0, 100)})`);
  r = await v1(A, `/maps/${mapId}/nodes/${k2.id}/delete`, { base_updated: await ver(A, mapId), force: true });
  expect(r.status === 400 && /force/.test(errOf(r)), `delete s neznámým polem → 400, uzel zůstal (${r.status})`);
  expect(!!findNode((await v1(A, `/maps/${mapId}`)).json.tree, 'Krok 2'), 'uzel po odmítnutém delete existuje');

  // ---------------------------------------------------------------- MCP HTTP
  await novyKlic(A);
  console.log('== MCP /mcp (HTTP) — katalog a neznámé argumenty ==');
  r = await inst.api('POST', '/mcp', { bearer: A.key, body: { jsonrpc: '2.0', id: rpcId++, method: 'tools/list', params: {} } });
  const tools = ((r.json || {}).result || {}).tools || [];
  expect(tools.length === 17 && tools.every((t) => t.inputSchema.additionalProperties === false), `tools/list: 17 nástrojů, každý additionalProperties:false (${tools.filter((t) => t.inputSchema.additionalProperties === false).length})`);
  const un = tools.find((t) => t.name === 'update_node') || { inputSchema: { properties: {} } };
  expect(!!un.inputSchema.properties.planned_on, 'update_node má planned_on');
  const an = tools.find((t) => t.name === 'add_nodes') || { inputSchema: {} };
  expect(an.inputSchema.$defs && an.inputSchema.$defs.treeItem && an.inputSchema.$defs.treeItem.additionalProperties === false && !!an.inputSchema.$defs.treeItem.properties.planned_on,
    'položka stromu: additionalProperties:false + planned_on');

  let m = await mcp(A, 'update_node', { map_id: mapId, node_id: k2.id, priority: 'high' });
  expect(m.err && m.err.code === -32602, `update_node priority → JSON-RPC -32602 (${JSON.stringify(m.err).slice(0, 80)})`);
  expect(m.err && /"priority"/.test(m.err.message) && /Allowed: .*planned_on/.test(m.err.message) && /deadline/.test(m.err.message),
    `hláška: klíč + výčet + nápověda (${String(m.err && m.err.message).slice(0, 160)})`);
  m = await mcp(A, 'add_nodes', { map_id: mapId, items: [{ title: 'X', children: [{ title: 'Y', tags: ['a'] }] }] });
  expect(m.err && m.err.code === -32602 && /items\[0\]\.children\[0\]\.tags/.test(m.err.message), `add_nodes vnořené tags → -32602 s cestou (${String(m.err && m.err.message).slice(0, 120)})`);
  m = await mcp(A, 'create_map', { title: 'M', outline: [{ title: 'X', due_date: day(2) }] });
  expect(m.err && m.err.code === -32602 && /outline\[0\]\.due_date/.test(m.err.message) && /deadline/.test(m.err.message), `create_map due_date → -32602 + nápověda deadline (${String(m.err && m.err.message).slice(0, 120)})`);
  m = await mcp(A, 'create_rule', { map_id: mapId, name: 'R', trigger: { type: 'node_created', foo: 1 }, actions: [{ type: 'notify', to: 'map_owner' }] });
  expect(m.err && m.err.code === -32602 && /trigger\.foo/.test(m.err.message), `create_rule trigger.foo → -32602 (${String(m.err && m.err.message).slice(0, 120)})`);
  m = await mcp(A, 'update_node', { map_id: mapId, node_id: k2.id, status: 'hotovo' });
  expect(m.err && m.err.code === -32602 && /status/.test(m.err.message), 'hodnota mimo enum dál -32602 (S9-03)');
  m = await mcp(A, 'update_node', { map_id: mapId, node_id: k2.id, planned_on: day(0) });
  expect(!m.err && !m.isError && /Node updated/.test(m.text), `update_node planned_on dnes → OK (${(m.err && m.err.message) || m.text.slice(0, 80)})`);
  m = await mcp(A, 'get_map', { map_id: mapId });
  expect(new RegExp(`Krok 2 \\(id: ${k2.id}, plan: ${day(0)}`).test(m.text), `get_map ukazuje „plan: ${day(0)}“`);
  m = await mcp(A, 'update_node', { map_id: mapId, node_id: k2.id, planned_on: day(10) });
  expect(m.isError && /planned_on/.test(m.text), `update_node planned_on +10 → chyba nástroje ze serveru (${m.text.slice(0, 80)})`);

  // ---------------------------------------------------------------- MCP stdio
  await novyKlic(A);
  console.log('== MCP stdio (npm balíček) — strict ==');
  const proc = spawn('node', [path.join(__dirname, '../mcp/index.js')], { env: { ...process.env, KB_URL: inst.base, KB_API_KEY: A.key }, stdio: ['pipe', 'pipe', 'pipe'] });
  H.uklidPridat && H.uklidPridat(() => proc.kill());
  let buf = ''; const pending = new Map();
  proc.stdout.on('data', (d) => {
    buf += d.toString(); let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      try { const msg = JSON.parse(line); if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } catch { /* jiný řádek */ }
    }
  });
  let sid = 500;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = sid++;
    pending.set(id, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 15000);
  });
  try {
    await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const st = (await rpc('tools/list', {})).result.tools;
    expect(st.length === 17 && st.every((t) => t.inputSchema.additionalProperties === false), 'stdio tools/list: 17× additionalProperties:false (schéma říká pravdu)');
    let s = await rpc('tools/call', { name: 'update_node', arguments: { map_id: mapId, node_id: k2.id, priority: 'high' } });
    const stext = JSON.stringify(s);
    expect(/-32602/.test(stext) && /priority/.test(stext), `stdio update_node priority → -32602 (ne tiché zahození) (${stext.slice(0, 120)})`);
    s = await rpc('tools/call', { name: 'add_nodes', arguments: { map_id: mapId, items: [{ title: 'S', children: [{ title: 'T', labels: ['a'] }] }] } });
    expect(/-32602/.test(JSON.stringify(s)) && /labels/.test(JSON.stringify(s)), 'stdio vnořené labels → -32602');
    s = await rpc('tools/call', { name: 'update_node', arguments: { map_id: mapId, node_id: k2.id, planned_on: day(1) } });
    expect(s.result && !s.result.isError && /Node updated/.test(JSON.stringify(s.result)), `stdio update_node planned_on zítra → OK (${JSON.stringify(s).slice(0, 100)})`);
    s = await rpc('tools/call', { name: 'get_map', arguments: { map_id: mapId } });
    expect(new RegExp(`plan: ${day(1)}`).test(JSON.stringify(s)), 'stdio get_map ukazuje plan');
  } finally {
    proc.kill();
  }
}, { nazev: 'API-NEZNAMA-POLE' });
