// Návod pro AI agenta GET /agent-setup.md (onboarding „Připoj svého AI agenta", vzor
// Runpod, 10. 10. 2026). Veřejný, bez přihlášení, text/markdown, adresa instance
// dosazená TOUTÉŽ funkcí jako OAuth metadata (helpers.publicBaseUrlFromRequest):
// KB_PUBLIC_URL → jinak Host požadavku (localhost z nastavení PB = nenastaveno — nález:
// Go přesouvá Host z hlaviček do request.host, starý kód padal vždy na „localhost").
// Plus přepínač configu agent_setup_ask (KB_AGENT_SETUP_ASK=0 / KB_PURPOSE_ASK=0).
const H = require('./_harness');
const { expect } = H;
const http = require('http');

// ⚠️ fetch (undici) hlavičku Host TIŠE ZAHAZUJE (zakázaná hlavička dle Fetch spec) — test
// s ní „procházel" na 127.0.0.1 a nic neměřil. Syrový http.request ji pošle doopravdy.
const rawGet = (base, path, { headers = {}, method = 'GET', body } = {}) => new Promise((resolve, reject) => {
  const u = new URL(base);
  const req = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
    let data = ''; res.setEncoding('utf8'); res.on('data', (c) => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data, json: () => { try { return JSON.parse(data); } catch { return null; } } }));
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});

H.beh(async () => {
  console.log('== instance bez KB_PUBLIC_URL (self-host na LAN) ==');
  // KB_PURPOSE_ASK: null = výchozí produkční chování (harness ho jinak vypíná)
  const inst = await H.startInstance({ slug: 'agent-setup', env: { KB_PURPOSE_ASK: null } });
  const B = inst.base;
  const r = await fetch(`${B}/agent-setup.md`);
  const md = await r.text();
  expect(r.status === 200, `GET /agent-setup.md → 200 (${r.status})`);
  expect(/^text\/markdown/.test(r.headers.get('content-type') || ''), `content-type markdown (${r.headers.get('content-type')})`);
  expect(!/<!doctype html|<html/i.test(md), 'není to SPA fallback (index.html)');
  expect(!md.includes('{{'), 'žádný nedosazený placeholder');
  expect(md.includes(`${B}/mcp`), 'adresa instance z Host požadavku (127.0.0.1:port) dosazená do /mcp');
  expect(md.includes('claude mcp add --transport http') && md.includes('codex mcp add') && md.includes('.cursor/mcp.json'), 'kroky pro Claude Code, Codex i Cursor');
  expect(md.includes(`${B}/oauth/authorize`) && md.includes('/mcp') && /list_maps/.test(md), 'User step přihlášení + ověření přes list_maps');
  expect(/API keys/.test(md) && /Read and write/.test(md), 'náhradní cesta klíčem s popisky z aplikace');
  expect(/section A \(OAuth\) is the way to go/.test(md), 'localhost = OAuth doporučeno (Claude Code localhost pouští)');
  const vary = r.headers.get('vary') || '';
  expect(/\bhost\b/i.test(vary) && /x-forwarded-host/i.test(vary) && /x-forwarded-proto/i.test(vary), `Vary nese Host i X-Forwarded-Host/Proto (${vary})`);
  expect(/^private\b/.test(r.headers.get('cache-control') || '') && /noindex/.test(r.headers.get('x-robots-tag') || ''), 'Cache-Control private (obsah závisí na hlavičkách, sdílená cache NE) + noindex');
  const bezPripony = await fetch(`${B}/agent-setup`);
  expect(bezPripony.status === 200 && (await bezPripony.text()).includes('agent setup guide'), '/agent-setup bez přípony dává totéž');

  console.log('== Host hlavička = adresa, kterou klient opravdu použil ==');
  const lan = await rawGet(B, '/agent-setup.md', { headers: { Host: '10.0.0.5:20506' } });
  expect(lan.text.includes('http://10.0.0.5:20506/mcp'), 'LAN Host → návod nese http://10.0.0.5:20506');
  expect(/Note for this instance/.test(lan.text) && /section B/.test(lan.text), 'plain http mimo localhost → poctivá poznámka „rovnou klíč" (Claude Code OAuth tam neposílá)');
  const prm = (await rawGet(B, '/.well-known/oauth-protected-resource', { headers: { Host: '10.0.0.5:20506' } })).json();
  expect(prm.resource === 'http://10.0.0.5:20506/mcp' && prm.authorization_servers[0] === 'http://10.0.0.5:20506', 'OAuth metadata říkají TUTÉŽ adresu (ne localhost z nastavení PB)');
  expect(prm.resource_documentation === 'http://10.0.0.5:20506/agent-setup.md', 'metadata odkazují na návod');
  const w = await rawGet(B, '/mcp', { method: 'POST', body: '{}', headers: { Host: '10.0.0.5:20506', 'Content-Type': 'application/json' } });
  expect(/^Bearer resource_metadata="http:\/\/10\.0\.0\.5:20506\/\.well-known/.test(w.headers['www-authenticate'] || ''), '401 z /mcp nese ABSOLUTNÍ resource_metadata s Host adresou');
  const proxy = (await rawGet(B, '/.well-known/oauth-authorization-server', { headers: { Host: 'firma.killbottleneck.com', 'X-Forwarded-Proto': 'https' } })).json();
  expect(proxy.authorization_endpoint === 'https://firma.killbottleneck.com/oauth/authorize', 'za reverzní proxy: X-Forwarded-Proto + Host → https doména');

  console.log('== config: přepínač dialogu ==');
  const cfg = await inst.api('GET', '/api/kb/config');
  expect(cfg.json.agent_setup_ask === true, 'výchozí agent_setup_ask = true');

  console.log('== instance s KB_PUBLIC_URL (hosted) ==');
  const hosted = await H.startInstance({ slug: 'agent-setup-hosted', env: { KB_PUBLIC_URL: 'https://firma.example.com', KB_AGENT_SETUP_ASK: 0, KB_PURPOSE_ASK: null } });
  const hm = (await rawGet(hosted.base, '/agent-setup.md', { headers: { Host: '10.9.9.9:1' } })).text;
  expect(hm.includes('https://firma.example.com/mcp') && !hm.includes('10.9.9.9'), 'KB_PUBLIC_URL má přednost před Host');
  expect(/section A \(OAuth\) is the way to go/.test(hm), 'HTTPS → OAuth doporučeno');
  const hcfg = await hosted.api('GET', '/api/kb/config');
  expect(hcfg.json.agent_setup_ask === false && hcfg.json.purpose_ask === true, 'KB_AGENT_SETUP_ASK=0 vypne jen dialog agenta, dotazník účelu ne');

  console.log('== KB_PURPOSE_ASK=0 (všechny testovací sady) vypíná i dialog agenta ==');
  const tich = await H.startInstance({ slug: 'agent-setup-tich' });   // harness: KB_PURPOSE_ASK=0
  const tcfg = await tich.api('GET', '/api/kb/config');
  expect(tcfg.json.agent_setup_ask === false, 'KB_PURPOSE_ASK=0 → agent_setup_ask=false (žádná sada nemusí nic přidávat)');
  const tmd = await fetch(`${tich.base}/agent-setup.md`);
  expect(tmd.status === 200, 'návod se servíruje i při vypnutém dialogu (odkaz z menu)');
}, { nazev: 'AGENT-SETUP' });
