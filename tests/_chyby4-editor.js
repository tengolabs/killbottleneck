// Shared helpers of the `ui-chyby4-*` editor suites (code analysis 4, slices F1/F2): a signed-in
// person in an own browser context, a small map, real mouse clicks on the canvas and the toolbar.
const H = require('./_harness');
const { sleep } = H;

const NODES = () => [
  { id: 'root', type: 'apexNode', position: { x: 300, y: 0 }, data: { title: 'Vrchol', status: 'todo' } },
  { id: 'k1', type: 'goalNode', position: { x: 60, y: 260 }, data: { title: 'Krok jedna', status: 'todo' } },
  { id: 'k2', type: 'goalNode', position: { x: 560, y: 260 }, data: { title: 'Krok dva', status: 'todo' } },
];
const EDGES = () => [{ id: 'e1', source: 'root', target: 'k1' }, { id: 'e2', source: 'root', target: 'k2' }];

const zalozMapu = async (inst, token, title, extra = {}) => (await inst.api('POST', '/api/collections/goalmaps/records', {
  token, body: { title, nodes: NODES(), edges: EDGES(), ...extra },
})).json;

// "id=title/status ; …" of a stored map — what the database really holds
const mapaZDb = async (inst, token, id) => (await inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token })).json;
const uzel = (m, id) => ((m && m.nodes) || []).find((n) => n.id === id) || null;
const stav = (m, id) => { const n = uzel(m, id); return n ? ((n.data || {}).status || 'todo') : '(není)'; };
const nazev = (m, id) => { const n = uzel(m, id); return n ? ((n.data || {}).title || '') : '(není)'; };

// A signed-in person: own browser context (own storage, own connection), token in localStorage.
async function clovek(browser, inst, email, chyby, { viewport = { width: 1920, height: 1000 }, appDialogy = true } = {}) {
  const token = await inst.login(email);
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext());
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  if (chyby) {
    page.on('console', (m) => { if (m.type() === 'error' && !H.cizihoPuvodu(m)) chyby.push(m.text()); });
    page.on('pageerror', (e) => chyby.push(String(e)));
  }
  // window.confirm of the app (delete a node…) and the browser's "leave the page?" → yes
  page.on('dialog', (d) => { d.accept().catch(() => {}); });
  // the app's own confirmation dialog (delete a node, start a waiting step…) → yes as well
  if (appDialogy) await H.appDialogy(page);
  await page.evaluateOnNewDocument((tk) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: tk, record: {} }));
    try { localStorage.setItem('kb-relax-rano:' + JSON.parse(atob(tk.split('.')[1])).id, new Date().toLocaleDateString('en-CA')); } catch { /* test */ }
  }, token);
  const P = { page, ctx, token, email };
  P.otevriMapu = async (id, uzelId = 'k1') => {
    await page.goto(`${inst.base}/map/${id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector(`.react-flow__node[data-id="${uzelId}"]`, { timeout: 45000 });
    await sleep(2000); // first fingerprint after the load
  };
  // real click on the status badge of a node (cycles Založeno → Probíhá → Hotovo)
  P.klikStav = async (id) => { const b = await page.$(`.react-flow__node[data-id="${id}"] button[title]`); if (!b) return false; await b.click(); return true; };
  P.stavNaPlatne = (id) => page.evaluate((i) => (document.querySelector(`.react-flow__node[data-id="${i}"] button[title]`) || {}).innerText || '', id);
  P.uzlyNaPlatne = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')));
  // visible button by its title / visible text (real click)
  P.klikTitulek = async (zacatek) => {
    const h = await page.evaluateHandle((z) => [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').startsWith(z) && !x.disabled && x.offsetParent !== null) || null, zacatek);
    const el = h.asElement(); if (!el) return false; await el.click(); return true;
  };
  P.klikText = async (text, koren = 'body') => {
    const h = await page.evaluateHandle((t, k) => [...document.querySelectorAll(`${k} button, ${k} [role="menuitem"], ${k} a`)].find((x) => (x.innerText || '').trim().startsWith(t) && !x.disabled && x.offsetParent !== null) || null, text, koren);
    const el = h.asElement(); if (!el) return false; await el.click(); return true;
  };
  P.zpetAktivni = () => page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').startsWith('Vrátit zpět') && x.offsetParent !== null); return b ? !b.disabled : null; });
  // hover the node and click one of its action buttons (title starts with…)
  P.akceUzlu = async (id, zacatek) => {
    const n = await page.$(`.react-flow__node[data-id="${id}"]`); if (!n) return false;
    await n.hover(); await sleep(250);
    const h = await page.evaluateHandle((i, z) => [...document.querySelectorAll(`.react-flow__node[data-id="${i}"] button`)].find((x) => (x.getAttribute('title') || '').startsWith(z)) || null, id, zacatek);
    const el = h.asElement(); if (!el) return false; await el.click(); return true;
  };
  P.otevriDialog = async (id) => {
    const n = await page.$(`.react-flow__node[data-id="${id}"]`); if (!n) return false;
    await n.click({ clickCount: 2 });
    return page.waitForSelector('[role="dialog"] #title', { timeout: 8000 }).then(() => true).catch(() => false);
  };
  P.toasty = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="toast-viewport"] > div')].map((x) => (x.innerText || '').replace(/\s+/g, ' ').trim()).filter(Boolean));
  P.pruhUlozeni = () => page.evaluate(() => { const el = document.querySelector('[data-testid="save-error"]'); return el ? { kind: el.getAttribute('data-kind'), text: (el.innerText || '').replace(/\s+/g, ' ').trim() } : null; });
  P.indikator = () => page.evaluate(() => { const el = [...document.querySelectorAll('[data-testid="save-status"]')].find((x) => x.offsetParent !== null) || document.querySelector('[data-testid="save-status"]'); return el ? (el.getAttribute('data-stav') || '') : ''; });
  return P;
}

const cekej = (fn, ms = 10000, popis = 'podmínka') => H.waitFor(fn, { timeout: ms, popis }).then(() => true).catch(() => false);

module.exports = { NODES, EDGES, zalozMapu, mapaZDb, uzel, stav, nazev, clovek, cekej };
