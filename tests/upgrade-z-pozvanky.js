// Upgrade: data z vydání BEZ místa a sérií událostí (KB_STARY_IMAGE, např. kb-app:20261029 = v0.94-beta) → nový image
// nad TÝMŽ volume (/checkup 2. 11. 2026). Migrace 1792621271_udalosti_misto_serie má STARŠÍ razítko než už nasazené
// 1792928875_kind_process a 1793096888_clients_mena — PocketBase ji musí doběhnout i tak.
//  • start bez chyb migrací; stávající události (osobní, s pozvaným, ve sdíleném kalendáři) beze změny, place a series prázdné
//  • po upgradu jde místo doplnit, dávka založí sérii a série jde smazat; stará událost zůstane
// Bez KB_STARY_IMAGE se sada přeskočí (v plné regresi) — spouštět cíleně:
//   KB_STARY_IMAGE=kb-app:20261029 KB_TEST_IMAGE=<nový> node product/tests/upgrade-z-pozvanky.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

const den = (posun) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + posun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

H.beh(async () => {
  if (!STARY) {
    expect(true, 'upgrade test PŘESKOČEN — KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, TZ: 'Europe/Prague' };
  const VOL = 'kb-upg-z-pozvanky-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  console.log(`== stará verze (${STARY}): osobní událost, s pozvaným, ve sdíleném kalendáři ==`);
  const stara = await H.startInstance({ slug: 'upg-pozv-stara', image: STARY, volume: VOL, env });
  const staraVerze = (await stara.api('GET', '/api/kb/config')).json.version;
  await stara.register('a@example.com', { name: 'Anna' });
  await stara.register('b@example.com', { name: 'Bára' });
  let A = await stara.login('a@example.com');
  let r = await stara.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Zubař', day: den(3), time: '09:00', remind_before_min: 30 } });
  const zubar = r.json.event;
  expect(r.status === 200 && zubar && zubar.place === undefined && zubar.series === undefined, `stará verze ${staraVerze} pole place/series nezná (jinak test neměří upgrade)`);
  r = await stara.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Porada', day: den(4), time: '10:00', end_time: '11:00', participants: ['b@example.com'] } });
  const porada = r.json.event;
  await stara.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Firma', kind: 'shared' } });
  r = await stara.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Večírek', day: den(5), time: '18:00', calendar: 'Firma' } });
  const vecirek = r.json.event;
  expect(!!zubar && !!porada && !!vecirek, 'tři události ve staré verzi');
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== nová verze nad týmž volume ==');
  const nova = await H.startInstance({ slug: 'upg-pozv-nova', volume: VOL, env });
  const logy = nova.logs(160);
  expect(!/(migrat\w*[^\n]*(error|fail)|panic|TypeError|ReferenceError|no such column)/i.test(logy), `start bez chyb migrací (${(logy.match(/[^\n]*(error|panic|no such)[^\n]*/i) || [''])[0].slice(0, 160)})`);
  A = await nova.login('a@example.com');
  const B = await nova.login('b@example.com');
  const vse = (await nova.api('GET', '/api/kb/events', { token: A })).json.events || [];
  const po = (id) => vse.find((e) => e.id === id);
  expect(vse.length === 3 && [zubar, porada, vecirek].every((e) => po(e.id) && po(e.id).place === '' && po(e.id).series === ''), `3 události přežily, place a series prázdné (${vse.map((e) => `${e.title}:${JSON.stringify(e.place)}/${JSON.stringify(e.series)}`)})`);
  expect(po(zubar.id).time === '09:00' && po(zubar.id).remind_before_min === 30 && po(porada.id).end_time === '11:00' && po(vecirek.id).calendar_name === 'Firma',
    'čas, konec, připomínka i kalendář beze změny');
  expect(((await nova.api('GET', '/api/kb/events', { token: B })).json.events || []).some((e) => e.id === porada.id), 'pozvaná B poradu dál vidí');

  console.log('== po upgradu: místo, dávka, smazání série ==');
  r = await nova.api('POST', '/api/kb/events/save', { token: A, body: { id: zubar.id, place: 'Vinohradská 12' } });
  expect(r.status === 200 && r.json.event.place === 'Vinohradská 12', 'staré události jde doplnit místo');
  r = await nova.api('POST', '/api/kb/events/batch', { token: A, body: { items: [{ title: 'Kurz', day: den(6), time: '17:00', place: 'Sál 1' }, { title: 'Kurz', day: den(13), time: '17:00', place: 'Sál 1' }] } });
  expect(r.status === 200 && r.json.events.length === 2 && !!r.json.series, `dávka po upgradu (${r.status})`);
  r = await nova.api('POST', '/api/kb/events/delete-series', { token: A, body: { series: r.json.series } });
  expect(r.status === 200 && r.json.events_deleted === 2, 'série po upgradu jde smazat');
  expect(((await nova.api('GET', '/api/kb/events', { token: A })).json.events || []).length === 3, 'staré události zůstaly');
  execSync(`docker rm -f ${nova.name}`, { stdio: 'ignore' });
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
}, { nazev: 'UPGRADE Z POZVÁNKY' });
