// UI e2e: KANBANOVÁ ŠABLONA očima uživatele (Richard 15. 8. 2026):
//  - dialog Nový projekt → Ze šablony: „8D report — kanban" je v nabídce
//    a přiznává odznak „vč. 7 pravidel automatizace"
//  - založení projektu ze šablony DOOPRAVDY založí pravidla (FE cesta
//    createProjectFromTemplate → /rules/save) — přehled ⚡ ukazuje 7 pravidel
//  - mapa ze šablony jede rovnou v kanban režimu (lišta: indikátor Kanban)
//  - kanban FUNGUJE: karta pod D1 → odznak stavu → done → karta pod D2
//    + návrat na Založeno (ověřeno čerstvým čtením mapy z API, ne echem UI)
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const NAME = 'kb-e2e-ui-sablony';
const PORT = 20996;
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

    await api('POST', '/api/collections/users/records', { body: { email: 'sef@example.com', password: PW, passwordConfirm: PW } });
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);

    console.log('== Nový projekt → Ze šablony: kanban šablona v nabídce s odznakem pravidel ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    // čekat na vykreslenou hlavičku, ne pevný spánek (lekce flaku ui-kanban)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Nový projekt/.test(b.textContent || '')), { timeout: 45000 });
    ok(await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Nový projekt/.test(x.textContent || ''));
      b && b.click();
      return !!b;
    }), 'tlačítko Nový projekt na Home');
    await page.waitForFunction(() => [...document.querySelectorAll('[role="tab"]')].some((x) => /Ze šablony/.test(x.textContent || '')), { timeout: 15000 });
    // Radix tab nereaguje na programový .click() (poslouchá pointer eventy)
    // → skutečný klik myší přes souřadnice
    const tabBox = await page.evaluate(() => {
      const t = [...document.querySelectorAll('[role="tab"]')].find((x) => /Ze šablony/.test(x.textContent || ''));
      const r = t.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(tabBox.x, tabBox.y);
    // šablony se donačítají ze serveru (a odznak pravidel čeká na lazy ns)
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((x) => (x.textContent || '').includes('8D report — kanban')), { timeout: 15000 });
    await page.waitForFunction(() => !!document.querySelector('[data-testid="tpl-rules-badge"]'), { timeout: 15000 });
    const tplBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').includes('8D report — kanban'));
      if (!b) return null;
      return { badge: !!b.querySelector('[data-testid="tpl-rules-badge"]'), badgeText: b.querySelector('[data-testid="tpl-rules-badge"]')?.textContent || '' };
    });
    ok(!!tplBtn, 'šablona „8D report — kanban" je v nabídce');
    ok(tplBtn && tplBtn.badge && /7/.test(tplBtn.badgeText), `odznak „vč. 7 pravidel automatizace" (${tplBtn && tplBtn.badgeText})`);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').includes('8D report — kanban'));
      b && b.click();
    });
    await sleep(400);
    await page.evaluate((v) => {
      const i = document.querySelector('#project-name');
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }, 'Reklamační kanban');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Založit projekt/.test(x.textContent || ''));
      b && b.click();
    });
    // založení mapy + 7× POST /rules/save proběhne sekvenčně — počkat na editor
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(2500);

    console.log('== pravidla DOOPRAVDY vznikla a míří na reálné uzly mapy ==');
    const maps = (await api('GET', '/api/collections/goalmaps/records?perPage=50', { token: SEF })).json.items || [];
    const mapa = maps.find((x) => x.title === 'Reklamační kanban');
    ok(!!mapa, 'projekt „Reklamační kanban" existuje');
    const rules = (await api('GET', `/api/kb/rules?map=${mapa.id}`, { token: SEF })).json.rules || [];
    ok(rules.length === 7, `mapa má 7 pravidel (${rules.length})`);
    const idSet = new Set((mapa.nodes || []).map((n) => n.id));
    ok(rules.every((r) => r.conditions.every((c) => c.field !== 'parent' || idSet.has(c.value))
      && r.actions.every((a) => a.type !== 'move_node' || idSet.has(a.to))), 'odkazy pravidel remapnuté na id TÉTO mapy');
    ok(rules.every((r) => r.enabled), 'pravidla jsou zapnutá');
    ok(rules.some((r) => /Kanban: D1 – Sestavení týmu → D2/.test(r.name)), 'název pravidla nese názvy sloupců (CZ)');

    console.log('== mapa ze šablony jede rovnou v kanban režimu; přehled ukazuje pravidla ==');
    ok(await page.evaluate(() => {
      const b = document.querySelector('[data-testid="toolbar-kanban-mode"]');
      return !!b && /Kanban/.test(b.textContent || '');
    }), 'lišta ukazuje indikátor „Kanban" místo Zarovnat');
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(1000);
    ok(await page.evaluate(() => document.querySelectorAll('[data-testid="rule-row"]').length === 7),
      'přehled ⚡ ukazuje 7 pravidel');
    await page.keyboard.press('Escape');
    await sleep(600);

    console.log('== kanban ze šablony FUNGUJE: karta pod D1 → done → pod D2 + Založeno ==');
    const d1 = (mapa.nodes || []).find((n) => String((n.data || {}).title || '').startsWith('D1'));
    const d2 = (mapa.nodes || []).find((n) => String((n.data || {}).title || '').startsWith('D2'));
    const f = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: SEF })).json;
    const r = await api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: SEF, body: {
      nodes: f.nodes.concat([{ id: 'karta1', type: 'goalNode', position: { x: (d1.position || {}).x || 0, y: ((d1.position || {}).y || 0) + 320 }, data: { title: 'Reklamace1', status: 'todo' } }]),
      edges: f.edges.concat([{ id: 'ek1', source: d1.id, target: 'karta1' }]),
      base_updated: f.updated,
    } });
    ok(r.status === 200, `karta pod D1 založena (${r.status})`);
    await page.goto(`${BASE}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(1500);
    const cyklus = async () => page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Reklamace1'));
      const b = uzel && uzel.querySelector('button');
      b && b.click();
      return !!b;
    });
    ok(await cyklus(), 'odznak stavu karty jde kliknout'); await sleep(1200); // → in_progress
    await cyklus(); await sleep(3000); // → done → pravidlo šablony přesune
    const po = (await api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: SEF })).json;
    const rodic = (po.edges.find((e) => e.target === 'karta1') || {}).source;
    const k1 = po.nodes.find((n) => n.id === 'karta1');
    ok(rodic === d2.id, `karta je po Hotovo pod D2 (${rodic === d2.id ? 'ano' : rodic})`);
    ok(k1?.data.status === 'todo', 'stav se vrátil na Založeno');

    console.log('== galerie Šablony (Richardova cesta „nic to nedělá"): sekce Kanban → náhled → Použít šablonu → pravidla JSOU ==');
    await page.goto(`${BASE}/?view=templates`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').trim() === 'Kanban'), { timeout: 45000 });
    ok(true, 'galerie má vlastní sekci (chip) Kanban');
    await page.evaluate(() => {
      const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Kanban');
      chip && chip.click();
    });
    await sleep(600);
    const kartyVSekci = await page.evaluate(() => [...document.querySelectorAll('button')]
      .filter((b) => /Otevřít šablonu/.test(b.textContent || '')).length);
    ok(kartyVSekci === 2, `sekce Kanban ukazuje právě 2 šablony (${kartyVSekci})`);
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find((d) => d.className.includes('rounded-xl') && (d.textContent || '').includes('8D report — kanban'));
      const b = card && [...card.querySelectorAll('button')].find((x) => /Otevřít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || '')), { timeout: 15000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Použít šablonu/.test(x.textContent || ''));
      b && b.click();
    });
    // založení mapy + POSTy pravidel — počkat, až zmizí banner náhledu
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((b) => /Použít šablonu/.test(b.textContent || '')), { timeout: 45000 });
    await sleep(2500);
    const maps2 = (await api('GET', '/api/collections/goalmaps/records?perPage=50&sort=-created', { token: SEF })).json.items || [];
    const zGalerie = maps2.find((x) => x.title === '8D report — kanban');
    ok(!!zGalerie, 'projekt z galerie existuje');
    const rulesG = (await api('GET', `/api/kb/rules?map=${zGalerie.id}`, { token: SEF })).json.rules || [];
    ok(rulesG.length === 7, `mapa z galerie MÁ 7 pravidel — „nic to nedělá" opraveno (${rulesG.length})`);
    // kanban DESKA: 8 sloupců v JEDNÉ řadě (stejné y), žádné dvouřadé balení
    const sloupceY = [...new Set((zGalerie.nodes || [])
      .filter((n) => /^D\d/.test(String((n.data || {}).title || '')))
      .map((n) => Math.round(n.position.y)))];
    ok(sloupceY.length === 1, `sloupce D1–D8 jsou v jedné řadě (${sloupceY.length} úrovní y)`);

    console.log('== export/import PROKLIKEM: soubor z REÁLNÉ buildMapExport → dialog Importovat → souhrn s počty ==');
    // export skládá skutečná FE funkce (jako tlačítko v editoru), soubor se
    // nahraje přes dialog; navíc 1 vadné pravidlo → musí se ukázat i jantarová
    // řádka o přeskočení
    const mp = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/mapPortable.js')).href);
    const rulesExp = (await api('GET', `/api/kb/rules?map=${zGalerie.id}`, { token: SEF })).json.rules || [];
    const exportObj = mp.buildMapExport({
      map: { title: 'Import proklikem', description: '' },
      nodes: zGalerie.nodes, edges: zGalerie.edges, tasks: [],
      rules: rulesExp.concat([{ name: 'Vadné', trigger: { type: 'node_status_changed' }, actions: [{ type: 'move_node', to: 'neexistuje' }] }]),
      includePeople: true, exportedBy: 'sef@example.com',
    });
    const soubor = path.join(os.tmpdir(), 'kb-ui-import-test.kb.json');
    fs.writeFileSync(soubor, JSON.stringify(exportObj));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /Nový projekt/.test(b.textContent || '')), { timeout: 45000 });
    // šipka vedle Nový projekt → Radix menu → Importovat (vše skutečnou myší)
    const sipka = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Nový projekt/.test(x.textContent || ''));
      const arrow = b && b.parentElement.querySelector('button[aria-label]');
      if (!arrow) return null;
      const r = arrow.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    ok(!!sipka, 'šipka nabídky vedle Nový projekt');
    await page.mouse.click(sipka.x, sipka.y);
    await page.waitForFunction(() => [...document.querySelectorAll('[role="menuitem"]')].some((m) => /Importovat/.test(m.textContent || '')), { timeout: 15000 });
    const polozka = await page.evaluate(() => {
      const m = [...document.querySelectorAll('[role="menuitem"]')].find((x) => /Importovat/.test(x.textContent || ''));
      const r = m.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(polozka.x, polozka.y);
    await page.waitForSelector('input[type="file"]', { timeout: 15000 });
    const vstup = await page.$('input[type="file"]');
    await vstup.uploadFile(soubor);
    await page.waitForFunction(() => /pravidel automatizace|pravidlo automatizace/.test(document.body.innerText || ''), { timeout: 30000 });
    const souhrn = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
    ok(/Naimportován[oa]? 7 pravidel automatizace/.test(souhrn), `souhrn ukazuje 7 importovaných pravidel (${(souhrn.match(/Naimportov[^\n]*/) || [''])[0]})`);
    ok(/1 pravidlo jsme přeskočili/.test(souhrn), 'jantarová řádka přiznává 1 přeskočené pravidlo');
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Otevřít projekt/.test(x.textContent || ''));
      b && b.click();
    });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    const maps3 = (await api('GET', '/api/collections/goalmaps/records?perPage=50&sort=-created', { token: SEF })).json.items || [];
    const importovana = maps3.find((x) => x.title === 'Import proklikem');
    const rulesImp = (await api('GET', `/api/kb/rules?map=${importovana.id}`, { token: SEF })).json.rules || [];
    ok(rulesImp.length === 7, `importovaná mapa má 7 pravidel (${rulesImp.length})`);
    fs.unlinkSync(soubor);

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 120) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-SABLONY-KANBAN PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
