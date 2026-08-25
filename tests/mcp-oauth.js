// OAuth pro MCP konektory — celý flow headlessly + consent obrazovka v prohlížeči.
// Ověřuje: discovery metadata → dynamic client registration (RFC 7591) →
// authorization code s PKCE S256 → token endpoint mintuje api_keys záznam →
// token FUNGUJE na /mcp. Mutačně: špatný verifier, druhé použití kódu,
// neregistrovaná redirect_uri, chybějící challenge, ne-https redirect při
// registraci, revokace klíče v UI = konec přístupu.
const { execSync } = require('child_process');
const crypto = require('crypto');
const http = require('http');
const puppeteer = require('puppeteer-core');
const BASE = 'http://127.0.0.1:20505';
const NAME = 'flowmap-e2e-mcp-oauth';
const CB_PORT = 33418;
const CB = `http://127.0.0.1:${CB_PORT}/callback`;
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, { token, body, form } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json',
      ...(token ? { Authorization: token } : {}),
    },
    ...(body !== undefined ? { body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json, headers: res.headers };
};
const mcpCall = async (key, name, args) => {
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args || {} } }),
  });
  const j = await r.json();
  return { status: r.status, result: (j || {}).result, error: (j || {}).error };
};
const S256 = (v) => crypto.createHash('sha256').update(v).digest('base64url');

// sběrač redirectů (jako by tu poslouchal mcp-remote/claude.ai)
let posledniCallback = null;
const catcher = http.createServer((req, res) => {
  // jen /callback — prohlížeč si po dopadnutí stáhne i /favicon.ico a ten by
  // zachycenou adresu s kódem přepsal (chytilo mě to: „callback OK" na obrazovce,
  // ale proměnná prázdná)
  if (req.url.startsWith('/callback')) {
    posledniCallback = new URL(req.url, `http://127.0.0.1:${CB_PORT}`);
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('callback OK');
});

(async () => {
  let browser;
  try {
    await new Promise((r) => catcher.listen(CB_PORT, '127.0.0.1', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 20505:8090 -e KB_PUBLIC_URL=${BASE} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    console.log('== discovery ==');
    const pr = await api('GET', '/.well-known/oauth-protected-resource');
    expect(pr.status === 200 && pr.json.resource === `${BASE}/mcp` && pr.json.authorization_servers[0] === BASE,
      'protected-resource metadata ukazuje na /mcp a náš AS');
    const as = await api('GET', '/.well-known/oauth-authorization-server');
    expect(as.status === 200 && as.json.registration_endpoint === `${BASE}/oauth/register`
      && as.json.code_challenge_methods_supported.includes('S256'), 'AS metadata: registrace + PKCE S256');
    const w401 = await fetch(`${BASE}/mcp`, { method: 'POST', body: '{}' });
    expect(String(w401.headers.get('www-authenticate') || '').includes('/.well-known/oauth-protected-resource'),
      '401 z /mcp ukazuje na resource metadata (vstup do OAuth flow)');

    console.log('== dynamic client registration ==');
    const reg = await api('POST', '/oauth/register', { body: { redirect_uris: [CB], client_name: 'Claude test' } });
    expect(reg.status === 201 && /^kbc_/.test(reg.json.client_id), `registrace klienta (${reg.json && reg.json.client_id})`);
    const CID = reg.json.client_id;
    const spatna = await api('POST', '/oauth/register', { body: { redirect_uris: ['http://evil.example.com/cb'] } });
    expect(spatna.status === 400, 'http redirect mimo localhost se odmítne');
    // consent MUSÍ vědět, kam kód poletí → client-info vrací redirect_uris
    const ci = await api('GET', `/oauth/client-info?client_id=${CID}`);
    expect(ci.status === 200 && Array.isArray(ci.json.redirect_uris) && ci.json.redirect_uris.includes(CB),
      'client-info vrací registrované redirect_uris (consent ukáže doménu)');

    console.log('== authorization code + PKCE (headless) ==');
    await api('POST', '/api/collections/users/records', { body: { email: 'o@x.cz', password: PW, passwordConfirm: PW } });
    const U = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'o@x.cz', password: PW } })).json.token;
    const verifier = crypto.randomBytes(32).toString('base64url');
    const ap = await api('POST', '/api/kb/oauth/approve', { token: U, body: {
      client_id: CID, redirect_uri: CB, state: 'st123', code_challenge: S256(verifier), code_challenge_method: 'S256', scope: 'read_write',
    } });
    expect(ap.status === 200 && String(ap.json.redirect).startsWith(CB), 'approve vydal redirect s kódem');
    const kod = new URL(ap.json.redirect).searchParams.get('code');
    expect(/^kbac_/.test(kod || ''), 'kód má prefix kbac_');
    expect(new URL(ap.json.redirect).searchParams.get('state') === 'st123', 'state se vrací beze změny');
    const ciziRedirect = await api('POST', '/api/kb/oauth/approve', { token: U, body: {
      client_id: CID, redirect_uri: 'http://127.0.0.1:9/jinam', code_challenge: S256(verifier), code_challenge_method: 'S256',
    } });
    expect(ciziRedirect.status === 400, 'neregistrovaná redirect_uri → 400 (žádný redirect s kódem)');
    const bezChallenge = await api('POST', '/api/kb/oauth/approve', { token: U, body: { client_id: CID, redirect_uri: CB } });
    expect(bezChallenge.status === 400, 'chybějící code_challenge → 400 (PKCE povinné)');
    // scope fail-CLOSED: neznámá hodnota se NEsmí tiše povýšit na read_write
    const spatnyScope = await api('POST', '/api/kb/oauth/approve', { token: U, body: {
      client_id: CID, redirect_uri: CB, code_challenge: S256(verifier), code_challenge_method: 'S256', scope: 'openid profile',
    } });
    expect(spatnyScope.status === 400 && spatnyScope.json.error === 'invalid_scope', 'neznámý scope → 400 (žádný tichý default na read_write)');

    console.log('== token endpoint ==');
    const spatnyVer = await api('POST', '/oauth/token', { form: true, body: {
      grant_type: 'authorization_code', code: kod, redirect_uri: CB, client_id: CID, code_verifier: 'jiny-verifier-uplne-spatny-ale-dost-dlouhy',
    } });
    expect(spatnyVer.status === 400 && spatnyVer.json.error === 'invalid_grant', 'špatný verifier → invalid_grant');
    // kód je jednorázový — po neúspěšném pokusu je SPÁLENÝ (obrana proti hádání) → nový approve
    const ap2 = await api('POST', '/api/kb/oauth/approve', { token: U, body: {
      client_id: CID, redirect_uri: CB, code_challenge: S256(verifier), code_challenge_method: 'S256', scope: 'read_write',
    } });
    const kod2 = new URL(ap2.json.redirect).searchParams.get('code');
    const tok = await api('POST', '/oauth/token', { form: true, body: {
      grant_type: 'authorization_code', code: kod2, redirect_uri: CB, client_id: CID, code_verifier: verifier,
    } });
    expect(tok.status === 200 && /^kb_user_/.test(tok.json.access_token), 'token endpoint vydal kb_user_ access token');
    expect(tok.json.token_type === 'Bearer' && tok.json.scope === 'read_write' && tok.json.expires_in > 0, 'odpověď nese type/scope/expiraci');
    const znovu = await api('POST', '/oauth/token', { form: true, body: {
      grant_type: 'authorization_code', code: kod2, redirect_uri: CB, client_id: CID, code_verifier: verifier,
    } });
    expect(znovu.status === 400, 'druhé použití kódu → chyba (jednorázovost)');
    const TOKEN = tok.json.access_token;

    console.log('== token reálně funguje na /mcp ==');
    const lm = await mcpCall(TOKEN, 'list_maps');
    expect(lm.result && !lm.result.isError, 'tools/call list_maps s OAuth tokenem projde');
    const keys = (await api('GET', '/api/kb/api-keys', { token: U })).json.keys;
    const oauthKey = keys.find((k) => /^OAuth:/.test(k.label));
    expect(!!oauthKey && oauthKey.scope === 'read_write' && !!oauthKey.expires_at,
      'token je vidět v API klíčích jako „OAuth: …" s expirací (revokace v UI)');
    // revokace v UI = konec přístupu; smazaný klíč /mcp odchytí lokálně → 401
    await api('POST', '/api/kb/api-keys/delete', { token: U, body: { id: oauthKey.id } });
    const poRevokaci = await mcpCall(TOKEN, 'list_maps');
    expect(poRevokaci.status === 401 || (poRevokaci.result && poRevokaci.result.isError),
      'po smazání klíče v UI token přestal platit (401)');
    // vymyšlený klíč správného formátu → 401 BEZ interního roundtripu (DoS brzda)
    const vymysleny = await mcpCall('kb_user_' + 'A'.repeat(40), 'list_maps');
    expect(vymysleny.status === 401, 'neexistující klíč správného formátu → 401 (odchycen lokálně)');

    console.log('== consent obrazovka v prohlížeči ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    // přihlášení vložením PB tokenu (stejný mechanismus jako SDK)
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    const record = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'o@x.cz', password: PW } })).json;
    await page.evaluate((tok, rec) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tok, record: rec }));
    }, record.token, record.record);
    const verifier2 = crypto.randomBytes(32).toString('base64url');
    await page.goto(`${BASE}/oauth/authorize?client_id=${CID}&redirect_uri=${encodeURIComponent(CB)}&state=ui1&code_challenge=${S256(verifier2)}&code_challenge_method=S256`,
      { waitUntil: 'networkidle2' });
    await sleep(800);
    const consentText = await page.evaluate(() => document.body.innerText);
    expect(/Claude test/.test(consentText), 'consent ukazuje jméno aplikace');
    expect(new URL(CB).host && consentText.includes(new URL(CB).host), 'consent ukazuje cílovou doménu (kam kód poletí)');

    // ÚTOK: přihlášený uživatel dostane odkaz s NEregistrovanou redirect_uri
    // (open redirect / javascript:). Stránka NESMÍ nabídnout tlačítka (ani Odmítnout,
    // které dřív navigovalo na redirect_uri z URL bez ověření).
    const utok = await browser.newPage();
    await utok.evaluateOnNewDocument((tok, rec) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tok, record: rec })), record.token, record.record);
    await utok.goto(`${BASE}/oauth/authorize?client_id=${CID}&redirect_uri=${encodeURIComponent('https://evil.example.com/cb')}&code_challenge=${S256(verifier2)}&code_challenge_method=S256`,
      { waitUntil: 'networkidle2' });
    await sleep(1200);
    const utokMaTlacitka = await utok.evaluate(() => !!document.querySelector('[data-testid="oauth-approve"]')
      || [...document.querySelectorAll('button')].some((b) => /Odmítnout|Deny/i.test(b.textContent || '')));
    expect(!utokMaTlacitka, 'neregistrovaná redirect_uri → žádná tlačítka (deny nenaviguje na cizí adresu)');
    await utok.close();
    posledniCallback = null;
    await page.waitForSelector('[data-testid="oauth-approve"]:not([disabled])', { timeout: 10000 });
    await page.click('[data-testid="oauth-approve"]');
    for (let i = 0; i < 30 && !posledniCallback; i++) await sleep(500);
    expect(!!posledniCallback && !!posledniCallback.searchParams.get('code') && posledniCallback.searchParams.get('state') === 'ui1',
      'klik na Povolit doručil kód na callback (jako u claude.ai)');
    if (posledniCallback) {
      const tok2 = await api('POST', '/oauth/token', { form: true, body: {
        grant_type: 'authorization_code', code: posledniCallback.searchParams.get('code'),
        redirect_uri: CB, client_id: CID, code_verifier: verifier2,
      } });
      expect(tok2.status === 200 && /^kb_user_/.test(tok2.json.access_token), 'kód z prohlížeče jde vyměnit za token');
    }
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 250));
  } finally {
    if (browser) await browser.close();
    catcher.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
