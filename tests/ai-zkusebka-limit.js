// Vyčerpaná AI kvóta ve ZKUŠEBCE musí říct, že jde o omezení zkušebky — ne
// o strop produktu.
//
// Proč: kvótu hlídá brána a ta o zkušebce nic neví. Její hláška zní „Vyčerpán
// měsíční limit AI operací. Kontaktujte poskytovatele." — zákazník ve zkušební
// verzi si z toho odnese, že takhle skoupě funguje celý killBottleneck, a to je
// přesně ten dojem, se kterým se nevrátí. (Richard 6. 8. 2026.)
//
// Testuje se PODVRŽENOU BRÁNOU (malý HTTP server, který vrací 429), takže se
// nesahá na ostrou bránu ani na kvóty skutečných zákazníků.
const { execSync } = require('child_process');
const http = require('http');

const PORT = 20551;
const BRANA_PORT = 20552;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-ai-trial';
const HESLO = 'TestHeslo.2026';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}

// Brána, která vždy hlásí vyčerpanou kvótu — přesně tou větou, kterou posílá ostrá.
function branaVycerpana() {
  return http.createServer((req, res) => {
    let telo = '';
    req.on('data', (d) => { telo += d; });
    req.on('end', () => {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        detail: { error: 'Vyčerpán měsíční limit AI operací. Kontaktujte poskytovatele.' },
      }));
    });
  }).listen(BRANA_PORT, '0.0.0.0');
}

async function start(env) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway ${env} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`,
    { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('kontejner nenaskočil');
}

async function ucet(email) {
  await api('POST', '/api/collections/users/records', {
    body: { email, password: HESLO, passwordConfirm: HESLO, name: 'Zkoušející', role: 'admin' },
  });
  const r = await api('POST', '/api/collections/users/auth-with-password', {
    body: { identity: email, password: HESLO },
  });
  return r.json?.token;
}

async function main() {
  const srv = branaVycerpana();
  const AI = `-e FLOWMAP_AI_PROVIDER=api -e FLOWMAP_AI_URL=http://host.docker.internal:${BRANA_PORT}/advisor -e FLOWMAP_AI_TOKEN=kb_test`;
  try {
    console.log('== zkušebka: hláška mluví o ZKUŠEBCE ==');
    const zitra = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    await start(`${AI} -e KB_TRIAL_UNTIL=${zitra}`);
    let tok = await ucet('sef@zkusebka.cz');
    let r = await api('POST', '/api/kb/advisor', { token: tok, body: { mode: 'expand', title: 'Otevřít kavárnu' } });
    expect(r.status === 429, `vyčerpaná kvóta vrací 429 (${r.status})`);
    const text = String(r.json?.error || '');
    expect(/zkušebn/i.test(text), `hláška zmiňuje ZKUŠEBNÍ verzi ("${text.slice(0, 60)}…")`);
    expect(/není to strop produktu|placených tarifech/i.test(text),
      'a výslovně říká, že to není strop produktu');
    expect(!/Kontaktujte poskytovatele/i.test(text),
      'původní věta od brány se k zákazníkovi NEDOSTANE');
    expect(r.json?.code === 'trial_quota', `nese strojově čitelný důvod (${r.json?.code})`);

    console.log('== vypršelá zkušebka: čtení přes POST (/mcp, výpis sdílení) projde, zápis 402 (nález S7-01) ==');
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    await start(`${AI} -e KB_TRIAL_UNTIL=2020-01-01`);
    // registrace i založení klíče jsou zápis (402) → účet a klíč zakládá superuser
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@example.com superheslo123`, { stdio: 'ignore' });
    const STz = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@example.com', password: 'superheslo123' } })).json.token;
    let rz = await api('POST', '/api/collections/users/records', { token: STz, body: { email: 'sef@vyprselo.cz', password: HESLO, passwordConfirm: HESLO, name: 'Šéf', role: 'admin' } });
    expect(rz.status === 200, `superuser založí účet i po vypršení (${rz.status})`);
    const uzivId = rz.json.id;
    tok = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@vyprselo.cz', password: HESLO } })).json?.token;
    expect(!!tok, 'přihlášení je výjimka zámku');
    const klicText = 'kb_user_' + 'a'.repeat(40);
    const hash = require('crypto').createHash('sha256').update(klicText).digest('hex');
    rz = await api('POST', '/api/collections/api_keys/records', { token: STz, body: { owner: uzivId, token_hash: hash, label: 'mcp', scope: 'read_write', use_count: 0 } });
    expect(rz.status === 200, `klíč pro MCP založen superuserem (${rz.status})`);
    const seznam = await api('POST', '/api/kb/share', { token: tok, body: { action: 'list', mapId: 'neexistuje' } });
    expect(seznam.status === 404, `výpis sdílení je čtení: 404 (mapa není), ne 402 (${seznam.status})`);
    const mcpList = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${klicText}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) });
    const mcpJson = await mcpList.json().catch(() => null);
    expect(mcpList.status === 200 && mcpJson && mcpJson.result && Array.isArray(mcpJson.result.tools), `MCP tools/list po vypršení projde (${mcpList.status})`);
    const mcpRead = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${klicText}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_maps', arguments: {} } }) });
    expect(mcpRead.status === 200, `MCP čtecí nástroj list_maps projde (${mcpRead.status})`);
    const mcpWrite = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${klicText}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'create_map', arguments: { title: 'x' } } }) });
    expect(mcpWrite.status === 402, `MCP zapisovací nástroj create_map je dál 402 (${mcpWrite.status})`);
    const zapis = await api('POST', '/api/collections/goalmaps/records', { token: tok, body: { title: 'x', nodes: [], edges: [] } });
    expect(zapis.status === 402, `zápis mapy je dál 402 (${zapis.status})`);

    console.log('== placená instance: hláška zůstává původní ==');
    // Pojistka proti tomu, aby se „je to jen zkušebka" neříkalo i platícímu —
    // ten by se právem zlobil, že mu tvrdíme něco, co si nekoupil.
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    await start(AI);   // bez KB_TRIAL_UNTIL = normální tarif
    tok = await ucet('sef@placeno.cz');
    r = await api('POST', '/api/kb/advisor', { token: tok, body: { mode: 'expand', title: 'Otevřít kavárnu' } });
    expect(r.status === 429, `i tady 429 (${r.status})`);
    const text2 = String(r.json?.error || '');
    expect(!/zkušebn/i.test(text2), `platícímu se o zkušebce NEMLUVÍ ("${text2.slice(0, 50)}…")`);
    expect(/Vyčerpán měsíční limit/i.test(text2), 'dostane původní hlášku od brány');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    srv.close();
  }

  console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
}

main();
