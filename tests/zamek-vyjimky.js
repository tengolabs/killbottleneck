// Instance lock × the table of exceptions (server/pb_hooks/lock-exceptions.js) — 4th code review, 11 Nov 2026
// (findings S8-01, S3-03, S3-04, F4-01, T1-02).
//
// A locked instance (the move to another server / the trial is over / the subscription ended / more accounts
// than the plan covers) refuses every write. Until now nothing listed what MUST still pass, so the customer
// could not download attachments, revoke an API key, pay by bank transfer, unsubscribe with one click or
// connect an MCP client for reading — and all suites were green.
//
// This suite is a TABLE: request × lock state.
//   · every row of LOCK_EXCEPTIONS has a case here (a new row without a case = red),
//   · a case passes in exactly the states its row names and gets the lock's answer in the others,
//   · a sample of application writes (maps, attachments, invitations, new keys, MCP writes, v1 writes,
//     the old "name a node auth-refresh" bypass) stays locked in ALL four states,
//   · the read-only MCP tools in the table match the catalogue in mcp-tools.js (no Docker needed).
// One data volume, five starts: unlocked (the data is created) → the four states one after another.
//
// Run: KB_TEST_IMAGE=<image> node product/tests/zamek-vyjimky.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const H = require('./_harness');
const { expect } = H;

const HOOKS = path.join(__dirname, '..', 'server', 'pb_hooks');
const { LOCK_EXCEPTIONS, MCP_READ_TOOLS } = require(path.join(HOOKS, 'lock-exceptions.js'));

const ANY = ['migrating', 'trial_expired', 'subscription_ended', 'user_limit'];
const SETTLED = ['trial_expired', 'subscription_ended', 'user_limit'];
const STATES = {
  migrating: { env: { KB_STEHUJEME: 1 }, lock: (r) => r.status === 503 && (r.json || {}).code === 'migrating' },
  trial_expired: { env: { KB_TRIAL_UNTIL: '2020-01-01' }, lock: (r) => r.status === 402 && /Zkušební doba skončila|trial has ended/.test((r.json || {}).error || '') },
  subscription_ended: { env: { KB_PREDPLATNE_SKONCILO: 1 }, lock: (r) => r.status === 402 && (r.json || {}).code === 'subscription_ended' },
  user_limit: { env: { KB_MAX_USERS: 1 }, lock: (r) => r.status === 409 && (r.json || {}).code === 'user_limit_exceeded' },
};
const MARK = 'ATTACHMENT-CONTENT-7f3a';
const rpc = (method, params) => ({ jsonrpc: '2.0', id: 1, method, params });
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------- the table ----------
// row    = id of the LOCK_EXCEPTIONS row the case proves ('' = application data, must stay locked)
// states = lock states in which the request must pass
// run(c) = the request; ok(r, c) = it really did its job (not just "was not refused");
// still(c) = after a refused request nothing changed
const CASES = [
  { row: 'auth', name: 'sign in with a password', states: ANY,
    run: (c) => c.inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@example.com', password: H.PW } }),
    ok: (r) => r.status === 200 && !!r.json.token },
  { row: 'auth', name: 'refresh the session token', states: ANY,
    run: (c) => c.inst.api('POST', '/api/collections/users/auth-refresh', { token: c.A }),
    ok: (r) => r.status === 200 && !!r.json.token },
  { row: 'public-map', name: 'open a publicly shared map', states: ANY,
    run: (c) => c.inst.api('POST', '/api/kb/public-maps', { body: { mapId: c.publicMap } }),
    ok: (r) => r.status === 200 },
  { row: 'realtime', name: 'subscribe to changes (POST /api/realtime)', states: ANY,
    run: (c) => c.inst.api('POST', '/api/realtime', { token: c.A, body: { clientId: 'no-such-client', subscriptions: [] } }),
    ok: (r) => r.status === 404 || r.status === 400 || r.status === 204 }, // the route itself answers (no SSE client here)
  { row: 'file-token', name: 'download an attachment (POST /api/files/token → GET the file)', states: ANY,
    run: (c) => c.inst.api('POST', '/api/files/token', { token: c.A }),
    ok: async (r, c) => {
      if (r.status !== 200 || !r.json.token) return false;
      const f = await fetch(`${c.inst.base}/api/files/node_files/${c.file.id}/${c.file.name}?token=${r.json.token}`);
      return f.status === 200 && (await f.text()).includes(MARK);
    } },
  { row: 'report', name: 'report a problem', states: ANY,
    run: (c) => c.inst.api('POST', '/api/kb/report', { token: c.A, body: { message: 'It does not work.' } }),
    ok: (r) => r.status === 404 }, // KB_REPORT_TO is not set in this suite: the route answers "not found", the lock does not
  { row: 'api-key-revoke', name: 'revoke an API key', states: SETTLED,
    run: (c) => c.inst.api('POST', '/api/kb/api-keys/delete', { token: c.A, body: { id: c.keyToRevoke.id } }),
    ok: async (r, c) => r.status === 200 && (await c.inst.api('GET', '/api/kb/v1/maps', { bearer: c.keyToRevoke.token })).status === 401,
    still: async (c) => (await c.inst.api('GET', '/api/kb/v1/maps', { bearer: c.keyToRevoke.token })).status === 200 },
  { row: 'unsubscribe', name: 'One-Click unsubscribe (POST from the mail client)', states: SETTLED,
    run: (c) => c.inst.api('POST', '/api/kb/navrat/odhlasit?u=nobody&t=bad-token', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: undefined }),
    ok: (r) => r.status === 200 },
  { row: 'notifications-read', name: 'mark notifications as read', states: SETTLED,
    run: (c) => c.inst.api('POST', '/api/flowmap/notifications/read-all', { token: c.B, body: {} }),
    ok: (r) => r.status === 200 && r.json.success === true },
  { row: 'billing', name: 'save billing details', states: SETTLED,
    run: (c) => c.inst.api('POST', '/api/kb/billing', { token: c.A, body: { company: 'Firma ' + c.state, ico: '12345678', street: 'Hlavní 1', city: 'Praha', zip: '11000', email: 'fakturace@example.com' } }),
    ok: async (r, c) => r.status === 200 && r.json.complete === true
      && (((await c.inst.api('GET', '/api/kb/billing', { token: c.A })).json || {}).billing || {}).company === 'Firma ' + c.state },
  { row: 'order-transfer', name: 'order a plan by bank transfer', states: SETTLED,
    run: (c) => { c.ordersBefore = c.orders.length; return c.inst.api('POST', '/api/kb/order-transfer', { token: c.A, body: { tier: 'cloud-lite', period: 'year' } }); },
    ok: (r, c) => r.status === 200 && r.json.success === true && c.orders.length === c.ordersBefore + 1 && c.orders.at(-1).tier === 'cloud-lite',
    still: (c) => c.orders.length === c.ordersBefore },
  { row: 'oauth', name: 'connect an MCP client through OAuth (register → approve → token), then read with it', states: SETTLED,
    run: async (c) => {
      const redirect = 'http://localhost:9911/cb';
      const reg = await c.inst.api('POST', '/oauth/register', { body: { client_name: 'Lock suite ' + c.state, redirect_uris: [redirect] } });
      if (reg.status !== 201) return reg;
      const verifier = b64url(crypto.randomBytes(40));
      const appr = await c.inst.api('POST', '/api/kb/oauth/approve', { token: c.B, body: { client_id: reg.json.client_id, redirect_uri: redirect,
        scope: 'read', code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256' } });
      if (appr.status !== 200) return appr;
      const code = new URL(appr.json.redirect).searchParams.get('code');
      return c.inst.api('POST', '/oauth/token', { form: true, body: { grant_type: 'authorization_code', code, client_id: reg.json.client_id, redirect_uri: redirect, code_verifier: verifier } });
    },
    ok: async (r, c) => r.status === 200 && /^kb_user_/.test(r.json.access_token || '')
      && (await c.inst.api('GET', '/api/kb/v1/maps', { bearer: r.json.access_token })).status === 200 },
  { row: 'mcp-read', name: 'MCP initialize', states: SETTLED,
    run: (c) => c.inst.api('POST', '/mcp', { bearer: c.RW, body: rpc('initialize', { protocolVersion: '2025-06-18' }) }),
    ok: (r) => r.status === 200 && !!(r.json.result || {}).serverInfo },
  { row: 'mcp-read', name: 'MCP tools/list', states: SETTLED,
    run: (c) => c.inst.api('POST', '/mcp', { bearer: c.RW, body: rpc('tools/list', {}) }),
    ok: (r) => r.status === 200 && ((r.json.result || {}).tools || []).length > 10 },
  ...MCP_READ_TOOLS.map((tool) => ({ row: 'mcp-read', name: `MCP read-only tool ${tool}`, states: SETTLED,
    run: (c) => c.inst.api('POST', '/mcp', { bearer: c.RW, body: rpc('tools/call', { name: tool,
      arguments: ['get_map', 'list_rules', 'list_rule_runs'].includes(tool) ? { map_id: c.map } : tool === 'get_page' ? { page_id: 'nosuchpage00000' } : {} }) }),
    // the tool ran and answered inside JSON-RPC (get_page: "not found" from the tool itself, not the lock)
    ok: (r) => r.status === 200 && !!r.json.result && Array.isArray(r.json.result.content) && (tool === 'get_page' || !r.json.result.isError) })),
  { row: 'share-list', name: 'list who a map is shared with', states: SETTLED,
    run: (c) => c.inst.api('POST', '/api/kb/share', { token: c.A, body: { action: 'list', mapId: c.map } }),
    ok: (r) => r.status === 200 },

  // ---------- application data: locked in every state ----------
  { row: '', name: 'create a map', states: [],
    run: (c) => c.inst.api('POST', '/api/collections/goalmaps/records', { token: c.A, body: { title: 'After the lock', nodes: [], edges: [] } }) },
  { row: '', name: 'rename a map (PATCH)', states: [],
    run: (c) => c.inst.api('PATCH', `/api/collections/goalmaps/records/${c.map}`, { token: c.A, body: { title: 'Renamed' } }),
    still: async (c) => ((await c.inst.api('GET', `/api/collections/goalmaps/records/${c.map}`, { token: c.A })).json || {}).title === 'Work before the lock' },
  { row: '', name: 'delete a map', states: [],
    run: (c) => c.inst.api('DELETE', `/api/collections/goalmaps/records/${c.publicMap}`, { token: c.A }),
    still: async (c) => (await c.inst.api('GET', `/api/collections/goalmaps/records/${c.publicMap}`, { token: c.A })).status === 200 },
  { row: '', name: 'upload an attachment', states: [],
    run: (c) => c.upload(c.A, 'after-lock.txt', 'x') },
  { row: '', name: 'invite a person', states: [],
    run: (c) => c.inst.api('POST', '/api/kb/invite', { token: c.A, body: { email: 'new@example.com' } }) },
  { row: '', name: 'create an API key', states: [],
    run: (c) => c.inst.api('POST', '/api/kb/api-keys', { token: c.A, body: { label: 'new', scope: 'read' } }) },
  { row: '', name: 'rotate an API key (issues a new token)', states: [],
    run: (c) => c.inst.api('POST', '/api/kb/api-keys/rotate', { token: c.A, body: { id: c.rwId } }),
    still: async (c) => (await c.inst.api('GET', '/api/kb/v1/maps', { bearer: c.RW })).status === 200 },
  { row: '', name: 'make a map public (POST /share, action other than list)', states: [],
    run: (c) => c.inst.api('POST', '/api/kb/share', { token: c.A, body: { action: 'toggle_public', mapId: c.map } }) },
  { row: '', name: 'MCP write tool create_map', states: [],
    run: (c) => c.inst.api('POST', '/mcp', { bearer: c.RW, body: rpc('tools/call', { name: 'create_map', arguments: { title: 'x' } }) }) },
  { row: '', name: 'MCP write tool create_event', states: [],
    run: (c) => c.inst.api('POST', '/mcp', { bearer: c.RW, body: rpc('tools/call', { name: 'create_event', arguments: { title: 'x', start: '2027-01-05T10:00' } }) }) },
  { row: '', name: 'MCP tool that does not exist', states: [],
    run: (c) => c.inst.api('POST', '/mcp', { bearer: c.RW, body: rpc('tools/call', { name: 'list_everything', arguments: {} }) }) },
  { row: '', name: 'MCP with an unreadable body (fail-closed)', states: [],
    run: async (c) => { const f = await fetch(c.inst.base + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept-Language': 'cs', Authorization: 'Bearer ' + c.RW }, body: '{"method":"tools/list"' });
      let json = null; try { json = await f.json(); } catch { /* empty */ } return { status: f.status, json }; } },
  { row: '', name: 'REST v1 write (create a map with a read_write key)', states: [],
    run: (c) => c.inst.api('POST', '/api/kb/v1/maps', { bearer: c.RW, body: { title: 'x' } }) },
  { row: '', name: 'REST v1 write hidden behind a node called auth-refresh (the old suffix bypass)', states: [],
    run: (c) => c.inst.api('POST', `/api/kb/v1/maps/${c.map}/nodes/auth-refresh`, { bearer: c.RW, body: { title: 'x' } }) },
  { row: '', name: 'a path that only ENDS like an exception (/api/kb/v1/maps/<id>/files/token)', states: [],
    run: (c) => c.inst.api('POST', `/api/kb/v1/maps/${c.map}/files/token`, { bearer: c.RW, body: {} }) },
  { row: '', name: 'the assistant (POST /chat)', states: [],
    run: (c) => c.inst.api('POST', '/api/kb/chat', { token: c.A, body: { message: 'hello' } }) },
  // listed LAST: it changes the number of accounts. Passes only where it is the way out of the lock.
  { row: 'account-removal', name: 'admin removes an account', states: ['user_limit'],
    run: (c) => c.inst.api('DELETE', `/api/collections/users/records/${c.extraUser}`, { token: c.A }),
    ok: (r) => r.status === 204,
    still: async (c) => (await c.inst.api('GET', `/api/collections/users/records/${c.extraUser}`, { token: c.A })).status === 200 },
];

H.beh(async () => {
  console.log('== without Docker: the table is complete and matches the MCP catalogue ==');
  const ids = LOCK_EXCEPTIONS.map((x) => x.id);
  expect(ids.length === new Set(ids).size && LOCK_EXCEPTIONS.every((x) => x.id && x.method && (x.paths || x.pattern) && Array.isArray(x.states) && x.states.length && String(x.why || '').length > 20),
    `every exception has an id, a method, a path, states and a reason (${ids.length} rows)`);
  const bezPripadu = ids.filter((id) => !CASES.some((k) => k.row === id));
  expect(bezPripadu.length === 0, `every row of LOCK_EXCEPTIONS has a case in this suite (missing: ${bezPripadu.join(', ') || 'none'})`);
  const neshoda = CASES.filter((k) => k.row).filter((k) => {
    const row = LOCK_EXCEPTIONS.find((x) => x.id === k.row);
    return !row || row.states.slice().sort().join() !== k.states.slice().sort().join();
  });
  expect(neshoda.length === 0, `the states of every case equal the states of its row (differs: ${neshoda.map((k) => k.name).join(', ') || 'none'})`);
  expect(LOCK_EXCEPTIONS.filter((x) => x.pattern).every((x) => x.pattern.source.startsWith('^') && x.pattern.source.endsWith('$')),
    'every pattern is anchored to the whole path (a suffix match could be bypassed by a node name)');
  // parity with mcp-tools.js: a tool is read-only when its implementation calls nothing but GET
  const src = fs.readFileSync(path.join(HOOKS, 'mcp-tools.js'), 'utf8');
  const exec = src.slice(src.indexOf('const EXEC = {'), src.indexOf('function zpracujMcpPost'));
  const casti = exec.split(/\n {2}([a-z_]+): /).slice(1);
  const cteci = [], vsechny = [];
  for (let i = 0; i < casti.length; i += 2) {
    vsechny.push(casti[i]);
    if (!/"(POST|PUT|PATCH|DELETE)"|mapWrite\(/.test(casti[i + 1])) cteci.push(casti[i]);
  }
  const katalog = [...src.matchAll(/\{\s*name: "([a-z_]+)",\s*(?:\n\s*)?description:/g)].map((m) => m[1]);
  expect(katalog.length >= 30 && katalog.slice().sort().join() === vsechny.slice().sort().join(), `every tool of the catalogue has an implementation the suite could read (${katalog.length} tools, ${vsechny.length} implementations)`);
  expect(cteci.slice().sort().join() === MCP_READ_TOOLS.slice().sort().join(),
    `MCP_READ_TOOLS = exactly the tools that only read (in the code: ${cteci.length}, in the table: ${MCP_READ_TOOLS.length}; `
    + `missing in the table: ${cteci.filter((x) => !MCP_READ_TOOLS.includes(x)).join(', ') || 'none'}; extra: ${MCP_READ_TOOLS.filter((x) => !cteci.includes(x)).join(', ') || 'none'})`);

  // ---------- the gateway of the operator (orders by bank transfer go there) ----------
  const orders = [];
  const gateway = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST' && req.url === '/v1/orders') { orders.push(JSON.parse(body || '{}')); res.end(JSON.stringify({ order_id: orders.length, amount: 990, currency: 'CZK' })); return; }
    if (req.url.startsWith('/v1/status')) { res.end(JSON.stringify({ schema_version: 1, name: 'Test', active: true, modes: [] })); return; }
    res.statusCode = 404; res.end('{}');
  });
  const zaklad = { KB_UVODNI_MAPA: 0, KB_AI_PROVIDER: 'api', KB_AI_URL: gateway.base + '/v1/advisor', KB_AI_TOKEN: 'kb_test_lock' };
  const volume = `kb-e2e-zamek-vyjimky-${crypto.createHash('sha1').update(String(process.env.KB_TEST_IMAGE)).digest('hex').slice(0, 6)}-data`;
  require('child_process').execSync(`docker volume rm -f ${volume} 2>/dev/null; true`, { stdio: 'ignore' });

  console.log('== unlocked: the data is created ==');
  let inst = await H.startInstance({ slug: 'zamek-vyj-0', addHostGateway: true, volume, env: zaklad });
  await inst.register('a@example.com', { name: 'Anna' });   // the first account = admin
  await inst.register('b@example.com', { name: 'Bob' });
  const extra = await inst.register('c@example.com', { name: 'Cyril' });
  const A0 = await inst.login('a@example.com');
  const mapa = await inst.api('POST', '/api/collections/goalmaps/records', { token: A0, body: { title: 'Work before the lock', nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Goal', title: 'Goal', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 100 }, data: { title: 'Step', status: 'todo' } }], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } });
  const verejna = await inst.api('POST', '/api/collections/goalmaps/records', { token: A0, body: { title: 'Public map', nodes: [], edges: [] } });
  await inst.api('POST', '/api/kb/share', { token: A0, body: { action: 'toggle_public', mapId: verejna.json.id } });
  const upload = (base) => async (token, name, content) => {
    const form = new FormData();
    form.append('map', mapa.json.id); form.append('node_id', 'n1'); form.append('name', name); form.append('size', String(content.length));
    form.append('file', new Blob([content], { type: 'text/plain' }), name);
    const res = await fetch(`${base()}/api/collections/node_files/records`, { method: 'POST', headers: { Authorization: token, 'Accept-Language': 'cs' }, body: form });
    let json = null; try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  };
  const soubor = await upload(() => inst.base)(A0, 'contract.txt', 'Contract. ' + MARK);
  const klic = async (label, scope) => (await inst.api('POST', '/api/kb/api-keys', { token: A0, body: { label, scope } })).json;
  const rw = await klic('agent', 'read_write');
  const kOdvolani = {};
  for (const s of ANY) kOdvolani[s] = await klic('to revoke: ' + s, 'read');
  expect(mapa.status === 200 && verejna.status === 200 && soubor.status === 200 && !!soubor.json.file && /^kb_user_/.test(rw.token || '') && ANY.every((s) => kOdvolani[s].id) && !!extra.json.id,
    `maps, an attachment, API keys and three accounts exist (${mapa.status} ${verejna.status} ${soubor.status})`);
  if (H.pocty().fail) throw new Error('the setup failed — the table below would prove nothing');
  // the unlocked instance: the write sample works (otherwise "locked" below would prove nothing)
  const zapis0 = await inst.api('PATCH', `/api/collections/goalmaps/records/${verejna.json.id}`, { token: A0, body: { description: 'ok' } });
  expect(zapis0.status === 200, `unlocked: a write passes (${zapis0.status})`);
  inst.pause();

  for (const state of ANY) {
    console.log(`\n== ${state} ==`);
    inst = await H.startInstance({ slug: 'zamek-vyj-' + state.replace(/_/g, '-'), addHostGateway: true, volume, env: Object.assign({}, zaklad, STATES[state].env) });
    const cur = inst;
    const cfg = (await inst.api('GET', '/api/kb/config')).json || {};
    const hlasi = state === 'migrating' ? cfg.stehujeme === true : state === 'trial_expired' ? cfg.trial_expired === true
      : state === 'subscription_ended' ? cfg.subscription_ended === true : cfg.over_user_limit === true;
    expect(hlasi, `/config reports the state ${state}`);
    const c = { state, inst, orders, map: mapa.json.id, publicMap: verejna.json.id, file: { id: soubor.json.id, name: soubor.json.file },
      RW: rw.token, rwId: rw.id, keyToRevoke: kOdvolani[state], extraUser: extra.json.id, upload: upload(() => cur.base) };
    c.A = await inst.login('a@example.com');
    c.B = await inst.login('b@example.com');
    const lock = STATES[state].lock;
    for (const k of CASES) {
      let r;
      try { r = await k.run(c); } catch (e) { r = { status: 0, json: { error: String(e && e.message || e) } }; }
      const popis = `${r.status} ${JSON.stringify(r.json || '').slice(0, 110)}`;
      if (k.states.includes(state)) {
        expect(!lock(r) && !!(await k.ok(r, c)), `PASSES  ${k.name} (${popis})`);
      } else {
        expect(lock(r), `LOCKED  ${k.name} (${popis})`);
        if (k.still) expect(!!(await k.still(c)), `        …and nothing changed: ${k.name}`);
      }
    }
    inst.pause();
  }
}, { nazev: 'ZAMEK-VYJIMKY' });
