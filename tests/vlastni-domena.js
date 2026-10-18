// Vlastní doména hostované instance (KB Cloud Pro / AI Agent, 13. 10. 2026).
//
// Co se hlídá (i nešťastné cesty):
//  - sekce je jen pro správce (člen 403) a jen tam, kde ji provisioning připravil,
//  - špatná / naše doména → 400 bez jakékoli akce,
//  - apex (firma.cz) dostane A na IP serveru, subdoména CNAME na <slug>.srv,
//  - DNS nesedí → žádost na bránu NEODEJDE; sedí → odejde pod zákaznickým tokenem,
//  - brzda kontroly (1× za 10 s), „probíhá" z brány (409) se ukáže jako busy,
//  - /api/kb/config nese plan / slug / portal_url / custom_domain_enabled,
//  - výjimka SSRF guardu pro adaptér agenta je ÚZKÁ (jen kb-portal:8100),
//  - OAuth discovery vrací adresu, na kterou se klient ptá — jen ze známých adres.
const { execSync } = require('child_process');
const http = require('http');

const PORT = 20590;
const BRANA_PORT = 20591;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-vlastni-domena';
const HESLO = 'TestHeslo.2026';
const IP = '203.0.113.42';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const spi = (ms) => new Promise((r) => setTimeout(r, ms));

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

// GET s vlastní hlavičkou Host (fetch ji přepsat nedovolí)
function sHostem(path, host) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, headers: { Host: host } }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; });
      res.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { resolve({}); } });
    }).on('error', reject);
  });
}

// mock brány (/v1/domain) + DoH resolveru (/dns?name=…&type=A)
const zachycene = [];
let dnsSedi = false;
let branaBusy = false;
const brana = http.createServer((req, res) => {
  let telo = '';
  req.on('data', (d) => { telo += d; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const json = (code, b) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/dns') {
      const ans = dnsSedi ? [{ type: 5, data: 'pekarna.srv.killbottleneck.com.' }, { type: 1, data: IP }] : [];
      return json(200, { Status: 0, Answer: ans });
    }
    if (u.pathname === '/v1/domain' && req.method === 'POST') {
      zachycene.push({ token: req.headers['x-kb-token'], body: JSON.parse(telo || '{}') });
      if (branaBusy) return json(409, { detail: { error: 'busy', code: 'busy', request: { id: 1, status: 'working' } } });
      const b = JSON.parse(telo || '{}');
      return json(200, { request: { id: 7, action: b.action, domain: b.domain, status: 'queued', error: '' } });
    }
    if (u.pathname === '/v1/domain' && req.method === 'GET') return json(200, { request: null });
    json(404, {});
  });
});

async function start(env) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway ${env} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`,
    { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch (e) { /* ještě ne */ }
    await spi(1000);
  }
  throw new Error('kontejner nenaskočil');
}

const zaloz = (email) => api('POST', '/api/collections/users/records',
  { body: { email, password: HESLO, passwordConfirm: HESLO, setup_code: 'e2e-kod' } });
const prihlas = async (email) => (await api('POST', '/api/collections/users/auth-with-password',
  { body: { identity: email, password: HESLO } })).json?.token;

(async () => {
  try {
    brana.listen(BRANA_PORT);
    const H = `http://host.docker.internal:${BRANA_PORT}`;
    await start([
      `-e KB_AI_PROVIDER=api -e KB_AI_URL=${H}/v1/advisor -e KB_AI_TOKEN=kb_test_domena`,
      '-e KB_HOSTED=1 -e KB_SETUP_CODE=e2e-kod -e KB_PLAN=agent -e KB_ORG_SLUG=pekarna',
      '-e KB_PORTAL_URL=/portal -e KB_PUBLIC_URL=https://pekarna.killbottleneck.com',
      '-e KB_SLUG_DOMAIN=pekarna.killbottleneck.com -e KB_CUSTOM_DOMAIN_TARGET=pekarna.srv.killbottleneck.com',
      `-e KB_SERVER_IP=${IP} -e KB_DOH_URLS=${H}/dns -e KB_PRIVATE_WEBHOOK_HOSTS=kb-portal:8100`,
      // jako na serveru: služby compose sítě se překládají na privátní adresy
      '--add-host=kb-portal:172.18.0.5 --add-host=kb-app:172.18.0.6',
    ].join(' '));

    console.log('== /api/kb/config ==');
    let r = await api('GET', '/api/kb/config');
    expect(r.json?.plan === 'agent' && r.json?.slug === 'pekarna' && r.json?.portal_url === '/portal'
      && r.json?.custom_domain_enabled === true, `plan/slug/portal_url/custom_domain_enabled (${JSON.stringify([r.json?.plan, r.json?.slug, r.json?.portal_url, r.json?.custom_domain_enabled])})`);

    console.log('== přístup ==');
    await zaloz('admin@e2e.cz'); await zaloz('clen@e2e.cz');
    const admin = await prihlas('admin@e2e.cz');
    const clen = await prihlas('clen@e2e.cz');
    r = await api('GET', '/api/kb/custom-domain', { token: clen });
    expect(r.status === 403, `člen sekci NEVIDÍ (${r.status})`);
    r = await api('POST', '/api/kb/custom-domain/check', { token: clen, body: { domain: 'ukoly.firma.cz' } });
    expect(r.status === 403, `člen doménu NEPŘEPNE (${r.status})`);
    r = await api('GET', '/api/kb/custom-domain');
    expect(r.status === 401, `bez přihlášení 401 (${r.status})`);
    r = await api('GET', '/api/kb/custom-domain', { token: admin });
    expect(r.status === 200 && r.json?.available === true && r.json?.target === 'pekarna.srv.killbottleneck.com',
      'správce vidí sekci a cíl CNAME');

    console.log('== záznamy ==');
    for (const zla of ['killbottleneck.com', 'x.killbottleneck.cz', 'localhost', '10.0.0.5', 'a b.cz', 'ukoly.firma.cz/x']) {
      r = await api('POST', '/api/kb/custom-domain/records', { token: admin, body: { domain: zla } });
      expect(r.status === 400 && r.json?.error_code === 'bad_domain', `'${zla}' → 400 bad_domain`);
    }
    r = await api('POST', '/api/kb/custom-domain/records', { token: admin, body: { domain: 'Ukoly.Firma.cz.' } });
    const z = r.json?.records || [];
    expect(r.json?.domain === 'ukoly.firma.cz' && !r.json?.apex
      && z[0]?.type === 'CNAME' && z[0]?.value === 'pekarna.srv.killbottleneck.com'
      && z[1]?.name === 'agent.ukoly.firma.cz' && z[1]?.type === 'CNAME', 'subdoména: dva CNAME na <slug>.srv');
    r = await api('POST', '/api/kb/custom-domain/records', { token: admin, body: { domain: 'firma.cz' } });
    expect(r.json?.apex === true && r.json?.records?.[0]?.type === 'A' && r.json?.records?.[0]?.value === IP
      && r.json?.records?.[1]?.type === 'CNAME', 'apex: A na IP serveru + CNAME pro agent.');
    expect(zachycene.length === 0, 'zatím nic na bránu');

    console.log('== kontrola DNS ==');
    r = await api('POST', '/api/kb/custom-domain/check', { token: admin, body: { domain: 'ukoly.firma.cz' } });
    expect(r.status === 200 && r.json?.requested === false && r.json?.checks?.every((c) => !c.ok && c.error === 'missing'),
      `DNS chybí → nic se neposílá (${JSON.stringify(r.json?.checks?.map((c) => c.error))})`);
    expect(zachycene.length === 0, 'brána nedostala nic');
    r = await api('POST', '/api/kb/custom-domain/check', { token: admin, body: { domain: 'ukoly.firma.cz' } });
    expect(r.status === 429 && r.json?.error_code === 'too_often', `hned znovu → 429 brzda (${r.status})`);
    await spi(10500);
    dnsSedi = true;
    r = await api('POST', '/api/kb/custom-domain/check', { token: admin, body: { domain: 'ukoly.firma.cz' } });
    expect(r.status === 200 && r.json?.requested === true && r.json?.checks?.every((c) => c.ok), 'DNS sedí → žádost odešla');
    expect(zachycene.length === 1 && zachycene[0].token === 'kb_test_domena'
      && zachycene[0].body.action === 'set' && zachycene[0].body.domain === 'ukoly.firma.cz',
    'na bránu: set ukoly.firma.cz pod zákaznickým tokenem');

    console.log('== probíhá / odpojení ==');
    await spi(10500);
    branaBusy = true;
    r = await api('POST', '/api/kb/custom-domain/remove', { token: admin, body: {} });
    expect(r.status === 409 && r.json?.error_code === 'busy', `brána „probíhá" → 409 busy (${r.status})`);
    branaBusy = false;
    await spi(10500);
    r = await api('POST', '/api/kb/custom-domain/remove', { token: admin, body: {} });
    expect(r.status === 200 && zachycene[zachycene.length - 1].body.action === 'remove', 'odpojení → remove na bránu');

    console.log('== výjimka SSRF guardu pro adaptér agenta ==');
    const agent = (url) => api('POST', '/api/kb/ai-agents/save', { token: admin,
      body: { name: `A ${Math.random()}`, webhook_url: url, secret: 'tajne-tajne', enabled: true } });
    r = await agent('http://kb-portal:8100/portal/hook/kb-hermes-abc');
    expect(r.status === 200, `kb-portal:8100 (adaptér) se uložit smí (${r.status})`);
    for (const url of ['http://kb-portal:8101/x', 'http://kb-portal/x', 'http://kb-app:8090/x',
      'http://10.0.0.5:8100/x', 'http://kb-portal:8100@169.254.169.254/x', 'http://169.254.169.254/latest']) {
      r = await agent(url);
      expect(r.status === 400, `${url} → 400 (výjimka je jen pro kb-portal:8100)`);
    }

    console.log('== OAuth discovery na dvou adresách (po přepnutí na vlastní doménu) ==');
    // stav PO přepnutí: adresa instance = vlastní doména, slug adresa dál běží
    await start([
      '-e KB_HOSTED=1 -e KB_SETUP_CODE=e2e-kod -e KB_SLUG_DOMAIN=pekarna.killbottleneck.com',
      '-e KB_CUSTOM_DOMAIN=ukoly.firma.cz -e KB_PUBLIC_URL=https://ukoly.firma.cz',
    ].join(' '));
    let m = await sHostem('/.well-known/oauth-authorization-server', 'pekarna.killbottleneck.com');
    expect(m.issuer === 'https://pekarna.killbottleneck.com', `dotaz na slug adresu → issuer na ní, konektor z doby před přepnutím sedí (${m.issuer})`);
    m = await sHostem('/.well-known/oauth-authorization-server', 'ukoly.firma.cz');
    expect(m.issuer === 'https://ukoly.firma.cz', `dotaz na vlastní doménu → issuer na ní (${m.issuer})`);
    m = await sHostem('/.well-known/oauth-authorization-server', 'utocnik.example.com');
    expect(m.issuer === 'https://ukoly.firma.cz', `cizí Host → adresa instance, ne z hlavičky (${m.issuer})`);
  } catch (err) {
    fail += 1;
    console.log(`  ❌ neočekávaná chyba: ${err.message}`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    brana.close();
  }
  console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
