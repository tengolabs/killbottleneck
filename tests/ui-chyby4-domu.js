// UI e2e (headless Chrome, own temporary profile): the home page shows ALL live projects (code
// analysis 4, F5-06).
//
// Before the fix: the page asked for the 50 most recently changed maps INCLUDING archived ones and
// filtered in the browser. The 51st project was silently missing; after archiving old projects
// (archiving "changes" a map) the archived ones took the whole window and live projects vanished.
// The "Archiv (N)" link counted from the same window.
//
// Fixture: 58 live projects, then 55 projects archived AFTER them (so they are the most recently
// changed). The person's path: open the home page, read the cards, click the archive link.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

const SEF = 'sef@example.com';
const ZIVYCH = 58, ARCHIVNICH = 55;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-domu', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(SEF, { name: 'Šéf' });
  const T = await inst.login(SEF);
  const zaloz = async (title, extra = {}) => (await inst.api('POST', '/api/collections/goalmaps/records', {
    token: T, body: { title, nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', title, apexText: title, status: 'todo' } }], edges: [], ...extra },
  })).json;
  let zalozeno = 0;
  for (let i = 1; i <= ZIVYCH; i++) { const m = await zaloz(`Zivy-${String(i).padStart(2, '0')}`); if (m.id) zalozeno++; }
  await sleep(1100); // the archived ones are changed LATER than every live one
  const archivni = [];
  for (let i = 1; i <= ARCHIVNICH; i++) { const m = await zaloz(`Stary-${String(i).padStart(2, '0')}`); if (m.id) archivni.push(m.id); }
  let archivovano = 0;
  for (const id of archivni) {
    const r = await inst.api('PATCH', `/api/collections/goalmaps/records/${id}`, { token: T, body: { archived: true } });
    if (r.status === 200) archivovano++;
  }
  expect(zalozeno === ZIVYCH && archivovano === ARCHIVNICH, `fixtura: ${zalozeno} živých projektů, ${archivovano} archivovaných po nich`);

  const { browser } = await H.browser();
  const chyby = [];
  const S = await E.clovek(browser, inst, SEF, chyby);
  const { page } = S;
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await E.cekej(() => page.evaluate(() => /Zivy-\d\d/.test(document.body.innerText)), 20000, 'karty');
  await sleep(1500);
  const text = await page.evaluate(() => document.body.innerText);
  const videt = [...new Set(text.match(/Zivy-\d\d/g) || [])];
  expect(videt.length === ZIVYCH, `titulní stránka ukazuje všech ${ZIVYCH} živých projektů (vidět ${videt.length})`);
  expect(videt.includes('Zivy-01') && videt.includes(`Zivy-${ZIVYCH}`), 'vidět je nejstarší i nejnovější živý projekt');
  expect(!/Stary-\d\d/.test(text), 'archivované projekty na titulní stránce nejsou');
  expect(!/Zatím nemáte žádn/.test(text) && new RegExp(`Moje projekty\\s*\\(${ZIVYCH}\\)`, 'i').test(text), `sekce „Moje projekty (${ZIVYCH})“ (${(text.match(/Moje projekty[^\n]*/i) || [''])[0]})`);
  const odkaz = (text.match(/Archiv \((\d+)\)/) || [])[1];
  expect(Number(odkaz) === ARCHIVNICH, `odkaz na archiv nese skutečný počet: „Archiv (${odkaz})“ (čeká se ${ARCHIVNICH})`);

  console.log('== archivace z titulní stránky: karta zmizí, počet archivu naroste ==');
  const karta = await page.evaluateHandle(() => {
    const k = [...document.querySelectorAll('h3, [class*="font-heading"]')].find((x) => (x.innerText || '').trim() === 'Zivy-07');
    let el = k; while (el && !el.querySelector('button[aria-label="Archivovat"], button[title="Archivovat"]')) el = el.parentElement;
    return el ? el.querySelector('button[aria-label="Archivovat"], button[title="Archivovat"]') : null;
  });
  if (karta.asElement()) {
    await karta.asElement().click(); // window.confirm is accepted by the helper
    expect(await E.cekej(() => page.evaluate((n) => new RegExp(`Archiv \\(${n}\\)`).test(document.body.innerText), ARCHIVNICH + 1), 10000, 'počet archivu'), `po archivaci jednoho projektu odkaz ukazuje „Archiv (${ARCHIVNICH + 1})“`);
    expect(await page.evaluate(() => !document.body.innerText.includes('Zivy-07')), 'archivovaný projekt z titulní stránky zmizel');
  } else {
    expect(false, 'karta projektu má tlačítko „Archivovat“');
  }

  console.log('== jen archivované projekty: titulní stránka není „prázdná“, vede do archivu ==');
  const jine = 'jina@example.com';
  await inst.register(jine, { name: 'Jiná' });
  const T2 = await inst.login(jine);
  const m = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T2, body: { title: 'Jediny-archivni', nodes: [], edges: [] } })).json;
  await inst.api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: T2, body: { archived: true } });
  const S2 = await E.clovek(browser, inst, jine, chyby);
  await S2.page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await E.cekej(() => S2.page.evaluate(() => /Archiv \(1\)/.test(document.body.innerText)), 15000, 'odkaz archivu'), 'účet jen s archivovaným projektem vidí odkaz „Archiv (1)“');

  const predVypadkem = chyby.length;
  console.log('== další stránka projektů selže: pruh s „Zkusit znovu“ místo tichého neúplného seznamu ==');
  let selhani = true;
  await page.setRequestInterception(true);
  page.on('request', (rq) => {
    if (selhani && rq.method() === 'GET' && /\/api\/collections\/goalmaps\/records\?.*\bpage=2\b/.test(rq.url())) {
      rq.respond({ status: 503, contentType: 'application/json', body: JSON.stringify({ status: 503, message: 'Server je přetížený.', data: {} }) }).catch(() => {});
      return;
    }
    rq.continue().catch(() => {});
  });
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  expect(await E.cekej(() => page.evaluate(() => !!document.querySelector('[data-testid="home-load-error"]')), 15000, 'pruh chyby'), 'po selhání druhé stránky projektů je vidět pruh „Projekty se nepodařilo načíst všechny“');
  const castecne = await page.evaluate(() => [...new Set(document.body.innerText.match(/Zivy-\d\d/g) || [])].length);
  expect(castecne === 50, `první stránka (50 projektů) zůstala vidět (vidět ${castecne})`);
  selhani = false;
  await page.click('[data-testid="home-load-retry"]');
  expect(await E.cekej(() => page.evaluate(() => !document.querySelector('[data-testid="home-load-error"]')), 15000, 'pruh zmizí'), 'po „Zkusit znovu“ pruh zmizel');
  const poOprave = await page.evaluate(() => [...new Set(document.body.innerText.match(/Zivy-\d\d/g) || [])].length);
  expect(poOprave === ZIVYCH - 1, `po „Zkusit znovu“ je vidět všech ${ZIVYCH - 1} živých projektů (vidět ${poOprave})`);
  chyby.length = predVypadkem; // the forged 503 is expected in the console

  expect(chyby.length === 0, `konzole bez chyb: ${JSON.stringify(chyby.slice(0, 3)).slice(0, 300)}`);
}, { nazev: 'UI-CHYBY4-DOMU' });
