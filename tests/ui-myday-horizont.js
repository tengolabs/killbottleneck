// UI + API e2e: chip v panelu Můj den (Home) a filtr „Termín“ na stránce Úkoly dávají
// TUTÉŽ množinu — horizont položky z PLÁNU i termínu (server helpers.js:horizonOf ↔
// klient lib/kalendar.js:horizontDnu, parita v tests/horizont-parity.js).
//
// Fixtura (superuser zakládá úkoly, jako ui-myday.js): T1 termín +10 dní, PLÁN DNES
// → server sekce „Dnes“; T2 termín DNES, plán ZÍTRA → server „Zítra“ (plán rozhoduje);
// T3 termín +3, bez plánu → server „Do týdne“.
//
// MUTAČNÍ DŮKAZ (analýza kódu 3, F3-03): na image v0.98-beta (kb-analyza-3) sada ČERVENÁ —
// chip „Dnes“ počítá 1 (server z plánu), ale klik vedl na /tasks s filtrem jen podle
// TERMÍNU: T1 (termín +10) v seznamu chyběl a T2 (termín dnes) tam byl navíc.
const H = require('./_harness');
const { expect, sleep } = H;

const UCET = 'den@e2e.cz';
const den = (posun) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + posun);
  return d.toLocaleDateString('en-CA'); // MÍSTNÍ den, stejně jako prohlížeč (lib/taskActions.todayKey)
};
const T1 = 'PLAN-DNES-XYZ', T2 = 'TERMIN-DNES-PLAN-ZITRA-XYZ', T3 = 'DO-TYDNE-XYZ';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'myday-horizont', env: { KB_UVODNI_MAPA: 0 } });
  const reg = await inst.register(UCET);
  expect(reg.status === 200, `účet založen (${reg.status})`);
  const T = await inst.login(UCET);
  const uid = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: UCET, password: H.PW } })).json.record.id;

  // úkol vždy patří do projektu a leží na uzlu → neutrální krok bez termínu (nehne čísly sekcí)
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
    title: 'Testovací projekt',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Testovací projekt', title: 'Testovací projekt', status: 'todo' } },
      { id: 'krok', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo' } },
    ],
    edges: [{ id: 'e1', source: 'apex', target: 'krok' }],
  } })).json;
  expect(!!mapa.id, 'projekt založen');
  const ST = await inst.superuser();
  const ukol = async (body) => (await inst.api('POST', '/api/collections/tasks/records', { token: ST, body: {
    status: 'todo', map: mapa.id, node_id: 'krok', owner: uid, owner_email: UCET, assignee_email: UCET, ...body,
  } })).json;
  const t1 = await ukol({ title: T1, deadline: den(10), planned_on: den(0) });
  const t2 = await ukol({ title: T2, deadline: den(0), planned_on: den(1) });
  const t3 = await ukol({ title: T3, deadline: den(3) });
  expect(!!t1.id && !!t2.id && !!t3.id, 'tři úkoly založeny (plán dnes / plán zítra / do týdne)');

  console.log('== server: sekce a počty chipů (horizonOf: plán rozhoduje do týdne) ==');
  const pulnoc = new Date(); pulnoc.setHours(0, 0, 0, 0);
  const mujDen = (await inst.api('GET', `/api/kb/my-day?today=${den(0)}&since=${encodeURIComponent(pulnoc.toISOString())}`, { token: T })).json;
  const c = (mujDen && mujDen.counts) || {};
  expect(c.today === 1 && c.week === 1 && c.overdue === 0, `counts: dnes ${c.today}, do týdne ${c.week}, po termínu ${c.overdue} (čeká se 1 / 1 / 0)`);
  const nazvy = (s) => ((mujDen && mujDen.sections && mujDen.sections[s]) || []).map((it) => it.title);
  expect(nazvy('today').includes(T1) && !nazvy('today').includes(T2), `sekce Dnes = [${nazvy('today')}] (T1 ano, T2 ne)`);

  const { page, chyby } = await H.browser();
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', UCET);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1200);

  // chip v panelu Můj den: tlačítko „<popisek>\n<číslo>“
  const chip = async (popisek) => {
    for (const h of await page.$$('button')) {
      const tx = await page.evaluate((el) => (el.innerText || '').trim(), h);
      const m = tx.match(/^(.+?)\s*\n\s*(\d+)/);
      if (m && m[1].trim() === popisek) return { h, hodnota: Number(m[2]) };
    }
    return null;
  };
  // řádky tabulky Úkolů s daným názvem (panel Můj den na /tasks je sbalený a není tabulka)
  const radky = (nazev) => page.evaluate((n) => [...document.querySelectorAll('table tr')].filter((tr) => (tr.innerText || '').includes(n)).length, nazev);
  const filtrTerminu = async () => (await page.$$eval('button[role="combobox"]', (els) => els.map((e) => e.innerText.trim())));

  console.log('== Home: chip „Dnes“ = 1 → klik → Úkoly ukážou PRÁVĚ ten úkol (termín +10, plán dnes) ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const dnes = await chip('Dnes');
  expect(!!dnes && dnes.hodnota === 1, `chip Dnes ukazuje ${dnes && dnes.hodnota} (čeká se 1)`);
  if (dnes) await dnes.h.click();
  await H.waitFor(() => page.url().includes('/tasks'), { timeout: 8000, popis: '/tasks' }).catch(() => {});
  await sleep(1500);
  expect((await filtrTerminu()).some((t) => t === 'Dnes'), `filtr Termín = Dnes (${JSON.stringify(await filtrTerminu())})`);
  expect(await radky(T1) === 1, `${T1} (termín +10, PLÁN DNES) je v seznamu 1× — chip 1 = seznam 1`);
  expect(await radky(T2) === 0, `${T2} (termín dnes, plán ZÍTRA) v seznamu NENÍ — server ho má v „Zítra“`);
  expect(await radky(T3) === 0, `${T3} (termín +3) v seznamu Dnes není`);

  console.log('== Home: chip „Do týdne“ = 1 → jen úkol s horizontem 2…7 dní ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const tyden = await chip('Do týdne');
  expect(!!tyden && tyden.hodnota === 1, `chip Do týdne ukazuje ${tyden && tyden.hodnota} (čeká se 1)`);
  if (tyden) await tyden.h.click();
  await H.waitFor(() => page.url().includes('/tasks'), { timeout: 8000, popis: '/tasks' }).catch(() => {});
  await sleep(1500);
  expect(await radky(T3) === 1 && await radky(T1) === 0 && await radky(T2) === 0, `Do týdne: jen ${T3} (T1 je „Dnes“, T2 je „Zítra“)`);

  console.log('== Home: chip „Po termínu“ = 0 → prázdný seznam (propadlý termín s plánem zítra není „po termínu“) ==');
  await page.goto(`${inst.base}/`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  const po = await chip('Po termínu');
  expect(!!po && po.hodnota === 0, `chip Po termínu ukazuje ${po && po.hodnota} (čeká se 0)`);
  if (po) await po.h.click();
  await H.waitFor(() => page.url().includes('/tasks'), { timeout: 8000, popis: '/tasks' }).catch(() => {});
  await sleep(1500);
  expect(await radky(T1) === 0 && await radky(T2) === 0 && await radky(T3) === 0, 'Po termínu: žádný z úkolů (chip 0 = seznam 0)');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-MYDAY-HORIZONT' });
