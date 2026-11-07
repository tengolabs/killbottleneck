// UI e2e (telefon): rychlý zápis v lite nabízí JEN projekty, kam smím zapsat.
// Analýza funkcí 5. 11. 2026: „Lite nabídne novému členovi cizí projekt k zápisu"
// — seznam bral všechny projekty bez ohledu na práva a zápis do projektu jen ke
// čtení skončil anglickou hláškou „The requested resource wasn't found".
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const PORT = 20534;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'flowmap-e2e-ui-lite-prava';
const PW = 'testheslo123';
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', 'Accept-Language': 'cs', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* prázdná odpověď */ }
  return { status: res.status, json };
};
const register = async (email) => {
  await api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW, language: 'cs' } });
  const r = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  return { token: r.json.token, record: r.json.record, id: r.json.record.id, email };
};
const mapa = async (who, title) => (await api('POST', '/api/collections/goalmaps/records', { token: who.token, body: {
  title, owner: who.id, owner_email: who.email,
  nodes: [{ id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } }],
  edges: [],
} })).json;

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d -e KB_RATE_LIMITS=0 -e KB_PURPOSE_ASK=0 --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const sef = await register('sef@lite.cz');
    const clen = await register('clen@lite.cz');
    const jenCteni = await mapa(sef, 'JEN-KE-CTENI');
    const upravovat = await mapa(sef, 'K-UPRAVE');
    const prace = await mapa(sef, 'JEN-PRACE');
    const tymova = await mapa(sef, 'TYMOVA-EDIT');
    const moje = await mapa(clen, 'MOJE-VLASTNI');
    expect(!!jenCteni.id && !!upravovat.id && !!prace.id && !!tymova.id && !!moje.id, 'pět map založených');
    let r = await api('POST', '/api/kb/share', { token: sef.token, body: { action: 'share', mapId: jenCteni.id, email: clen.email, permission: 'read' } });
    expect(r.status === 200, `sdílení ke čtení (${r.status})`);
    r = await api('POST', '/api/kb/share', { token: sef.token, body: { action: 'share', mapId: upravovat.id, email: clen.email, permission: 'edit' } });
    expect(r.status === 200, `sdílení k úpravě (${r.status})`);
    r = await api('POST', '/api/kb/share', { token: sef.token, body: { action: 'share', mapId: prace.id, email: clen.email, permission: 'work' } });
    expect(r.status === 200, `sdílení k práci (${r.status})`);
    r = await api('POST', '/api/kb/share', { token: sef.token, body: { action: 'set_team_access', mapId: tymova.id, access: 'edit' } });
    expect(r.status === 200, `týmový přístup edit (${r.status} ${JSON.stringify(r.json).slice(0, 80)})`);
    await sleep(500);
    // kontrola předpokladu: člen opravdu NEMŮŽE zapsat do mapy jen ke čtení (jinak by test nic nedokazoval)
    const jc = (await api('GET', `/api/collections/goalmaps/records/${jenCteni.id}`, { token: clen.token })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${jenCteni.id}`, { token: clen.token, body: { description: 'x', base_updated: jc.updated } });
    expect(r.status === 404 || r.status === 403, `zápis do mapy jen ke čtení server odmítá (${r.status})`);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport(PHONE);
    const chyby = [];
    page.on('pageerror', (e) => chyby.push(String(e)));
    await page.evaluateOnNewDocument((t, rec) => {
      localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: rec }));
      localStorage.setItem('kb-lang', 'cs');
    }, clen.token, clen.record);
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const fab = await page.$('button[aria-label="Nový úkol"]');
    expect(!!fab, 'plovoucí tlačítko Nový úkol');
    await fab.click();
    await page.waitForSelector('form select', { timeout: 15000 });
    await sleep(800);
    const volby = await page.$$eval('form select option', (os) => os.map((o) => o.textContent.trim()));
    console.log('  projekty v nabídce:', volby.join(' | '));
    expect(volby.includes('MOJE-VLASTNI'), 'vlastní projekt v nabídce je');
    expect(volby.includes('K-UPRAVE'), 'projekt s právem Upravovat v nabídce je');
    expect(volby.includes('TYMOVA-EDIT'), 'týmový projekt (edit) v nabídce je');
    expect(!volby.includes('JEN-KE-CTENI'), 'projekt jen ke čtení se NENABÍZÍ');
    expect(!volby.includes('JEN-PRACE'), 'projekt jen k práci (work) se NENABÍZÍ (zápis nového uzlu by neprošel)');
    // a zápis do nabízeného projektu opravdu projde
    const hodnota = await page.$$eval('form select option', (os) => (os.find((o) => o.textContent.trim() === 'K-UPRAVE') || {}).value);
    await page.select('form select', hodnota);
    await page.type('form input[type="text"], form input:not([type])', 'LITE-ZAPIS-DO-SDILENE');
    const tlacitka = await page.$$('form button');
    for (const b of tlacitka) { if ((await b.evaluate((el) => el.innerText || '')).includes('Přidat')) { await b.click(); break; } }
    await sleep(3000);
    const up = (await api('GET', `/api/collections/goalmaps/records/${upravovat.id}`, { token: sef.token })).json;
    expect((up.nodes || []).some((n) => (n.data || {}).title === 'LITE-ZAPIS-DO-SDILENE'), 'zápis do sdíleného projektu s právem Upravovat se uložil');
    expect(chyby.length === 0, `stránka bez výjimek (${chyby.length})`);
  } catch (err) {
    fail++; console.log('  ❌ výjimka:', err.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
