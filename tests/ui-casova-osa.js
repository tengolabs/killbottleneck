// UI e2e: ČASOVÁ OSA (Gantt) na stránce Úkoly — vydání v0.57-beta.
//
// Nový čtvrtý pohled (záložka na 2. pozici: Tabulka | Časová osa | Kanban |
// Kalendář): horizontální osa seskupená po projektech, škály Dny/Týdny/Měsíce
// (ISO týdny, kvartální hlavička), navigace −1/Dnes/+1, značka Dnes, položky
// po termínu s červeným prstencem. Volba pohledu se pamatuje (kb-tasks-view).
//
// Fixtura: projekt se 4 cíli — po termínu (včera), dnes, budoucí (+10 dní),
// hotový (+5 dní). Vše přes API uživatele (uzly s termínem, žádné úkolové
// záznamy — „uzel JE úkol").
//
// MUTAČNÍ DŮKAZ: na image z main sada ČERVENÁ — záložka „Časová osa" neexistuje.
const H = require('./_harness');
const { expect, sleep } = H;

const UCET = 'osa@e2e.cz';
const den = (posun) => {
  const d = new Date();
  d.setDate(d.getDate() + posun);
  return d.toISOString().slice(0, 10);
};

H.beh(async () => {
  // bez úvodní mapy — sada kontroluje přesné názvy cílů, výchozí obsah by rušil
  const inst = await H.startInstance({ slug: 'casova-osa', env: { KB_UVODNI_MAPA: 0 } });

  const reg = await inst.register(UCET);
  expect(reg.status === 200, `účet založen (${reg.status})`);
  const T = await inst.login(UCET);

  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
    title: 'Rozjezd kavárny',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'ROZJEZD KAVÁRNY', title: 'ROZJEZD KAVÁRNY', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'Zpožděná kolaudace', status: 'todo', deadline: den(-1), owner: UCET } },
      { id: 'n2', type: 'goalNode', position: { x: 250, y: 380 }, data: { title: 'Dnešní ochutnávka', status: 'in_progress', deadline: den(0), owner: UCET } },
      { id: 'n3', type: 'goalNode', position: { x: 500, y: 380 }, data: { title: 'Budoucí otevření', status: 'todo', deadline: den(10), owner: UCET } },
      { id: 'n4', type: 'goalNode', position: { x: 750, y: 380 }, data: { title: 'Hotové vybavení', status: 'done', deadline: den(5), owner: UCET } },
    ],
    edges: [
      { id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' },
      { id: 'e3', source: 'apex', target: 'n3' }, { id: 'e4', source: 'apex', target: 'n4' },
    ],
  } })).json;
  expect(!!mapa.id, 'projekt s termíny založen');

  const { page, chyby } = await H.browser();
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', UCET);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1200);

  console.log('== /tasks: záložka „Časová osa" na 2. pozici ==');
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const zalozky = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((el) => (el.textContent || '').trim()));
  expect(zalozky.length >= 4, `lišta pohledů má ${zalozky.length} záložky`);
  expect(zalozky[0] === 'Tabulka' && zalozky[1] === 'Časová osa',
    `pořadí pohledů: ${zalozky.slice(0, 4).join(' | ')} (čeká se Tabulka | Časová osa | …)`);

  console.log('== přepnutí na Časovou osu: projekt, cíle, týdenní hlavička, Dnes ==');
  // skutečný klik myší (syntetické el.click() radixový TabsTrigger nepřepne)
  const klikTab = async (text) => {
    for (const h of await page.$$('[role="tab"]')) {
      if ((await page.evaluate((el) => (el.textContent || '').trim(), h)) === text) { await h.click(); break; }
    }
    await page.waitForFunction((tx) => {
      const el = [...document.querySelectorAll('[role="tab"]')].find((t2) => (t2.textContent || '').trim() === tx);
      return el && (el.getAttribute('aria-selected') === 'true' || el.dataset.state === 'active');
    }, { timeout: 10000 }, text).catch(() => {});
    await sleep(1200);
  };
  await klikTab('Časová osa');
  const telo = await page.evaluate(() => document.body.innerText);
  expect(/Rozjezd kavárny/.test(telo), 'levý strom ukazuje projekt');
  for (const cil of ['Zpožděná kolaudace', 'Dnešní ochutnávka', 'Budoucí otevření', 'Hotové vybavení']) {
    expect(telo.includes(cil), `cíl „${cil}" je na ose`);
  }
  expect(/\d+\. týden/.test(telo), 'týdenní hlavička ukazuje číslo ISO týdne (výchozí škála Týdny)');
  expect(/\bDnes\b/.test(telo), 'značka/tlačítko Dnes existuje');
  // po termínu = červený prstenec (ring-red na značce, ring-rose na pruhu)
  const poTerminu = await page.evaluate(() =>
    document.querySelectorAll('[class*="ring-red-500"], [class*="ring-rose-500"]').length);
  expect(poTerminu >= 1, `položka po termínu má červené zvýraznění (${poTerminu} prvků)`);

  console.log('== škály: Dny (dny v týdnu) a Měsíce (kvartál + měsíc) ==');
  const klikText = async (text) => {
    for (const h of await page.$$('button')) {
      if ((await page.evaluate((el) => (el.textContent || '').trim(), h)) === text) { await h.click(); break; }
    }
    await sleep(800);
  };
  await klikText('Dny');
  const teloDny = await page.evaluate(() => document.body.innerText);
  expect(/\b(Po|Út|St|Čt|Pá)\b/.test(teloDny), 'denní škála ukazuje zkratky dnů v týdnu');
  expect(/−?-?1\s?D/.test(teloDny.replace(/−/g, '-')) || /1D/.test(teloDny), 'krokovací tlačítka se přepnula na dny (±1D)');
  await klikText('Měsíce');
  const teloMesice = await page.evaluate(() => document.body.innerText);
  expect(/Q[1-4]\s+\d{4}/.test(teloMesice), 'měsíční škála ukazuje kvartální pruh (Q…)');
  await klikText('Týdny');

  console.log('== navigace: −1T a zpět Dnes (bez pádu, plátno žije) ==');
  await klikText('-1T');
  await klikText('Dnes');
  const teloPo = await page.evaluate(() => document.body.innerText);
  expect(/\d+\. týden/.test(teloPo), 'po návratu Dnes je týdenní hlavička dál vykreslená');

  console.log('== volba pohledu se pamatuje (kb-tasks-view) ==');
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1500);
  const aktivni = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true' || t.dataset.state === 'active');
    return el ? (el.textContent || '').trim() : '';
  });
  expect(aktivni === 'Časová osa', `po reloadu je aktivní pohled „${aktivni}" (čeká se Časová osa)`);

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-CASOVA-OSA' });
