// UI e2e (headless Chrome): two small "it says something untrue" faults from code analysis 4.
//
//  F3-11  Event dialog: after the confirming click on "Smazat" the button stayed live until the server
//         answered. One more quick click sent /events/delete again; the first deleted the event, the second
//         got 404 and showed a red "saving failed" after a successful delete.
//  F4-09  Lite quick add into a project that was deleted (or unshared) meanwhile showed the internal code
//         "mapNotFound" instead of a sentence.
//
// Real clicks; the delete request is held back for 1.5 s to stand in for a slow connection.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-chyby4-drobnosti', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby);
  const { page } = S;
  const den = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

  console.log('== F3-11: třetí rychlý klik na Smazat neodešle druhý požadavek ==');
  const ev = await inst.api('POST', '/api/kb/events/save', { token: S.token, body: { title: 'Zubař', day: den, time: '10:00' } });
  const evId = (ev.json && (ev.json.id || (ev.json.event || {}).id)) || '';
  expect(ev.status === 200 && !!evId, `událost založena (${ev.status})`);
  let mazani = 0;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/kb/events/delete')) { mazani++; setTimeout(() => req.continue().catch(() => {}), 1500); return; }
    req.continue().catch(() => {});
  });
  await page.goto(`${inst.base}/tasks?view=calendar&udalost=${evId}`, { waitUntil: 'networkidle2' });
  expect(await E.cekej(async () => !!(await page.$('[data-testid="udalost-smazat"]')), 15000, 'dialog události'), 'otevřel se detail události');
  await page.click('[data-testid="udalost-smazat"]'); await sleep(300);   // 1st = "really?"
  await page.click('[data-testid="udalost-smazat"]'); await sleep(250);   // 2nd = delete
  await page.click('[data-testid="udalost-smazat"]').catch(() => {});     // 3rd = the impatient one
  await sleep(300);
  await page.click('[data-testid="udalost-smazat"]').catch(() => {});
  expect(await E.cekej(async () => !(await page.$('[data-testid="kal-dialog-udalost"]')), 8000, 'dialog zavřený'), 'po smazání se dialog zavřel');
  await sleep(2500);
  expect(mazani === 1, `na server odešel právě jeden požadavek na smazání (${mazani})`);
  const text = await page.evaluate(() => document.body.innerText);
  expect(!/selhalo/i.test(text), 'žádná červená hláška o selhání po úspěšném smazání');
  expect(/Zubař/.test(text) && /smazán/i.test(text), 'potvrzení o smazání se ukázalo');
  const zbyle = ((await inst.api('GET', '/api/kb/events', { token: S.token })).json.events || []).filter((x) => x.id === evId);
  expect(zbyle.length === 0, 'událost je smazaná');
  await page.setRequestInterception(false);

  console.log('== F4-09: lite — projekt mezitím zmizel → věta, ne vnitřní kód ==');
  const m = await E.zalozMapu(inst, S.token, 'Projekt na smazání');
  await page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  const fab = await page.$('button[aria-label="Nový úkol"]');
  expect(!!fab, 'plovoucí tlačítko Nový úkol');
  if (fab) await fab.click();
  expect(await E.cekej(async () => !!(await page.$(`form select option[value="${m.id}"]`)), 10000, 'projekt v nabídce'), 'formulář nabízí projekt');
  await page.type('form input:not([type="date"])', 'Úkol do zmizelého projektu');
  await page.select('form select', m.id);
  const del = await inst.api('DELETE', `/api/collections/goalmaps/records/${m.id}`, { token: S.token });
  expect(del.status === 204, `projekt mezitím smazán jinde (${del.status})`);
  await page.click('form button[type="submit"]');
  expect(await E.cekej(async () => !!(await page.$('form p.text-destructive')), 8000, 'hláška'), 'formulář ukázal hlášku');
  const hlaska = await page.$eval('form p.text-destructive', (el) => el.innerText).catch(() => '');
  expect(hlaska === 'Mapa nenalezena', `hláška je věta („${hlaska}“)`);
  expect(!/mapNotFound|mapConflict/.test(hlaska), 'žádný vnitřní kód');

  expect(chyby.filter((c) => !/404|Failed to load resource/.test(c)).length === 0, `konzole bez chyb (${chyby.length}: ${chyby.slice(0, 2).join(' | ').slice(0, 200)})`);
}, { nazev: 'UI-CHYBY4-DROBNOSTI' });
