// UI e2e: zásobník nápadů na /tasks nemizí s filtrem Moje úkoly / chipy.
// Repro: zásobník nápadů na /tasks — viditelnost bez filtrů a po kliku na chip.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20504';
const NAME = 'flowmap-e2e-ui-buffer';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20504:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
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
    // SLOVNÍK 17. 8. 2026: položky sází superuser (uživatelský create = 403)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const su = await (await fetch('/api/collections/_superusers/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'su@e2e.local', password: 'supersu12345' }) })).json();
      const HS = { 'Content-Type': 'application/json', Authorization: su.token };
      const myId = (auth.record || auth.model || {}).id;
      await fetch('/api/collections/buffer_nodes/records', { method: 'POST', headers: H, body: JSON.stringify({ title: 'NAPAD-XYZ', owner: auth.record?.id || auth.model?.id }) });
      // úkol vždy patří do projektu A na konkrétní NE-vrcholový uzel
      // (neutrální uzel bez garanta/termínu, ať do seznamů nic nepřidá)
      const m = await (await fetch('/api/collections/goalmaps/records', { method: 'POST', headers: H, body: JSON.stringify({ title: 'Buffer mapa', nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Buffer mapa', title: 'Buffer mapa', status: 'todo' } }, { id: 'n1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Zázemí úkolů', status: 'todo' } }], edges: [{ id: 'e-n1', source: 'apex', target: 'n1' }] }) })).json();
      await fetch('/api/collections/tasks/records', { method: 'POST', headers: HS, body: JSON.stringify({ title: 'UKOL-PO-TERMINU', status: 'todo', deadline: '2026-07-01', assignee_email: 'admin@e2e.cz', map: m.id, node_id: 'n1', owner: myId, owner_email: 'admin@e2e.cz' }) });
    });

    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    let txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('Zásobník nápadů') && txt.includes('NAPAD-XYZ'), 'zásobník viditelný BEZ filtrů');

    // zapnout filtr „Moje úkoly" (tlačítko v liště filtrů) — zásobník musí zůstat
    for (const h of await page.$$('button')) {
      const t = (await h.evaluate((el) => el.innerText || '')).trim();
      if (t === 'Moje úkoly') { await h.click(); break; }
    }
    await sleep(1000);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('Zásobník nápadů') && txt.includes('NAPAD-XYZ'), 'zásobník viditelný i s filtrem Moje úkoly');
    // chip Otevřené (nastaví moje + termín vše) — taky musí zůstat
    for (const h of await page.$$('button')) {
      const t = await h.evaluate((el) => el.innerText || '');
      if (t.includes('Otevřené')) { await h.click(); break; }
    }
    await sleep(1000);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('Zásobník nápadů'), 'zásobník viditelný i po kliku na chip Otevřené');

    // Čtvrtá vlna 7. 8. (commit b0045a0): nápad opouští zásobník JEN jako UZEL
    // pod hlavním cílem — „Převést na úkol" byl odstraněn. Test dřív hlídal
    // odstraněnou funkci a po změně logicky spadl.
    console.log('== vložení nápadu do projektu = uzel pod hlavním cílem ==');
    const conv = await page.$('button[title="Vložit do projektu (pod hlavní cíl)"]');
    expect(!!conv, 'tlačítko „Vložit do projektu" v sekci zásobníku');
    await conv.click();
    await sleep(800);
    let txt2 = await page.evaluate(() => document.body.innerText);
    expect(txt2.includes('Vložit nápad do projektu'), 'dialog s výběrem projektu je otevřený');
    for (const h of await page.$$('[role="dialog"] button')) {
      const t = await h.evaluate((el) => el.innerText || '');
      if (t.includes('Buffer mapa')) { await h.click(); break; }
    }
    await sleep(1500);
    const after = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { Authorization: auth.token };
      const tasks = (await (await fetch('/api/collections/tasks/records', { headers: H })).json()).items || [];
      const ideas = (await (await fetch('/api/collections/buffer_nodes/records', { headers: H })).json()).items || [];
      const maps = (await (await fetch('/api/collections/goalmaps/records', { headers: H })).json()).items || [];
      const mapa = maps.find((m) => m.title === 'Buffer mapa');
      const uzel = (mapa?.nodes || []).find((n) => n.data?.title === 'NAPAD-XYZ');
      const apex = (mapa?.nodes || []).find((n) => n.type === 'apexNode');
      const hrana = uzel && apex && (mapa?.edges || []).some((e) => e.source === apex.id && e.target === uzel.id);
      return {
        uzel: !!uzel, hrana: !!hrana,
        vzniklUkol: tasks.some((t) => t.title === 'NAPAD-XYZ'),
        ideaCount: ideas.filter((b) => b.title === 'NAPAD-XYZ').length,
      };
    });
    expect(after.uzel, 'nápad je v mapě jako uzel');
    expect(after.hrana, 'uzel visí POD hlavním cílem (hrana z vrcholu)');
    expect(!after.vzniklUkol, 'úkolový záznam NEvznikl (model: nápad opouští zásobník jen jako uzel)');
    expect(after.ideaCount === 0, 'nápad po vložení ze zásobníku zmizel');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
