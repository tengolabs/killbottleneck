// ZADAVATELSKÝ MODEL TERMÍNŮ NA UZLECH (Richard 7. 8. 2026 večer):
// zadavatel úkolu = kdo PRVNÍ nastavil termín (serverové razítko assignedBy);
// existující termín mění a uzel s termínem odstraňuje jen zadavatel nebo
// vlastník mapy. Rozšiřuje dřívější owner-only hotfix (fix/termin-jen-zadavatel)
// — editor, který si úkol zadal sám, ho nově smí spravovat (a smazat).
// Mazání cizího zadání = „odstranění důkazu" → 400 i pro editora.
//
// Mutační pojistky: podvržené razítko v PATCHi server přerazítkuje; razítko
// vzniká i při založení mapy a přes v1 API; public-maps e-mail neleakuje.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-uzel-zadavatel';
const PORT = 20547;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TajneHeslo.2026';
const VLASTNIK = 'vlastnik@e2e.cz';
const E1 = 'editor1@e2e.cz';
const E2 = 'editor2@e2e.cz';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, bearer, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

const node = (id, data, x) => ({ id, type: 'goalNode', position: { x, y: 380 }, data });
const APEX = { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } };
const EDGES = [{ id: 'e1', source: 'apex', target: 'nA' }, { id: 'e2', source: 'apex', target: 'nB' }];

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ } await sleep(1000); }

    await reg(VLASTNIK); await reg(E1); await reg(E2);
    const V = await login(VLASTNIK), T1 = await login(E1), T2 = await login(E2);

    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: V,
      body: {
        title: 'Zadavatelé', shared_with: [E1, E2], shared_with_edit: [E1, E2],
        nodes: [APEX,
          node('nA', { title: 'Bez termínu', status: 'todo' }, 100),
          node('nB', { title: 'Vlastníkův úkol', status: 'todo', deadline: '2026-08-20', owner: E1 }, 500),
        ],
        edges: EDGES,
      },
    });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena (${mapa.status})`);

    const getNodes = async (token) => (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token })).json?.nodes || [];
    const byId = (nodes, id) => nodes.find((n) => n.id === id);

    console.log('== razítko zadavatele ==');
    let ns = await getNodes(V);
    expect(byId(ns, 'nB')?.data?.assignedBy === VLASTNIK, `úkol z founding PATCHe má zadavatele vlastníka (${byId(ns, 'nB')?.data?.assignedBy})`);

    // E1 nastaví první termín na nA a zkusí podvrhnout razítko
    const patchNodes = (mods) => {
      // mods: {id: {data changes} | null (smazat)}
      const base = { apex: APEX.data, nA: byId(ns, 'nA')?.data, nB: byId(ns, 'nB')?.data };
      const out = [];
      for (const id of ['apex', 'nA', 'nB']) {
        if (mods[id] === null) continue;
        const src = id === 'apex' ? APEX : node(id, {}, id === 'nA' ? 100 : 500);
        out.push({ ...src, data: { ...base[id], ...(mods[id] || {}) } });
      }
      return out;
    };
    let r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T1, body: { nodes: patchNodes({ nA: { deadline: '2026-09-01', assignedBy: 'podvrh@e2e.cz' } }), edges: EDGES },
    });
    expect(r.status === 200, `editor nastavil první termín (${r.status})`);
    ns = await getNodes(V);
    expect(byId(ns, 'nA')?.data?.assignedBy === E1, `server přerazítkoval podvrh na skutečného aktéra (${byId(ns, 'nA')?.data?.assignedBy})`);

    console.log('== práva ke změně termínu podle zadavatele ==');
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T1, body: { nodes: patchNodes({ nA: { deadline: '2026-09-05' } }), edges: EDGES },
    });
    expect(r.status === 200, `editor-zadavatel svůj termín změní (${r.status})`);
    ns = await getNodes(V);
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T2, body: { nodes: patchNodes({ nA: { deadline: '2026-12-31' } }), edges: EDGES },
    });
    expect(r.status === 400, `druhý editor cizí termín nezmění (${r.status})`);
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T1, body: { nodes: patchNodes({ nB: { deadline: '2026-12-31' } }), edges: EDGES },
    });
    expect(r.status === 400, `editor nezmění termín zadaný vlastníkem (${r.status})`);

    console.log('== mazání uzlu s termínem = jen zadavatel/vlastník ==');
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T2, body: { nodes: patchNodes({ nA: null }), edges: [EDGES[1]] },
    });
    expect(r.status === 400, `druhý editor cizí úkol nesmaže (${r.status})`);
    expect(JSON.stringify(r.json || {}).includes('zadavatel'), 'chyba vysvětluje, kdo smí uzel odstranit');
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T1, body: { nodes: patchNodes({ nB: null }), edges: [EDGES[0]] },
    });
    expect(r.status === 400, `editor nesmaže úkol zadaný vlastníkem (${r.status})`);
    // obchvat: převod uzlu na poznámku = taky odstranění úkolu z modelu
    const noteNodes = patchNodes({}).map((n) => (n.id === 'nB' ? { ...n, type: 'note' } : n));
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T1, body: { nodes: noteNodes, edges: EDGES },
    });
    expect(r.status === 400, `editor cizí úkol neschová ani převodem na poznámku (${r.status})`);

    console.log('== UI: dialog ukazuje zadavatele a zamyká pole ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const dialogState = async (email) => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1600, height: 950 });
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#email');
      await page.type('#email', email);
      await page.type('#password', PW);
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
      await sleep(1500);
      await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('.react-flow__node', { timeout: 15000 });
      await sleep(2000);
      await page.evaluate(() => {
        const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Bez termínu'));
        const tuzka = [...(n?.querySelectorAll('button') || [])].find((b) => b.querySelector('.lucide-pencil'));
        tuzka?.click();
      });
      // editor mapy má od 14. 8. 2026 VELKÉ okno s kategoriemi — termín je v „Zadání"
      await page.waitForSelector('[role="dialog"] [data-cat="assignment"]', { timeout: 8000 });
      await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="assignment"]').click());
      await page.waitForSelector('[role="dialog"] #deadline', { timeout: 8000 });
      const st = await page.evaluate(() => {
        const btn = document.querySelector('[role="dialog"] #deadline');
        const txt = btn?.closest('[role="dialog"]')?.innerText || '';
        return { disabled: !!btn?.disabled, text: txt };
      });
      await ctx.close();
      return st;
    };
    const stE1 = await dialogState(E1);
    expect(!stE1.disabled, 'editor-zadavatel: pole termínu aktivní');
    const stE2 = await dialogState(E2);
    expect(stE2.disabled, 'druhý editor: pole termínu zamčené');
    expect(stE2.text.includes(E1), `dialog ukazuje skutečného zadavatele (${E1})`);

    console.log('== mutační pojistky: zadavatel a vlastník mažou ==');
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: T1, body: { nodes: patchNodes({ nA: null }), edges: [EDGES[1]] },
    });
    expect(r.status === 200, `editor-zadavatel svůj úkol smaže (${r.status})`);
    ns = await getNodes(V);
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: V, body: { nodes: [APEX], edges: [] },
    });
    expect(r.status === 200, `vlastník smaže i cizí zadání (${r.status})`);

    console.log('== v1 API razítkuje taky ==');
    const vKey = (await api('POST', '/api/flowmap/api-keys', { token: V, body: { label: 'rw', scope: 'read_write' } })).json.token;
    const ver = (await api('GET', `/api/flowmap/v1/maps/${mapId}`, { bearer: vKey })).json.updated;
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes`, {
      bearer: vKey, body: { base_updated: ver, items: [{ title: 'API úkol', deadline: '2026-10-01' }] },
    });
    expect(r.status === 200, `v1 add_nodes prošel (${r.status})`);
    ns = await getNodes(V);
    const apiNode = ns.find((n) => (n.data || {}).title === 'API úkol');
    expect(apiNode?.data?.assignedBy === VLASTNIK, `uzel z v1 API má zadavatele (${apiNode?.data?.assignedBy})`);

    console.log('== public-maps neleakuje zadavatele ==');
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: V, body: { is_public: true } });
    expect(r.status === 200, `mapa zveřejněna (${r.status})`);
    r = await api('POST', '/api/kb/public-maps', { body: { mapId } });
    const pub = JSON.stringify(r.json || {});
    expect(r.status === 200 && !pub.includes('assignedBy') && !pub.includes('@e2e.cz'), 'veřejný DTO bez razítka a e-mailů');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
