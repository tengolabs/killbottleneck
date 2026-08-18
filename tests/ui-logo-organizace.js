// UI e2e: LOGO ORGANIZACE v liště mapy.
//
// Richard 18. 8. 2026: „v organizaci DUVE jsem změnil logo, ale v mapě se
// nezměnilo." Lišta mapy do té doby kreslila vždycky značku killBottlenecku;
// od 18. 8. má přednost logo firmy — stejně jako hlavička plné verze.
//
// Sada tvrdí OBA směry: s nahraným logem musí značka produktu z lišty zmizet,
// bez něj tam musí zůstat. Sada, která by hlídala jen ten první případ, by
// prošla i appce, co značku produktu zahodila úplně.
//
// A třetí směr, dopsaný po panelu /checkup 18. 8. 2026: ANONYMNÍMU návštěvníkovi
// veřejně sdílené mapy se logo zákazníka ukázat NESMÍ. `org_settings` má vědomě
// veřejné čtení (listRule "") a /map/:id není za ProtectedRoute, takže tohle
// hlídá jedině klient — a veřejná mapa je jediná akviziční plocha produktu.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-logo-org';
const PORT = 20988;
const BASE = `http://127.0.0.1:${PORT}`;
const UCET = 'admin@e2e.cz';
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

// nejmenší platné PNG (1×1 průhledný pixel) — obsah je jedno, jde o cestu k souboru
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: UCET, password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: UCET, password: PW } })).json.token;
    ok(!!A, 'admin přihlášen');

    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Mapa s logem',
      nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Hlavní cíl', title: 'Hlavní cíl', status: 'todo' } }],
      edges: [],
    } })).json;
    ok(!!map.id, 'mapa založena');

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', UCET);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(2000);

    // obrázky v levém rohu lišty mapy (tlačítko „zpět na úvod")
    const znackyVListe = async () => {
      await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.react-flow__node', { timeout: 45000 });
      await sleep(1500);
      return page.evaluate(() => {
        const btn = [...document.querySelectorAll('header button, button')]
          .find((b) => /úvodní stránku|home/i.test(b.getAttribute('aria-label') || ''));
        return btn ? [...btn.querySelectorAll('img')].map((i) => i.getAttribute('src')) : null;
      });
    };

    console.log('== bez nahraného loga zůstává v mapě značka killBottlenecku ==');
    const bezLoga = await znackyVListe();
    ok(!!bezLoga && bezLoga.length > 0, `lišta mapy má logo-tlačítko (${(bezLoga || []).join(', ') || 'ŽÁDNÉ'})`);
    ok(!!bezLoga && bezLoga.every((s) => /znak-/.test(s)), `kreslí se značka produktu (${(bezLoga || []).join(', ')})`);

    console.log('== po nahrání loga organizace se v mapě ukáže ONO ==');
    const form = new FormData();
    form.append('name', 'DUVE');
    form.append('logo', new Blob([PNG], { type: 'image/png' }), 'duve.png');
    const up = await fetch(`${BASE}/api/collections/org_settings/records`, { method: 'POST', headers: { Authorization: A }, body: form });
    ok(up.ok, `logo organizace nahráno (${up.status})`);

    const sLogem = await znackyVListe();
    ok(!!sLogem && sLogem.some((s) => /\/api\/files\/|org_settings/.test(s)),
      `lišta mapy kreslí nahrané logo (${(sLogem || []).join(', ')})`);
    ok(!!sLogem && !sLogem.some((s) => /znak-/.test(s)),
      'značka produktu z lišty zmizela (dvě loga vedle sebe si konkurují)');

    console.log('== ANONYM na veřejné mapě vidí značku produktu, ne logo firmy ==');
    const verejna = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Veřejná mapa',
      nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Veřejný cíl', title: 'Veřejný cíl', status: 'todo' } }],
      edges: [],
    } })).json;
    // is_public nastavuje server-side hook až po vytvoření (viz api-rls.js)
    await api('PATCH', `/api/collections/goalmaps/records/${verejna.id}`, { token: A, body: { is_public: true } });
    const jeVerejna = (await api('GET', `/api/collections/goalmaps/records/${verejna.id}`, { token: A })).json.is_public;
    ok(jeVerejna === true, 'mapa je opravdu veřejná (jinak by test níž nedokazoval nic)');

    const anonym = await browser.createBrowserContext();
    const stranka = await anonym.newPage();
    await stranka.setViewport({ width: 1600, height: 900 });
    await stranka.goto(`${BASE}/map/${verejna.id}`, { waitUntil: 'networkidle2' });
    await stranka.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(2000);
    const anonZnacky = await stranka.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => /úvodní stránku|home/i.test(b.getAttribute('aria-label') || ''));
      return btn ? [...btn.querySelectorAll('img')].map((i) => i.getAttribute('src')) : null;
    });
    ok(!!anonZnacky && anonZnacky.length > 0, `anonym mapu vidí a lišta má značku (${(anonZnacky || []).join(', ') || 'NIC'})`);
    ok(!!anonZnacky && !anonZnacky.some((x) => /\/api\/files\//.test(x)),
      `logo zákazníka se anonymovi NEUKÁŽE (${(anonZnacky || []).join(', ')})`);
    ok(!!anonZnacky && anonZnacky.every((x) => /znak-/.test(x)), 'anonym vidí značku killBottlenecku');
    await anonym.close();

    console.log('== hlavička plné verze ukazuje totéž (jedno chování, ne dvě) ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const vHlavicce = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('header button')]
        .find((b) => /úvodní stránku|home/i.test(b.getAttribute('aria-label') || ''));
      return btn ? [...btn.querySelectorAll('img')].map((i) => i.getAttribute('src')) : null;
    });
    ok(!!vHlavicce && vHlavicce.some((s) => /\/api\/files\/|org_settings/.test(s)),
      `hlavička kreslí totéž logo (${(vHlavicce || []).join(', ')})`);

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 160) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-LOGO-ORGANIZACE PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
