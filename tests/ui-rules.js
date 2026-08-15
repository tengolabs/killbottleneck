// UI e2e: automatizační pravidla OČIMA EDITORA mapy (14. 8. 2026):
//  - blesk „Pravidla" na liště otevře přehled pravidel mapy
//  - builder Když/Pokud/Udělej celou klikací cestou založí pravidlo
//  - pravidlo pak DOOPRAVDY fireuje (změna stavu → set_owner) a běh je v logu
//  - badge blesku na uzlu, na který pravidlo míří (scope)
//  - kategorie Automatizace v okně uzlu ukazuje pravidla uzlu
//  - vypnutí pravidla přepínačem ho zastaví
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-rules';
const PORT = 20761;
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
    await api('POST', '/api/collections/users/records', { body: { email: 'kolega@example.com', password: PW, passwordConfirm: PW } });
    const SEF = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sef@example.com', password: PW } })).json.token;
    const mapa = await api('POST', '/api/collections/goalmaps/records', {
      token: SEF, body: { title: 'Projekt s pravidly', edges: [{ id: 'e1', source: 'root', target: 'n1' }], nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Návrh webu', status: 'todo', owner: 'sef@example.com' } },
      ] },
    });
    // kolega má work sdílení → v OwnerSelectu je ve skupině „má přístup"
    // (výběr člena BEZ přístupu se ptá na přisdílení — standard aplikace)
    await api('POST', '/api/kb/share', { token: SEF, body: { action: 'share', mapId: mapa.json.id, email: 'kolega@example.com', permission: 'work' } });

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    // ≥1850 px, ať je blesk vidět přímo v liště (pod tím žije v ⋮ menu)
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    const cizihoPuvodu = (m) => {
      const u = (m.location() && m.location().url) || '';
      return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
    };
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })), SEF);
    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    console.log('== blesk na liště → přehled → builder ==');
    const bleskJe = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="toolbar-rules"]');
      if (!b) return false;
      b.click();
      return true;
    });
    ok(bleskJe, 'blesk „Pravidla" je na velké liště');
    await sleep(800);
    ok(await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').includes('Automatizační pravidla')),
      'otevřel se přehled pravidel mapy');
    ok(await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').includes('nepočítá')),
      'přehled říká, že běhy se nepočítají a neúčtují (opěra proti metru konkurence)');
    await page.evaluate(() => document.querySelector('[data-testid="rules-new"]')?.click());
    await sleep(600);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="rule-builder"]')), 'builder Když/Pokud/Udělej se otevřel');

    // pravidlo: KDYŽ stav n1 → done, UDĚLEJ set_owner kolega
    const setInput = (sel, val) => page.evaluate((s, v) => {
      const i = document.querySelector(s);
      if (!i) return false;
      const proto = i.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, v);
      i.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, sel, val);
    const setSelect = (sel, val) => page.evaluate((s, v) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, sel, val);
    ok(await setInput('#rule-name', 'Hotovo → předat kolegovi'), 'název vyplněn');
    await setSelect('[data-testid="rule-trigger"]', 'node_status_changed');
    await sleep(300);
    // druhý select v trigger boxu = filtr stavu (hned za rule-trigger)
    await page.evaluate(() => {
      const box = document.querySelector('[data-testid="rule-trigger"]').parentElement;
      const sel = box.querySelectorAll('select')[1];
      sel.value = 'done';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    ok(await setSelect('[data-testid="rule-scope"]', 'n1'), 'scope na uzel Návrh webu');
    // výchozí akce je notify — přepnout na set_owner a vyplnit e-mail
    await page.evaluate(() => {
      const act = document.querySelector('[data-testid="rule-action"] select');
      act.value = 'set_owner';
      act.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await sleep(300);
    // zodpovědná osoba se VYBÍRÁ (OwnerSelect jako v dialogu uzlu), ne píše —
    // skutečný proklik Radix selectem
    await page.click('#rule-set-owner-0');
    await sleep(600);
    const optBox = await page.evaluate(() => {
      const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || '').includes('kolega@example.com'));
      if (!opt) return null;
      const r = opt.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    ok(!!optBox, 'kolega je v nabídce zodpovědných osob (žádné volné psaní e-mailu)');
    await page.mouse.click(optBox.x, optBox.y);
    await sleep(500);
    await page.evaluate(() => document.querySelector('[data-testid="rule-save"]')?.click());
    await sleep(1500);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="rule-row"]')), 'pravidlo je v přehledu');
    // zavřít přehled (Escape)
    await page.keyboard.press('Escape');
    await sleep(800);

    console.log('== badge blesku na uzlu se scope pravidlem ==');
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="node-rule-badge"]')),
      'uzel Návrh webu nese badge blesku');

    console.log('== pravidlo DOOPRAVDY fireuje z UI změny ==');
    // klik na stavový odznak uzlu cykluje todo → in_progress → done
    const cyklus = async () => page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Návrh webu'));
      const b = uzel && uzel.querySelector('button');
      b && b.click();
      return !!b;
    });
    await cyklus(); await sleep(1200); // → in_progress
    await cyklus(); await sleep(2500); // → done → pravidlo
    const poFire = await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF });
    ok(poFire.json.nodes.find((n) => n.id === 'n1')?.data.owner === 'kolega@example.com',
      'akce set_owner přepsala garanta po dokončení uzlu');

    console.log('== log běhů + kategorie Automatizace v okně uzlu ==');
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(800);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Zobrazit log běhů/i.test(x.textContent || ''));
      b && b.click();
    });
    await sleep(800);
    const logText = await page.evaluate(() => document.querySelector('[data-testid="rule-runs"]')?.innerText || '');
    ok(/Hotovo → předat kolegovi/.test(logText) && /Návrh webu/.test(logText), `log běhů ukazuje pravidlo i uzel (${logText.slice(0, 60)}…)`);
    await page.keyboard.press('Escape');
    await sleep(600);
    // okno uzlu → kategorie Vykonavatel a automatizace → panel pravidel uzlu
    await page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Návrh webu'));
      const tuzka = [...uzel.querySelectorAll('button')].find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      tuzka && tuzka.click();
    });
    await sleep(1200);
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="executor"]')?.click());
    await sleep(600);
    const panelText = await page.evaluate(() => document.querySelector('[data-testid="node-rules-panel"]')?.innerText || '');
    ok(/Hotovo → předat kolegovi/.test(panelText), 'kategorie Automatizace ukazuje pravidla uzlu');
    // log běhů JEDNÍM klikem přímo z panelu uzlu (nález Richarda 15. 8.:
    // „nemohu na logy, musím hledat dost do hloubky")
    await page.evaluate(() => document.querySelector('[data-testid="node-rules-panel"] [data-testid^="node-rule-runs-"]')?.click());
    await sleep(1200);
    ok(await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n');
      return dlg.includes('Skrýt log běhů') && dlg.includes('set_owner');
    }), 'klik na hodiny u pravidla otevřel přehled ROVNOU s logem jeho běhů');
    await page.keyboard.press('Escape');
    await sleep(600);
    await page.keyboard.press('Escape');
    await sleep(600);

    console.log('== CELOMAPOVÉ pravidlo je v panelu uzlu vidět (se štítkem) ==');
    // nález Richarda 14. 8.: pravidlo bez scope na uzel míří taky — panel ho
    // dřív neukazoval a vypadalo to, že se pravidlo ztratilo
    await api('POST', '/api/kb/rules/save', { token: SEF, body: {
      map: mapa.json.id, name: 'Celomapové hlášení',
      trigger: { type: 'node_created' },
      actions: [{ type: 'notify', to: 'map_owner', message: 'nový uzel' }],
    } });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);
    await page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Návrh webu'));
      const tuzka = [...uzel.querySelectorAll('button')].find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      tuzka && tuzka.click();
    });
    await sleep(1200);
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="executor"]')?.click());
    await sleep(600);
    const panelText2 = await page.evaluate(() => document.querySelector('[data-testid="node-rules-panel"]')?.innerText || '');
    ok(/Celomapové hlášení/.test(panelText2) && /celá mapa/.test(panelText2),
      'celomapové pravidlo je v panelu uzlu se štítkem „celá mapa"');
    await page.keyboard.press('Escape');
    await sleep(600);

    console.log('== propojka čekání ↔ pravidla „po odblokování" (v Automatizaci) ==');
    // nález Richarda 14. 8.: „Čekat na podřízené" a pravidla spolu souvisí,
    // ale nebylo to vidět — a pravidlo „po odblokování" na uzlu bez čekání
    // by se TIŠE nikdy nespustilo. Od 15. 8. je Chování SLOUČENÉ do kategorie
    // Automatizace (Richard: „nelíbí se mi název vykonavatel… nechápu chování")
    await page.evaluate(() => {
      const uzel = [...document.querySelectorAll('.react-flow__node')].find((n) => (n.textContent || '').includes('Návrh webu'));
      const tuzka = [...uzel.querySelectorAll('button')].find((b) => /lucide-pencil/.test(b.querySelector('svg')?.getAttribute('class') || ''));
      tuzka && tuzka.click();
    });
    await sleep(1200);
    ok(await page.evaluate(() => !document.querySelector('[role="dialog"] [data-cat="behavior"]')
      && (document.querySelector('[role="dialog"] [data-cat="executor"]')?.textContent || '').includes('Automatizace')),
      'kategorie Chování zmizela, Automatizace nese nový název');
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="executor"]')?.click());
    await sleep(600);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="wait-rules-hint"]')),
      'kategorie Automatizace ukazuje blok „Po odblokování" (i čekání na podřízené)');
    await page.evaluate(() => document.querySelector('[data-testid="wait-rules-new"]')?.click());
    await sleep(1000);
    const trigPreset = await page.evaluate(() => document.querySelector('[data-testid="rule-trigger"]')?.value);
    ok(trigPreset === 'node_unblocked', `builder má předvyplněný spouštěč „po odblokování" (${trigPreset})`);
    const scopePreset = await page.evaluate(() => document.querySelector('[data-testid="rule-scope"]')?.value);
    ok(scopePreset === 'n1', `scope předvyplněný na uzel (${scopePreset})`);
    ok(await page.evaluate(() => !!document.querySelector('[data-testid="rule-wait-warn"]')),
      'uzel bez čekání → builder varuje (žádné tiše mrtvé pravidlo)');
    await page.evaluate(() => {
      const i = document.querySelector('#rule-name');
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, 'Po odblokování ohlásit');
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => document.querySelector('[data-testid="rule-save"]')?.click());
    await sleep(2500);
    const poFixu = await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF });
    ok(poFixu.json.nodes.find((n) => n.id === 'n1')?.data.waitForChildren === true,
      'zaškrtnutá náprava DOOPRAVDY zapnula uzlu čekání na podřízené');
    const seznam = (await api('GET', `/api/kb/rules?map=${mapa.json.id}`, { token: SEF })).json.rules;
    ok(seznam.some((r) => r.name === 'Po odblokování ohlásit' && r.node_id === 'n1' && r.trigger.type === 'node_unblocked'),
      'pravidlo po odblokování založeno se správným spouštěčem i uzlem');
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(600);

    console.log('== šablony: pravidlo → knihovna → načtení v JINÉ mapě ==');
    // Richard 14. 8.: „chci mít pravidlo jako šablonu a tu si načíst v dané mapě"
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(800);
    const ulozeno = await page.evaluate(() => {
      const row = [...document.querySelectorAll('[data-testid="rule-row"]')].find((x) => (x.innerText || '').includes('Celomapové hlášení'));
      const b = row?.querySelector('[data-testid="rule-save-template"]');
      if (!b) return false;
      b.click();
      return true;
    });
    ok(ulozeno, 'u pravidla je záložka „Uložit jako šablonu"');
    await sleep(1000);
    await page.keyboard.press('Escape');
    await sleep(500);
    const mapa2 = await api('POST', '/api/collections/goalmaps/records', {
      token: SEF, body: { title: 'Druhý projekt', edges: [], nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl 2', title: 'Cíl 2', status: 'todo' } },
      ] },
    });
    await page.goto(`${BASE}/map/${mapa2.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('[data-testid="rules-templates"]')?.click());
    await sleep(800);
    ok(await page.evaluate(() => (document.querySelector('[data-testid="templates-panel"]')?.innerText || '').includes('Celomapové hlášení')),
      'šablona je vidět i v DRUHÉ mapě');
    await page.evaluate(() => document.querySelector('[data-testid="template-load"]')?.click());
    await sleep(800);
    const prefillName = await page.evaluate(() => document.querySelector('#rule-name')?.value);
    ok(prefillName === 'Celomapové hlášení', `builder je předvyplněný ze šablony (${prefillName})`);
    await page.evaluate(() => document.querySelector('[data-testid="rule-save"]')?.click());
    await sleep(1500);
    const vDruheMape = (await api('GET', `/api/kb/rules?map=${mapa2.json.id}`, { token: SEF })).json.rules;
    ok(vDruheMape.some((x) => x.name === 'Celomapové hlášení' && x.trigger.type === 'node_created'),
      'načtením vzniklo v druhé mapě OBYČEJNÉ pravidlo (kopie)');
    await page.keyboard.press('Escape');
    await sleep(500);
    // zpět na první mapu pro zbytek sady
    await page.goto(`${BASE}/map/${mapa.json.id}`, { waitUntil: 'networkidle2' });
    await sleep(2000);

    console.log('== vypnutí pravidla přepínačem ho zastaví ==');
    await page.evaluate(() => document.querySelector('[data-testid="toolbar-rules"]')?.click());
    await sleep(800);
    await page.evaluate(() => document.querySelector('[data-testid="rule-row"] button[role="switch"]')?.click());
    await sleep(1000);
    await page.keyboard.press('Escape');
    await sleep(600);
    // vrátit stav na todo (přímo přes API — jde o motor, ne o klikání) a znovu dokončit
    const f = (await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF, body: {
      nodes: f.nodes.map((n) => (n.id === 'n1' ? { ...n, data: { ...n.data, status: 'todo', owner: 'sef@example.com' } } : n)),
      edges: f.edges, base_updated: f.updated,
    } });
    const f2 = (await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF, body: {
      nodes: f2.nodes.map((n) => (n.id === 'n1' ? { ...n, data: { ...n.data, status: 'done' } } : n)),
      edges: f2.edges, base_updated: f2.updated,
    } });
    await sleep(1000);
    const poVypnuti = (await api('GET', `/api/collections/goalmaps/records/${mapa.json.id}`, { token: SEF })).json;
    ok(poVypnuti.nodes.find((n) => n.id === 'n1')?.data.owner === 'sef@example.com',
      'vypnuté pravidlo garanta nepřepsalo');

    const real = errs.filter((e) => !/favicon|Failed to load resource/i.test(e));
    ok(real.length === 0, `konzole bez chyb (${real.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (e) {
    fail++; console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${pass} OK, ${fail} chyb`);
  process.exit(fail ? 1 : 0);
})();
