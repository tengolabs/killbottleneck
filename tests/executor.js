// Vykonavatel uzlu (člověk / automatizace) přes v1 API a MCP + role správce
// AI agentů. Vlastní kontejner a vlastní API klíč, aby se nesnědl write rate-limit
// sady v1-api.js (~23 z 30/min na klíč).
//
// Klíčové invarianty:
//  - `owner` uzlu ZŮSTÁVÁ e-mail člověka (garanta) i u automatizovaného kroku
//  - legacy uzel bez nových polí musí projít zápisem beze změny významu
//  - neplatný executor_kind je CHYBA, ne tichý fallback na "human"
//  - „chtěl bych automatizaci" je PŘÁNÍ pro správce, ne příkaz agentovi
const { execSync, spawn } = require('child_process');
const path = require('path');

const NAME = 'flowmap-e2e-executor';
const PORT = 20511;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, key, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

// minimální JSON-RPC dialog s MCP serverem přes stdio (vzor mcp-e2e.js)
function mcpClient(apiKey) {
  const proc = spawn('node', [path.join(__dirname, '../mcp/index.js')], {
    env: { ...process.env, FLOWMAP_URL: BASE, FLOWMAP_API_KEY: apiKey },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buf = '';
  const waiters = new Map();
  proc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const w = waiters.get(msg.id);
        if (w) { waiters.delete(msg.id); w(msg); }
      } catch { /* nekompletní řádek */ }
    }
  });
  let id = 0;
  const send = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    waiters.set(myId, resolve);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: myId, method, params })}\n`);
  });
  return { send, kill: () => proc.kill() };
}

(async () => {
  let mcp = null;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const rA = await reg('a@example.com');
    const rB = await reg('b@example.com');
    const A = await login('a@example.com');
    const B = await login('b@example.com');
    const key = (await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'exec', scope: 'read_write' } })).json.token;

    console.log('== role správce AI agentů ==');
    expect(rB.json.is_ai_manager !== true, 'registrace správcovství AI nedává');
    let r = await api('PATCH', `/api/collections/users/records/${rB.json.id}`, { token: B, body: { is_ai_manager: true } });
    expect(r.status === 200 && r.json.is_ai_manager === false, 'člen si příznak sám nenastaví');
    r = await api('PATCH', `/api/collections/users/records/${rB.json.id}`, { token: A, body: { is_ai_manager: true } });
    expect(r.status === 200 && r.json.is_ai_manager === true, 'admin příznak nastaví');
    const members = (await api('GET', '/api/flowmap/members', { token: B })).json.members;
    expect(members.find((m) => m.email === 'b@example.com').is_ai_manager === true, '/members vrací příznak');
    expect(members.every((m) => m.notify_prefs === undefined), '/members NEvydá notify_prefs');

    // čerstvá instalace bez FLOWMAP_PUBLIC_URL → appURL PocketBase je localhost:8090,
    // což vypadá platně, ale agent jinde by volal sám sebe → registr musí varovat
    const adm = (await api('GET', '/api/flowmap/ai-agents/admin', { token: B })).json;
    expect(adm.callback_url_warn === true,
      `bez FLOWMAP_PUBLIC_URL registr varuje na localhost (${adm.callback_url})`);

    console.log('== v1 API: vykonavatel na uzlu ==');
    const created = await api('POST', '/api/flowmap/v1/maps', { key, body: {
      title: 'Proces', tree: [
        { title: 'Ruční krok', owner: 'a@example.com' },
        { title: 'Automatický krok', owner: 'b@example.com', executor_kind: 'automation',
          executor_name: 'n8n reporty', color: '#3b82f6' },
        { title: 'Ruční krok s přáním', owner: 'a@example.com',
          automation_wanted: true, automation_note: 'dělám to ručně 20 minut' },
      ],
    } });
    expect(created.status === 200, `create_map prošlo (${created.status})`);
    const aiItem = created.json.tree[0].children.find((x) => x.title === 'Automatický krok');
    expect(aiItem.executor_kind === 'automation' && aiItem.executor_name === 'n8n reporty',
      'strom vrací vykonavatele');
    const wishItem = created.json.tree[0].children.find((x) => x.title === 'Ruční krok s přáním');
    expect(wishItem.automation_wanted === true && wishItem.automation_note === 'dělám to ručně 20 minut',
      'strom vrací přání automatizace i s poznámkou');
    expect(aiItem.owner === 'b@example.com', 'garant zůstává e-mail ČLOVĚKA i u automatizace');
    expect(aiItem.color === '#3b82f6', 'barva projde přes v1 (parita s update_node)');

    const mapId = created.json.id;
    let m = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { key });
    const manual = m.json.tree[0].children.find((x) => x.title === 'Ruční krok');
    expect(manual.executor_kind === 'human', 'krok bez určení = human');

    console.log('== v1 update_node ==');
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${manual.id}`, { key, body: {
      executor_kind: 'automation', executor_name: 'n8n noční záloha', base_updated: m.json.updated,
    } });
    expect(r.status === 200 && r.json.node.executor_kind === 'automation', `přepnutí na automatizaci (${r.status})`);
    m = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { key });
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${manual.id}`, { key, body: {
      executor_kind: 'robot', base_updated: m.json.updated,
    } });
    expect(r.status === 400, `neplatný vykonavatel → 400, ne tichý fallback (${r.status})`);

    console.log('== přání automatizace → notifikace správci → uzavření smyčky ==');
    const aiReq = async (token) => (await api('GET', `/api/collections/notifications/records?perPage=20&filter=${encodeURIComponent('type="ai_request"')}`, { token })).json;
    expect((await aiReq(B)).totalItems === 1, 'správce AI dostal přání z v1 create_map');
    // BRZDA: opakovaná úprava téhož přání správce znovu NEotravuje (dedup na uzel
    // a hodinu). Bez ní by stačilo cyklit ukládání mapy a zaplavit mu zvoneček.
    m = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { key });
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${wishItem.id}`, { key, body: {
      automation_note: 'a navíc na tom závisí fakturace', base_updated: m.json.updated,
    } });
    expect(r.status === 200 && (await aiReq(B)).totalItems === 1,
      `úprava téhož přání do hodiny už neotravuje (${(await aiReq(B)).totalItems})`);
    m = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { key });
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${wishItem.id}`, { key, body: {
      description: 'jen popis', base_updated: m.json.updated,
    } });
    expect(r.status === 200 && (await aiReq(B)).totalItems === 1, 'zápis beze změny přání nenotifikuje');
    // ...ale přání u JINÉHO uzlu dojde normálně
    m = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { key });
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${aiItem.id}`, { key, body: {
      automation_wanted: true, automation_note: 'i tady', base_updated: m.json.updated,
    } });
    expect(r.status === 200 && (await aiReq(B)).totalItems === 2,
      `přání u jiného uzlu dojde (${(await aiReq(B)).totalItems})`);

    // dopsaná automatizace přání shodí
    m = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { key });
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${wishItem.id}`, { key, body: {
      executor_kind: 'automation', executor_name: 'n8n fakturace', base_updated: m.json.updated,
    } });
    expect(r.status === 200 && r.json.node.automation_wanted === false,
      'zapsaná automatizace shodila přání');
    // notifikace TADY záměrně nechodí: žadatel i ten, kdo ji dopsal, je tentýž
    // člověk (majitel klíče) a notify() sám sobě neposílá
    let ready = (await api('GET', `/api/collections/notifications/records?perPage=20&filter=${encodeURIComponent('type="automation_ready"')}`, { token: A })).json;
    expect(ready.totalItems === 0, `sám sobě se splněné přání neoznamuje (${ready.totalItems})`);

    console.log('== legacy uzel bez nových polí ==');
    const legacy = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Stará mapa',
      nodes: [{ id: 'old1', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'Starý uzel', status: 'todo', owner: 'a@example.com' } }],
      edges: [],
    } })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${legacy.id}`, { token: A, body: {
      nodes: [{ id: 'old1', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'Starý uzel upravený', status: 'todo', owner: 'a@example.com' } }],
      edges: [],
    } });
    const reread = (await api('GET', `/api/collections/goalmaps/records/${legacy.id}`, { token: A })).json;
    expect(reread.nodes[0].data.title === 'Starý uzel upravený' && reread.nodes[0].data.owner === 'a@example.com',
      'legacy uzel projde zápisem beze změny významu');

    console.log('== MCP: nástroje vystavují vykonavatele i barvu ==');
    mcp = mcpClient(key);
    await mcp.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    const tools = (await mcp.send('tools/list', {})).result.tools;
    const upd = tools.find((x) => x.name === 'update_node');
    const props = Object.keys(upd.inputSchema.properties || {});
    expect(['executor_kind', 'executor_name', 'automation_wanted', 'automation_note', 'color'].every((k) => props.includes(k)),
      `update_node vystavuje vykonavatele, přání i color (${props.join(',')})`);
    const createTool = tools.find((x) => x.name === 'create_map');
    const itemProps = JSON.stringify(createTool.inputSchema);
    expect(/executor_kind/.test(itemProps) && /automation_wanted/.test(itemProps),
      'create_map/outline zná vykonavatele i přání');

    // přání na `manual` (splněná přání se z uzlu mažou, tak si jedno vyrobíme znovu)
    m = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { key });
    await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${manual.id}`, { key, body: {
      executor_kind: 'human', executor_name: '', automation_wanted: true,
      automation_note: 'ručně to trvá věčnost', base_updated: m.json.updated,
    } });
    const call = await mcp.send('tools/call', { name: 'get_map', arguments: { map_id: mapId } });
    const rendered = call.result.content[0].text;
    expect(/automated: n8n reporty/.test(rendered), 'MCP výpis mapy ukazuje vykonavatele');
    expect(/automation requested/.test(rendered), 'MCP výpis mapy ukazuje čekající přání');
    expect(/automation wish:/.test(rendered), 'MCP výpis mapy ukazuje přání automatizace');

    console.log('== uzavření smyčky: přání zadá jeden, automatizaci dopíše druhý ==');
    // v MCP části výš vzniklo na `manual` nové přání (žadatel = A). Teď ho splní
    // SPRÁVCE B přes aplikaci — a A se to musí dozvědět.
    await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: mapId, email: 'b@example.com', permission: 'edit' } });
    const full = (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: A })).json;
    const wishNode = full.nodes.find((n) => n.id === manual.id);
    expect(wishNode.data.automationRequestedBy === 'a@example.com',
      `server zapsal žadatele (${wishNode.data.automationRequestedBy})`);
    const patched = full.nodes.map((n) => (n.id === manual.id
      ? { ...n, data: { ...n.data, executorKind: 'automation', executorName: 'n8n fakturace' } } : n));
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: B, body: { nodes: patched, edges: full.edges } });
    expect(r.status === 200, `správce mapu upravil (${r.status})`);
    const after = (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: A })).json;
    const doneNode = after.nodes.find((n) => n.id === manual.id);
    expect(doneNode.data.automationWanted === false && doneNode.data.automationRequestedBy === '',
      'přání se po splnění uklidilo');
    ready = (await api('GET', `/api/collections/notifications/records?perPage=20&filter=${encodeURIComponent('type="automation_ready"')}`, { token: A })).json;
    expect(ready.totalItems === 1 && /n8n fakturace/.test(ready.items[0]?.text || ''),
      `žadatel dostal zprávu, že jeho automatizace běží (${ready.totalItems})`);

    console.log('== API klíč nesmí sahat na registr ani na roli ==');
    r = await api('GET', '/api/flowmap/ai-agents/admin', { key });
    expect(r.status === 401, `registr agentů přes API klíč nedostupný (${r.status})`);
    r = await api('PATCH', `/api/collections/users/records/${rA.json.id}`, { key, body: { is_ai_manager: true } });
    expect(r.status === 401 || r.status === 403 || r.status === 404, `API klíč roli nemění (${r.status})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    if (mcp) mcp.kill();
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} EXECUTOR PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
