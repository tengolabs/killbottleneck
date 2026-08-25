// Termín smí měnit jen zadavatel (vlastník mapy) — Richardův nález 7. 8. 2026:
// zodpovědná osoba (sdílený editor) si v dialogu cíle přepsala termín zadaný
// vlastníkem. Model 27. 7.: „termín je dohoda a mění se výhradně vědomě."
//
// Hlídá serverové pravidlo na PATCH goalmaps (autosave i REST posílají celé
// pole nodes, UI zámek je jen půlka pravdy) a zámek pole v NodeEditDialog.
// Mutační pojistky: povolené cesty MUSÍ projít — první nastavení termínu
// editorem, editace jiných polí editorem a změna termínu vlastníkem.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-termin-prava';
const PORT = 20545;
const BASE = `http://127.0.0.1:${PORT}`;
const VLASTNIK = { email: 'vlastnik@e2e.cz', password: 'TajneHeslo.2026' };
const EDITOR = { email: 'editor@e2e.cz', password: 'TajneHeslo.2026' };
const TERMIN = '2026-08-08';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}

async function registerAndLogin(u) {
  await api('POST', '/api/collections/users/records', {
    body: { email: u.email, password: u.password, passwordConfirm: u.password },
  });
  const auth = await api('POST', '/api/collections/users/auth-with-password', {
    body: { identity: u.email, password: u.password },
  });
  return auth.json.token;
}

// celé pole nodes jako autosave — vrchol musí zůstat (err.apexRequired)
function nodes({ n1deadline = TERMIN, n1title = 'S termínem', n2deadline = '' } = {}) {
  return [
    { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 },
      data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 100, y: 380 },
      data: { title: n1title, status: 'todo', deadline: n1deadline, owner: EDITOR.email } },
    { id: 'n2', type: 'goalNode', position: { x: 500, y: 380 },
      data: { title: 'Bez termínu', status: 'todo', deadline: n2deadline } },
  ];
}
const EDGES = [
  { id: 'e1', source: 'apex', target: 'n1' },
  { id: 'e2', source: 'apex', target: 'n2' },
];

async function loginUI(page, u) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', u.email);
  await page.type('#password', u.password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1500);
}

// otevře dialog úprav uzlu „S termínem" (tužka na kruhu) a vrátí stav pole termínu
async function deadlineFieldState(page, mapId) {
  await page.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.react-flow__node', { timeout: 15000 });
  await sleep(2000);
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('S termínem'));
    n?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await sleep(400);
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('.react-flow__node')].find((x) => (x.innerText || '').includes('S termínem'));
    const tuzka = [...(n?.querySelectorAll('button') || [])].find((b) => b.querySelector('.lucide-pencil'));
    tuzka?.click();
  });
  // editor mapy má od 14. 8. 2026 VELKÉ okno s kategoriemi — termín bydlí
  // v kategorii „Zadání"; work sdílení dostává zjednodušené okno bez kategorií,
  // tahle sada ale testuje editora/vlastníka (edit sdílení)
  await page.waitForSelector('[role="dialog"] [data-cat="assignment"]', { timeout: 8000 });
  await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="assignment"]').click());
  await page.waitForSelector('[role="dialog"] #deadline', { timeout: 8000 });
  return page.evaluate(() => {
    const btn = document.querySelector('[role="dialog"] #deadline');
    const dlg = btn?.closest('[role="dialog"]');
    return { disabled: !!btn?.disabled, hint: (dlg?.innerText || '').includes('zadavatel') };
  });
}

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ } await sleep(1000); }

    const tokenV = await registerAndLogin(VLASTNIK);
    const tokenE = await registerAndLogin(EDITOR);

    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: tokenV,
      body: {
        title: 'Termíny', nodes: nodes(), edges: EDGES,
        shared_with: [EDITOR.email], shared_with_edit: [EDITOR.email],
      },
    });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena a sdílena s právem editace (${mapa.status})`);

    console.log('== server: editor NESMÍ změnit ani smazat existující termín ==');
    const zmena = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: tokenE, body: { nodes: nodes({ n1deadline: '2026-08-20' }), edges: EDGES },
    });
    expect(zmena.status === 400, `PATCH editora s posunutým termínem odmítnut (${zmena.status})`);
    expect(JSON.stringify(zmena.json || {}).includes('zadavatel'), 'chyba vysvětluje, že termín mění jen zadavatel');
    const smazani = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: tokenE, body: { nodes: nodes({ n1deadline: '' }), edges: EDGES },
    });
    expect(smazani.status === 400, `PATCH editora se smazaným termínem odmítnut (${smazani.status})`);
    const stale = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: tokenV });
    const n1 = (stale.json?.nodes || []).find((n) => n.id === 'n1');
    expect(n1?.data?.deadline === TERMIN, `termín v DB nedotčen (${n1?.data?.deadline})`);

    console.log('== mutační pojistky: povolené cesty projít MUSÍ ==');
    const jinaPole = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: tokenE, body: { nodes: nodes({ n1title: 'S termínem (přejmenováno)' }), edges: EDGES },
    });
    expect(jinaPole.status === 200, `editor smí dál měnit ostatní pole uzlu (${jinaPole.status})`);
    const prvni = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: tokenE, body: { nodes: nodes({ n1title: 'S termínem (přejmenováno)', n2deadline: '2026-09-01' }), edges: EDGES },
    });
    expect(prvni.status === 200, `první nastavení termínu na uzlu bez termínu projde (${prvni.status})`);
    const vlastnik = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, {
      token: tokenV, body: { nodes: nodes({ n1title: 'S termínem (přejmenováno)', n1deadline: '2026-08-15', n2deadline: '2026-09-01' }), edges: EDGES },
    });
    expect(vlastnik.status === 200, `vlastník (zadavatel) termín změní (${vlastnik.status})`);

    console.log('== UI: pole termínu je pro editora zamčené, pro vlastníka ne ==');
    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const pageE = await browser.newPage();
    await pageE.setViewport({ width: 1600, height: 950 });
    await loginUI(pageE, EDITOR);
    const stavE = await deadlineFieldState(pageE, mapId);
    expect(stavE.disabled, 'editor: DatePicker termínu je disabled');
    expect(stavE.hint, 'editor: dialog vysvětluje, že termín mění jen zadavatel');

    const ctxV = await browser.createBrowserContext();
    const pageV = await ctxV.newPage();
    await pageV.setViewport({ width: 1600, height: 950 });
    await loginUI(pageV, VLASTNIK);
    const stavV = await deadlineFieldState(pageV, mapId);
    expect(!stavV.disabled, 'vlastník: DatePicker termínu je aktivní');
    expect(!stavV.hint, 'vlastník: žádná hláška o zadavateli');
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
