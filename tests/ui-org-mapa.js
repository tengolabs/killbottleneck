// UI e2e: ORGANIZAČNÍ STRUKTURA očima správce:
//  - Správa organizace: sekce struktury → založení org mapy klikem → editor
//  - uzly org mapy = karty POZIC (badge druhu, „neobsazeno", zástupce)
//  - dialog uzlu má jedinou kategorii Pozice: obsazení holder+deputy klikem
//  - tabulka ve Správě organizace ukazuje TOTÉŽ a zápis z ní se propíše
//    do mapy (jeden zdroj pravdy oběma směry)
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-org';
const PORT = 20801;
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
    execSync(`docker run -d --name ${NAME} -e KB_PURPOSE_ASK=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await api('POST', '/api/collections/users/records', { body: { email: 'sef@example.com', password: PW, passwordConfirm: PW } }); // první = admin
    await api('POST', '/api/collections/users/records', { body: { email: 'kolega@example.com', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/users/records', { body: { email: 'zastupce@example.com', password: PW, passwordConfirm: PW } });
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);

    console.log('== založení org mapy ze Správy organizace ==');
    await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="org-structure-section"]')), 'sekce Organizační struktura je na stránce');
    await page.evaluate(() => document.querySelector('[data-testid="org-create"]')?.click());
    await sleep(2500);
    ok(page.url().includes('/map/'), 'založení přesměrovalo do editoru mapy');
    const orgId = page.url().split('/map/')[1];
    const orgMap = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: SEF })).json;
    ok(orgMap.kind === 'org', 'založená mapa má kind=org');

    console.log('== karty pozic v mapě ==');
    // pozice nakreslíme přes API (drag&drop kreslení kryje běžný editor test)
    const apexId = (orgMap.nodes || []).find((n) => n.type === 'apexNode').id;
    await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: SEF, body: {
      nodes: orgMap.nodes.concat([
        { id: 'pos1', type: 'goalNode', position: { x: -150, y: 250 }, data: { title: 'Kvality manager', status: 'todo', positionKind: 'position' } },
        { id: 'fun1', type: 'goalNode', position: { x: 150, y: 250 }, data: { title: 'Interní auditor', status: 'todo', positionKind: 'function', holder: 'kolega@example.com', deputy: 'zastupce@example.com' } },
      ]),
      edges: [{ id: 'e1', source: apexId, target: 'pos1' }, { id: 'e2', source: apexId, target: 'fun1' }],
      base_updated: orgMap.updated,
    } });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    const karty = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-testid="org-node"]')];
      return cards.map((c) => c.innerText);
    });
    ok(karty.length === 2, `mapa kreslí 2 karty pozic (${karty.length})`);
    ok(karty.some((k) => k.includes('Pozice') && k.includes('neobsazeno')), 'neobsazená pozice to o sobě říká');
    ok(karty.some((k) => k.includes('Funkce') && k.includes('kolega') && k.includes('zástupce')), 'obsazená funkce ukazuje držitele i zástupce');

    console.log('== dialog Pozice: obsazení klikem ==');
    // otevřít dialog neobsazené pozice (první org karta s „neobsazeno")
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('[data-testid="org-node"]')].find((c) => c.innerText.includes('neobsazeno'));
      card?.querySelector('[data-testid="org-node-edit"]')?.click();
    });
    await sleep(800);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="org-holder"]')), 'dialog má kategorii Pozice s výběrem držitele');
    ok(await page.evaluate(() => !document.querySelector('[role="dialog"] [data-cat="tasks"]')), 'kategorie úkolů na pozici NENÍ (server je stejně odmítá)');
    const setSelect = (sel, val) => page.evaluate((s, v) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, sel, val);
    ok(await setSelect('[data-testid="org-holder"]', 'kolega@example.com'), 'vybrán držitel');
    ok(await setSelect('[data-testid="org-deputy"]', 'zastupce@example.com'), 'vybrán zástupce pozice');
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('[role="dialog"] button')];
      btns.find((b) => b.textContent.trim() === 'Uložit')?.click();
    });
    await sleep(1500);
    const pos1 = ((await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: SEF })).json.nodes || []).find((n) => n.id === 'pos1');
    ok(pos1.data.holder === 'kolega@example.com' && pos1.data.deputy === 'zastupce@example.com',
      'obsazení z dialogu se uložilo do mapy');

    console.log('== tabulka ve Správě organizace = tentýž zdroj ==');
    await page.goto(`${BASE}/admin/users`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    ok(await page.evaluate(() => document.querySelector('[data-testid="org-holder-pos1"]')?.value === 'kolega@example.com'),
      'tabulka ukazuje držitele nastaveného v mapě');
    ok(await setSelect('[data-testid="org-deputy-fun1"]', ''), 'v tabulce jde zástupce funkce zrušit');
    await sleep(1200);
    const fun1 = ((await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: SEF })).json.nodes || []).find((n) => n.id === 'fun1');
    ok(fun1.data.deputy === '', 'zápis z tabulky se propsal do mapy (jeden zdroj pravdy)');

    console.log('== tabulka umí tvořit a přejmenovávat bez vstupu do mapy ==');
    await page.evaluate(() => document.querySelector('[data-testid="org-add-pos1"]')?.click());
    await sleep(1500);
    const novaRow = await page.evaluate(() => {
      const inp = [...document.querySelectorAll('[data-testid^="org-title-"]')].find((i) => i.value === 'Nová pozice');
      if (!inp) return null;
      return { pad: inp.closest('div').style.paddingLeft };
    });
    ok(!!novaRow, 'podřízená pozice založená PŘÍMO z tabulky');
    ok(novaRow && novaRow.pad === '20px', `podřízená pozice je odsazená (${novaRow && novaRow.pad})`);
    // přejmenování pozice v tabulce (uloží se opuštěním pole)
    await page.evaluate(() => {
      const i = document.querySelector('[data-testid="org-title-pos1"]');
      i.focus(); // bez fokusu by blur nevystřelil a onBlur uložení by neproběhlo
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'Kvalitář');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.blur();
    });
    await sleep(1200);
    const pos1b = ((await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: SEF })).json.nodes || []).find((n) => n.id === 'pos1');
    ok(pos1b.data.title === 'Kvalitář', 'přejmenování z tabulky se propsalo do mapy');

    console.log('== odebrání pozice z tabulky ==');
    let r2 = await api('POST', '/api/kb/org-structure/remove', { token: SEF, body: { node_id: 'pos1' } });
    ok(r2.status === 400, `pozice s podřízenými se odmítne (${r2.status})`);
    page.on('dialog', (d) => d.accept()); // confirm mazání
    await page.evaluate(() => {
      const inp = [...document.querySelectorAll('[data-testid^="org-title-"]')].find((i) => i.value === 'Nová pozice');
      inp?.closest('div')?.querySelector('[data-testid^="org-remove-"]')?.click();
    });
    await sleep(1500);
    ok(await page.evaluate(() => ![...document.querySelectorAll('[data-testid^="org-title-"]')].some((i) => i.value === 'Nová pozice')),
      'list bez podřízených šel z tabulky odebrat');

    console.log('== org mapa NENÍ v tabulce úkolů ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    ok(await page.evaluate(() => !document.body.innerText.includes('Organizační struktura')),
      'tabulka úkolů org strukturu neukazuje (není to projekt)');

    console.log('== org mapa NENÍ ani mezi projekty na titulce ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    ok(await page.evaluate(() => !document.body.innerText.includes('Organizační struktura')),
      'titulka org strukturu nenabízí jako projekt (vstup = panáček / Správa organizace)');

    console.log('== org struktura pod panáčkem (pro každého člena) ==');
    await page.click('[data-user-menu]'); // reálná myš — Radix menu
    await sleep(600);
    const menuItem = await page.$('[data-testid="menu-org-structure"]');
    ok(!!menuItem, 'menu pod panáčkem nabízí Organizační strukturu');
    if (menuItem) { await menuItem.click(); await sleep(2000); }
    ok(page.url().includes(`/map/${orgId}`), 'položka vede do mapy struktury');

    console.log('== nálezy Richardova klik-testu 15. 8. ==');
    // vrchol org mapy NENÍ projekt: žádný štítek Projekt, stav ani % pokroku
    await page.goto(`${BASE}/map/${orgId}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const vrchol = await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node-apexNode');
      return el ? el.innerText : '';
    });
    ok(vrchol.includes('Organizace') && !vrchol.includes('Projekt') && !vrchol.includes('%'),
      `vrchol org mapy není „projekt" — bez stavu a pokroku (${vrchol.split('\n').join(' · ').slice(0, 60)})`);
    // + na vrcholu zakládá POZICI („Nová pozice"), ne „Nový podcíl"
    await page.evaluate(() => {
      const el = document.querySelector('.react-flow__node-apexNode');
      [...(el?.querySelectorAll('button') || [])].find((b) => (b.title || '').includes('pozice'))?.click();
    });
    await sleep(1500);
    ok(await page.evaluate(() => document.body.innerText.includes('Nová pozice') && !document.body.innerText.includes('Nový podcíl')),
      'nový uzel z vrcholu je „Nová pozice", ne podcíl');

    const zavazne = errs.filter((e) => !/favicon|manifest/i.test(e));
    ok(zavazne.length === 0, `konzole bez chyb (${zavazne.length}${zavazne.length ? ': ' + zavazne[0].slice(0, 120) : ''})`);

    console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    fail++;
  } finally {
    try { if (browser) await browser.close(); } catch { /* už zavřeno */ }
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  process.exit(fail === 0 ? 0 : 1);
})();
