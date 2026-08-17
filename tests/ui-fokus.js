// UI e2e: denní fokus — JEDEN nejdůležitější úkol na dnes a jeden na zítra.
//
// Ověřuje: označení hvězdičkou z řádkových akcí (panel Můj den), badge + plavání
// na začátek sekce, přežití reloadu i uložení k účtu, že označení jiného řádku
// to předchozí NAHRADÍ (vždy max jeden na den), zítřek vedle dneška, hvězdu
// v lite režimu a serverovou sanitizaci (staré datumové klíče vyprší).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20530';
const NAME = 'flowmap-e2e-ui-fokus';
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// klik na hvězdu v řádku s daným titulkem + volba dne v rozbalovátku
async function markFocus(page, title, when) {
  const btn = await page.evaluateHandle((tt) => {
    const rows = [...document.querySelectorAll('div')].filter((el) =>
      (el.innerText || '').includes(tt) && el.querySelector('[data-focus-btn]'));
    const row = rows[rows.length - 1];
    return row ? row.querySelector('[data-focus-btn]') : null;
  }, title);
  if (!btn.asElement()) return false;
  await btn.asElement().click();
  await sleep(300);
  const opt = await page.$(`[data-focus-when="${when}"]`);
  if (!opt) return false;
  await opt.click();
  await sleep(1200);
  return true;
}

const badgeInfo = (page) => page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll('[data-focus-badge]')) {
    const row = b.closest('div');
    out.push({ when: b.getAttribute('data-focus-badge'), text: (row?.innerText || '').slice(0, 40) });
  }
  return out;
});

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20530:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
        // Chyby z GOOGLE FONTS nejsou vada aplikace. `index.css:1` tahá písma
    // z internetu a při bourání docker kontejnerů se požadavek utne — sada
    // pak padala na „konzole bez chyb" pokaždé jinde (nález 12. 8. 2026).
    // ⚠️ Vyloučen je JEN tenhle známý původce, ne „všechno cizí": jinak by
    // regrese přestala hlídat i chyby cloudové brány api.killbottleneck.com,
    // tedy zrovna to, na čem cloud stojí. Adresa NENÍ v textu hlášky, je
    // v m.location().url — starý filtr na 'favicon' proto nikdy nic nefiltroval.
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewport({ width: 1440, height: 950 });

    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'fokus@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(1500);

    const today = new Date().toLocaleDateString('en-CA');
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    await page.evaluate(async (today) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const m = await (await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          title: 'FOKUS-PROJEKT',
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'FOKUS-PROJEKT', title: 'FOKUS-PROJEKT', status: 'todo' } },
            // úkol musí ležet na uzlu → neutrální krok (bez ownera/termínu, ať nehne čísly sekcí)
            { id: 'krok', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo' } },
          ],
          edges: [{ id: 'e1', source: 'apex', target: 'krok' }],
        }),
      })).json();
      const su = await (await fetch('/api/collections/_superusers/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'su@e2e.local', password: 'supersu12345' }) })).json();
      const HS = { 'Content-Type': 'application/json', Authorization: su.token };
      const myId = (auth.record || auth.model || {}).id;
      const mk = (b) => fetch('/api/collections/tasks/records', { method: 'POST', headers: HS, body: JSON.stringify({ map: m.id, node_id: 'krok', owner: myId, owner_email: 'fokus@e2e.cz', ...b }) });
      await mk({ title: 'FOKUS-A', status: 'todo', assignee_email: 'fokus@e2e.cz', deadline: today });
      await mk({ title: 'FOKUS-B', status: 'todo', assignee_email: 'fokus@e2e.cz', deadline: today });
    }, today);

    console.log('== označení z řádkových akcí + badge + začátek sekce ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(await markFocus(page, 'FOKUS-B', 'today'), 'hvězda → Dnes u FOKUS-B');
    let badges = await badgeInfo(page);
    expect(badges.length === 1 && badges[0].when === 'today' && badges[0].text.includes('FOKUS-B'),
      `právě jeden badge „dnes" a je u FOKUS-B (${JSON.stringify(badges)})`);
    const orderTxt = await page.evaluate(() => document.body.innerText);
    expect(orderTxt.indexOf('FOKUS-B') < orderTxt.indexOf('FOKUS-A'),
      'označený FOKUS-B plave před FOKUS-A');

    console.log('== přežije reload a je na účtu ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    badges = await badgeInfo(page);
    expect(badges.length === 1 && badges[0].text.includes('FOKUS-B'), 'po reloadu badge drží');
    const onServer = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch(`/api/collections/users/records/${auth.record?.id || auth.model?.id}`,
        { headers: { Authorization: auth.token } })).json();
      return r.focus;
    });
    expect(onServer && onServer[today] && onServer[today].kind === 'task',
      `users.focus na serveru nese dnešní volbu (${JSON.stringify(onServer)})`);

    console.log('== jiný řádek NAHRADÍ předchozí (vždy max jeden na den) ==');
    expect(await markFocus(page, 'FOKUS-A', 'today'), 'hvězda → Dnes u FOKUS-A');
    badges = await badgeInfo(page);
    expect(badges.length === 1 && badges[0].text.includes('FOKUS-A'),
      `jediný „dnes" je teď FOKUS-A (${JSON.stringify(badges)})`);

    console.log('== zítřek vedle dneška ==');
    expect(await markFocus(page, 'FOKUS-B', 'tomorrow'), 'hvězda → Zítra u FOKUS-B');
    badges = await badgeInfo(page);
    const whens = badges.map((b) => b.when).sort();
    expect(badges.length === 2 && whens.join(',') === 'today,tomorrow',
      `dnes i zítra vedle sebe (${JSON.stringify(badges)})`);

    console.log('== lite: hvězda i na telefonu ==');
    await page.setViewport(PHONE);
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    const liteBadges = await badgeInfo(page);
    expect(liteBadges.length >= 1, `lite ukazuje hvězdu (${liteBadges.length})`);
    const liteTxt = await page.evaluate(() => document.body.innerText);
    expect(liteTxt.indexOf('FOKUS-A') < liteTxt.indexOf('FOKUS-B'), 'v lite je dnešní fokus první');

    console.log('== server: staré datumové klíče vyprší (sanitizace) ==');
    const sanitized = await page.evaluate(async (today) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const id = auth.record?.id || auth.model?.id;
      await fetch(`/api/collections/users/records/${id}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({ focus: {
          '2020-01-01': { kind: 'task', id: 'stary', map: 'x' },
          [today]: { kind: 'task', id: 'ok', map: 'x' },
          'nesmysl': { kind: 'task', id: 'x', map: 'x' },
        } }),
      });
      return (await (await fetch(`/api/collections/users/records/${id}`, { headers: H })).json()).focus;
    }, today);
    expect(sanitized && !sanitized['2020-01-01'] && !sanitized.nesmysl && sanitized[today]?.id === 'ok',
      `starý a nesmyslný klíč zahozen, dnešní přežil (${JSON.stringify(sanitized)})`);

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 120) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
