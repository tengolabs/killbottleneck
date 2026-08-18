// UI e2e: zjednodušený (lite) režim.
//
// Ověřuje to, co je na něm podstatné: že na telefonu naskočí sám, že se z něj
// dá VŽDYCKY odejít (a volba se pamatuje), že řádkové akce fungují i tady,
// že rychlé přidání nechce zbytečná rozhodnutí — a hlavně že v něm NEJSOU věci
// plné verze. Chybějící mapa a nastavení nejsou nedodělek, je to celý smysl.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20515';
const NAME = 'flowmap-e2e-ui-lite';
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickText = async (page, text, sel = 'button, a') => {
  for (const h of await page.$$(sel)) {
    const t = await h.evaluate((el) => el.innerText || '');
    if (t.includes(text)) { await h.click(); return true; }
  }
  return false;
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20515:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    // SLOVNÍK 17. 8. 2026: položky sází superuser (uživatelský create = 403)
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

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
    await page.setViewport(PHONE);

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

    const today = new Date().toLocaleDateString('en-CA');
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    await page.evaluate(async (today) => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      const m = await (await fetch('/api/collections/goalmaps/records', {
        method: 'POST', headers: H,
        body: JSON.stringify({
          title: 'PROJEKT-LITE',
          // n1 = neutrální uzel pro úkoly (bez garanta/termínu se v seznamech
          // neukáže) — úkol musí viset na konkrétním NE-vrcholovém uzlu
          nodes: [
            { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT-LITE', title: 'PROJEKT-LITE', status: 'todo' } },
            { id: 'n1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Zázemí úkolů', status: 'todo' } },
          ],
          edges: [{ id: 'e-n1', source: 'apex', target: 'n1' }],
        }),
      })).json();
      const su = await (await fetch('/api/collections/_superusers/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'su@e2e.local', password: 'supersu12345' }) })).json();
      const HS = { 'Content-Type': 'application/json', Authorization: su.token };
      const myId = (auth.record || auth.model || {}).id;
      const mk = (b) => fetch('/api/collections/tasks/records', { method: 'POST', headers: HS, body: JSON.stringify({ map: m.id, node_id: 'n1', owner: myId, owner_email: 'admin@e2e.cz', ...b }) });
      await mk({ title: 'LITE-DNES', status: 'todo', assignee_email: 'admin@e2e.cz', deadline: today });
      await mk({ title: 'LITE-PO-TERMINU', status: 'todo', assignee_email: 'admin@e2e.cz', deadline: '2026-07-01' });
      await mk({ title: 'LITE-ZADANY', status: 'todo', assignee_email: 'kolega@e2e.cz', deadline: today });
    }, today);

    console.log('== na telefonu naskočí lite sám ==');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(page.url().endsWith('/lite'), `z „/" se stalo /lite (${page.url().replace(BASE, '')})`);
    let txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('LITE-DNES') && txt.includes('LITE-PO-TERMINU'), 'moje práce je vidět');
    expect(!txt.includes('LITE-ZADANY'), 'cizí (delegovaná) práce v „Dnes" není');

    console.log('== v lite režimu NEJSOU věci plné verze (to je záměr) ==');
    for (const zakazane of ['Šablony', 'Sdílet', 'API klíče', 'Archiv', 'Moje mapa']) {
      expect(!txt.includes(zakazane), `„${zakazane}" se v lite režimu nenabízí`);
    }
    expect((await page.$$('.react-flow')).length === 0, 'plátno mapy se v lite režimu nerenderuje');

    console.log('== řádková akce: hotovo ==');
    const doneBtn = await page.evaluateHandle((title) => {
      const rows = [...document.querySelectorAll('div')].filter((el) => (el.innerText || '').includes(title) && el.querySelector('button[aria-label="Hotovo"]'));
      const row = rows[rows.length - 1];
      return row ? row.querySelector('button[aria-label="Hotovo"]') : null;
    }, 'LITE-DNES');
    expect(!!(await doneBtn.asElement()), 'řádek má tlačítko Hotovo');
    await doneBtn.asElement().click();
    await sleep(2000);
    txt = await page.evaluate(() => document.body.innerText);
    expect(!txt.includes('LITE-DNES'), 'hotový úkol ze seznamu zmizel bez otevírání detailu');

    console.log('== omylem odbavené jde vrátit + „Hotovo dnes" ==');
    // Richard 27. 7. 2026: „klikl jsem omylem na hotovo a zmizel mi úkol
    // a nevím kam." Potvrzení předem by zdražilo KAŽDÉ odbavení, proto vrácení.
    txt = await page.evaluate(() => document.body.innerText);
    expect(/Vr\u00e1tit/.test(txt), 'hláška po odbavení nabízí vrácení');
    const vraceno = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText || '').trim() === 'Vrátit');
      if (!b) return false;
      b.click();
      return true;
    });
    expect(vraceno, 'klik na Vrátit');
    await sleep(2500);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('LITE-DNES'), 'omylem odbavený úkol se vrátil zpět do seznamu');
    // a znovu odbavit, ať navazující části sady sedí
    const znovu = await page.evaluateHandle((title) => {
      const rows = [...document.querySelectorAll('div')].filter((el) => (el.innerText || '').includes(title) && el.querySelector('button[aria-label="Hotovo"]'));
      const row = rows[rows.length - 1];
      return row ? row.querySelector('button[aria-label="Hotovo"]') : null;
    }, 'LITE-DNES');
    if (znovu.asElement()) await znovu.asElement().click();
    await sleep(2500);
    // hotová práce se ze seznamu schová, ale musí jít dohledat
    const hotovo = await page.evaluate(() => {
      // nadpis má CSS uppercase → innerText je „HOTOVO DNES", proto bez ohledu
      // na velikost písmen (stejná past jako u „ZADAL JSEM")
      const b = [...document.querySelectorAll('button')].find((x) => /hotovo dnes/i.test(x.innerText || ''));
      if (!b) return null;
      b.click();
      return true;
    });
    expect(hotovo, 'sekce „Hotovo dnes" je v seznamu');
    await sleep(800);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('LITE-DNES'), 'odbavený úkol je dohledatelný v „Hotovo dnes"');

    console.log('== záložka „Zadal jsem" ==');
    expect(await clickText(page, 'Zadal jsem'), 'klik na Zadal jsem');
    await sleep(1500);
    txt = await page.evaluate(() => document.body.innerText);
    // v řádku je jen část před zavináčem — celý e-mail se na telefon nevejde
    // a ořízne se doprostřed domény (kontrola celého e-mailu je níž, v title)
    expect(txt.includes('LITE-ZADANY') && txt.includes('řeší kolega'), 'delegovaná práce s řešitelem');
    const delegHasDone = await page.evaluate(() => !!document.querySelector('button[aria-label="Hotovo"]'));
    expect(!delegHasDone, 'za druhého to odbavit nejde (žádné Hotovo)');

    console.log('== záložka Zprávy ==');
    expect(await clickText(page, 'Zprávy'), 'klik na Zprávy');
    await sleep(1500);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('Zprávy'), 'stránka zpráv se otevřela');

    console.log('== rychlé přidání: projekt je NEPOVINNÝ ==');
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const fab = await page.$('button[aria-label="Nový úkol"]');
    expect(!!fab, 'plovoucí tlačítko Nový úkol');
    await fab.click();
    await sleep(1200);
    // Richard 27. 7. 2026: „mohl bych to přece uložit rovnou?" — projekt se
    // vybírat NEMUSÍ; bez něj to jde do zásobníku nápadů, aby si šlo něco
    // rychle zapsat bez rozhodování.
    const defaultProject = await page.$eval('form select', (el) => el.value).catch(() => null);
    expect(defaultProject === '', `výchozí je bez projektu (hodnota "${defaultProject}")`);
    const formText = await page.evaluate(() => document.querySelector('form')?.innerText || '');
    expect(/v\u00e1\u0161 n\u00e1pad|your idea/i.test(formText),
      `formulář říká, že to bude tvoje (${formText.replace(/\n/g, ' ').slice(0, 90)})`);
    const addBtnEnabled = await page.evaluate(() => {
      const b = [...document.querySelectorAll('form button')].find((x) => /Přidat/.test(x.innerText || ''));
      return b ? !b.disabled : null;
    });
    await page.type('form input[type="text"], form input:not([type])', 'LITE-RYCHLY-ZAPIS');
    expect(await clickText(page, 'Přidat', 'form button'), 'klik na Přidat bez výběru projektu');
    await sleep(2500);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('LITE-RYCHLY-ZAPIS'), 'rychlý zápis je hned v seznamu');
    expect(txt.includes('nápad'), 'a je označený jako nápad ze zásobníku');
    const inBuffer = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch('/api/collections/buffer_nodes/records?perPage=50', { headers: { Authorization: auth.token } })).json();
      return (r.items || []).some((b) => b.title === 'LITE-RYCHLY-ZAPIS');
    });
    expect(inBuffer, 'zápis bez projektu skončil v zásobníku nápadů, ne jako volný úkol');
    // Lite režim nemá samostatný zásobník, takže se nápad MUSÍ ukázat i tehdy,
    // když nemá termín ani plán — jinak by druhý den zmizel
    // (Richard 27. 7. 2026: „v režimu lite nemáme zásobník nápadů").
    await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch('/api/collections/buffer_nodes/records?perPage=50', { headers: { Authorization: auth.token } })).json();
      const b = (r.items || []).find((x) => x.title === 'LITE-RYCHLY-ZAPIS');
      await fetch('/api/collections/buffer_nodes/records/' + b.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: auth.token },
        body: JSON.stringify({ planned_on: '', deadline: '' }),
      });
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('LITE-RYCHLY-ZAPIS'),
      'nápad bez termínu i bez plánu je v lite režimu pořád vidět (sekce Bez termínu)');

    console.log('== zápis S PROJEKTEM vytvoří UZEL, a nic navíc ==');
    // Richard 27. 7. 2026: „už děláme jen uzly a ten je vždy — a když to má
    // termín, je to úkol." Uzel JE ta práce. Zakládat k němu ještě úkol se
    // stejným názvem znamenalo vést jednu věc dvakrát: přehled ho schoval
    // do uzlu, ale po odbavení uzlu zůstal viset otevřený na stránce Úkoly.
    const fab2 = await page.$('button[aria-label="Nový úkol"]');
    await fab2.click();
    await sleep(1200);
    await page.select('form select', await page.$eval('form select option:nth-child(2)', (o) => o.value));
    await sleep(300);
    await page.type('form input[type="text"], form input:not([type])', 'LITE-S-PROJEKTEM');
    expect(await clickText(page, 'Přidat', 'form button'), 'klik na Přidat s vybraným projektem');
    await sleep(3000);
    const vMape = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { Authorization: auth.token };
      const maps = await (await fetch('/api/collections/goalmaps/records?perPage=50', { headers: H })).json();
      const tasks = await (await fetch('/api/collections/tasks/records?perPage=50', { headers: H })).json();
      let map = null, node = null;
      for (const m of maps.items || []) {
        const n = (m.nodes || []).find((x) => (x.data || {}).title === 'LITE-S-PROJEKTEM');
        if (n) { map = m; node = n; break; }
      }
      const edge = ((map || {}).edges || []).find((e) => e.target === (node || {}).id);
      return {
        vznikl: !!node,
        napojeny: !!edge,
        garant: (node || {}).data ? node.data.owner : null,
        plan: (node || {}).data ? (node.data.plannedOn || '') : '',
        ukoluNavic: (tasks.items || []).filter((t) => t.title === 'LITE-S-PROJEKTEM').length,
      };
    });
    expect(vMape.vznikl, 'v mapě vznikl uzel');
    expect(vMape.napojeny, 'uzel je v mapě napojený hranou (vykreslí se, neplave stranou)');
    expect(vMape.ukoluNavic === 0,
      `NEVZNIKL žádný samostatný úkol navíc — uzel JE ta práce (nalezeno ${vMape.ukoluNavic})`);
    // Na řešitele se formulář neptá — co si v lite režimu založíš, je vždycky
    // TVOJE. Práce přiřazená někomu jinému by se v „co mám dělat" ani neukázala.
    expect(vMape.garant === 'admin@e2e.cz', `uzel má garanta = mě (${vMape.garant})`);
    // Bez termínu se zápis plánuje na dnešek, ať nikam nezapadne
    expect(/^\d{4}-\d{2}-\d{2}$/.test(vMape.plan), `zápis bez termínu je naplánovaný na dnešek (${vMape.plan})`);
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    txt = await page.evaluate(() => document.body.innerText);
    expect(txt.includes('LITE-S-PROJEKTEM'), 'nově založený uzel je hned vidět v seznamu');

    console.log('== plánování v lite režimu dá potvrzení a nesahá na termín ==');
    const beforePlan = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch('/api/collections/tasks/records?perPage=50', { headers: { Authorization: auth.token } })).json();
      const t = (r.items || []).find((x) => x.title === 'LITE-PO-TERMINU');
      return t ? { deadline: t.deadline, planned: t.planned_on } : null;
    });
    const planned = await page.evaluate((title) => {
      const rows = [...document.querySelectorAll('div')].filter((el) => (el.innerText || '').includes(title)
        && el.querySelector('button[aria-label="Naplánovat, kdy to řešit"]'));
      const row = rows[rows.length - 1];
      row?.querySelector('button[aria-label="Naplánovat, kdy to řešit"]')?.click();
      return !!row;
    }, 'LITE-PO-TERMINU');
    expect(planned, 'lišta v lite režimu nabízí plánování');
    await sleep(700);
    expect(await clickText(page, 'Zítra'), 'volba Zítra');
    await sleep(2500);
    txt = await page.evaluate(() => document.body.innerText);
    // Richard 27. 7. 2026: „na mobilu to nic nepíše a jen to udělá"
    expect(/Naplánováno na zítra/.test(txt), 'akce v lite režimu dá potvrzení');
    const afterPlan = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const r = await (await fetch('/api/collections/tasks/records?perPage=50', { headers: { Authorization: auth.token } })).json();
      const t = (r.items || []).find((x) => x.title === 'LITE-PO-TERMINU');
      return t ? { deadline: t.deadline, planned: t.planned_on } : null;
    });
    expect(afterPlan?.deadline === beforePlan?.deadline,
      `TERMÍN se plánováním nezměnil (${afterPlan?.deadline} = ${beforePlan?.deadline})`);
    expect(!!afterPlan?.planned, `plán zapsán (${afterPlan?.planned})`);

    console.log('== sekce: „Do týdne" × „Později" × „Bez termínu" ==');
    // „Do týdne" je posuvných 7 dní, ne kalendářní týden — název to od
    // 27. 7. 2026 říká rovnou. „Později" (termín dál) a „Bez termínu" jsou
    // dvě různé věci, proto dvě sekce, ne jedna „Ostatní".
    await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('pocketbase_auth') || '{}');
      const H = { 'Content-Type': 'application/json', Authorization: auth.token };
      // ⚠️ PROJEKT-LITE NENÍ jediná mapa (každý nový účet dostává úvodní mapu)
      // a bez sortu vrací PB pořadí náhodně → items[0] občas byla úvodní mapa
      // bez uzlu n1 a zakládání úkolů tiše padalo na 400 (zdroj flaku sady).
      const maps = await (await fetch('/api/collections/goalmaps/records?perPage=10&filter=' + encodeURIComponent('title="PROJEKT-LITE"'), { headers: H })).json();
      const map = maps.items[0];
      const day = (o) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + o); return d.toLocaleDateString('en-CA'); };
      // node_id: 'n1' = neutrální uzel založený na začátku sady v mapě PROJEKT-LITE
      const su = await (await fetch('/api/collections/_superusers/auth-with-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: 'su@e2e.local', password: 'supersu12345' }) })).json();
      const HS = { 'Content-Type': 'application/json', Authorization: su.token };
      const myId = (auth.record || auth.model || {}).id;
      const mk = (b) => fetch('/api/collections/tasks/records', { method: 'POST', headers: HS, body: JSON.stringify({ map: map.id, node_id: 'n1', assignee_email: 'admin@e2e.cz', status: 'todo', owner: myId, owner_email: 'admin@e2e.cz', ...b }) });
      await mk({ title: 'LITE-DO-TYDNE', deadline: day(5) });
      await mk({ title: 'LITE-POZDEJI', deadline: day(20) });
      await mk({ title: 'LITE-BEZ-TERMINU' });
    });
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const sekce = await page.evaluate(() => {
      const out = {};
      let cur = null;
      for (const el of document.querySelectorAll('section')) {
        const nadpis = el.querySelector('p');
        cur = nadpis ? nadpis.innerText.replace(/\s*\(\d+\)\s*$/, '').trim() : '?';
        out[cur] = el.innerText;
      }
      return out;
    });
    const kde = (title) => Object.keys(sekce).find((k) => sekce[k].includes(title)) || '—';
    expect(kde('LITE-DO-TYDNE') === 'DO TÝDNE', `termín za 5 dní je v „Do týdne" (${kde('LITE-DO-TYDNE')})`);
    expect(kde('LITE-POZDEJI') === 'POZDĚJI', `termín za 20 dní je v „Později" (${kde('LITE-POZDEJI')})`);
    expect(kde('LITE-BEZ-TERMINU') === 'BEZ TERMÍNU', `bez termínu je v „Bez termínu" (${kde('LITE-BEZ-TERMINU')})`);

    console.log('== řádek se na telefonu nerozpadá ==');
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const radek = await page.evaluate((title) => {
      const rows = [...document.querySelectorAll('div')]
        .filter((el) => (el.innerText || '').includes(title) && el.className.includes('border-b'));
      const row = rows[rows.length - 1];
      if (!row) return null;
      const meta = row.querySelector('p:last-of-type');
      return {
        text: meta ? meta.innerText : '',
        planIkona: !!row.querySelector('[aria-label^="Naplánováno"]'),
        // jednořádkový meta řádek: víc než ~1,6 řádku znamená, že se něco zalomilo
        radku: meta ? Math.round(meta.getBoundingClientRect().height / parseFloat(getComputedStyle(meta).lineHeight)) : 0,
      };
    }, 'LITE-PO-TERMINU');
    // Richardovy snímky 27. 7. 2026: v sekci „Dnes" stálo u položky ještě
    // „Naplánováno na dnes" — opakovalo to nadpis sekce a lámalo řádek na dva.
    expect(radek && !/Napl\u00e1nov\u00e1no/.test(radek.text),
      `plán se v řádku neopisuje textem (${(radek && radek.text || '').replace(/\n/g, ' ')})`);
    expect(radek && radek.planIkona, 'místo textu je ikona plánu');
    expect(radek && radek.radku <= 1, `řádek podrobností se nezalomil (${radek && radek.radku} řádky)`);

    console.log('== dlouhý e-mail nesežere řádek ==');
    await clickText(page, 'Zadal jsem');
    await sleep(2000);
    const deleg = await page.evaluate((title) => {
      const rows = [...document.querySelectorAll('div')]
        .filter((el) => (el.innerText || '').includes(title) && el.className.includes('border-b'));
      const row = rows[rows.length - 1];
      const meta = row && row.querySelector('p:last-of-type');
      return meta ? { text: meta.innerText, title: meta.querySelector('[title]')?.getAttribute('title') } : null;
    }, 'LITE-ZADANY');
    // celý e-mail se na telefon nevejde a ořízne se doprostřed domény, takže
    // z něj nic nepoznáš — v řádku je část před zavináčem, celý zůstává v title
    expect(deleg && !/@/.test(deleg.text), `v řádku není celý e-mail (${(deleg && deleg.text || '').replace(/\n/g, ' ')})`);
    expect(deleg && deleg.title === 'kolega@e2e.cz', `celý e-mail zůstal v title (${deleg && deleg.title})`);

    console.log('== odchod do plné verze a zpět (nikoho neuvěznit) ==');
    expect(await clickText(page, 'Přepnout na plnou verzi'), 'klik na Přepnout na plnou verzi');
    await sleep(2500);
    expect(!page.url().includes('/lite'), `jsme v plné verzi (${page.url().replace(BASE, '')})`);
    // volba se pamatuje — další načtení „/" na telefonu už NEsmí přehodit zpět
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(!page.url().includes('/lite'), 'volba plné verze se pamatuje i po znovunačtení');
    const mode = await page.evaluate(() => localStorage.getItem('kb-mode'));
    expect(mode === 'full', `volba uložena (kb-mode=${mode})`);

    console.log('== cesta zpět je vidět BEZ otevírání menu ==');
    // Richard 27. 7. 2026: „přepnu se do plného režimu jedním klikem a pak se
    // člověk ztratí ve velkém prostředí a nemá šanci se dostat zpět."
    // Na úzkém displeji proto musí být přepnutí přímo v liště, ne schované
    // v menu pod avatarem.
    const backBtn = await page.$('header button[aria-label="Zjednodušené zobrazení"]');
    expect(!!backBtn, 'v hlavičce je vidět tlačítko zpět do lite režimu');
    await backBtn.click();
    await sleep(2500);
    expect(page.url().endsWith('/lite'), `jedním klikem zpět v lite režimu (${page.url().replace(BASE, '')})`);

    console.log('== v hlavičce je svátek (Richard 18. 8. 2026) ==');
    // ⚠️ Nesmí to být natvrdo „Helena" — sada by fungovala jeden den v roce.
    // Očekávaná hodnota se bere ze stejného kalendáře jako appka a dny BEZ
    // jmeniny (1. 1., 1. 5., …) se kontrolují obráceně: tam řádek být nesmí.
    const { todayNameDay } = await import('file://' + require('path').resolve(__dirname, '../frontend/src/lib/nameDays.js'));
    const dnesniSvatek = todayNameDay();
    // ⚠️ Texty níž jsou natvrdo česky, ale jazyk určuje navigator.language
    // prohlížeče — pod anglickým prostředím by sada falešně červenala.
    await page.evaluateOnNewDocument(() => localStorage.setItem('kb-lang', 'cs'));
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    const hlavicka = await page.evaluate(() => (document.querySelector('header')?.innerText || ''));
    if (dnesniSvatek) {
      expect(hlavicka.includes(`svátek má ${dnesniSvatek}`),
        `hlavička lite ukazuje „svátek má ${dnesniSvatek}" („${hlavicka.split('\n').pop()}")`);
    } else {
      expect(!/svátek má/.test(hlavicka),
        `dnes jmeniny nejsou, hlavička o svátku mlčí („${hlavicka.split('\n').pop()}")`);
    }
    // ⚠️ Ve dnech BEZ jmenin (1. 1., 1. 5., … ~11 dní v roce) by výše proběhla jen
    // záporná větev a sada by v ten den prošla i appce, která svátek nezobrazí
    // NIKDY. Proto se kladná strana ověří vždy — s podvrženým datem, kdy jmeniny
    // jistě jsou. (Nález panelu /checkup 18. 8. 2026.)
    const PEVNE = new Date(2026, 6, 21);   // 21. 7. = Vítězslav, viz name-days.js
    const ocekavany = todayNameDay(PEVNE);
    await page.evaluateOnNewDocument((ms) => {
      const Puvodni = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends Puvodni {
        constructor(...a) { super(...(a.length ? a : [ms])); }
        static now() { return ms; }
      };
    }, PEVNE.getTime());
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    const hlavickaPevna = await page.evaluate(() => (document.querySelector('header')?.innerText || ''));
    expect(hlavickaPevna.includes(`svátek má ${ocekavany}`),
      `s podvrženým 21. 7. hlavička hlásí „svátek má ${ocekavany}" („${hlavickaPevna.split('\n').pop()}")`);

    console.log('== logo v liště je zkratka domů (klik nesmí spadnout) ==');
    // Logo volalo `navigate`, které v LiteList vůbec neexistovalo (hák seděl
    // ve vnitřní komponentě Row, kde se nepoužíval) → klik = ReferenceError.
    // Strom to NESHODÍ (chyba letí z handleru, ne z renderu), takže navenek se
    // jen „nic nestane" — o to hůř se to všimne. Chytá to kontrola konzole
    // na konci sady; ověřeno mutací 18. 8. 2026 (vrácení vady = 1 ❌).
    await page.goto(`${BASE}/lite`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    const logo = await page.$('header button[aria-label="Zpět na dnešní seznam"]');
    expect(!!logo, 'logo v lite hlavičce je klikací zkratka');
    if (logo) {
      await logo.click();
      await sleep(1500);
      const zije = await page.evaluate(() => (document.body.innerText || '').trim().length);
      expect(zije > 50, `po kliku na logo seznam dál stojí (${zije} znaků)`);
      expect(page.url().includes('/lite'), `logo drží v lite režimu (${page.url().replace(BASE, '')})`);
    }

    console.log('== stará adresa /light dál funguje ==');
    // režim se přejmenoval z „light" na „lite"; kdo si starou adresu uložil
    // na plochu telefonu, nesmí zůstat na chybové stránce
    await page.goto(`${BASE}/light`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    expect(page.url().endsWith('/lite'), `/light přesměruje na /lite (${page.url().replace(BASE, '')})`);

    const relevant = errors.filter((e) => !e.includes('favicon') && !e.includes('ERR_NETWORK_CHANGED'));
    expect(relevant.length === 0, `konzole bez chyb (${relevant.length}${relevant.length ? ': ' + relevant[0].slice(0, 140) : ''})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    if (browser) await browser.close();
  }
  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
