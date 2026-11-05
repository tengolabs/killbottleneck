// Archivovaný kalendář je jen pro čtení i pro EXISTUJÍCÍ události (S5-09, 3. kolo analýzy, 4. 11. 2026).
//
// Do 4. 11. 2026 archivace skryla události v seznamu i RLS a odmítla NOVOU událost (400), ale
// úprava a smazání podle id procházely (session /events/save a /events/delete, v1 /v1/events/{id}
// i asistent přes v1) — správce měnil a mazal, co nikdo neviděl. Teď: úprava i smazání → 400
// „je archivovaný“ stejně jako založení; běžný člen bez práva dál dostává 403/404 jako dřív;
// po odarchivaci vše zase projde.
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/kalendar-archiv-zapis.js
const H = require('./_harness');
const { expect } = H;

const den = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'kalendar-archiv', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('admin@example.com');   // první = admin
  await inst.register('clen@example.com');
  await inst.register('cizi@example.com');
  const A = await inst.login('admin@example.com');
  const C = await inst.login('clen@example.com');
  const X = await inst.login('cizi@example.com');
  const klicC = (await inst.api('POST', '/api/kb/api-keys', { token: C, body: { label: 'rw', scope: 'read_write' } })).json.token;
  expect(!!klicC, 'člen má v1 klíč read_write');

  let r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Firemní', kind: 'shared' } });
  expect(r.status === 200, `sdílený kalendář založen (${r.status})`);
  const CAL = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Školení', day: den(3), time: '09:00', calendar: CAL } });
  expect(r.status === 200, `člen založil událost ve sdíleném kalendáři (${r.status})`);
  const EV = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Porada', day: den(4), time: '10:00', calendar: CAL } });
  const EV2 = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Audit', day: den(5), calendar: CAL } });
  const EV3 = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: X, body: { id: EV, title: 'Hack' } });
  expect(r.status === 403, `cizí člen událost kolegy ve sdíleném kalendáři nemění ani před archivací (${r.status})`);
  // série (dávka) v témže kalendáři — po archivaci musí „smazat sérii“ říct „archivovaný“, ne „nenalezena“
  r = await inst.api('POST', '/api/kb/events/batch', { token: C, body: { calendar: CAL, items: [6, 7].map((i) => ({ title: 'Kurz', day: den(i), time: '08:00' })) } });
  expect(r.status === 200 && r.json.series, `člen založil sérii dvou událostí (${r.status})`);
  const SERIE = r.json.series;

  console.log('== archivace: úprava a smazání existující události → 400 jako nová ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: CAL, archived: true } });
  expect(r.status === 200 && r.json.calendar.archived === true, 'kalendář archivován');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Nová', day: den(6), calendar: CAL } });
  expect(r.status === 400 && /archiv/i.test(r.json.error), `nová událost do archivovaného → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: EV, title: 'Školení PŘEJMENOVÁNO' } });
  expect(r.status === 400 && /archiv/i.test(String(r.json && r.json.error)), `autor: úprava přes session → 400 „archivovaný“ (${r.status} ${r.json && r.json.error})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: EV, day: den(10) } });
  expect(r.status === 400, `autor: přesun na jiný den přes session → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { id: EV, title: 'Admin mění' } });
  expect(r.status === 400, `správce: úprava přes session → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete', { token: C, body: { id: EV } });
  expect(r.status === 400 && /archiv/i.test(String(r.json && r.json.error)), `autor: smazání přes session → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete', { token: A, body: { id: EV } });
  expect(r.status === 400, `správce: smazání přes session → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/v1/events/' + EV2, { bearer: klicC, body: { title: 'Porada v1' } });
  expect(r.status === 400 && /archiv/i.test(String(r.json && r.json.error)), `v1: úprava → 400 (${r.status} ${r.json && r.json.error})`);
  r = await inst.api('POST', `/api/kb/v1/events/${EV2}/delete`, { bearer: klicC, body: {} });
  expect(r.status === 400, `v1: smazání → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: X, body: { id: EV, title: 'Hack' } });
  expect(r.status === 403 || r.status === 404, `člen bez práva dál dostává 403/404, ne 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete-series', { token: C, body: { series: 'neni' } });
  expect(r.status === 404, `neexistující série 404 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete-series', { token: C, body: { series: SERIE } });
  expect(r.status === 400 && /archiv/i.test(String(r.json && r.json.error)), `smazání série v archivovaném kalendáři → 400 „archivovaný“, ne 404 (${r.status} ${r.json && r.json.error})`);
  const vsechny = (await inst.api('GET', '/api/collections/events/records?perPage=50', { token: await inst.superuser() })).json.items || [];
  expect([EV, EV2, EV3].every((id) => vsechny.some((e) => e.id === id)) && !vsechny.some((e) => e.title === 'Školení PŘEJMENOVÁNO' || e.title === 'Porada v1'), 'v DB zůstaly všechny tři události beze změny');

  console.log('== odarchivace: zase to jde ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: CAL, archived: false } });
  expect(r.status === 200 && r.json.calendar.archived === false, 'kalendář odarchivován');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: EV, title: 'Školení PŘEJMENOVÁNO' } });
  expect(r.status === 200 && r.json.event.title === 'Školení PŘEJMENOVÁNO', `úprava po odarchivaci → 200 (${r.status})`);
  r = await inst.api('POST', '/api/kb/v1/events/' + EV2, { bearer: klicC, body: { title: 'Porada v1' } });
  expect(r.status === 200, `v1 úprava po odarchivaci → 200 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete', { token: A, body: { id: EV3 } });
  expect(r.status === 200, `správce po odarchivaci smaže (${r.status})`);
}, { nazev: 'KALENDÁŘ ARCHIV ZÁPIS' });
