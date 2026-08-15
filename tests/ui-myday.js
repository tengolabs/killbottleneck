// UI e2e: panel Můj den (Home i /tasks) — jmeniny, klik na položku → dialog,
// chipy → filtry, PNG export (normální + anonymní), Web Share mock.
// Klik-test panelu „Můj den": Home → klik na položku → /tasks s dialogem;
// chip z Home → /tasks s nastaveným filtrem termínu; export PNG; konzole čistá.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const fs = require('fs');
const BASE = 'http://127.0.0.1:20501';
const NAME = 'flowmap-e2e-ui-myday';
const DL = require('os').tmpdir() + '/flowmap-dl-ui-myday';
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

const clickButtonWithText = async (page, text) => {
  const handles = await page.$$('button');
  for (const h of handles) {
    const t = await h.evaluate((el) => el.innerText || '');
    if (t.includes(text)) { await h.click(); return true; }
  }
  return false;
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20501:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });

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
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

    // registrace + testovací úkoly (po termínu / dnes, přiřazené mně)
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
    const todayIso = new Date().toLocaleDateString('en-CA');
    await page.evaluate(async (todayIso) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      // mapa napřed — úkol vždy patří do projektu (server volné úkoly odmítá);
      // bez mapy by Home navíc ukazovala uvítací prázdný stav (panel se nerenderuje)
      const m = await (await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          title: 'Testovací projekt',
          nodes: [
            { id: 'node-1', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Testovací projekt', title: 'Testovací projekt', status: 'todo', owner: '', deadline: '' } },
            // úkol musí ležet na uzlu → neutrální krok (bez ownera/termínu, ať nehne čísly sekcí)
            { id: 'krok', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo' } },
          ],
          edges: [{ id: 'e1', source: 'node-1', target: 'krok' }],
        }),
      })).json();
      const mk = (body) => fetch('/api/collections/tasks/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({ map: m.id, node_id: 'krok', assignee_email: 'admin@e2e.cz', ...body }),
      });
      await mk({ title: 'PRESLY-UKOL-XYZ', status: 'todo', deadline: '2026-07-01' });
      await mk({ title: 'DNESNI-UKOL-XYZ', status: 'todo', deadline: todayIso });
      // úkol, který jsem ZADAL někomu jinému (owner=admin server-side, řešitel=kolega)
      await mk({ title: 'ZADANY-UKOL-XYZ', status: 'todo', deadline: '2026-07-02', assignee_email: 'kolega@e2e.cz' });
      // nápad ze zásobníku s termínem po termínu → má se ukázat v Můj den s badge „nápad"
      await fetch('/api/collections/buffer_nodes/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({ title: 'NAPAD-TERMIN-XYZ', deadline: '2026-07-01', owner: (auth.record || auth.model || {}).id }),
      });
    }, todayIso);

    console.log('== Home: panel Můj den ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    const homeText = await page.evaluate(() => document.body.innerText);
    expect(homeText.includes('Můj den'), 'panel „Můj den" je na Home');
    expect(homeText.includes('svátek má'), `hlavička ukazuje jmeniny (${(homeText.match(/svátek má \S+/) || [''])[0]})`);
    expect(homeText.includes('PRESLY-UKOL-XYZ') && homeText.includes('Po termínu'), 'sekce Po termínu ukazuje úkol jménem');
    // „Zadal jsem": delegovaný úkol je vidět v samostatné sekci s e-mailem řešitele,
    // ale NEmíchá se do mých sekcí (Po termínu ukazuje jen mé úkoly)
    // sekce má CSS uppercase → innerText je „ZADAL JSEM" (proto case-insensitive)
    expect(/zadal jsem/i.test(homeText) && homeText.includes('ZADANY-UKOL-XYZ') && homeText.includes('kolega@e2e.cz'),
      'sekce „Zadal jsem" ukazuje delegovaný úkol s řešitelem');
    // nápad s termínem: je v termínové sekci s badge „nápad", ale NEpočítá se do Otevřené
    expect(homeText.includes('NAPAD-TERMIN-XYZ') && homeText.includes('nápad'),
      'nápad ze zásobníku s termínem je v panelu s badge „nápad"');

    console.log('== klik na položku vede DO MAPY (úkol i cíl stejně) ==');
    // Od doby, co má úkol vždycky uzel, není důvod, aby se dvě položky vedle
    // sebe chovaly po kliknutí jinak (Richard 27. 7. 2026; záměr už z e55e509).
    expect(await clickButtonWithText(page, 'PRESLY-UKOL-XYZ'), 'klik na položku v panelu');
    await sleep(2200);
    expect(/\/map\/.*[?&]node=/.test(page.url()),
      `úkol otevřel mapu na svém uzlu (${page.url().replace(BASE, '')})`);

    console.log('== chip z Home → /tasks s filtrem termínu ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1000);
    expect(await clickButtonWithText(page, 'Po termínu'), 'klik na chip Po termínu');
    await sleep(1500);
    expect(page.url().includes('/tasks'), `jsme na /tasks (${page.url().replace(BASE, '')})`);
    const combos = await page.$$eval('button[role="combobox"]', (els) => els.map((e) => e.innerText));
    expect(combos.some((t) => t.includes('Po termínu')), `filtr Termín nastaven na Po termínu (${JSON.stringify(combos)})`);

    await rozbalDen(page);
    console.log('== i na /tasks vede klik do mapy (stejně jako na titulce) ==');
    expect(await clickButtonWithText(page, 'DNESNI-UKOL-XYZ'), 'klik na položku Dnes v panelu');
    await sleep(2200);
    expect(/\/map\/.*[?&]node=/.test(page.url()),
      `i tady se otevřela mapa na uzlu (${page.url().replace(BASE, '')})`);

    console.log('== export PNG (dropdown: normální + anonymní) ==');
    await page.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' }); // z mapy zpět k panelu
    await sleep(1500);
    await rozbalDen(page);
    const clickMenuItem = async (text) => {
      const btn = await page.$('button[title*="Uložit přehled"]');
      if (!btn) return false;
      await btn.click();
      await sleep(500);
      const items = await page.$$('[role="menuitem"]');
      for (const h of items) {
        const t = await h.evaluate((el) => el.innerText || '');
        if (t.includes(text)) { await h.click(); return true; }
      }
      return false;
    };
    expect(await clickMenuItem('Stáhnout PNG'), 'menu: Stáhnout PNG');
    await sleep(3500);
    let f1 = fs.readdirSync(DL).filter((f) => f.endsWith('.png'));
    expect(f1.length === 1 && fs.statSync(`${DL}/${f1[0]}`).size > 5000, `první PNG staženo (${f1.join(', ')})`);
    if (f1[0]) fs.renameSync(`${DL}/${f1[0]}`, `${DL}/normal.png`); // stejný název by Chrome přepsal
    expect(await clickMenuItem('anonymně'), 'menu: Stáhnout anonymně');
    await sleep(3500);
    const f2 = fs.readdirSync(DL).filter((f) => f.endsWith('.png') && f !== 'normal.png');
    expect(f2.length === 1 && fs.statSync(`${DL}/${f2[0]}`).size > 5000, `anonymní PNG staženo (${f2.join(', ')})`);
    if (f2[0]) fs.renameSync(`${DL}/${f2[0]}`, `${DL}/anon.png`);
    // na HTTP (mimo secure kontext) se položky Sdílet nesmí nabízet
    const btn2 = await page.$('button[title*="Uložit přehled"]');
    await btn2.click();
    await sleep(500);
    const itemTexts = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.innerText));
    expect(!itemTexts.some((t) => t.includes('Sdílet')), `Sdílet se na HTTP nenabízí (${JSON.stringify(itemTexts)})`);
    await page.keyboard.press('Escape');

    console.log('== Web Share (mock = jako mobil s HTTPS) ==');
    // nová stránka s podvrženým navigator.share/canShare — přihlášení sdílí localStorage
    const page2 = await browser.newPage();
    await page2.evaluateOnNewDocument(() => {
      window.__sharedPayloads = [];
      navigator.canShare = (data) => !!(data && data.files && data.files.length);
      navigator.share = async (data) => {
        window.__sharedPayloads.push({
          title: data.title,
          files: (data.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
        });
      };
    });
    page2.on('pageerror', (e) => errors.push(String(e)));
    await page2.goto(`${BASE}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(1200);
    await rozbalDen(page2);
    await sleep(1200);
    const btn3 = await page2.$('button[title*="Uložit přehled"]');
    await btn3.click();
    await sleep(500);
    const itemTexts2 = await page2.$$eval('[role="menuitem"]', (els) => els.map((e) => e.innerText));
    expect(itemTexts2.some((t) => t.includes('Sdílet…')), `s dostupným API se Sdílet nabízí (${JSON.stringify(itemTexts2)})`);
    for (const h of await page2.$$('[role="menuitem"]')) {
      const t = await h.evaluate((el) => el.innerText || '');
      if (t === 'Sdílet…') { await h.click(); break; }
    }
    await sleep(3500);
    const payloads = await page2.evaluate(() => window.__sharedPayloads);
    expect(payloads.length === 1 && payloads[0].files?.[0]?.type === 'image/png' && payloads[0].files[0].size > 5000,
      `navigator.share dostal PNG (${JSON.stringify(payloads.map((p) => p.files))})`);
    await page2.close();

    console.log('== řádkové akce: hotovo / naplánovat (bez dialogu) ==');
    // Řádek panelu = <div class="group"> s tlačítky lišty. Bereme POSLEDNÍ shodu,
    // protože nadřazený .group obsahuje tentýž text (chceme ten nejvnitřnější).
    const rowAction = async (title, label) => {
      const rows = await page.$$('div.group');
      let target = null;
      for (const r of rows) {
        const txt = await r.evaluate((el) => el.innerText || '');
        if (txt.includes(title)) target = r;
      }
      if (!target) return false;
      const btn = await target.$(`button[aria-label="${label}"]`);
      if (!btn) return false;
      await btn.click();
      return true;
    };
    // stav v DB je jediný nesporný důkaz, že akce opravdu zapsala
    const taskState = (title) => page.evaluate(async (title) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch('/api/collections/tasks/records?perPage=200', {
        headers: { Authorization: auth.token },
      })).json();
      const t = (r.items || []).find((x) => x.title === title);
      return t ? { deadline: t.deadline, status: t.status, planned_on: t.planned_on } : null;
    }, title);

    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowIso = tomorrow.toLocaleDateString('en-CA');
    const pred = await taskState('PRESLY-UKOL-XYZ');

    expect(await rowAction('PRESLY-UKOL-XYZ', 'Naplánovat, kdy to řešit'), 'lišta: otevření nabídky plánu');
    expect(await clickButtonWithText(page, 'Zítra'), 'nabídka plánu: Zítra');
    await sleep(2000);
    const st1 = await taskState('PRESLY-UKOL-XYZ');
    expect(st1?.planned_on === tomorrowIso, `plán zapsán na zítra (${st1?.planned_on} vs ${tomorrowIso})`);
    // JÁDRO: naplánování se NESMÍ dotknout termínu. Dřív ho přepisovalo, což
    // tichým kliknutím v seznamu měnilo dohodu s někým jiným
    // (Richard 27. 7. 2026: „termín je termín").
    expect(st1?.deadline === pred?.deadline,
      `TERMÍN zůstal netknutý (${st1?.deadline} = ${pred?.deadline})`);

    // po naplánování je položka v sekci Zítra a lišta hlásí naplánovaný stav
    const zitraOk = await page.evaluate((title) => {
      const rows = [...document.querySelectorAll('div.group')].filter((el) => (el.innerText || '').includes(title));
      const row = rows[rows.length - 1];
      return !!row?.querySelector('button[aria-label="Naplánováno na zítra"]');
    }, 'PRESLY-UKOL-XYZ');
    expect(zitraOk, 'lišta ukazuje, že je naplánováno na zítra');
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(/ZÍTRA/i.test(bodyText), 'panel má sekci Zítra');

    expect(await rowAction('DNESNI-UKOL-XYZ', 'Hotovo'), 'lišta: klik na Hotovo');
    await sleep(2000);
    const st3 = await taskState('DNESNI-UKOL-XYZ');
    expect(st3?.status === 'done', `úkol označen hotový bez otevření dialogu (status=${st3?.status})`);

    // delegovaná práce nesmí jít odbavit za druhého — u „Zadal jsem" žádná lišta
    const delegatedHasActions = await page.evaluate((title) => {
      const rows = [...document.querySelectorAll('div.group')].filter((el) => (el.innerText || '').includes(title));
      const row = rows[rows.length - 1];
      return !!row?.querySelector('button[aria-label="Hotovo"]');
    }, 'ZADANY-UKOL-XYZ');
    expect(!delegatedHasActions, 'delegovaný úkol NEMÁ řádkové akce (jen hlídání termínu)');

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 120) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
