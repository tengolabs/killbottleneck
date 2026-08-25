// UI e2e: „Moje mapa" — záložky Mám udělat / Zadal jsem + seskupení delegace.
// Zadal jsem = uzly s owner≠já v mých mapách + úkoly zadané jiným; dedup (úkol
// na uzlu téhož řešitele počítá uzel); přepínač Dle termínu/lidí/projektů;
// klik na položku naviguje do mapy projektu; deep-link ?view=delegated.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20508';
const NAME = 'flowmap-e2e-mymap-deleg';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickButtonExact = async (page, text) => {
  for (const h of await page.$$('button')) {
    const t = await h.evaluate((el) => (el.innerText || '').trim());
    if (t === text) { await h.click(); return true; }
  }
  return false;
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 20508:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 900 });
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    // mapa s uzlem přiřazeným kolegovi + delegované úkoly (jeden na TOM uzlu =
    // fold, jeden volně v projektu = vlastní položka) + můj vlastní uzel
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const mapId = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const m = await (await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          title: 'Delegacni projekt',
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Delegacni projekt', title: 'Delegacni projekt', status: 'todo' } },
            { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'DELEG-UZEL-XYZ', status: 'todo', owner: 'kolega@e2e.cz', deadline: '2026-07-01' } },
            { id: 'n2', type: 'goalNode', position: { x: 200, y: 300 }, data: { title: 'MUJ-UZEL-XYZ', status: 'todo', owner: 'admin@e2e.cz', deadline: '2026-07-30' } },
            // neutrální uzel pro „volný" delegovaný úkol (bez ownera/termínu,
            // ať se nefolduje pod n1 a nehne čísly vlastnictví)
            { id: 'krok', type: 'goalNode', position: { x: 400, y: 300 }, data: { title: 'Krok', status: 'todo' } },
          ],
          edges: [{ id: 'e1', source: 'apex', target: 'n1', type: 'deletable' }, { id: 'e2', source: 'apex', target: 'n2', type: 'deletable' }, { id: 'e3', source: 'apex', target: 'krok', type: 'deletable' }],
        }),
      })).json();
            const su = await (await fetch('/api/collections/_superusers/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'su@e2e.local', password: 'supersu12345' }) })).json();
      const HS = { 'Content-Type': 'application/json', Authorization: su.token };
      const myId = (auth.record || auth.model || {}).id;
const mk = (body) => fetch('/api/collections/tasks/records', {
        method: 'POST', headers: HS, body: JSON.stringify({ status: 'todo', map: m.id, owner: myId, owner_email: (auth.record || auth.model || {}).email, ...body }),
      });
      await mk({ title: 'FOLD-DELEG-UKOL', assignee_email: 'kolega@e2e.cz', node_id: 'n1', deadline: '2026-07-02' });
      await mk({ title: 'DELEG-UKOL-XYZ', assignee_email: 'jiny@e2e.cz', node_id: 'krok', deadline: '2026-07-28' });
      return m.id;
    });

    console.log('== záložka Mám udělat (default) ==');
    await page.goto(`${BASE}/my-map`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    let txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('MUJ-UZEL-XYZ') && !txt.includes('DELEG-UZEL-XYZ'), 'Mám udělat: můj uzel ano, delegovaný ne');
    expect(txt.includes('Mám udělat') && txt.includes('Zadal jsem'), 'záložky jsou vidět');

    // Klik-test 27. 7. 2026: při 7 kartách byla poslední schovaná za minimapou.
    // Osobní mapa je SEZNAM, ne mapa k procházení — minimapa sem nepatří.
    // ⚠️ Kontrolovat TADY, dokud jsme v /my-map; níž už sada odskočí do mapy
    // projektu, kde minimapa naopak zůstat MÁ.
    const mm = await page.evaluate(() => document.querySelectorAll('.react-flow__minimap').length);
    expect(mm === 0, `osobní mapa nemá minimapu, která by překrývala karty (${mm})`);

    console.log('== přepnutí na Zadal jsem ==');
    expect(await clickButtonExact(page, 'Zadal jsem'), 'klik na záložku Zadal jsem');
    await sleep(2000);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('DELEG-UZEL-XYZ') && txt.includes('DELEG-UKOL-XYZ'), 'delegovaný uzel i úkol jsou v mapě');
    expect(!txt.includes('FOLD-DELEG-UKOL'), 'úkol na uzlu téhož řešitele se nezdvojuje (fold do uzlu)');
    expect(!txt.includes('MUJ-UZEL-XYZ'), 'moje vlastní práce v Zadal jsem není');
    expect(txt.includes('Dle termínu') && txt.includes('Dle lidí') && txt.includes('Dle projektů'), 'přepínač seskupení je vidět');

    console.log('== seskupení dle lidí / dle projektů ==');
    expect(await clickButtonExact(page, 'Dle lidí'), 'klik Dle lidí');
    await sleep(1500);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('kolega@e2e.cz') && txt.includes('jiny@e2e.cz'), 'skupinové uzly = lidé');
    expect(await clickButtonExact(page, 'Dle projektů'), 'klik Dle projektů');
    await sleep(1500);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.split('Delegacni projekt').length > 1, 'skupinový uzel = projekt');
    expect(await clickButtonExact(page, 'Dle termínu'), 'zpět Dle termínu');
    await sleep(1200);

    console.log('== klik na delegovaný uzel → mapa projektu ==');
    let clicked = false;
    for (const h of await page.$$('.react-flow__node')) {
      const t = await h.evaluate((el) => el.innerText || '');
      if (t.includes('DELEG-UZEL-XYZ')) { await h.click(); clicked = true; break; }
    }
    expect(clicked, 'klik na delegovaný uzel');
    await sleep(2000);
    expect(page.url().includes(`/map/${mapId}`) && page.url().includes('node=n1'), `naviguje do mapy projektu na uzel (${page.url().replace(BASE, '')})`);

    console.log('== deep-link ?view=delegated ==');
    await page.goto(`${BASE}/my-map?view=delegated`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('DELEG-UZEL-XYZ'), 'deep-link otevře rovnou Zadal jsem');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
