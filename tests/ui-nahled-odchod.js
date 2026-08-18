// UI e2e: ODCHOD Z NÁHLEDU ŠABLONY NA SKUTEČNOU MAPU (nález panelu 17. 8. 2026)
//
// Vada (PŘED opravou, tichá ztráta dat): `setIsTemplatePreview(false)` bylo
// v editoru na JEDINÉM místě — uvnitř „Použít šablonu". Route `/map/:id` nemá
// `key`, takže přechod z náhledu (/map/new) rovnou na jinou mapu (panáček →
// Organizační struktura) komponentu NEPŘEMOUNTUJE a příznak náhledu přežije.
// Následek: nad REÁLNOU mapou zůstane vypnutý autosave (podmínka v efektu
// autosave) — uživatel edituje, aplikace nic neuloží a NIC o tom neřekne.
// Navíc nad cizí mapou visí lišta „Náhled šablony" s tlačítkem Použít šablonu.
//
// Sada jede přesně tu cestu a měří následek, ne příznak: po odchodu přidá
// pozici a čte mapu Z API. Na obrazu PŘED opravou musí být rudá.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-nahled-odchod';
const PORT = 20802;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'sef@example.com', password: PW, passwordConfirm: PW } }); // první = admin
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;
    // org mapa je jediná mapa dosažitelná z editoru JEDNÍM klikem (panáček →
    // Organizační struktura) — tedy bez přemountování komponenty. Přesně ta
    // cesta, na které vada vzniká.
    const org = (await api('POST', '/api/kb/org-map', { token: SEF, body: {} })).json;
    const orgId = org.map && org.map.id;
    ok(!!orgId, `org mapa založena (${orgId || 'nevznikla'})`);
    const orgPred = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: SEF })).json;
    const uzluPred = (orgPred.nodes || []).length;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);

    console.log('== náhled šablony otevřen ==');
    await page.goto(`${BASE}/?view=templates`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Otevřít šablonu/.test(b.textContent || '')), { timeout: 45000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Otevřít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
    ok(await page.evaluate(() => document.body.innerText.includes('Náhled šablony')), 'lišta náhledu svítí');
    ok(page.url().includes('/map/new'), `náhled běží na /map/new (${page.url().split(BASE)[1]})`);

    console.log('== odchod na skutečnou mapu JEDNÍM klikem (bez přemountování) ==');
    await page.click('[data-user-menu]'); // reálná myš — Radix menu neposlouchá programový click
    await sleep(700);
    const polozka = await page.$('[data-testid="menu-org-structure"]');
    ok(!!polozka, 'panáček nabízí Organizační strukturu i z náhledu');
    if (polozka) { await polozka.click(); }
    await page.waitForFunction((id) => window.location.pathname === `/map/${id}`, { timeout: 20000 }, orgId);
    await page.waitForSelector('.react-flow__node-apexNode', { timeout: 45000 });
    await sleep(2000);

    console.log('== příznak náhledu je pryč ==');
    ok(await page.evaluate(() => !document.body.innerText.includes('Náhled šablony')),
      'lišta „Náhled šablony" nad cizí mapou NEVISÍ');
    ok(await page.evaluate(() => ![...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || ''))),
      'tlačítko „Použít šablonu" nad cizí mapou NEVISÍ');

    console.log('== a hlavně: úpravy skutečné mapy se UKLÁDAJÍ (jádro vady) ==');
    // „+ pozice" na vrcholu = běžná úprava mapy; na obrazu před opravou ji
    // autosave zahodí, protože si myslí, že jsme pořád v náhledu šablony.
    await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node-apexNode');
      [...(el?.querySelectorAll('button') || [])].find((b) => (b.title || '').includes('pozice'))?.click();
    });
    await sleep(1200);
    ok(await page.evaluate(() => document.body.innerText.includes('Nová pozice')), 'pozice přibyla na plátně');
    await sleep(4000); // autosave je debounced 1,2 s + kolečko požadavku
    const orgPo = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: SEF })).json;
    const uzluPo = (orgPo.nodes || []).length;
    ok(uzluPo === uzluPred + 1,
      `úprava se ULOŽILA — mapa má o uzel víc (${uzluPred} → ${uzluPo}; před opravou zůstávalo ${uzluPred})`);
    ok((orgPo.nodes || []).some((n) => /Nová pozice/.test(String((n.data || {}).title || ''))),
      'a je to opravdu ta nová pozice, ne jiná změna');

    const zavazne = errs.filter((e) => !/favicon|manifest/i.test(e));
    ok(zavazne.length === 0, `konzole bez chyb (${zavazne.length}${zavazne.length ? ': ' + zavazne[0].slice(0, 120) : ''})`);
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-NAHLED-ODCHOD PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
