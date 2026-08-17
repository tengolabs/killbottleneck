// Třetí úroveň sdílení „spolupracovník" (work) — Richard 7. 8. 2026:
// vidí mapu, mění stav JEN u svých úkolů (garant uzlu / řešitel úkolu na uzlu),
// komentuje; mapu jinak needituje. Zapisuje výhradně routou /node-status —
// goalmaps updateRule ho záměrně NEpouští (edit-práva na celý JSON nodes
// byla zdrojem děr). Auto-sdílení při přiřazení garanta nově dává work, ne edit.
//
// Mutační pojistky: povolené cesty MUSÍ projít (vlastní uzel, řešitelský uzel,
// editor kterýkoli uzel, komentář) a změna se musí propsat do mapy i záznamníku.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-spoluprace-work';
const PORT = 20548;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TajneHeslo.2026';
const VLASTNIK = 'vlastnik@e2e.cz';
const WORKER = 'spolupracovnik@e2e.cz';
const CTENAR = 'ctenar@e2e.cz';
const EDITOR = 'editor@e2e.cz';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ } await sleep(1000); }

    await reg(VLASTNIK); await reg(WORKER); await reg(CTENAR); await reg(EDITOR);
    const V = await login(VLASTNIK), W = await login(WORKER), R = await login(CTENAR), E = await login(EDITOR);
    // SLOVNÍK 17. 8. 2026: položky sází superuser (uživatelský create = 403)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const vId = ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email='${VLASTNIK}'`)}`, { token: ST })).json.items || [])[0].id;
    const suTask = (body) => api('POST', '/api/collections/tasks/records', { token: ST, body: { owner: vId, owner_email: VLASTNIK, ...body } });

    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: V,
      body: {
        title: 'Spolupráce',
        nodes: [
          { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } },
          { id: 'n1', type: 'goalNode', position: { x: 100, y: 380 }, data: { title: 'Můj úkol', status: 'todo', owner: WORKER } },
          { id: 'n2', type: 'goalNode', position: { x: 500, y: 380 }, data: { title: 'Cizí krok', status: 'todo' } },
        ],
        edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }],
      },
    });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena (${mapa.status})`);

    console.log('== sdílení tří úrovní přes /share ==');
    let r = await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: WORKER, permission: 'work' } });
    expect(r.status === 200 && r.json?.member?.permission === 'work', `sdíleno jako spolupracovník (${r.status}/${r.json?.member?.permission})`);
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: CTENAR, permission: 'read' } });
    expect(r.status === 200, `sdíleno pro čtení (${r.status})`);
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: EDITOR, permission: 'edit' } });
    expect(r.status === 200, `sdíleno pro editaci (${r.status})`);
    r = await api('POST', '/api/kb/share', { token: V, body: { action: 'list', mapId } });
    const perms = Object.fromEntries((r.json?.members || []).map((m) => [m.email, m.permission]));
    expect(perms[WORKER] === 'work' && perms[CTENAR] === 'read' && perms[EDITOR] === 'edit',
      `list vrací úrovně (${JSON.stringify(perms)})`);

    console.log('== spolupracovník: čte, ale mapu needituje ==');
    r = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: W });
    expect(r.status === 200, `spolupracovník mapu přečte (${r.status})`);
    const origNodes = r.json?.nodes || [];
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: W, body: { nodes: origNodes, edges: r.json?.edges || [] } });
    expect(r.status !== 200, `PATCH mapy spolupracovníkem neprojde — RLS (${r.status})`);

    console.log('== /node-status: vlastní uzel ano, cizí ne ==');
    r = await api('POST', '/api/kb/node-status', { token: W, body: { mapId, nodeId: 'n1', status: 'done' } });
    expect(r.status === 200, `spolupracovník označil SVŮJ uzel hotový (${r.status})`);
    r = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: V });
    expect((r.json?.nodes || []).find((n) => n.id === 'n1')?.data?.status === 'done', 'stav se propsal do mapy');
    r = await api('GET', `/api/flowmap/map-changes?map=${mapId}&range=7`, { token: V });
    const done = (r.json?.groups?.done || []).filter((x) => x.id === 'n1' && x.actor === WORKER);
    expect(done.length === 1, `změna je v záznamníku s aktérem spolupracovníka (${done.length})`);
    r = await api('POST', '/api/kb/node-status', { token: W, body: { mapId, nodeId: 'n2', status: 'done' } });
    expect(r.status === 403, `cizí uzel spolupracovník nezmění (${r.status})`);
    r = await api('POST', '/api/kb/node-status', { token: R, body: { mapId, nodeId: 'n1', status: 'todo' } });
    expect(r.status === 403, `čtenář přes routu nic nezmění (${r.status})`);
    r = await api('POST', '/api/kb/node-status', { token: E, body: { mapId, nodeId: 'n2', status: 'in_progress' } });
    expect(r.status === 200, `editor přes routu smí kterýkoli uzel (${r.status})`);

    console.log('== řešitel úkolu na uzlu smí jeho stav taky ==');
    r = await suTask({ title: 'Podúkol pro spolupracovníka', status: 'todo', map: mapId, node_id: 'n2', assignee_email: WORKER });
    expect(r.status === 200, `zbytková položka na uzlu založena superuserem (${r.status})`);
    r = await api('POST', '/api/kb/node-status', { token: W, body: { mapId, nodeId: 'n2', status: 'done' } });
    expect(r.status === 200, `s úkolem na uzlu už spolupracovník stav změní (${r.status})`);

    console.log('== komentáře a vlastní task ==');
    r = await api('POST', '/api/collections/comments/records', {
      token: W, body: { goalmap: mapId, node_id: 'n1', text: 'Hotovo, mrkněte.' },
    });
    expect(r.status === 200, `spolupracovník komentuje (${r.status})`);
    const task = await suTask({ title: 'Task pro workera', status: 'todo', map: mapId, node_id: 'n1', assignee_email: WORKER });
    r = await api('PATCH', `/api/collections/tasks/records/${task.json.id}`, { token: W, body: { status: 'done' } });
    expect(r.status === 200, `svůj úkolový záznam odškrtne (${r.status})`);

    console.log('== UI: badge spolupracovníka + klik na stav vlastního uzlu ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 950 });
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', WORKER);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);
    await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 15000 });
    await sleep(2000);
    const badge = await page.evaluate(() => document.body.innerText.includes('Spolupracovník'));
    expect(badge, 'hlavička ukazuje badge spolupracovníka');
    // klik na stavový štítek vlastního uzlu (n1, teď done) → cykluje na todo přes routu
    await page.evaluate(() => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Můj úkol'));
      const btn = n?.querySelector('button');
      btn?.click();
    });
    await sleep(1500);
    const stav = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: V });
    const n1status = (stav.json?.nodes || []).find((n) => n.id === 'n1')?.data?.status;
    expect(n1status === 'todo', `klik ve UI cykloval stav přes routu (${n1status})`);
    console.log('== stránka Úkoly: odškrtnutí vlastního uzlu jde přes fallback ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const clicked = await page.evaluate(() => {
      const row = [...document.querySelectorAll('tr')].find((x) => (x.innerText || '').includes('Můj úkol'));
      const btn = row?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    });
    expect(clicked, 'řádek vlastního uzlu má klikatelný stav');
    await sleep(2000);
    const poKliku = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: V });
    const n1po = (poKliku.json?.nodes || []).find((n) => n.id === 'n1')?.data?.status;
    expect(n1po !== 'todo', `stav se změnil i ze stránky Úkoly — fallback /node-status funguje (${n1po})`);

    const tuzky = await page.evaluate(() => {
      const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('Cizí krok'));
      return [...(n?.querySelectorAll('button') || [])].filter((b) => b.querySelector('.lucide-pencil')).length;
    });
    expect(tuzky === 0, `mapa zůstává read-only — bez tužky na uzlech (${tuzky})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
