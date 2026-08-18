// UI e2e: ULOŽIT MAPU JAKO ŠABLONU proklikem (Richard 18. 8. 2026: „dám export,
// uložit jako šablona, je černá obrazovka").
//  - v mapě: Export → „Uložit jako šablonu…" dialog SKUTEČNĚ otevře
//  - obrazovka nezčerná: React strom stojí, stránka má obsah, nula chyb konzole
//  - uložení dojede až do entity Template (ne jen echo UI — čte se přes API)
//  - a od 18. 8. 2026 i GALERIE: zvolená kategorie se propíše a filtruje,
//    firemní šablona nese odznak organizace (ne zámek „osobní")
//
// ⚠️ Proč to nechytila žádná dřívější sada: dialog se otevírá až kliknutím
// v mapě a NIC ho neproklikávalo. Pád byl přitom čistý ReferenceError
// (`setWithTasks` zůstal v resetu po zrušení task_seeds) → celý strom spadl
// a uživatel viděl jen černo. Proto sada tvrdí i „stránka není prázdná".
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-ui-sablona-z-mapy';
const PORT = 20983;
const BASE = `http://127.0.0.1:${PORT}`;
const UCET = 'sablonar@e2e.cz';
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

    await api('POST', '/api/collections/users/records', { body: { email: UCET, password: PW, passwordConfirm: PW } });
    const A = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: UCET, password: PW } })).json.token;
    ok(!!A, 'testovací účet přihlášen');

    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Mapa na šablonu',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Nábor', title: 'Nábor', status: 'todo' } },
        { id: 'k1', type: 'goalNode', position: { x: 0, y: 160 }, data: { title: 'Inzerát', status: 'todo' } },
        { id: 'k2', type: 'goalNode', position: { x: 260, y: 160 }, data: { title: 'Pohovory', status: 'todo' } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'k1' }, { id: 'e2', source: 'root', target: 'k2' }],
    } })).json;
    ok(!!map.id, 'mapa ke zdrojování šablony založena');

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    const errs = [];
    // Chyby z Google Fonts nejsou vada aplikace (viz ui-conflict-merge.js).
    const cizihoPuvodu = (m) => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test((m.location() && m.location().url) || '');
    page.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m)) errs.push(m.text()); });
    // pageerror = nezachycená výjimka; PRÁVĚ tudy vznikla černá obrazovka
    page.on('pageerror', (e) => errs.push(String(e)));

    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', UCET);
    await page.type('#password', PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1500);

    console.log('== Mapa → Export → Uložit jako šablonu ==');
    await page.goto(`${BASE}/map/${map.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node', { timeout: 45000 });
    await sleep(2000);

    // ⚠️ Radix nabídku otevírá pointerdown — klik přes page.evaluate() ji NEOTEVŘE
    // (ticho, žádná chyba). Musí to být skutečný klik myší přes handle.
    const klikPodleTextu = async (selektor, re) => {
      const prvky = await page.$$(selektor);
      const texty = await page.evaluate((s) => [...document.querySelectorAll(s)].map((x) => x.textContent || ''), selektor);
      const i = texty.findIndex((tx) => re.test(tx));
      if (i < 0) return false;
      await prvky[i].click();
      return true;
    };
    ok(await klikPodleTextu('button', /^\s*Export\s*$/), 'v liště mapy je tlačítko Export');

    await page.waitForFunction(
      () => [...document.querySelectorAll('[role="menuitem"]')].some((x) => /Uložit jako šablonu/.test(x.textContent || '')),
      { timeout: 15000 },
    );
    ok(true, 'nabídka Exportu obsahuje „Uložit jako šablonu…"');

    ok(await klikPodleTextu('[role="menuitem"]', /Uložit jako šablonu/), 'kliknuto na „Uložit jako šablonu…"');
    await sleep(2500);

    // 1) dialog je fakt vidět
    const dialog = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Uložit jako šablonu/.test(x.innerText || ''));
      return d ? d.innerText : '';
    });
    ok(/Uložit jako šablonu/.test(dialog), 'dialog „Uložit jako šablonu" se otevřel');
    ok(/Název šablony/.test(dialog) && /Kdo šablonu uvidí/.test(dialog), 'dialog má vyplněný obsah (název + viditelnost)');

    // 2) ČERNÁ OBRAZOVKA: strom stojí a stránka není prázdná
    const zivot = await page.evaluate(() => {
      const root = document.getElementById('root') || document.body.firstElementChild;
      return {
        detiRootu: root ? root.children.length : 0,
        delkaTextu: (document.body.innerText || '').trim().length,
        mapaStoji: !!document.querySelector('.react-flow__node'),
      };
    });
    ok(zivot.detiRootu > 0, `React strom po otevření dialogu stojí (dětí v #root: ${zivot.detiRootu})`);
    ok(zivot.delkaTextu > 200, `stránka není prázdná (${zivot.delkaTextu} znaků textu)`);
    ok(zivot.mapaStoji, 'mapa pod dialogem se nerozpadla');

    // 3) uložení dojede do entity Template (čteno z API, ne z UI)
    await page.evaluate(() => {
      const inp = document.querySelector('#tpl-name');
      if (!inp) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, 'Nábor — šablona z prokliku');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);

    // Kategorie SCHVÁLNĚ jiná než výchozí („Firemní procesy") — jinak by se
    // nedalo poznat, jestli se volba z dialogu vůbec někam propsala.
    const kategorieTrigger = await page.$$('[role="dialog"] button[role="combobox"]');
    ok(kategorieTrigger.length >= 1, `dialog má rozbalovač kategorie (${kategorieTrigger.length})`);
    if (kategorieTrigger.length) {
      await kategorieTrigger[0].click();
      await sleep(600);
      ok(await klikPodleTextu('[role="option"]', /^\s*Zdraví\s*$/), 'v nabídce kategorií jde vybrat „Zdraví"');
      await sleep(400);
    }

    ok(await klikPodleTextu('[role="dialog"] button', /^\s*Uložit šablonu\s*$/), 'kliknuto na „Uložit šablonu"');
    await sleep(3000);
    const tpls = (await api('GET', '/api/collections/templates/records?perPage=50&sort=-created', { token: A })).json.items || [];
    const nasa = tpls.find((x) => x.title === 'Nábor — šablona z prokliku');
    ok(!!nasa, `šablona vznikla i v datech (${tpls.length} šablon vlastníka)`);
    ok(!!nasa && (nasa.ai_nodes || []).length >= 3, `šablona nese uzly mapy (${nasa ? (nasa.ai_nodes || []).length : 0})`);
    ok(nasa && nasa.category === 'zdravi', `uložila se ZVOLENÁ kategorie, ne výchozí (${nasa && nasa.category})`);
    ok(nasa && nasa.visibility === 'org', `uložila se zvolená viditelnost organizace (${nasa && nasa.visibility})`);

    // ── Galerie šablon ──────────────────────────────────────────────────────
    // Richard 18. 8. 2026: „když vyberu kategorii, stejně se to do ní nedá,
    // a dal jsem vidí organizace a mám ji v osobních." Obojí byla vada GALERIE,
    // ne ukládání: skupina „Moje šablony" tvrdila „vidíte je jen vy" a lepila
    // zámek „osobní" i firemním šablonám, a filtr kategorií platil JEN na
    // připravené šablony.
    console.log('== galerie: odznak podle viditelnosti a filtr kategorií ==');
    await page.goto(`${BASE}/?view=templates`, { waitUntil: 'networkidle2' });
    await sleep(2500);

    const kartaText = () => page.evaluate(() => {
      const karty = [...document.querySelectorAll('div')].filter(
        (d) => d.className.includes('rounded-xl') && /Nábor — šablona z prokliku/.test(d.innerText || ''));
      return karty.length ? karty[karty.length - 1].innerText : '';
    });
    const naStrance = () => page.evaluate(() => document.body.innerText || '');

    const kartaVse = await kartaText();
    ok(/Nábor — šablona z prokliku/.test(kartaVse), 'šablona je v galerii vidět');
    ok(!/osobní/i.test(kartaVse), 'firemní šablona NENESE odznak „osobní"');

    // Sekce = kdo šablonu vidí. Firemní patří pod „Šablony organizace", do
    // „Mých šablon" (= osobní, vidíte je jen vy) se dostat NESMÍ.
    const sekceSNasi = await page.evaluate(() => {
      const h = [...document.querySelectorAll('h2')];
      const kde = h.filter((x) => /Nábor — šablona z prokliku/.test((x.parentElement || {}).innerText || ''));
      return { nadpisy: h.map((x) => (x.innerText || '').trim()), obsahujici: kde.map((x) => (x.innerText || '').trim()) };
    });
    ok(sekceSNasi.obsahujici.some((n) => /ŠABLONY ORGANIZACE/i.test(n)),
      `šablona stojí v sekci „Šablony organizace" (nalezena v: ${sekceSNasi.obsahujici.join(', ') || 'nikde'})`);
    ok(!sekceSNasi.obsahujici.some((n) => /MOJE ŠABLONY/i.test(n)),
      'šablona NENÍ v sekci „Moje šablony" (ta je jen pro osobní)');

    // filtr kategorií musí platit i na VLASTNÍ šablony
    ok(await klikPodleTextu('button', /^\s*Zdraví\s*$/), 'v galerii jde kliknout na kategorii „Zdraví"');
    await sleep(800);
    ok(/Nábor — šablona z prokliku/.test(await naStrance()), 've zvolené kategorii šablona ZŮSTANE vidět');
    ok(await klikPodleTextu('button', /^\s*Finance\s*$/), 'jde přepnout na jinou kategorii („Finance")');
    await sleep(800);
    ok(!/Nábor — šablona z prokliku/.test(await naStrance()), 'v cizí kategorii šablona ZMIZÍ (filtr platí i na vlastní)');
    ok(await klikPodleTextu('button', /^\s*Všechny\s*$/), 'jde se vrátit na „Všechny"');
    await sleep(800);
    ok(/Nábor — šablona z prokliku/.test(await naStrance()), 'po návratu na „Všechny" je šablona zase vidět');

    ok(errs.length === 0, `konzole bez chyb (${errs.length}${errs.length ? ': ' + errs[0].slice(0, 160) : ''})`);
  } catch (err) {
    console.error('SADA SPADLA:', err);
    fail++;
  } finally {
    if (browser) await browser.close();
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI-SABLONA-Z-MAPY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
