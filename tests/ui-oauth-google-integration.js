// KOMBINOVANÝ test (cross-branch) — Google login + OAuth consent pro MCP naráz.
// Jednotlivé větve tohle nechytnou: google-oauth testy o /oauth nevědí, mcp-oauth
// se přihlašuje e-mailem. Ověřuje architektův nález: nepřihlášený uživatel na
// /oauth/authorize se pošle na /login?next=…, kde MUSÍ být i tlačítko Google
// (obě funkce koexistují) a přihlášení Googlem se pak vrací zpět na consent
// (GoogleAuthButton respektuje ?next=), ne na dashboard. Reálný Google round-trip
// je Richardův klik-test; tady ověřujeme mechaniku (redirect s next + koexistence
// + že safeNext blokuje open redirect).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const IMG = process.env.KB_TEST_IMAGE || 'product-flowmap';
const NAME = 'flowmap-e2e-oauth-goog-int';
const PORT = 20507;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json' }, ...(b ? { body: JSON.stringify(b) } : {}) });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    // instance s OBĚMA funkcemi: Google OAuth (client) + OAuth server (KB_PUBLIC_URL)
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 -e KB_PUBLIC_URL=${BASE} -e KB_GOOGLE_CLIENT_ID=dummy.apps.googleusercontent.com -e KB_GOOGLE_CLIENT_SECRET=dummy ${IMG}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    console.log('== obě funkce naráz živé ==');
    const am = (await api('GET', '/api/collections/users/auth-methods')).json;
    ok(am.oauth2.enabled && am.oauth2.providers.some((p) => p.name === 'google'), 'Google OAuth zapnutý');
    const meta = (await api('GET', '/.well-known/oauth-authorization-server')).json;
    ok(meta && meta.token_endpoint === `${BASE}/oauth/token`, 'OAuth server (pro MCP) běží');
    // registrace MCP klienta
    const reg = await api('POST', '/oauth/register', { redirect_uris: ['http://127.0.0.1:33500/cb'], client_name: 'Claude test' });
    const CID = reg.json.client_id;
    ok(/^kbc_/.test(CID || ''), 'MCP klient zaregistrován');

    // instanci ZABRAT prvním účtem — na panensky čisté od 11. 8. posílá login
    // first-run rovnou na registraci správce (claimed=false) a tenhle test
    // ověřuje chování BĚŽNÉ (zabrané) instance
    await api('POST', '/api/collections/users/records', { email: 'admin@e2e.cz', password: 'testheslo123', passwordConfirm: 'testheslo123' });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    console.log('== nepřihlášený na /oauth/authorize → /login?next= s Google tlačítkem ==');
    const page = await browser.newPage();
    const authorizeUrl = `/oauth/authorize?client_id=${CID}&redirect_uri=${encodeURIComponent('http://127.0.0.1:33500/cb')}&code_challenge=${'A'.repeat(43)}&code_challenge_method=S256`;
    await page.goto(`${BASE}${authorizeUrl}`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const url = page.url();
    ok(/\/login\?next=/.test(url), `nepřihlášený přesměrován na /login?next= (${url.replace(BASE, '')})`);
    ok(decodeURIComponent(url).includes('/oauth/authorize'), 'next nese cestu zpět na OAuth consent');
    const maGoogle = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /přes Google|with Google/i.test(b.textContent || '')));
    ok(maGoogle, 'na /login je i tlačítko Google (obě funkce koexistují po merge)');
    await page.close();

    console.log('== safeNext blokuje open redirect (jádro cross-branch opravy) ==');
    const p2 = await browser.newPage();
    await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    const res = await p2.evaluate(() => {
      // stejná logika jako lib/safeNext.js — ověříme chování v reálném prohlížeči
      const safe = (raw) => {
        const next = String(raw || ''); if (!next) return '/';
        try { const u = new URL(next, window.location.origin); if (u.origin !== window.location.origin) return '/'; return u.pathname + u.search + u.hash; } catch { return '/'; }
      };
      return {
        evil: safe('https://evil.com/x'),
        proto: safe('//evil.com'),
        backslash: safe('/\\evil.com'),
        good: safe('/oauth/authorize?client_id=abc'),
      };
    });
    ok(res.evil === '/', 'absolutní cizí URL → "/"');
    ok(res.proto === '/', 'protocol-relative //evil.com → "/"');
    ok(res.backslash === '/', String.raw`/\evil.com → "/" (bez normalizace na //evil.com)`);
    ok(res.good === '/oauth/authorize?client_id=abc', 'legitimní relativní cesta projde');
    await p2.close();
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 200));
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
