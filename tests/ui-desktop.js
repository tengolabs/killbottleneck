// Web ↔ aplikace pro Windows: co web dělá jinak v okně aplikace (window.kbDesktop) a co NE v prohlížeči.
// Rám (product/desktop) se tu podvrhuje objektem se stejnou smlouvou (api 1) — skutečný Electron
// testuje product/tests/desktop-e2e/e2e.js. Kontroluje se OBOJÍ SMĚR: každá věc navíc v aplikaci
// musí v prohlížeči chybět, a naopak (PWA service worker, Google Disk).
// Navíc oprava pro všechny: výpadek serveru (502) při startu stránky už neodhlásí, 401 ano;
// a v aplikaci přihlášený člověk na /login jde rovnou dál (po výpadku nemusí znovu zadávat
// heslo; v prohlížeči /login zůstává i pro přihlášeného — přihlášení za jiného člověka).
const H = require('./_harness');

const { expect, sleep, waitFor } = H;

// Stejná smlouva jako product/desktop/preload.cjs (api 1); volání se zapisují do window.__ram.
function falesnyRam() {
  window.__ram = { zmena: 0, flush: 0, hotovo: [], pozadavek: null };
  window.kbDesktop = Object.freeze({
    api: 1,
    version: '9.9.9',
    changeOrganization: () => { window.__ram.zmena++; },
    supportsFlush: () => { window.__ram.flush++; },
    flushDone: () => { window.__ram.hotovo.push(Date.now()); },
    takeOpenRequest: () => { const r = window.__ram.pozadavek; window.__ram.pozadavek = null; return r; },
  });
}

H.beh(async () => {
  const inst = await H.startInstance({
    slug: 'ui-desktop',
    env: { KB_UVODNI_MAPA: 0, KB_GOOGLE_CLIENT_ID: 'dummy.apps.googleusercontent.com', KB_GOOGLE_CLIENT_SECRET: 'dummy', KB_GOOGLE_PICKER_API_KEY: 'dummy-picker-key' },
  });
  await inst.register('anna@e2e.cz', { name: 'Anna' });
  await inst.register('petr@e2e.cz', { name: 'Petr' });
  const anna = await inst.login('anna@e2e.cz');
  const petr = await inst.login('petr@e2e.cz');
  const uzly = (owner) => [
    { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'Desktop', title: 'Desktop', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 300, y: 380 }, data: { title: 'Krok s podklady', status: 'todo', ...(owner ? { owner } : {}) } },
  ];
  const hrany = [{ id: 'e1', source: 'apex', target: 'n1' }];
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: anna, body: { title: 'Desktop', nodes: uzly(), edges: hrany } })).json;
  expect(!!mapa.id, 'mapa Anny založena');

  const { browser } = await H.browser();
  // Každá stránka ve vlastním kontextu (čisté úložiště); `ram` = podvržená aplikace, `token` = přihlášení.
  async function stranka({ ram = false, token = null } = {}) {
    const kontext = await browser.createBrowserContext();
    const page = await kontext.newPage();
    await page.setViewport({ width: 1500, height: 950 });
    const pozadavky = [];
    page.on('request', (r) => pozadavky.push(r.url()));
    if (ram) await page.evaluateOnNewDocument(falesnyRam);
    if (token) await page.evaluateOnNewDocument((t) => { if (!localStorage.getItem('pocketbase_auth')) localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: {} })); }, token);
    return { page, pozadavky, zavri: () => kontext.close() };
  }
  const textStranky = (page) => page.evaluate(() => document.body.innerText);
  const pocetSw = (page) => page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length));
  const chunkAplikace = (pozadavky) => pozadavky.some((u) => /\/assets\/desktopApp-[^/]+\.js$/.test(u));
  const host = new URL(inst.base).host;

  console.log('== přihlášení: v aplikaci adresa organizace a „Změnit organizaci“, v prohlížeči ne ==');
  {
    const web = await stranka();
    await web.page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await web.page.waitForSelector('#email');
    const t = await textStranky(web.page);
    expect(!t.includes('Změnit organizaci') && !t.includes(`Organizace: ${host}`), 'prohlížeč: řádek organizace na přihlášení NENÍ');
    expect(!chunkAplikace(web.pozadavky), 'prohlížeč: kus webu pro aplikaci se nestahuje');
    await waitFor(async () => (await pocetSw(web.page)) > 0, { timeout: 8000, popis: 'service worker v prohlížeči' }).catch(() => {});
    expect((await pocetSw(web.page)) > 0, 'prohlížeč: PWA service worker se registruje dál');
    await web.zavri();

    const app = await stranka({ ram: true });
    await app.page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await app.page.waitForSelector('#email');
    const ta = await textStranky(app.page);
    expect(ta.includes(`Organizace: ${host}`), `aplikace: přihlášení ukazuje „Organizace: ${host}“`);
    const tlacitko = await app.page.evaluateHandle(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Změnit organizaci'));
    expect(!!(await tlacitko.evaluate((b) => !!b)), 'aplikace: tlačítko „Změnit organizaci“');
    await tlacitko.evaluate((b) => b.click());
    expect(await app.page.evaluate(() => window.__ram.zmena === 1), 'klik → rám dostane changeOrganization()');
    await waitFor(() => chunkAplikace(app.pozadavky), { timeout: 8000, popis: 'kus webu pro aplikaci' }).catch(() => {});
    expect(chunkAplikace(app.pozadavky), 'aplikace: kus webu pro aplikaci (desktopApp) se načetl');
    expect(await app.page.evaluate(() => window.__ram.flush >= 1), 'aplikace: web ohlásil rámu uložení rozdělané práce (supportsFlush)');
    await sleep(3000);
    expect((await pocetSw(app.page)) === 0, 'aplikace: service worker se NEregistruje');
    await app.zavri();
  }

  console.log('== Google Disk v detailu uzlu: v prohlížeči ano, v aplikaci ne ==');
  async function dialogUzlu(page) {
    await page.goto(`${inst.base}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.react-flow__node[data-id="n1"]', { timeout: 45000 });
    await sleep(1500);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('.react-flow__node *')].find((x) => (x.innerText || '').trim() === 'Krok s podklady');
      if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await page.waitForSelector('[role="dialog"] [data-cat="files"]', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('[role="dialog"] [data-cat="files"]').click());
    await sleep(800);
  }
  {
    const web = await stranka({ token: anna });
    await dialogUzlu(web.page);
    expect(!!(await web.page.$('[data-testid="drive-picker"]')), 'prohlížeč: „Vybrat z Disku“ je');
    await web.zavri();
    const app = await stranka({ ram: true, token: anna });
    await dialogUzlu(app.page);
    expect(!!(await app.page.$('[role="dialog"] [data-cat="files"]')), 'aplikace: sekce příloh otevřená (kontrola níž neprojde naprázdno)');
    expect(!(await app.page.$('[data-testid="drive-picker"]')), 'aplikace: „Vybrat z Disku“ NENÍ (Google token by se do okna nevrátil)');
    await app.zavri();
  }

  console.log('== O aplikaci: verze aplikace pro Windows jen v aplikaci ==');
  for (const ram of [false, true]) {
    const s = await stranka({ ram, token: anna });
    await s.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    await s.page.waitForSelector('[data-user-menu]', { timeout: 20000 });
    await s.page.click('[data-user-menu]');
    await s.page.waitForSelector('[role="menuitem"]', { visible: true });
    await s.page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.innerText.includes('O aplikaci')).click());
    await s.page.waitForSelector('[role="dialog"]', { visible: true });
    const t = await s.page.$eval('[role="dialog"]', (d) => d.innerText);
    if (ram) expect(t.includes('Aplikace pro Windows 9.9.9'), 'aplikace: „Aplikace pro Windows 9.9.9“ v O aplikaci');
    else expect(!t.includes('Aplikace pro Windows'), 'prohlížeč: O aplikaci bez řádku aplikace pro Windows');
    await s.zavri();
  }

  console.log('== uložení rozdělané práce: rám počká na ukladače, nejdéle ~3 s ==');
  {
    const app = await stranka({ ram: true, token: anna });
    await app.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    await waitFor(() => app.page.evaluate(() => window.__ram.flush >= 1), { timeout: 10000, popis: 'napojení na rám' });
    const pomaly = await app.page.evaluate(async () => {
      window.addEventListener('kb-desktop-flush', (e) => e.detail.wait(new Promise((r) => setTimeout(r, 600))), { once: true });
      const t0 = Date.now();
      window.dispatchEvent(new Event('kb-desktop-flush-request'));
      while (window.__ram.hotovo.length < 1) await new Promise((r) => setTimeout(r, 50));
      return window.__ram.hotovo[0] - t0;
    });
    expect(pomaly >= 550 && pomaly < 2500, `flushDone až po doběhnutí ukladače (${pomaly} ms)`);
    const visici = await app.page.evaluate(async () => {
      window.addEventListener('kb-desktop-flush', (e) => e.detail.wait(new Promise(() => {})), { once: true });
      const t0 = Date.now();
      window.dispatchEvent(new Event('kb-desktop-flush-request'));
      while (window.__ram.hotovo.length < 2) await new Promise((r) => setTimeout(r, 50));
      return window.__ram.hotovo[1] - t0;
    });
    expect(visici >= 2900 && visici < 4000, `viselý ukladač rám nezablokuje — strop ~3 s (${visici} ms)`);
    await app.zavri();
  }

  console.log('== skutečná úprava mapy + okamžité uložení (autosave by jinak čekal 1,2 s) ==');
  {
    const app = await stranka({ ram: true, token: anna });
    await app.page.goto(`${inst.base}/map/${mapa.id}`, { waitUntil: 'networkidle2' });
    await app.page.waitForSelector('.react-flow__node[data-id="n1"]', { timeout: 45000 });
    await sleep(2500);
    await app.page.evaluate(() => {
      const el = [...document.querySelectorAll('.react-flow__node *')].find((x) => (x.innerText || '').trim() === 'Krok s podklady');
      if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await app.page.waitForSelector('[role="dialog"] #title', { timeout: 8000 });
    await app.page.click('[role="dialog"] #title', { clickCount: 3 });
    await app.page.keyboard.type('Uloženo před zavřením');
    const vysledek = await app.page.evaluate(async () => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /^Uložit/.test((x.innerText || '').trim()) && !x.disabled);
      if (!b) return { ok: false };
      b.click();
      await new Promise((r) => setTimeout(r, 150)); // autosave teď čeká na svůj časovač (1,2 s)
      const pred = window.__ram.hotovo.length;
      const t0 = Date.now();
      window.dispatchEvent(new Event('kb-desktop-flush-request'));
      while (window.__ram.hotovo.length <= pred) await new Promise((r) => setTimeout(r, 25));
      return { ok: true, ms: Date.now() - t0 };
    });
    expect(vysledek.ok, 'úprava uzlu uložena v dialogu');
    const ulozena = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: anna })).json;
    const titulek = ((ulozena.nodes || []).find((n) => n.id === 'n1') || {}).data?.title;
    expect(titulek === 'Uloženo před zavřením', `po flushDone (${vysledek.ms} ms) je úprava v databázi — dřív než by doběhl časovač autosave (${titulek})`);
    await app.zavri();
  }

  console.log('== klik na upozornění Windows: web otevře cíl a označí přečtené ==');
  {
    await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: anna, body: { nodes: uzly('petr@e2e.cz'), edges: hrany } });
    await inst.api('POST', '/api/collections/comments/records', { token: anna, body: { goalmap: mapa.id, node_id: 'n1', text: 'Mrkni na to' } });
    const radek = await waitFor(async () => ((await inst.api('GET', '/api/collections/notifications/records?filter=type%3D%22node_comment%22', { token: petr })).json.items || [])[0], { popis: 'notifikace pro Petra' });
    const app = await stranka({ ram: true, token: petr });
    await app.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    await waitFor(() => app.page.evaluate(() => window.__ram.flush >= 1), { timeout: 10000, popis: 'napojení na rám' });
    await app.page.evaluate((id) => { window.__ram.pozadavek = { id }; window.dispatchEvent(new Event('kb-desktop-open')); }, radek.id);
    await waitFor(() => app.page.evaluate(() => location.pathname.startsWith('/map/')), { timeout: 10000, popis: 'přechod do mapy' }).catch(() => {});
    const url = new URL(app.page.url());
    expect(url.pathname === `/map/${mapa.id}` && url.searchParams.get('node') === 'n1', `cíl notifikace: mapa s uzlem (${url.pathname}${url.search})`);
    expect(await app.page.evaluate(() => window.__ram.pozadavek === null), 'web si požadavek vyzvedl (takeOpenRequest)');
    const po = (await inst.api('GET', `/api/collections/notifications/records/${radek.id}`, { token: petr })).json;
    expect(po.read === true, 'notifikace je přečtená');
    await app.zavri();
  }

  console.log('== výpadek serveru při startu stránky už neodhlásí (502), neplatné přihlášení ano (401) ==');
  for (const [kod, odhlasit, ram] of [[502, false, true], [401, true, false]]) {
    const s = await stranka({ token: anna, ram });
    await s.page.setRequestInterception(true);
    s.page.on('request', (r) => {
      if (r.url().includes('/api/collections/users/auth-refresh')) r.respond({ status: kod, contentType: 'application/json', body: JSON.stringify({ status: kod, message: 'x', data: {} }) });
      else r.continue();
    });
    await s.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const ulozeno = await s.page.evaluate(() => localStorage.getItem('pocketbase_auth'));
    if (odhlasit) expect(!ulozeno, `odpověď ${kod} na obnovu přihlášení → odhlášen`);
    else expect(!!ulozeno && JSON.parse(ulozeno).token, `odpověď ${kod} na obnovu přihlášení → přihlášení ZŮSTÁVÁ`);
    if (!odhlasit) {
      // v aplikaci: výpadek poslal na /login; server se vrátil → obnovení NESMÍ chtít heslo znovu
      expect(new URL(s.page.url()).pathname === '/login', `při výpadku chráněná stránka poslala na přihlášení (${new URL(s.page.url()).pathname})`);
      s.page.removeAllListeners('request');
      await s.page.setRequestInterception(false);
      await s.page.reload({ waitUntil: 'networkidle2' });
      await sleep(1500);
      expect(new URL(s.page.url()).pathname !== '/login', `po návratu serveru obnovení vede do aplikace, ne na formulář s heslem (${new URL(s.page.url()).pathname})`);
    }
    await s.zavri();
  }
  {
    // prohlížeč: /login slouží i k přihlášení za jiného člověka → formulář i pro přihlášeného
    const w = await stranka({ token: anna });
    await w.page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    const formular = new URL(w.page.url()).pathname === '/login' && !!(await w.page.$('#email'));
    expect(formular, `prohlížeč: přihlášený na /login vidí formulář (přepnutí uživatele) (${new URL(w.page.url()).pathname})`);
    await w.zavri();
  }
  {
    // aplikace: přihlášený na /login?next= jde rovnou na cíl; cizí cíl ne
    const s = await stranka({ token: anna, ram: true });
    await s.page.goto(`${inst.base}/login?next=${encodeURIComponent('/notifications')}`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    expect(new URL(s.page.url()).pathname === '/notifications', `aplikace: přihlášený na /login?next= → rovnou na cíl (${new URL(s.page.url()).pathname})`);
    await s.page.goto(`${inst.base}/login?next=${encodeURIComponent('//evil.example/x')}`, { waitUntil: 'networkidle2' });
    await sleep(1500);
    expect(new URL(s.page.url()).origin === inst.base, `cizí ?next= nikam ven (${s.page.url()})`);
    await s.zavri();
  }
}, { nazev: 'UI-DESKTOP' });
