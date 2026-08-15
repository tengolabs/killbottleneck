// Fakturační údaje + objednávka členství převodem (Richard 8. 8. 2026).
//
// Co se hlídá (mutačně, ne jen šťastná cesta):
//  - billing čte/píše JEN admin (člen dostane 403),
//  - whitelist: cizí pole se do uložených údajů NEdostane,
//  - objednávka převodem BEZ kompletních údajů → 400 billing_required
//    (přesně tohle je „povinné až při objednávce, ne při registraci"),
//  - převodem jde JEN roční tarif (měsíční/čtvrtletní 400),
//  - objednávka letí na bránu /v1/orders pod zákaznickým tokenem instance
//    a nese fakturační údaje (mock brány to zachytí),
//  - payment_links z KB_PAYMENT_LINKS jdou do /api/kb/config.
const { execSync } = require('child_process');
const http = require('http');

const PORT = 20570;
const BRANA_PORT = 20571;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-billing';
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

// mock AI brány: zachytí POST /v1/orders (hlavičky + tělo), vrátí order_id
const zachycene = [];
const brana = http.createServer((req, res) => {
  let telo = '';
  req.on('data', (d) => { telo += d; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/v1/orders') {
      zachycene.push({ token: req.headers['x-kb-token'], body: JSON.parse(telo || '{}') });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ order_id: 42, amount: 290, currency: 'CZK' }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
});

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

const zaloz = (email) => api('POST', '/api/collections/users/records',
  { body: { email, password: HESLO, passwordConfirm: HESLO, setup_code: 'e2e-kod' } });
const prihlas = async (email) => (await api('POST', '/api/collections/users/auth-with-password',
  { body: { identity: email, password: HESLO } })).json?.token;

(async () => {
  try {
    brana.listen(BRANA_PORT);
    const AI = `-e FLOWMAP_AI_PROVIDER=api -e FLOWMAP_AI_URL=http://host.docker.internal:${BRANA_PORT}/v1/advisor -e FLOWMAP_AI_TOKEN=kb_test_billing`;
    const LINKS = `-e KB_PAYMENT_LINKS='{"cloud-lite-year":"https://buy.stripe.com/test_abc"}'`;
    // KB_SETUP_CODE: hostovaný box bez kódu má od 11. 8. registraci FAIL-CLOSED
    // (ochrana nezabraných subdomén) — reálný box kód má vždy, sada taky
    await start(`${AI} ${LINKS} -e KB_HOSTED=1 -e KB_SETUP_CODE=e2e-kod`);

    console.log('== přístup: billing jen pro admina ==');
    await zaloz('admin@e2e.cz');           // první účet = admin
    await zaloz('clen@e2e.cz');
    const admin = await prihlas('admin@e2e.cz');
    const clen = await prihlas('clen@e2e.cz');
    expect(!!admin && !!clen, 'oba účty přihlášeny');
    let r = await api('GET', '/api/kb/billing', { token: clen });
    expect(r.status === 403, `člen billing NEPŘEČTE (${r.status})`);
    r = await api('POST', '/api/kb/billing', { token: clen, body: { company: 'Hack' } });
    expect(r.status === 403, `člen billing NEZAPÍŠE (${r.status})`);
    r = await api('GET', '/api/kb/billing', { token: admin });
    expect(r.status === 200 && r.json.complete === false, 'admin čte; čerstvá instance = nekompletní');

    console.log('== objednávka bez údajů = 400 (povinné až při objednávce) ==');
    r = await api('POST', '/api/kb/order-transfer', { token: admin, body: { tier: 'cloud-lite', period: 'year' } });
    expect(r.status === 400 && r.json.code === 'billing_required',
      `bez fakturačních údajů objednávka NEPROJDE (${r.status}/${r.json?.code})`);
    expect(zachycene.length === 0, 'na bránu nic neodešlo');

    console.log('== uložení údajů: whitelist + validace ==');
    r = await api('POST', '/api/kb/billing', { token: admin,
      body: { company: 'Pekárna U Krásy s.r.o.', ico: '12345678', street: 'Hlavní 1',
              city: 'Praha', zip: '110 00', email: 'ne-email', hack: 'x' } });
    expect(r.status === 400, `neplatný e-mail odmítnut (${r.status})`);
    r = await api('POST', '/api/kb/billing', { token: admin,
      body: { company: 'Pekárna U Krásy s.r.o.', ico: '12345678', street: 'Hlavní 1',
              city: 'Praha', zip: '110 00', email: 'ucetni@pekarna.cz', hack: 'x' } });
    expect(r.status === 200 && r.json.complete === true, 'kompletní údaje uloženy');
    r = await api('GET', '/api/kb/billing', { token: admin });
    expect(r.json.billing.company === 'Pekárna U Krásy s.r.o.' && r.json.billing.hack === undefined,
      'whitelist: cizí pole se NEuložilo');

    console.log('== převodem jen roční ==');
    r = await api('POST', '/api/kb/order-transfer', { token: admin, body: { tier: 'cloud-lite', period: 'month' } });
    expect(r.status === 400, `měsíční převodem NEJDE (${r.status})`);
    r = await api('POST', '/api/kb/order-transfer', { token: admin, body: { tier: 'privat-standard', period: 'year' } });
    expect(r.status === 400, `Privát (měsíční tarif) převodem NEJDE (${r.status})`);
    // AI se u nás nekupuje (odstraněno 15. 8. 2026) — návrat tarifu do
    // whitelistu na serveru musí tenhle řádek rozsvítit.
    r = await api('POST', '/api/kb/order-transfer', { token: admin, body: { tier: 'ai-solo', period: 'year' } });
    expect(r.status === 400, `zrušený tarif ai-solo NEJDE objednat (${r.status})`);
    r = await api('POST', '/api/kb/order-transfer', { token: clen, body: { tier: 'cloud-lite', period: 'year' } });
    expect(r.status === 403, `člen objednávku NEPOŠLE (${r.status})`);

    console.log('== platná objednávka → brána ==');
    r = await api('POST', '/api/kb/order-transfer', { token: admin, body: { tier: 'cloud-lite', period: 'year' } });
    expect(r.status === 200 && r.json.order?.order_id === 42, `objednávka prošla (${r.status})`);
    expect(zachycene.length === 1, 'brána dostala právě jednu objednávku');
    const z = zachycene[0] || {};
    expect(z.token === 'kb_test_billing', 'letěla pod zákaznickým tokenem instance');
    expect(z.body?.tier === 'cloud-lite' && z.body?.period === 'year', 'nese tarif a období');
    expect(z.body?.billing?.company === 'Pekárna U Krásy s.r.o.' && z.body?.billing?.zip === '110 00',
      'nese fakturační údaje');

    console.log('== payment_links v /config ==');
    r = await api('GET', '/api/kb/config');
    expect(r.json?.payment_links?.['cloud-lite-year'] === 'https://buy.stripe.com/test_abc',
      'KB_PAYMENT_LINKS se propíše do /api/kb/config');
  } catch (err) {
    fail += 1;
    console.log(`  ❌ neočekávaná chyba: ${err.message}`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    brana.close();
  }
  console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
