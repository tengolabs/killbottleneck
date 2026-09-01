// UI e2e: AUTOSAVE PŘI ODCHODU Z MAPY + ZPĚT PO ZAROVNAT (nálezy F1-04, F1-02,
// analýza kódu 27. 8. 2026).
//   • Úprava mapy a do 1,2 s odchod na jinou stránku aplikace → dřív se úprava
//     tiše ztratila (cleanup efektu jen zrušil časovač). Teď se odešle hned.
//   • Zarovnat → Zpět: dřív `skipNextSave` vrácený stav NEuložil — plátno
//     ukazovalo původní, DB držela zarovnané. Teď otisk pošle skutečný rozdíl.
// Měří se Z API (DB), ne z plátna. Na obrazu PŘED opravou musí být rudá.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-autosave-odchod';
const PORT = 20643;
const BASE = `http://127.0.0.1:${PORT}`;
const EMAIL = 'editor@example.com';
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const cizihoPuvodu = (m) => /fonts\.g|favicon|ERR_NETWORK_CHANGED/.test(m.text() || '');

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    await api('POST', '/api/collections/users/records', { body: { email: EMAIL, password: PW, passwordConfirm: PW, name: 'Editor', role: 'admin' } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: EMAIL, password: PW } })).json.token;
    // schválně NEzarovnané pozice, ať Zarovnat něco změní
    const nodes = [
      { id: 'root', type: 'apexNode', position: { x: 300, y: 0 }, data: { title: 'Cíl', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 40, y: 260 }, data: { title: 'Alfa', status: 'todo' } },
      { id: 'n2', type: 'goalNode', position: { x: 620, y: 410 }, data: { title: 'Beta', status: 'todo' } },
    ];
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Autosave odchod', nodes, edges: [{ id: 'e1', source: 'root', target: 'n1' }, { id: 'e2', source: 'root', target: 'n2' }],
    } })).json;
    expect(!!map.id, 'mapa založena');
    const poziceZApi = async () => {
      const m = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
      return Object.fromEntries((m.nodes || []).map((n) => [n.id, n.position]));
    };

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 }); // široká lišta: Zarovnat i Zpět jsou tlačítka, ne ⋮ menu
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', EMAIL);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1000);

    console.log('== úprava názvu uzlu a do 1,2 s odchod z mapy → změna je v DB (F1-04) ==');
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node[data-id="n1"]', { timeout: 45000 });
    await sleep(2500); // po načtení nechat proběhnout případný první otisk
    const dblclickNa = (hledany) => page.evaluate((h) => {
      const el = [...document.querySelectorAll('.react-flow__node *')].find((x) => (x.innerText || '').trim() === h);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return true;
    }, hledany);
    expect(await dblclickNa('Alfa'), 'dialog uzlu Alfa otevřen dvojklikem');
    await page.waitForSelector('[role="dialog"] #title', { timeout: 8000 });
    await page.click('[role="dialog"] #title', { clickCount: 3 });
    await page.keyboard.type('Alfa PO ODCHODU');
    const ulozeno = await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^Uložit/.test((x.innerText || '').trim()) && !x.disabled);
      if (!b) return false; b.click(); return true;
    });
    expect(ulozeno, 'klik na Uložit v dialogu');
    await sleep(250); // dialog zavře, autosave má časovač 1,2 s → odejít DŘÍV
    // odchod uvnitř aplikace (SPA) — editor nemá horní lištu, proto přechod
    // routeru jako při kliku na odkaz (pushState + popstate)
    await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await sleep(300);
    expect(await page.evaluate(() => location.pathname === '/' && !document.querySelector('.react-flow__node')), 'odchod na jinou stránku aplikace do 1,2 s');
    await sleep(2500);
    const poOdchodu = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    const titulN1 = ((poOdchodu.nodes || []).find((n) => n.id === 'n1') || { data: {} }).data.title;
    expect(titulN1 === 'Alfa PO ODCHODU', `úprava je v DB i po okamžitém odchodu (název n1: "${titulN1}")`);

    console.log('== přechod mapa A → mapa B odkazem UVNITŘ editoru: úprava A v DB, B netknutá (panel 27. 8.) ==');
    // route /map/:id nemá key → komponenta se nepřemontuje; flush musí běžet
    // v cleanupu načtení mapy, ještě s uzly A (dřív by PATCH A nesl uzly B)
    const mapB = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Mapa B', nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { title: 'Cíl B', status: 'todo' } },
        { id: 'b1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Gama', status: 'todo' } },
      ], edges: [{ id: 'e1', source: 'root', target: 'b1' }],
    } })).json;
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node[data-id="n2"]', { timeout: 45000 });
    await sleep(2500);
    expect(await dblclickNa('Beta'), 'dialog uzlu Beta otevřen');
    await page.waitForSelector('[role="dialog"] #title', { timeout: 8000 });
    await page.click('[role="dialog"] #title', { clickCount: 3 });
    await page.keyboard.type('Beta PO PRECHODU');
    expect(await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^Uložit/.test((x.innerText || '').trim()) && !x.disabled);
      if (!b) return false; b.click(); return true;
    }), 'klik na Uložit v dialogu (mapa A)');
    await sleep(250);
    await page.evaluate((id) => { window.history.pushState({}, '', `/map/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, mapB.id);
    await page.waitForSelector('.react-flow__node[data-id="b1"]', { timeout: 45000 }).catch(() => {});
    await sleep(3000);
    const aPo = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    const bPo = (await api('GET', `/api/collections/goalmaps/records/${mapB.id}`, { token: A })).json;
    const titulN2 = ((aPo.nodes || []).find((n) => n.id === 'n2') || { data: {} }).data.title;
    expect(titulN2 === 'Beta PO PRECHODU', `úprava mapy A je v DB i po přechodu na mapu B (n2: "${titulN2}")`);
    expect((aPo.nodes || []).length === 3 && !(aPo.nodes || []).some((n) => n.id === 'b1'), `mapa A nese své 3 uzly, ne uzly B (${(aPo.nodes || []).map((n) => n.id).join(',')})`);
    expect((bPo.nodes || []).length === 2 && (bPo.nodes || []).some((n) => n.id === 'b1'), `mapa B je netknutá (${(bPo.nodes || []).map((n) => n.id).join(',')})`);

    console.log('== Zarovnat → Zpět: v DB je zase stav před zarovnáním (F1-02) ==');
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node[data-id="n2"]', { timeout: 45000 });
    await sleep(2500);
    const predZarovnanim = await poziceZApi();
    const klik = (hledany) => page.evaluate((h) => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '').startsWith(h) && !x.disabled && x.offsetParent !== null);
      if (!b) return false; b.click(); return true;
    }, hledany);
    expect(await klik('Zarovnat'), 'tlačítko Zarovnat je v liště');
    await sleep(3000); // zarovnání + autosave (1,2 s)
    const poZarovnani = await poziceZApi();
    const zmenilo = ['n1', 'n2'].some((id) => Math.abs(poZarovnani[id].x - predZarovnanim[id].x) > 5 || Math.abs(poZarovnani[id].y - predZarovnanim[id].y) > 5);
    expect(zmenilo, 'Zarovnat změnilo pozice a uložilo je');
    expect(await klik('Vrátit zpět'), 'tlačítko Zpět je v liště a je aktivní');
    await sleep(3000);
    const poZpet = await poziceZApi();
    const vraceno = ['n1', 'n2'].every((id) => Math.abs(poZpet[id].x - predZarovnanim[id].x) < 2 && Math.abs(poZpet[id].y - predZarovnanim[id].y) < 2);
    expect(vraceno, `Zpět se ULOŽILO — DB drží stav před zarovnáním (n1 ${JSON.stringify(poZpet.n1)} vs ${JSON.stringify(predZarovnanim.n1)})`);

    console.log('== síťový rozpočet editoru: přidat uzel (+ na kartě, dialog) → přejmenovat mapu → autosave → Zpět ==');
    // KOTVA: počty požadavků na mapu během jednoho deterministického scénáře.
    // Naměřeno 28. 8. 2026 před rozkladem autosave (F1-07 krok 13); růst =
    // regrese (autosave/hlídač/merge by posílal víc, než posílal). Počítá se
    // AŽ od otevřené a usazené mapy, ať do toho nepadá načtení. Uzel se přidává
    // tlačítkem + na kartě (plní historii Zpět — od 1. 9. 2026 ji plní i „Přidat cíl" v liště)
    // a pojmenuje se v dialogu.
    const sit = { PATCH: 0, GET: 0, POST: 0, on: false };
    page.on('request', (req) => {
      if (!sit.on) return;
      const u = req.url();
      const m = req.method();
      if (/\/api\/collections\/goalmaps\/records\//.test(u)) {
        if (m === 'PATCH') sit.PATCH++;
        else if (m === 'GET') sit.GET++;
      } else if (m === 'POST' && /\/api\/kb\//.test(u)) sit.POST++;
    });
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node[data-id="n2"]', { timeout: 45000 });
    await sleep(2500);
    sit.on = true;
    expect(await page.evaluate(() => {
      const karta = document.querySelector('.react-flow__node[data-id="n1"]');
      const b = karta && [...karta.querySelectorAll('button')].find((x) => (x.getAttribute('title') || '') === 'Přidat podcíl');
      if (!b) return false; b.click(); return true;
    }), 'klik na + (Přidat podcíl) na kartě Alfa');
    await sleep(800);
    expect(await dblclickNa('Nový podcíl'), 'dialog nového uzlu otevřen dvojklikem');
    await page.waitForSelector('[role="dialog"] #title', { timeout: 8000 });
    await page.click('[role="dialog"] #title', { clickCount: 3 });
    await page.keyboard.type('Delta ze site');
    expect(await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^Uložit/.test((x.innerText || '').trim()) && !x.disabled);
      if (!b) return false; b.click(); return true;
    }), 'klik na Uložit v dialogu nového uzlu');
    await sleep(600); // dialog zavře; autosave má časovač 1,2 s — přejmenování ho posune
    const nazevPole = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '') === 'Autosave odchod');
      if (!b) return false;
      b.click();
      return true;
    });
    expect(nazevPole, 'klik na název mapy otevřel přejmenování');
    await sleep(600);
    expect(await page.evaluate(() => {
      const el = [...document.querySelectorAll('input')].find((i) => i.value === 'Autosave odchod');
      if (!el) return false; el.focus(); el.setSelectionRange(0, el.value.length); return true;
    }), 'pole názvu je vybrané');
    await page.keyboard.type('Autosave sit');
    await page.keyboard.press('Enter');
    await sleep(2000); // autosave (1,2 s)
    expect(await klik('Vrátit zpět'), 'Zpět je aktivní');
    await sleep(2000); // autosave po Zpět
    sit.on = false;
    console.log(`   síť: PATCH ${sit.PATCH}, GET ${sit.GET}, POST ${sit.POST}`);
    // horní meze = max ze dvou běhů na obrazu kb-analyza-d10 (28. 8. 2026):
    // 2× PATCH 3 / GET 0 / POST 0 (přidání+dialog, přejmenování, Zpět)
    expect(sit.PATCH <= 3, `PATCH mapy ≤ 3 (kotva; ${sit.PATCH})`);
    expect(sit.GET <= 0, `GET mapy ≤ 0 (kotva; ${sit.GET})`);
    expect(sit.POST <= 0, `POST /api/kb ≤ 0 (kotva; ${sit.POST})`);
    const poSiti = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    expect(poSiti.title === 'Autosave sit' && !(poSiti.nodes || []).some((n) => n.data?.title === 'Delta ze site'),
      `DB po Zpět: název přejmenovaný, přidaný uzel vrácený („${poSiti.title}", uzlů ${(poSiti.nodes || []).length})`);
    expect(errs.length === 0, `konzole bez chyb (${errs.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (err) {
    fail++; console.log('  ❌ výjimka', err.message);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail ? '🔴' : '🟢'} UI AUTOSAVE ODCHOD PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
