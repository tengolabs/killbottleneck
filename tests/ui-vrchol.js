// UI e2e: hlavní uzel (vrchol) NEJDE smazat — jde jen přejmenovat.
// Rozhodnutí Richarda 2. 8. 2026: vrchol JE projekt; pryč jen s celou mapou.
// Hlídá: chybějící koš na kruhu, klávesu Delete nad vybraným vrcholem
// (s vysvětlující hláškou, ne tichým nic) a že přejmenování dál funguje.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20540';
const NAME = 'flowmap-e2e-ui-vrchol';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 127.0.0.1:20540:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 950 });
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'vrchol@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    const mapId = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const m = await (await fetch('/api/collections/goalmaps/records', { method: 'POST', headers: H,
        body: JSON.stringify({ title: 'VRCHOL', nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'VRCHOL-PROJEKT', title: 'VRCHOL-PROJEKT', status: 'todo' } },
          { id: 'n1', type: 'goalNode', position: { x: 300, y: 380 }, data: { title: 'Podřízený', status: 'todo' } },
        ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }] }) })).json();
      return m.id;
    });
    await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 15000 });
    await sleep(2000);

    console.log('== koš na vrcholu není ==');
    const kose = await page.evaluate(() => {
      const apex = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.innerText || '').includes('VRCHOL-PROJEKT'));
      return [...apex.querySelectorAll('button')].filter((b) => (b.title || '') === 'Smazat' || b.querySelector('.lucide-trash-2, .lucide-trash2')).length;
    });
    expect(kose === 0, `kruh vrcholu nemá koš (${kose})`);

    console.log('== Delete nad vybraným vrcholem nesmaže + hláška ==');
    await page.click('.react-flow__node.react-flow__node-apexNode');
    await sleep(400);
    await page.keyboard.press('Delete');
    await sleep(800);
    let txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('VRCHOL-PROJEKT'), 'vrchol po Delete stále v mapě');
    expect(txt.includes('Hlavní uzel nejde smazat'), 'uživatel dostal vysvětlující hlášku');
    // regrese z checkupu 2. 8.: dřívější filtr remove-změn nechal xyflow tiše
    // smazat HRANY vrcholu (deleteElements je posílá zvlášť) → děti osiřely
    const hranyPoDelete = await page.evaluate(() => document.querySelectorAll('.react-flow__edge').length);
    expect(hranyPoDelete === 1, `hrana vrchol→dítě Delete přežila (${hranyPoDelete}/1)`);

    console.log('== běžný uzel Delete smaže dál ==');
    await page.evaluate(() => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Podřízený'));
      n?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.click('.react-flow__node.react-flow__node-goalNode');
    await sleep(400);
    await page.keyboard.press('Delete');
    await sleep(800);
    txt = await page.evaluate(() => document.body.innerText);
    expect(!txt.includes('Podřízený'), 'běžný uzel jde smazat jako dřív');

    console.log('== přejmenování vrcholu funguje ==');
    await page.evaluate(() => {
      const apex = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.innerText || '').includes('VRCHOL-PROJEKT'));
      const tuzka = [...apex.querySelectorAll('button')].find((b) => b.querySelector('.lucide-pencil'));
      tuzka?.click();
    });
    await sleep(800);
    const input = await page.$('[role="dialog"] input[value*="VRCHOL"], [role="dialog"] textarea');
    expect(!!input, 'dialog úprav vrcholu se otevřel (tužka)');
    await page.keyboard.press('Escape');
    await sleep(400);

    console.log('== server: PATCH bez vrcholu → 400 ==');
    const api = await page.evaluate(async (id) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      // obejití UI: surový PocketBase PATCH s nodes BEZ apexu musí server odmítnout
      const bezApexu = await fetch(`/api/collections/goalmaps/records/${id}`, { method: 'PATCH', headers: H,
        body: JSON.stringify({ nodes: [{ id: 'x1', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'sirotek', status: 'todo' } }], edges: [] }) });
      // kontrolní vzorek: PATCH s apexem uvnitř projít MUSÍ (autosave cesta)
      const sApexem = await fetch(`/api/collections/goalmaps/records/${id}`, { method: 'PATCH', headers: H,
        body: JSON.stringify({ nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'VRCHOL-PROJEKT', title: 'VRCHOL-PROJEKT', status: 'todo' } },
        ], edges: [] }) });
      return { bezApexu: bezApexu.status, sApexem: sApexem.status };
    }, mapId);
    expect(api.bezApexu === 400, `PATCH bez vrcholu odmítnut (${api.bezApexu})`);
    expect(api.sApexem === 200, `PATCH s vrcholem prošel (${api.sApexem})`);

  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
