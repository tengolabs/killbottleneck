// UI e2e: levé panely na /tasks — zásobník, řádkové akce (stopky/odložit),
// zavírání hlavičkou, odsouvání obsahu, výlučnost, ouška na hraně panelu.
// Kontrola: levý zásobník na /tasks, hodinky u řádků uzlů, odložení z řádku,
// zavírání panelů klikem na hlavičku.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20503';
const NAME = 'flowmap-e2e-ui-panels';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20503:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await sleep(1500);
    await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const mResp = await fetch('/api/collections/goalmaps/records', { method: 'POST', headers: H, body: JSON.stringify({
        title: 'Panel mapa',
        nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Panel mapa', title: 'Panel mapa', status: 'todo' } },
          { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'UZEL-CIL-XYZ', status: 'todo', owner: 'admin@e2e.cz' } },
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1', type: 'deletable' }],
      }) });
      const mid = (await mResp.json()).id;
      // úkol vždy patří do projektu (server volné úkoly odmítá)
      await fetch('/api/collections/tasks/records', { method: 'POST', headers: H, body: JSON.stringify({ title: 'UKOL-XYZ', status: 'todo', assignee_email: 'admin@e2e.cz', map: mid }) });
    });

    console.log('== /tasks: levý zásobník ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const bufBtn = await page.$('button[title="Zásobník nápadů"]');
    expect(!!bufBtn, 'zavřené tlačítko zásobníku vlevo na /tasks');
    await bufBtn.click();
    await sleep(800);
    expect(await page.evaluate(() => document.body.innerText.includes('Zásobník')), 'zásobník se otevřel');
    const closeHdr = await page.$('button[title="Zavřít zásobník"]');
    expect(!!closeHdr, 'hlavička zásobníku je klikací');
    await closeHdr.click();
    await sleep(800);
    expect(!!(await page.$('button[title="Zásobník nápadů"]')), 'klik na hlavičku zásobník zavřel');

    console.log('== /tasks: hodinky a odložení u řádků ==');
    const timers = await page.$$('button[title="Spustit měření času"]');
    expect(timers.length >= 3, `hodinky u úkolu i u cílů-uzlů (${timers.length} řádků)`);
    const stash = await page.$$('button[title="Odložit do zásobníku"]');
    expect(stash.length >= 2, `odložení do zásobníku u řádků v DOM (${stash.length})`);

    console.log('== panel Měření času: zavření hlavičkou ==');
    const tlBtn = await page.$('button[title*="Měření času — záznamy"]');
    expect(!!tlBtn, 'zavřené tlačítko měření času');
    await tlBtn.click();
    await sleep(800);
    const tlClose = await page.$('button[title="Zavřít měření času"]');
    expect(!!tlClose, 'hlavička měření je klikací');
    await tlClose.click();
    await sleep(800);
    expect(!!(await page.$('button[title*="Měření času — záznamy"]')), 'klik na hlavičku měření zavřel');

    console.log('== odsouvání obsahu + výlučnost panelů ==');
    const rootPad = () => page.evaluate(() => {
      const el = document.querySelector('.min-h-screen');
      return el ? el.className.match(/sm:pl-\d+/)?.[0] || '' : '?';
    });
    await (await page.$('button[title*="Měření času — záznamy"]')).click();
    await sleep(600);
    expect((await rootPad()) === 'sm:pl-80', `otevřené měření odsouvá obsah (${await rootPad()})`);
    {
      const bufTab = await page.$('button[title="Zásobník nápadů"]');
      const box = await bufTab.boundingBox();
      expect(box.x >= 315, `ouško zásobníku sedí na hraně otevřeného měření, ne přes obsah (x=${Math.round(box.x)})`);
      await bufTab.click();
    }
    await sleep(600);
    expect((await rootPad()) === 'sm:pl-72', `otevření zásobníku zavře měření a odsune (${await rootPad()})`);
    {
      const tlTab = await page.$('button[title*="Měření času — záznamy"]');
      const box = await tlTab.boundingBox();
      expect(box.x >= 283, `ouško měření sedí na hraně otevřeného zásobníku (x=${Math.round(box.x)})`);
    }
    expect(!!(await page.$('button[title*="Měření času — záznamy"]')), 'měření je zavřené (výlučnost)');
    await (await page.$('button[title="Zavřít zásobník"]')).click();
    await sleep(600);
    expect((await rootPad()) === '', `zavřený zásobník = žádné odsazení (${await rootPad()})`);

    console.log('== Můj den: Úkoly sbalený, Projekty rozbalený, NEZÁVISLE ==');
    // Richard 11. 8.: „když to minimalizuji v jednom, je to v obou propojené."
    // Na Úkolech je pod panelem hned tabulka téhož → výchozí sbalený; Projekty
    // rozbalené. Sbalení jedné stránky nesmí sbalit druhou (vlastní klíče).
    const denRozbaleny = () => page.evaluate(() => {
      // sbalený panel nemá dlaždice sekcí (Po termínu/Dnes…), hlavička zůstává
      const t = document.body.innerText || '';
      return t.includes('Po termínu');
    });
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    expect(!(await denRozbaleny()), 'na Úkolech je Můj den výchozí SBALENÝ');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    expect(await denRozbaleny(), 'na Projektech je Můj den výchozí ROZBALENÝ');
    // sbalit na Projektech → Úkoly (rozbalené ručně) to nesmí ovlivnit a naopak
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.title || '') === 'Sbalit');
      btn?.click();
    });
    await sleep(600);
    expect(!(await denRozbaleny()), 'Projekty jdou sbalit');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.title || '') === 'Rozbalit');
      btn?.click();
    });
    await sleep(600);
    expect(await denRozbaleny(), 'Úkoly jdou rozbalit');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    expect(!(await denRozbaleny()), 'sbalené Projekty zůstaly sbalené — stavy se NEPROPOJUJÍ');

    expect(errors.length === 0, `konzole bez chyb (${errors.length}${errors.length ? ': ' + errors[0].slice(0, 100) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
