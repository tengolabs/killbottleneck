// UI e2e: měření času v editoru mapy — hodinky na uzlech, klik spustí měření,
// TimeLogPanel (běžící čas, od–do), hodinky v tabulce úkolů bez hoveru.
// Kontrola měření času v2 v prohlížeči: hodinky na uzlu v mapě, TimeLogPanel,
// viditelné hodinky v tabulce úkolů, od–do v dialogu Odpracovaný čas.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20502';
const NAME = 'flowmap-e2e-ui-timer';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20502:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

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
    const mapId = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({
          title: 'Timer mapa',
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 100, y: 50 }, data: { nodeType: 'apex', apexText: 'Timer mapa', title: 'Timer mapa', status: 'todo' } },
            { id: 'n1', type: 'goalNode', position: { x: 100, y: 300 }, data: { title: 'Měřený cíl', status: 'todo' } },
          ],
          edges: [{ id: 'e1', source: 'apex', target: 'n1', type: 'deletable' }],
        }),
      });
      const mid = (await r.json()).id;
      // úkol vždy patří do projektu A na konkrétní uzel (server jinak odmítá 400)
      await fetch('/api/collections/tasks/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({ title: 'UKOL-TIMER', status: 'todo', assignee_email: 'admin@e2e.cz', map: mid, node_id: 'n1' }),
      });
      return mid;
    });

    console.log('== editor mapy ==');
    await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const nodeClocks = await page.$$('button[title="Spustit měření času na tomto cíli"]');
    expect(nodeClocks.length >= 2, `hodinky na uzlech viditelné (${nodeClocks.length})`);
    const panelBtn = await page.$('button[title*="Měření času"]');
    expect(!!panelBtn, 'tlačítko panelu Měření času vlevo existuje');

    // klik na hodinky uzlu → měření běží (backend) + panel po otevření ukazuje běžící čas
    await nodeClocks[0].click();
    await sleep(1200);
    const runningCnt = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await fetch(`/api/collections/time_entries/records?filter=${encodeURIComponent("ended = ''")}`, { headers: { Authorization: auth.token } });
      return (await r.json()).items?.length ?? -1;
    });
    expect(runningCnt === 1, `klik na hodinky uzlu spustil měření (běží ${runningCnt})`);
    await panelBtn.click();
    await sleep(1200);
    const panelText = await page.evaluate(() => document.body.innerText);
    expect(panelText.includes('Měření času') && /\d+:\d{2}/.test(panelText), 'panel otevřen a ukazuje běžící čas');
    // stop v panelu s poznámkou bez přiřazení? — měření JE přiřazené k uzlu, stop bez poznámky
    const stopBtn = (await page.$$('button')).filter(() => true);
    let clicked = false;
    for (const h of await page.$$('button')) {
      const t = await h.evaluate((el) => el.innerText || '');
      if (t.trim() === 'Stop') { await h.click(); clicked = true; break; }
    }
    expect(clicked, 'Stop v panelu kliknut');
    await sleep(1200);
    const panelText2 = await page.evaluate(() => document.body.innerText);
    expect(/\d{1,2}:\d{2}–\d{1,2}:\d{2}/.test(panelText2), 'záznam v panelu ukazuje od–do');

    console.log('== tabulka úkolů ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const hasPanel = async () => page.evaluate(() =>
      !!document.querySelector('button[title*="Měření času"]') || document.body.innerText.includes('Měření času'));
    expect(await hasPanel(), 'panel Měření času i na /tasks');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    expect(await hasPanel(), 'panel Měření času i na Home');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const taskClock = await page.$('button[title="Spustit měření času"]');
    expect(!!taskClock, 'hodinky u úkolu v DOM');
    const visible = taskClock && await taskClock.evaluate((el) => {
      const r = el.getBoundingClientRect();
      let n = el;
      while (n) { const s = getComputedStyle(n); if (parseFloat(s.opacity) === 0 || s.visibility === 'hidden') return false; n = n.parentElement; }
      return r.width > 0;
    });
    expect(visible, 'hodinky u úkolu viditelné BEZ hoveru');

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 120) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
