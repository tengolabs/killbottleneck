// UI e2e: klik na cíl-uzel v panelu Můj den na /tasks naviguje do mapy na uzel.
// Klik na cíl-uzel v panelu Můj den na /tasks → musí navigovat do mapy (ne dialog).
// + Dedup uzel+úkol (etapa E): úkol pověšený na můj uzel se počítá u uzlu
// (v panelu se neukazuje podruhé); úkol s osiřelým node_id se počítá samostatně.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20505';
const NAME = 'flowmap-e2e-ui-mydaynode';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Panel Můj den je na /tasks VÝCHOZĚ SBALENÝ (Richard 11. 8. — pod ním je hned
// tabulka téhož); před klikáním do panelu ho testy rozbalí.
const rozbalDen = async (p) => {
  await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.title || '') === 'Rozbalit');
    b && b.click();
  });
  await new Promise((r) => setTimeout(r, 700));
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    // KB_UVODNI_MAPA=0: sada POČÍTÁ položky v Můj den — úvodní mapa by je
    // rozhodila. Odhaleno přes půlnoc 7. 8. 2026: server datuje položky v UTC,
    // prohlížeč už měl další den a „dnešní" položky mapy spadly do Po termínu.
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -e KB_UVODNI_MAPA=0 -p 20505:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', 'admin@e2e.cz');
    await page.type('#password', 'testheslo123');
    await page.type('#confirm', 'testheslo123');
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    const mapId = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({
          title: 'Klik mapa',
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Klik mapa', title: 'Klik mapa', status: 'todo' } },
            { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'PRESLY-CIL-XYZ', status: 'todo', owner: 'admin@e2e.cz', deadline: '2026-07-01' } },
            // dočasný neutrální uzel — jen k LEGÁLNÍMU vyrobení osiřelého úkolu
            // (server nový úkol na neexistujícím uzlu odmítá 400); hned po
            // založení úkolu se z mapy zase smaže → úkol osiří
            { id: 'docasny', type: 'goalNode', position: { x: 200, y: 300 }, data: { title: 'Dočasný', status: 'todo' } },
          ],
          edges: [
            { id: 'e1', source: 'apex', target: 'n1', type: 'deletable' },
            { id: 'e2', source: 'apex', target: 'docasny', type: 'deletable' },
          ],
        }),
      });
      return (await r.json()).id;
    });
    // dedup: úkol na existujícím uzlu n1 (fold) + úkol s osiřelým node_id (počítá se sám).
    // Osiřelost se vyrábí legálně: úkol vznikne na uzlu 'docasny', pak se uzel
    // (i s hranou) PATCHem mapy smaže — ponechané node_id osiří (vzor api-rls.js).
    // SLOVNÍK 17. 8. 2026: zbytkové položky sází superuser (create = 403)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    await page.evaluate(async (mapId) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const su = await (await fetch('/api/collections/_superusers/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'su@e2e.local', password: 'supersu12345' }) })).json();
      const HS = { 'Content-Type': 'application/json', Authorization: su.token };
      const myId = (auth.record || auth.model || {}).id;
      const mk = (body) => fetch('/api/collections/tasks/records', {
        method: 'POST', headers: HS,
        body: JSON.stringify({ ...body, assignee_email: 'admin@e2e.cz', status: 'todo', deadline: '2026-07-01', owner: myId, owner_email: 'admin@e2e.cz' }),
      });
      await mk({ title: 'FOLDNUTY-UKOL-XYZ', map: mapId, node_id: 'n1' });
      await mk({ title: 'OSIRELY-UKOL-XYZ', map: mapId, node_id: 'docasny' });
      const stav = await (await fetch(`/api/collections/goalmaps/records/${mapId}`, { headers: H })).json();
      await fetch(`/api/collections/goalmaps/records/${mapId}`, {
        method: 'PATCH', headers: H,
        body: JSON.stringify({
          nodes: stav.nodes.filter((n) => n.id !== 'docasny'),
          edges: stav.edges.filter((ed) => ed.target !== 'docasny'),
          base_updated: stav.updated,
        }),
      });
    }, mapId);
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    await rozbalDen(page);
    await sleep(1500);
    // jen text PANELU Můj den — v tabulce úkolů níž foldnutý úkol správně JE (řádek = detail)
    const panelText = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')].find((el) => (el.innerText || '').includes('Můj den'));
      return h ? h.closest('.rounded-xl').innerText : '';
    });
    expect(panelText.includes('PRESLY-CIL-XYZ'), 'uzel je v panelu Můj den');
    expect(!panelText.includes('FOLDNUTY-UKOL-XYZ'), 'úkol na uzlu se v panelu NEukazuje podruhé (fold do uzlu)');
    expect(panelText.includes('OSIRELY-UKOL-XYZ'), 'úkol s osiřelým node_id se počítá samostatně');
    // hlavička sekce má CSS uppercase → innerText je „PO TERMÍNU (2)"
    expect(/po termínu \(2\)/i.test(panelText), `sekce Po termínu počítá práci jednou: uzel + osiřelý = 2 (${(panelText.match(/po termínu \(\d+\)/i) || [''])[0]})`);
    // klik na položku v panelu Můj den (sekce Po termínu)
    let clicked = false;
    for (const h of await page.$$('button')) {
      const t = await h.evaluate((el) => el.innerText || '');
      if (t.includes('PRESLY-CIL-XYZ') && t.includes('19')) { /* řádek s termínem */ }
      if (t.includes('PRESLY-CIL-XYZ')) { await h.click(); clicked = true; break; }
    }
    expect(clicked, 'klik na cíl v panelu Můj den');
    await sleep(2000);
    expect(page.url().includes(`/map/${mapId}`) && page.url().includes('node=n1'), `naviguje do mapy na uzel (${page.url().replace(BASE, '')})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
