// UI e2e: dva uživatelé nad TOUTÉŽ mapou — hlídání na pozadí + záchrana práce.
// Scénář A: kolega uloží změnu → druhé okno se to dozví BEZ editace (pruh, žádný PATCH).
// Scénář B: kolega uloží změnu → já upravím → 409 → dialog → „Ponechat moje změny"
// → o svoji úpravu NEPŘIJDU (kotva = razítko v databázi, ne pohyb uzlů v DOM).
//
// První sada v repu se DVĚMA reálně přihlášenými uživateli: druhé okno běží
// v izolovaném browser contextu (vlastní localStorage), jinak by obě okna
// sdílela jedno přihlášení. Kontrolu na pozadí (tick à 45 s) testy nevyčkávají —
// vynutí ji událostí `kb-native-resume`, kterou tick poslouchá kvůli mobilu.
const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

const NAME = 'kb-e2e-konflikt-zachrana';
const PORT = 20620;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const VLASTNIK = 'vlastnik@e2e.cz';
const KOLEGA = 'kolega@e2e.cz';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

// Chyby z Google Fonts nejsou vada aplikace (viz ui-conflict-merge.js) —
// filtruje se podle PŮVODU hlášky, ne podle textu.
const cizihoPuvodu = (m) => {
  const u = (m.location() && m.location().url) || '';
  return /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u);
};

const prihlas = async (page, email) => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', email);
  await page.type('#password', PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1500);
};

// Přejmenování uzlu přes dialog (dblclick na kartu → #title → Uložit)
const prejmenuj = async (page, puvodni, novy) => {
  const otevreno = await page.evaluate((hledany) => {
    const h = [...document.querySelectorAll('h3')].find((x) => (x.innerText || '').includes(hledany));
    if (!h) return false;
    h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return true;
  }, puvodni);
  if (!otevreno) return false;
  await sleep(800);
  await page.evaluate(() => { const i = document.querySelector('#title'); if (i) i.value = ''; });
  await page.type('#title', novy);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^(Uložit|Save)/.test((x.innerText || '').trim()));
    if (b) b.click();
  });
  return true;
};

// Kotva proti „zeleným testům na prázdné stránce": bez vykreslených uzlů
// žádný další assert nic nedokazuje.
const cekejNaUzly = async (page, pocet) => {
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-flow__node').length === n,
    { timeout: 45000 }, pocet,
  ).catch(() => {});
  return page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
};

// Autosave má debounce 1200 ms — na uložení kolegovy změny se čeká na RAZÍTKU
// v databázi (past č. 2 ze zadání: DOM nic nedokazuje).
const cekejNaTitulVDb = async (token, mapId, nodeId, titul, s = 15) => {
  for (let i = 0; i < s; i++) {
    const m = (await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token })).json;
    if (m?.nodes?.find((n) => n.id === nodeId)?.data?.title === titul) return m;
    await sleep(1000);
  }
  return null;
};

(async () => {
  let browser;
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await reg(VLASTNIK); await reg(KOLEGA);
    const V = await login(VLASTNIK);
    const mapa = await api('POST', '/api/collections/goalmaps/records', { token: V, body: {
      title: 'Konflikt dvou lidí',
      nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'PROJEKT', title: 'PROJEKT', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 100, y: 380 }, data: { title: 'Krok jedna', status: 'todo' } },
        { id: 'n2', type: 'goalNode', position: { x: 500, y: 380 }, data: { title: 'Krok dva', status: 'todo' } },
      ],
      edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }],
    } });
    const mapId = mapa.json?.id;
    expect(mapa.status === 200 && !!mapId, `mapa založena (${mapa.status})`);
    const sdileni = await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId, email: KOLEGA, permission: 'edit' } });
    expect(sdileni.status === 200, `sdíleno kolegovi na úpravy (${sdileni.status})`);

    browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });

    // okno A = vlastník (výchozí context), okno B = kolega (izolovaný context)
    const pageA = await browser.newPage();
    await pageA.setViewport({ width: 1400, height: 900 });
    const ctxB = await browser.createBrowserContext();
    const pageB = await ctxB.newPage();
    await pageB.setViewport({ width: 1400, height: 900 });

    const errs = [];
    // 409 z PATCHe mapy je TESTOVANÝ mechanismus (konflikt verzí) — prohlížeč
    // každou ne-2xx odpověď sám hlásí jako console error. Filtruje se JEN tahle
    // konkrétní hláška, ne plošně „Failed to load resource" (to by zaslepilo
    // regresi na skutečné 404/500).
    const ocekavany409 = (m) => /status of 409/.test(m.text() || '');
    pageA.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m) && !ocekavany409(m)) errs.push('A: ' + m.text()); });
    pageA.on('pageerror', (e) => errs.push('A: ' + String(e)));
    pageB.on('console', (m) => { if (m.type() === 'error' && !cizihoPuvodu(m) && !ocekavany409(m)) errs.push('B: ' + m.text()); });
    pageB.on('pageerror', (e) => errs.push('B: ' + String(e)));

    // detekce na pozadí smí jen ČÍST — měří se SÍŤ, ne pohyb uzlů
    let patchuA = 0;
    pageA.on('request', (r) => {
      if (r.method() === 'PATCH' && r.url().includes('/api/collections/goalmaps/records')) patchuA++;
    });

    await prihlas(pageA, VLASTNIK);
    await prihlas(pageB, KOLEGA);
    await pageA.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    await pageB.goto(`${BASE}/map/${mapId}`, { waitUntil: 'networkidle2' });
    expect(await cekejNaUzly(pageA, 3) === 3, 'okno A: vykresleny 3 uzly');
    expect(await cekejNaUzly(pageB, 3) === 3, 'okno B: vykresleny 3 uzly');
    await sleep(3000); // usadit editor (případný úvodní autosave) v obou oknech

    console.log('== Scénář A: hlídání na pozadí (bez editace v okně A) ==');
    const patchuAPredtim = patchuA; // úvodní autosave po načtení nepočítat
    expect(await prejmenuj(pageB, 'Krok jedna', 'Krok jedna od kolegy'), 'okno B: přejmenován uzel');
    expect(!!(await cekejNaTitulVDb(V, mapId, 'n1', 'Krok jedna od kolegy')), 'kolegova změna doputovala do databáze');

    // kontrola na pozadí běží à 45 s — vynutit hned událostí, kterou tick poslouchá.
    // ⚠️ Neaktivní záložka je `visibilityState: hidden` a tick ji (správně) ignoruje
    // → okno A musí být v popředí, jinak test měří vlastní slepotu.
    await pageA.bringToFront();
    await sleep(300);
    await pageA.evaluate(() => window.dispatchEvent(new Event('kb-native-resume')));
    await pageA.waitForFunction(
      () => document.body.innerText.includes('Mapu mezitím změnil někdo jiný'),
      { timeout: 8000 },
    ).catch(() => {});
    const teloA = await pageA.evaluate(() => document.body.innerText);
    expect(/Mapu mezitím změnil někdo jiný/.test(teloA), 'okno A: pruh o cizí změně, ANIŽ by se editovalo');
    expect(!/Mapa byla mezitím změněna/.test(teloA), 'okno A: žádný tvrdý dialog (nic se nerozbilo)');
    expect(patchuA === patchuAPredtim, `okno A: detekce jen četla, žádný PATCH (${patchuA - patchuAPredtim} navíc)`);
    expect(await pageA.evaluate(() => document.querySelectorAll('.react-flow__node').length) === 3, 'okno A: stále 3 uzly');

    console.log('== Scénář B: konflikt při editaci → „Ponechat moje změny" ==');
    // čistý start okna A: reload = převzatá aktuální verze, pruh zmizel
    await pageA.reload({ waitUntil: 'networkidle2' });
    expect(await cekejNaUzly(pageA, 3) === 3, 'okno A po reloadu: 3 uzly');
    await sleep(3000);

    // kolega mezitím uloží další změnu…
    expect(await prejmenuj(pageB, 'Krok jedna od kolegy', 'Krok jedna PODRUHÉ'), 'okno B: druhé přejmenování');
    expect(!!(await cekejNaTitulVDb(V, mapId, 'n1', 'Krok jedna PODRUHÉ')), 'druhá kolegova změna v databázi');

    // …a já v okně A rozepíšu svoji úpravu jiného uzlu → autosave → 409 → dialog
    expect(await prejmenuj(pageA, 'Krok dva', 'MOJE ROZDĚLANÉ'), 'okno A: rozepsána vlastní úprava');
    await pageA.waitForFunction(
      () => document.body.innerText.includes('Mapa byla mezitím změněna'),
      { timeout: 10000 },
    ).catch(() => {});
    const dialog = await pageA.evaluate(() => document.body.innerText);
    expect(/Mapa byla mezitím změněna/.test(dialog), 'okno A: dialog konfliktu vyskočil');
    expect(/Ponechat moje změny/.test(dialog), 'dialog nabízí „Ponechat moje změny"');
    expect(/Stáhnout zálohu/.test(dialog), 'dialog nabízí stažení zálohy (JSON)');
    expect(/Načíst aktuální verzi/.test(dialog), 'dialog nabízí i načtení aktuální verze');

    await pageA.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /Ponechat moje změny/.test(x.innerText || ''));
      if (b) b.click();
    });
    await pageA.waitForFunction(
      () => !document.body.innerText.includes('Mapa byla mezitím změněna'),
      { timeout: 8000 },
    ).catch(() => {});
    const poKliku = await pageA.evaluate(() => document.body.innerText);
    expect(!/Mapa byla mezitím změněna/.test(poKliku), 'dialog po volbě zmizel');
    expect(/MOJE ROZDĚLANÉ/.test(poKliku), 'moje rozepsaná úprava zůstala v okně');
    expect(await pageA.evaluate(() => document.querySelectorAll('.react-flow__node').length) === 3, 'okno A: stále 3 uzly');

    // KOTVA V DATABÁZI: moje úprava se uložila; kolegův uzel má verzi, kterou
    // okno A vidělo — jeho „PODRUHÉ" se VĚDOMĚ přepsalo (to je smysl volby).
    const poUlozeni = await cekejNaTitulVDb(V, mapId, 'n2', 'MOJE ROZDĚLANÉ');
    expect(!!poUlozeni, 'moje úprava je v databázi (o práci jsem nepřišel)');
    expect(poUlozeni?.nodes?.find((n) => n.id === 'n1')?.data?.title === 'Krok jedna od kolegy',
      `kolegův uzel má verzi z okna A — vědomé přepsání (${poUlozeni?.nodes?.find((n) => n.id === 'n1')?.data?.title})`);

    // žádná smyčka konfliktů: dialog se sám znovu neobjeví
    await sleep(5000);
    const klid = await pageA.evaluate(() => document.body.innerText);
    expect(!/Mapa byla mezitím změněna/.test(klid), 'po záchraně žádný další dialog (žádná 409 smyčka)');

    expect(errs.length === 0, `konzole obou oken bez chyb (${errs.slice(0, 2).join(' | ') || 'čistá'})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    if (browser) await browser.close();
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} UI KONFLIKT ZÁCHRANA PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
