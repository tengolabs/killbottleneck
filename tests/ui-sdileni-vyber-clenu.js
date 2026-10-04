// UI e2e: SDÍLENÍ — VÝBĚR ČLENA ORGANIZACE ZE SEZNAMU.
//
// Richard 3. 10. 2026: „našel jsem chybu ve sdílení — nemohu vybírat lidi
// v organizaci." Dialog Sdílet mapu měl jen holé pole na e-mail; adresu kolegy
// bylo nutné znát zpaměti, přestože editor adresář členů (/api/kb/members) už
// dávno má (pro výběr řešitele uzlu). Teď je nad polem VIDITELNÝ výběr
// (skrytý datalist Richard 15. 8. odmítl u automatizací — „vypadá, že registr
// zmizel") a výběr jen předvyplní e-mail; sdílení jde dál stejnou cestou.
//
// Hlídá se:
//  1) výběr existuje a nabízí kolegu (ne mě samotného),
//  2) výběr předvyplní pole s e-mailem,
//  3) Pozvat po výběru DOOPRAVDY sdílí (čte se z API, ne z UI),
//  4) nasdílený kolega z výběru zmizí (nenabízet dvakrát),
//  5) volný e-mail dál funguje (člověk mimo adresář).
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-sdileni-vyber';
const PORT = 20997;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SEF = 'sef@e2e.cz';
const KOLEGA = 'kolega@e2e.cz';
const KOLEGYNE = 'kolegyne@e2e.cz';
const CIZI = 'cizi@jinde.cz';

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
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    for (const e of [SEF, KOLEGA, KOLEGYNE]) {
      const r = await api('POST', '/api/collections/users/records', { body: { email: e, password: PW, passwordConfirm: PW } });
      ok(r.status === 200, `účet ${e} založen (${r.status})`);
    }
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: SEF, password: PW } })).json.token;
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Sdílená mapa',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
        { id: 'k1', type: 'goalNode', position: { x: 0, y: 240 }, data: { title: 'Krok', status: 'todo' } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'k1' }],
    } })).json;
    ok(!!map.id, 'mapa založena');

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1900, height: 950 }); // ≥1850 px → „Sdílet" je tlačítko v liště, ne v ⋮
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', SEF);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(2000);
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(2500);

    const otevritSdileni = async () => {
      const kliklo = await page.evaluate(() => {
        const b = [...document.querySelectorAll('header button')].find((x) => (x.textContent || '').trim() === 'Sdílet');
        if (!b) return false; b.click(); return true;
      });
      ok(kliklo, 'tlačítko Sdílet v liště nalezeno a kliknuto');
      await page.waitForSelector('[data-testid="share-member-select"]', { timeout: 10000 });
      await sleep(500);
    };
    const moznosti = () => page.evaluate(() => [...document.querySelector('[data-testid="share-member-select"]').options].map((o) => o.value).filter(Boolean));
    const seznamSdileni = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"] p.text-sm.font-medium.truncate')].map((p) => p.textContent.trim()));
    const pozvat = async () => {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').trim() === 'Pozvat');
        b.click();
      });
      await sleep(1500);
    };

    console.log('== 1) výběr nabízí kolegy, ne mě ==');
    await otevritSdileni();
    let m = await moznosti();
    ok(m.includes(KOLEGA) && m.includes(KOLEGYNE), `výběr nabízí oba kolegy (${m.join(', ')})`);
    ok(!m.includes(SEF), 'výběr nenabízí mě samotného');
    const placeholder = await page.$eval('[role="dialog"] input[type="email"]', (i) => i.placeholder);
    ok(/napište e-mail/.test(placeholder), `pole e-mailu říká, že je i druhá cesta („${placeholder}")`);

    console.log('== 2) výběr předvyplní e-mail ==');
    await page.select('[data-testid="share-member-select"]', KOLEGA);
    await sleep(300);
    const hodnota = await page.$eval('[role="dialog"] input[type="email"]', (i) => i.value);
    ok(hodnota === KOLEGA, `pole e-mailu má vybraného kolegu (${hodnota})`);
    const pozvatAktivni = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').trim() === 'Pozvat');
      return b && !b.disabled;
    });
    ok(pozvatAktivni, 'tlačítko Pozvat je po výběru aktivní');

    console.log('== 3) Pozvat po výběru DOOPRAVDY sdílí ==');
    await pozvat();
    let r = await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A });
    ok((r.json?.shared_with || []).includes(KOLEGA), `shared_with na serveru obsahuje ${KOLEGA} (${JSON.stringify(r.json?.shared_with)})`);
    let s = await seznamSdileni();
    ok(s.includes(KOLEGA), `kolega je v seznamu „Sdíleno s" (${s.join(', ')})`);

    console.log('== 4) nasdílený kolega z výběru zmizí, kolegyně zůstává ==');
    m = await moznosti();
    ok(!m.includes(KOLEGA), 'nasdílený kolega už se ve výběru nenabízí');
    ok(m.includes(KOLEGYNE), 'kolegyně se nabízí dál');
    const prazdne = await page.$eval('[role="dialog"] input[type="email"]', (i) => i.value);
    ok(prazdne === '', 'pole e-mailu se po pozvání vyprázdnilo');

    console.log('== 5) volný e-mail mimo adresář dál funguje ==');
    await page.type('[role="dialog"] input[type="email"]', CIZI);
    await pozvat();
    r = await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A });
    ok((r.json?.shared_with || []).includes(CIZI), `volný e-mail nasdílen (${JSON.stringify(r.json?.shared_with)})`);
    s = await seznamSdileni();
    ok(s.includes(CIZI), `cizí adresa je v seznamu (${s.join(', ')})`);
    m = await moznosti();
    ok(m.length === 1 && m[0] === KOLEGYNE, `ve výběru zbyla jen kolegyně (${m.join(', ')})`);

    console.log('== 6) po znovuotevření dialog drží stav ze serveru ==');
    await page.keyboard.press('Escape');
    await sleep(500);
    await otevritSdileni();
    m = await moznosti();
    ok(m.length === 1 && m[0] === KOLEGYNE, `po znovuotevření ve výběru jen kolegyně (${m.join(', ')})`);

    console.log('== 7) úvodní stránka: výběr člena i v dialogu Sdílet u karty mapy (panel 4. 10.: Home dialog seznam členů nedostával) ==');
    await page.keyboard.press('Escape');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="home-share"]', { timeout: 15000 });
    await page.click('[data-testid="home-share"]');
    const jeSelect = await page.waitForSelector('[data-testid="share-member-select"]', { timeout: 10000 }).then(() => true).catch(() => false);
    ok(jeSelect, 'dialog Sdílet z úvodní stránky má výběr člena');
    m = jeSelect ? await moznosti() : [];
    ok(m.length === 1 && m[0] === KOLEGYNE, `z úvodní stránky se nabízí jen nenasdílená kolegyně (${m.join(', ')})`);

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 160) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-SDILENI-VYBER-CLENU PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
