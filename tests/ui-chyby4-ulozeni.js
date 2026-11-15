// UI e2e (headless Chrome, own temporary profile): a FAILED SAVE of the map is visible and is not
// lost (code analysis 4, F1-03) and closing the tab right after an edit still stores it (F1-09).
//
// Before the fix: a failed PATCH (connection down, 5xx, 400) only reached the console — the
// indicator went back to idle, the change stayed on the canvas and was sent again only with the
// NEXT edit; a tab closed within 1.2 s of an edit threw the edit away.
//
// The person's path: real clicks on the status badge, the connection cut by the browser's
// offline mode, a server error by a forged answer to the PATCH. The database is read through
// the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-ulozeni', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const { browser } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', null);
  const { page } = S;
  const db = (id) => E.mapaZDb(inst, S.token, id);

  // forged answers to the map PATCH: `podvrh` = null (let through) | { status, message, jednou }
  let podvrh = null; const patche = [];
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    const jePatch = rq.method() === 'PATCH' && /\/api\/collections\/goalmaps\/records\//.test(rq.url());
    if (jePatch) patche.push(podvrh ? podvrh.status : 'ok');
    if (jePatch && podvrh) {
      const p = podvrh; if (p.jednou) podvrh = null;
      rq.respond({ status: p.status, contentType: 'application/json', body: JSON.stringify({ status: p.status, message: p.message || 'Chyba.', data: {} }) }).catch(() => {});
      return;
    }
    rq.continue().catch(() => {});
  });

  console.log('== výpadek spojení při ukládání: viditelný stav, opakování samo, nic se neztratí ==');
  const m1 = await E.zalozMapu(inst, S.token, 'Mapa výpadek');
  await S.otevriMapu(m1.id);
  await page.setOfflineMode(true);
  expect(await S.klikStav('k1'), 'offline: klik na stav kroku k1');
  expect(await E.cekej(async () => (await S.pruhUlozeni()) !== null, 8000, 'pruh neuloženo'), 'offline: editor ukázal pruh „změny nejsou uložené“');
  const pruhOff = await S.pruhUlozeni();
  expect(!!pruhOff && pruhOff.kind === 'offline' && /nejsou uložené/.test(pruhOff.text) && /spojení/.test(pruhOff.text), `offline: pruh říká důvod — spojení („${pruhOff ? pruhOff.text.slice(0, 90) : ''}“)`);
  expect((await S.indikator()) === 'error', `offline: indikátor v liště je „Neuloženo“ (${await S.indikator()})`);
  await sleep(4000);
  expect((await S.pruhUlozeni()) !== null && (await S.indikator()) === 'error', 'offline: stav „neuloženo“ je trvalý (po 4 s pořád svítí)');
  expect(E.stav(await db(m1.id), 'k1') === 'todo', 'offline: v databázi změna zatím není');
  await page.setOfflineMode(false);
  expect(await E.cekej(async () => E.stav(await db(m1.id), 'k1') === 'in_progress', 20000, 'uložení po návratu'), `po návratu spojení se změna uložila SAMA, bez další úpravy (k1: ${E.stav(await db(m1.id), 'k1')})`);
  expect(await E.cekej(async () => (await S.pruhUlozeni()) === null, 8000, 'pruh zmizel'), 'po uložení pruh zmizel');
  expect((await S.indikator()) !== 'error', `po uložení indikátor není „Neuloženo“ (${await S.indikator()})`);

  console.log('== chyba serveru 503: pruh s důvodem a opakování samo ==');
  podvrh = { status: 503, message: 'Server je přetížený.', jednou: true };
  expect(await S.klikStav('k2'), '503: klik na stav kroku k2');
  expect(await E.cekej(async () => { const p = await S.pruhUlozeni(); return !!p && p.kind === 'server'; }, 8000, 'pruh server'), '503: pruh „neuloženo“ s chybou serveru');
  const pruh503 = await S.pruhUlozeni();
  expect(!!pruh503 && /Server je přetížený/.test(pruh503.text), `503: pruh nese větu serveru („${pruh503 ? pruh503.text.slice(0, 110) : 'už zmizel'}“)`);
  expect(await E.cekej(async () => E.stav(await db(m1.id), 'k2') === 'in_progress', 15000, 'uložení po 503'), `503: další pokus proběhl sám a změna je v databázi (k2: ${E.stav(await db(m1.id), 'k2')})`);
  expect(await E.cekej(async () => (await S.pruhUlozeni()) === null, 8000, 'pruh zmizel'), '503: po uložení pruh zmizel');

  console.log('== trvalé odmítnutí 400 (strop uzlů): jasná hláška, žádné tiché zahazování ==');
  const m2 = await E.zalozMapu(inst, S.token, 'Mapa odmítnutí');
  await S.otevriMapu(m2.id);
  patche.length = 0;
  podvrh = { status: 400, message: 'Neplatná data mapy: příliš mnoho uzlů (max 1000).' };
  expect(await S.klikStav('k1'), '400: klik na stav kroku k1');
  expect(await E.cekej(async () => { const p = await S.pruhUlozeni(); return !!p && p.kind === 'rejected'; }, 8000, 'pruh odmítnutí'), '400: pruh „změny nejsou uložené — server je odmítl“');
  const pruh400 = await S.pruhUlozeni();
  expect(!!pruh400 && /příliš mnoho uzlů \(max 1000\)/.test(pruh400.text), `400: pruh nese důvod ze serveru („${pruh400 ? pruh400.text.slice(0, 120) : ''}“)`);
  expect(!!pruh400 && /Zpět/.test(pruh400.text) && /zálohu/.test(pruh400.text), '400: pruh říká, co udělat (vrátit úpravu / stáhnout zálohu)');
  expect((await S.indikator()) === 'error', `400: indikátor „Neuloženo“ (${await S.indikator()})`);
  await sleep(7000);
  expect(patche.length === 1, `400: odmítnutý zápis se sám dokola neopakuje (PATCHů: ${patche.length})`);
  expect(await S.klikStav('k2'), '400: další úprava (stav k2)');
  await sleep(3000);
  expect(patche.length === 2 && (await S.pruhUlozeni()) !== null && (await S.indikator()) === 'error', `400: i po další úpravě pruh svítí dál — práce se nezahazuje potichu (PATCHů: ${patche.length})`);
  podvrh = null; // the cause is gone (e.g. the person removed nodes) → "Try again"
  expect(await page.$('[data-testid="save-retry"]') !== null, '400: pruh má tlačítko „Zkusit znovu“');
  await (await page.$('[data-testid="save-retry"]')).click();
  expect(await E.cekej(async () => { const m = await db(m2.id); return E.stav(m, 'k1') === 'in_progress' && E.stav(m, 'k2') === 'in_progress'; }, 10000, 'uložení po Zkusit znovu'), 'po „Zkusit znovu“ jsou v databázi OBĚ úpravy');
  expect(await E.cekej(async () => (await S.pruhUlozeni()) === null, 8000, 'pruh zmizel'), 'po uložení pruh zmizel');

  console.log('== odmítnutá úprava vrácená zpět: pruh zmizí, není co ukládat ==');
  podvrh = { status: 400, message: 'Neplatná data mapy.' };
  expect(await S.klikStav('k1'), 'klik na stav k1 (Probíhá → Hotovo), server odmítá');
  expect(await E.cekej(async () => (await S.pruhUlozeni()) !== null, 8000, 'pruh'), 'pruh svítí');
  await S.klikStav('k1'); await sleep(300); await S.klikStav('k1'); // Hotovo → Založeno → Probíhá = what the database holds
  expect(await E.cekej(async () => (await S.pruhUlozeni()) === null, 8000, 'pruh zmizel'), 'plátno je zpátky ve stavu z databáze → pruh „neuloženo“ zmizel');
  podvrh = null;

  console.log('== odchod z mapy s neuloženou změnou: uživatel se to dozví ==');
  await page.setOfflineMode(true);
  expect(await S.klikStav('k2'), 'offline: klik na stav k2');
  expect(await E.cekej(async () => (await S.pruhUlozeni()) !== null, 8000, 'pruh'), 'offline: pruh svítí už před odchodem');
  // leave through the app (popstate = what a link / the browser's Back does); the page itself is cached
  await page.evaluate(() => { window.history.pushState({}, '', '/tasks'); window.dispatchEvent(new PopStateEvent('popstate')); });
  expect(await E.cekej(async () => (await S.toasty()).some((x) => /se nepodařilo uložit/.test(x) && /Mapa odmítnutí/.test(x)), 8000, 'hláška po odchodu'), `po odchodu z mapy hláška „Poslední změny v mapě … se nepodařilo uložit“ (${JSON.stringify((await S.toasty()).slice(0, 2)).slice(0, 160)})`);
  await page.setOfflineMode(false);

  console.log('== nový 409 ze serveru (souběh zápisů, bez ohledu na base_updated): cesta konfliktu ==');
  const m3 = await E.zalozMapu(inst, S.token, 'Mapa souběh');
  await S.otevriMapu(m3.id);
  podvrh = { status: 409, message: 'Mapu mezitím změnil někdo jiný.', jednou: true };
  expect(await S.klikStav('k1'), '409: klik na stav k1');
  expect(await E.cekej(async () => E.stav(await db(m3.id), 'k1') === 'in_progress', 15000, 'uložení po 409'), `409 bez cizí změny: editor mapu přečetl, slil a uložil znovu (k1: ${E.stav(await db(m3.id), 'k1')})`);
  expect(await page.evaluate(() => !/Mapa byla mezitím změněna/.test(document.body.innerText)) && (await S.pruhUlozeni()) === null, '409 bez cizí změny: žádný dialog konfliktu ani pruh „neuloženo“');
  // a real collision behind the 409: the same node renamed elsewhere while I rename it too
  const cur = await db(m3.id);
  await inst.api('PATCH', `/api/collections/goalmaps/records/${m3.id}`, { token: S.token, body: { nodes: cur.nodes.map((n) => (n.id === 'k2' ? { ...n, data: { ...n.data, title: 'Krok dva JINDE' } } : n)), edges: cur.edges } });
  expect(await S.otevriDialog('k2'), '409 s kolizí: dialog kroku k2');
  await page.click('[role="dialog"] #title', { clickCount: 3 });
  await page.keyboard.type('Krok dva U MĚ');
  expect(await S.klikText('Uložit', '[role="dialog"]'), '409 s kolizí: Uložit v dialogu');
  expect(await E.cekej(() => page.evaluate(() => /Mapa byla mezitím změněna/.test(document.body.innerText)), 10000, 'dialog konfliktu'), '409 s kolizí na témže uzlu: dialog „Mapa byla mezitím změněna“');
  expect(E.nazev(await db(m3.id), 'k2') === 'Krok dva JINDE', 'cizí změna v databázi zůstala nepřepsaná');

  console.log('== F1-09: zavření karty / obnovení stránky těsně po úpravě ==');
  // own context WITHOUT request interception (a request that outlives its page has nobody to continue it)
  const Z = await E.clovek(browser, inst, 'sef@example.com', null);
  const dialogy = [];
  const hlidejDialogy = (pg, prodleva = 0) => pg.on('dialog', async (d) => { dialogy.push(d.type()); if (prodleva) await sleep(prodleva); await d.accept().catch(() => {}); });
  hlidejDialogy(Z.page);
  const m4 = await E.zalozMapu(inst, S.token, 'Mapa zavření');
  await Z.otevriMapu(m4.id);
  expect(await Z.klikStav('k1'), 'klik na stav k1 a za 0,3 s zavření karty');
  await sleep(300);
  await Z.page.close();
  expect(await E.cekej(async () => E.stav(await db(m4.id), 'k1') === 'in_progress', 8000, 'uložení po zavření'), `změna 0,3 s před zavřením karty JE v databázi (k1: ${E.stav(await db(m4.id), 'k1')})`);

  const Z2 = { ...Z, page: await Z.ctx.newPage() };
  await Z2.page.setViewport({ width: 1920, height: 1000 });
  hlidejDialogy(Z2.page);
  const klikStav = async (pg, id) => { const b = await pg.$(`.react-flow__node[data-id="${id}"] button[title]`); await b.click(); };
  const otevri = async (pg, id) => { await pg.goto(`${inst.base}/map/${id}`, { waitUntil: 'networkidle2' }); await pg.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 45000 }); await sleep(2000); };
  await otevri(Z2.page, m4.id);
  dialogy.length = 0;
  await Z2.page.reload({ waitUntil: 'networkidle2' });
  expect(dialogy.length === 0, `obnovení stránky BEZ neuložené práce se na nic neptá (dialogů: ${dialogy.length})`);
  await Z2.page.waitForSelector('.react-flow__node[data-id="k2"]', { timeout: 45000 });
  await sleep(2000);
  await klikStav(Z2.page, 'k2');
  await sleep(300);
  await Z2.page.reload({ waitUntil: 'networkidle2' });
  expect(dialogy.length === 0, `malá mapa, obnovení stránky 0,3 s po úpravě: prohlížeč se NEPTÁ, uložení odejde samo (${JSON.stringify(dialogy)})`);
  expect(await E.cekej(async () => E.stav(await db(m4.id), 'k2') === 'in_progress', 8000, 'uložení po F5'), `změna 0,3 s před obnovením stránky JE v databázi (k2: ${E.stav(await db(m4.id), 'k2')})`);

  console.log('== F1-09: velká mapa (tělo nad 64 kB — keepalive nejde) ==');
  const velke = E.NODES().concat(Array.from({ length: 30 }, (_, i) => ({ id: `v${i}`, type: 'goalNode', position: { x: i * 260, y: 520 }, data: { title: `Velký ${i}`, status: 'todo', description: 'Dlouhý popis kroku. '.repeat(160) } })));
  const m5 = (await inst.api('POST', '/api/collections/goalmaps/records', { token: S.token, body: { title: 'Mapa velká', nodes: velke, edges: E.EDGES().concat(velke.slice(3).map((n, i) => ({ id: `ev${i}`, source: 'k1', target: n.id }))) } })).json;
  const velikost = Buffer.byteLength(JSON.stringify({ nodes: m5.nodes, edges: m5.edges }));
  expect(velikost > 70000, `mapa má ${Math.round(velikost / 1024)} kB (nad limitem keepalive)`);
  const Z3 = { page: await Z.ctx.newPage() };
  await Z3.page.setViewport({ width: 1920, height: 1000 });
  hlidejDialogy(Z3.page, 1500); // the person reads the question for a moment, then leaves anyway
  await otevri(Z3.page, m5.id);
  dialogy.length = 0;
  await klikStav(Z3.page, 'k2');
  await sleep(300);
  await Z3.page.reload({ waitUntil: 'networkidle2' });
  expect(dialogy.includes('beforeunload'), 'velká mapa: obnovení stránky 0,3 s po úpravě se zeptá');
  expect(await E.cekej(async () => E.stav(await db(m5.id), 'k2') === 'in_progress', 8000, 'uložení velké mapy'), `velká mapa: změna je v databázi (k2: ${E.stav(await db(m5.id), 'k2')})`);
  // without the question (tab closed outright): an ordinary request, best effort — reported, not asserted
  await Z3.page.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 45000 });
  await sleep(2000);
  await klikStav(Z3.page, 'k1');
  await sleep(300);
  await Z3.page.close();
  await sleep(3000);
  console.log(`  ℹ️ velká mapa, karta zavřená bez dotazu 0,3 s po úpravě: k1 v databázi = ${E.stav(await db(m5.id), 'k1')} (bez keepalive jen „nejlepší snaha“)`);
}, { nazev: 'UI-CHYBY4-ULOZENI' });
