// MCP e2e: čerstvý kontejner (:20503) → uživatel + read_write API klíč přes REST →
// spawn product/mcp/index.js (stdio) → ruční JSON-RPC dialog (initialize, tools/list,
// create_map → get_map → add_nodes → update_node → delete_node; task nástroje NEEXISTUJÍ)
// — celý řetěz MCP → v1 API → PocketBase naostro, bez SDK klienta v testu.
// Předpoklad: v product/mcp proběhl `npm install`.
const { execSync, spawn } = require('child_process');
const path = require('path');
const BASE = 'http://127.0.0.1:20503';
const NAME = 'flowmap-e2e-mcp';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

let mcp = null;
(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20503:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    await api('POST', '/api/collections/users/records', { body: { email: 'a@x.cz', password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: PW } })).json.token;
    const key = (await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'mcp-e2e', scope: 'read_write' } })).json.token;

    // spawn MCP serveru (stdio, newline-delimited JSON-RPC)
    mcp = spawn('node', [path.join(__dirname, '../mcp/index.js')], {
      // ⚠️ Schválně STARÉ názvy proměnných: kdo má MCP server zaregistrovaný
      // v Claude Code nebo Desktopu, má tam po přejmenování pořád FLOWMAP_* —
      // tenhle test tedy zároveň hlídá, že jim to nepřestalo fungovat.
      env: { ...process.env, FLOWMAP_URL: BASE, FLOWMAP_API_KEY: key },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    const pending = new Map();
    mcp.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
        } catch { /* ne-JSON řádek ignorovat */ }
      }
    });
    let nextId = 1;
    const rpc = (method, params) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, resolve);
      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 15000);
    });
    const callTool = async (name, args) => {
      const r = await rpc('tools/call', { name, arguments: args });
      const t = ((r.result || {}).content || []).map((c) => c.text || '').join('\n');
      return { text: t, isError: !!(r.result || {}).isError, raw: r };
    };

    console.log('== handshake ==');
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' },
    });
    expect(init.result && init.result.serverInfo && init.result.serverInfo.name === 'killbottleneck',
      `initialize → serverInfo killbottleneck (${init.result && init.result.protocolVersion})`);
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = await rpc('tools/list', {});
    const names = (tools.result.tools || []).map((t) => t.name).sort();
    expect(names.length === 17 && names.includes('create_map') && names.includes('create_rule') && names.includes('get_org_structure') && names.includes('list_people') && names.includes('get_portfolio'),
      `tools/list → 17 nástrojů vč. list_people a get_portfolio (${names.join(', ')})`);
    // Slovník 17. 8. 2026: úkol = uzel s řešitelem nebo termínem — task nástroje zanikly
    expect(!names.includes('add_task') && !names.includes('list_tasks') && !names.includes('update_task'),
      'task nástroje (add/list/update_task) NEEXISTUJÍ');

    console.log('== create_map → get_map ==');
    let r = await callTool('create_map', {
      title: 'MCP demo projekt',
      apex_text: 'Ověřit MCP řetěz',
      outline: [
        { title: 'Fáze A', deadline: '2026-09-01', children: [{ title: 'Krok A1' }, { title: 'Krok A2' }] },
        { title: 'Fáze B' },
      ],
    });
    expect(!r.isError && /Map created/.test(r.text) && /Fáze A/.test(r.text), 'create_map založí mapu');
    const mapId = (r.text.match(/\(id: ([a-z0-9]{15})/i) || [])[1];
    expect(!!mapId, `z odpovědi jde vyčíst id mapy (${mapId})`);
    r = await callTool('list_maps', {});
    expect(!r.isError && /MCP demo projekt/.test(r.text), 'list_maps mapu vidí');
    r = await callTool('get_map', { map_id: mapId });
    expect(!r.isError && /\[ \] Fáze A .*deadline: 2026-09-01/.test(r.text) && /Krok A2/.test(r.text),
      'get_map vrací odsazený strom s termínem');
    const krokA1 = (r.text.match(/Krok A1 \(id: (node-[\w-]+)/) || [])[1];
    const fazeB = (r.text.match(/Fáze B \(id: (node-[\w-]+)/) || [])[1];
    expect(!!krokA1 && !!fazeB, 'id uzlů jsou ve stromu');

    console.log('== add_nodes / update_node / delete_node ==');
    r = await callTool('add_nodes', { map_id: mapId, parent_id: fazeB, items: [{ title: 'Krok B1', owner: 'a@x.cz' }] });
    expect(!r.isError && /Added 1 node/.test(r.text) && /Krok B1/.test(r.text), 'add_nodes pod Fázi B');
    r = await callTool('update_node', { map_id: mapId, node_id: krokA1, status: 'done', deadline: '2026-08-01' });
    expect(!r.isError && /status done/.test(r.text), 'update_node → done');
    r = await callTool('get_map', { map_id: mapId });
    expect(/\[✓\] Krok A1/.test(r.text), 'strom ukazuje [✓] u hotového');
    r = await callTool('update_node', { map_id: mapId, node_id: 'node-neexistuje', status: 'done' });
    expect(r.isError && /nalezen|not found/i.test(r.text), `neznámý uzel = srozumitelná chyba („${r.text.slice(0, 40)}…")`);
    r = await callTool('delete_node', { map_id: mapId, node_id: fazeB });
    expect(!r.isError && /Deleted 2 node/.test(r.text), 'delete_node smaže uzel + podstrom');

    console.log('== tasks: nástroje odstraněny ==');
    // volání odstraněného nástroje = slušná chyba, ne pád serveru
    r = await callTool('add_task', { title: 'Poslat pozvánky', map_id: mapId, node_id: krokA1 });
    expect(r.isError, `volání add_task = chyba, server běží dál („${(r.text || '').slice(0, 40)}…")`);

    console.log('== automatizační pravidla přes MCP ==');
    // agent si pravidlo ZALOŽÍ sám (opěra „MCP first" — tohle nemá Asana ani Monday)
    r = await callTool('create_rule', {
      map_id: mapId, name: 'Nový uzel → ohlásit',
      trigger: { type: 'node_created' },
      actions: [{ type: 'notify', to: 'map_owner', message: 'v mapě přibyl uzel' }],
    });
    expect(!r.isError && /Rule created/.test(r.text), 'create_rule');
    const ruleId = (r.text.match(/\(id: ([a-z0-9]{15})/i) || [])[1];
    // v0.35: opakování na cílech — agent zakládá opakovací pravidlo přes advance
    r = await callTool('create_rule', {
      map_id: mapId, name: 'Opakování (týdně): Krok A1', node_id: krokA1,
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'weekly' }],
    });
    expect(!r.isError && /Rule created/.test(r.text), 'create_rule s set_deadline advance: weekly');
    r = await callTool('create_rule', {
      map_id: mapId, name: 'Vadné opakování', node_id: krokA1,
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_deadline', advance: 'yearly' }],
    });
    expect(r.isError && /advance/.test(r.text), `advance mimo výčet = srozumitelná chyba („${(r.text || '').slice(0, 60)}…")`);
    // úklid: opakovací pravidlo smazat hned — pozdější část sady počítá pravidla mapy
    r = await callTool('list_rules', { map_id: mapId });
    const opakId = ((r.text || '').match(/Opakování \(týdně\)[^(]*\(id: ([a-z0-9]{15})/i) || [])[1];
    expect(!!opakId, `opakovací pravidlo má id v list_rules (${opakId || 'nenalezeno'})`);
    if (opakId) {
      r = await callTool('delete_rule', { map_id: mapId, rule_id: opakId });
      expect(!r.isError, 'delete_rule opakovací pravidlo uklidil');
    }

    r = await callTool('list_rules', { map_id: mapId });
    expect(!r.isError && /Nový uzel → ohlásit/.test(r.text) && /enabled/.test(r.text), 'list_rules pravidlo vidí');
    r = await callTool('add_nodes', { map_id: mapId, items: [{ title: 'Spouštěcí uzel' }] });
    expect(!r.isError, 'add_nodes spouštěcího uzlu');
    r = await callTool('list_rule_runs', { map_id: mapId, rule_id: ruleId });
    expect(!r.isError && /\[ok\]/.test(r.text) && /node_created/.test(r.text) && /notify/.test(r.text),
      'pravidlo firelo na zápis PŘES MCP a běh je v logu');
    r = await callTool('update_rule', { map_id: mapId, rule_id: ruleId, enabled: false });
    expect(!r.isError && /DISABLED/.test(r.text), 'update_rule toggle vypnul');
    r = await callTool('delete_rule', { map_id: mapId, rule_id: ruleId });
    expect(!r.isError && /Rule deleted/.test(r.text), 'delete_rule');
    r = await callTool('list_rules', { map_id: mapId });
    expect(!r.isError && /No rules/.test(r.text), 'po smazání žádná pravidla');

    console.log('== konfliktní zápis (409 recovery) ==');
    // cizí zápis mimo MCP session (přes PB session) posune updated → další MCP zápis
    // s uloženou base_updated dostane 409 a nástroj vrátí aktuální strom k re-apply
    const mapRec = (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: A, body: { title: 'MCP demo projekt (přejmenováno v UI)', nodes: mapRec.nodes, edges: mapRec.edges } });
    r = await callTool('add_nodes', { map_id: mapId, items: [{ title: 'Po konfliktu' }] });
    expect(r.isError && /modified elsewhere|409/.test(r.text) && /Current tree/.test(r.text),
      '409 → nástroj vrátí aktuální strom k zopakování úpravy');
    r = await callTool('add_nodes', { map_id: mapId, items: [{ title: 'Po konfliktu' }] });
    expect(!r.isError && /Po konfliktu/.test(r.text), 'opakování po přenačtení projde');
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 200));
  } finally {
    if (mcp) mcp.kill();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
