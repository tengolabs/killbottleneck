// MCP přes Streamable HTTP (POST /mcp) — e2e proti čerstvému kontejneru (:20504).
// Ověřuje: (1) PARITU katalogu nástrojů se stdio serverem product/mcp/index.js
// (jména, popisy, properties, required — drift = červená), (2) celý round-trip
// create_map → add_nodes → get_map naostro, (3) autorizaci: bez klíče 401
// s WWW-Authenticate, scope read na mutaci = chyba, izolaci dvou uživatelů,
// (4) protokol: -32700 na vadný JSON, 405 na GET, 202 na notifikaci, neznámá
// metoda -32601, neznámý nástroj a chybějící povinný argument -32602.
// Předpoklad: v product/mcp proběhl `npm install` (dělá run-all.sh).
const { execSync, spawn } = require('child_process');
const path = require('path');
const BASE = 'http://127.0.0.1:20504';
const NAME = 'flowmap-e2e-mcp-http';
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
  return { status: res.status, json, headers: res.headers };
};
// jeden JSON-RPC požadavek na /mcp
let rpcId = 1;
const mcpPost = async (key, method, params, { raw } = {}) => {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: raw !== undefined ? raw : JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params: params || {} }),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
};
const toolText = (r) => (((r.json || {}).result || {}).content || []).map((c) => c.text || '').join('\n');

let mcp = null;
(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20504:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    await api('POST', '/api/collections/users/records', { body: { email: 'a@x.cz', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/users/records', { body: { email: 'b@x.cz', password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: PW } })).json.token;
    const B = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'b@x.cz', password: PW } })).json.token;
    const keyRW = (await api('POST', '/api/kb/api-keys', { token: A, body: { label: 'http-rw', scope: 'read_write' } })).json.token;
    const keyRO = (await api('POST', '/api/kb/api-keys', { token: A, body: { label: 'http-ro', scope: 'read' } })).json.token;
    const keyB = (await api('POST', '/api/kb/api-keys', { token: B, body: { label: 'http-b', scope: 'read_write' } })).json.token;

    console.log('== protokol ==');
    const init = await mcpPost(keyRW, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    expect(init.status === 200 && init.json.result.protocolVersion === '2025-06-18'
      && init.json.result.serverInfo.name === 'killbottleneck', 'initialize → 2025-06-18, serverInfo killbottleneck');
    const initOld = await mcpPost(keyRW, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    expect(initOld.json.result.protocolVersion === '2025-03-26', 'initialize se starší verzí → server ji potvrdí');
    const notif = await fetch(`${BASE}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyRW}` },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(notif.status === 202, `notifikace (bez id) → 202 (${notif.status})`);
    const bad = await mcpPost(keyRW, null, null, { raw: '{tohle není json' });
    expect(bad.json && bad.json.error && bad.json.error.code === -32700, 'vadný JSON → -32700');
    const batch = await mcpPost(keyRW, null, null, { raw: '[]' });
    expect(batch.json && batch.json.error && batch.json.error.code === -32600, 'batch → -32600 (2025-06-18 batching nemá)');
    const unk = await mcpPost(keyRW, 'resources/list', {});
    expect(unk.json && unk.json.error && unk.json.error.code === -32601, 'neznámá metoda → -32601');
    const get = await fetch(`${BASE}/mcp`);
    expect(get.status === 405, `GET /mcp → 405, ne SPA fallback (${get.status})`);

    console.log('== auth ==');
    const noKey = await mcpPost(null, 'tools/list', {});
    expect(noKey.status === 401, `bez klíče → 401 (${noKey.status})`);
    expect(String(noKey.headers.get('www-authenticate') || '').startsWith('Bearer'), '401 nese WWW-Authenticate: Bearer');

    console.log('== parita katalogu se stdio serverem ==');
    // stdio server se zeptáme na tools/list stejným klíčem
    mcp = spawn('node', [path.join(__dirname, '../mcp/index.js')], {
      env: { ...process.env, KB_URL: BASE, KB_API_KEY: keyRW }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = ''; const pending = new Map();
    mcp.stdout.on('data', (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try { const m = JSON.parse(line); if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } catch {}
      }
    });
    let sid = 100;
    const stdioRpc = (method, params) => new Promise((resolve, reject) => {
      const id = sid++;
      pending.set(id, resolve);
      mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 15000);
    });
    await stdioRpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const stdioTools = (await stdioRpc('tools/list', {})).result.tools;
    const httpTools = (await mcpPost(keyRW, 'tools/list', {})).json.result.tools;
    expect(httpTools.length === 18, `HTTP tools/list → 18 nástrojů (${httpTools.length})`);
    const podle = (arr) => Object.fromEntries(arr.map((t) => [t.name, t]));
    const S = podle(stdioTools), H = podle(httpTools);
    expect(JSON.stringify(Object.keys(S).sort()) === JSON.stringify(Object.keys(H).sort()), 'stejná JMÉNA nástrojů');
    let popisyOk = true, propsOk = true, reqOk = true;
    for (const n of Object.keys(S)) {
      if (!H[n]) continue;
      if (S[n].description !== H[n].description) { popisyOk = false; console.log(`    drift popisu: ${n}`); }
      const sp = Object.keys((S[n].inputSchema || {}).properties || {}).sort();
      const hp = Object.keys((H[n].inputSchema || {}).properties || {}).sort();
      if (JSON.stringify(sp) !== JSON.stringify(hp)) { propsOk = false; console.log(`    drift properties: ${n} stdio=[${sp}] http=[${hp}]`); }
      const sr = ((S[n].inputSchema || {}).required || []).slice().sort();
      const hr = ((H[n].inputSchema || {}).required || []).slice().sort();
      if (JSON.stringify(sr) !== JSON.stringify(hr)) { reqOk = false; console.log(`    drift required: ${n} stdio=[${sr}] http=[${hr}]`); }
    }
    expect(popisyOk, 'stejné POPISY nástrojů (1:1 se stdio)');
    expect(propsOk, 'stejné properties vstupů');
    expect(reqOk, 'stejná required pole');

    console.log('== round-trip naostro ==');
    const cm = await mcpPost(keyRW, 'tools/call', { name: 'create_map', arguments: { title: 'HTTP mapa', outline: [{ title: 'Krok 1', children: [{ title: 'Krok 1a' }] }, { title: 'Krok 2' }] } });
    const cmText = toolText(cm);
    expect(/Map created/.test(cmText) && /Krok 1a/.test(cmText), 'create_map přes HTTP postavil mapu');
    const mapId = (cmText.match(/id: ([a-z0-9]+)/) || [])[1];
    expect(!!mapId, `mapa má id (${mapId})`);
    const an = await mcpPost(keyRW, 'tools/call', { name: 'add_nodes', arguments: { map_id: mapId, items: [{ title: 'Krok 3' }] } });
    expect(/Added 1 node/.test(toolText(an)), 'add_nodes přidal uzel (base_updated si server načetl sám)');
    const gm = await mcpPost(keyRW, 'tools/call', { name: 'get_map', arguments: { map_id: mapId } });
    expect(/Krok 3/.test(toolText(gm)) && /user DATA/.test(toolText(gm)), 'get_map vrací strom i DATA_FENCE');
    // parita výstupu get_map se stdio serverem (stejná mapa, stejný text)
    const gmStdio = await stdioRpc('tools/call', { name: 'get_map', arguments: { map_id: mapId } });
    const stdioText = (gmStdio.result.content || []).map((c) => c.text).join('\n');
    expect(stdioText === toolText(gm), 'výstup get_map je BYTE-SHODNÝ se stdio serverem');

    console.log('== autorizace nástrojů ==');
    const ro = await mcpPost(keyRO, 'tools/call', { name: 'add_nodes', arguments: { map_id: mapId, items: [{ title: 'X' }] } });
    expect(ro.json.result && ro.json.result.isError, 'read klíč na mutaci → isError (scope vynucen v1 API)');
    const cizi = await mcpPost(keyB, 'tools/call', { name: 'get_map', arguments: { map_id: mapId } });
    expect(cizi.json.result && cizi.json.result.isError, 'cizí klíč nevidí cizí mapu (404 z v1)');
    const unkTool = await mcpPost(keyRW, 'tools/call', { name: 'neexistuje', arguments: {} });
    expect(unkTool.json.error && unkTool.json.error.code === -32602, 'neznámý nástroj → -32602');
    const missing = await mcpPost(keyRW, 'tools/call', { name: 'get_map', arguments: {} });
    expect(missing.json.error && missing.json.error.code === -32602, 'chybějící povinný argument → -32602');
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 200));
  } finally {
    if (mcp) mcp.kill();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
