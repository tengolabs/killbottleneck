// Z POZVÁNKY DO KALENDÁŘE (Richard 22. 10. 2026): fotka rozpisu přednášek, e-mail s pozvánkou na
// semináře, tréninky dětí → víc událostí NAJEDNOU (create_events / POST /events/batch) + místo konání.
//
// Co se hlídá: pole place (uložení, strop 200, výpis, v1, hint „location“ → place); dávka = vše, nebo nic
// (vadná položka č. 2 → 400 s číslem položky a NIC se nezapíše); strop 30; společné `series`; duplicity
// (stejný název+den+čas, i podruhé poslaná pozvánka) se přeskočí a hlásí; pozvaný dostane JEDNU notifikaci
// za celou dávku; nepřítomnost v dávce ne; zdroj: překryv s rezervací i uvnitř dávky = 400 a nic;
// smazání celé série jen tomu, kdo smí měnit (účastník 404); připomínka nese místo; v1 neznámé pole v položce.
//
// Mutační důkaz: na image z main (bez /events/batch a bez pole place) padá už první kontrola.
const H = require('./_harness');
const { expect } = H;

const den = (posun) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + posun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'z-pozvanky', env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0, KB_TEST_CLOCK: 1 } });
  const ST = await inst.superuser();
  for (const e of ['a@e2e.cz', 'b@e2e.cz', 'c@e2e.cz']) await inst.register(e);
  const A = await inst.login('a@e2e.cz'); // první = admin
  const B = await inst.login('b@e2e.cz');
  const C = await inst.login('c@e2e.cz');
  const notif = async (token, filtr) => (await inst.api('GET', `/api/collections/notifications/records?perPage=100&filter=${encodeURIComponent(filtr || 'id != ""')}`, { token })).json.items || [];
  const udalosti = async (token) => ((await inst.api('GET', '/api/kb/events', { token })).json.events || []);

  console.log('== místo konání (place) ==');
  let r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Zubař', day: den(2), time: '09:00', place: 'Vinohradská 12' } });
  expect(r.status === 200 && r.json.event && r.json.event.place === 'Vinohradská 12', `událost s místem (${r.status} ${r.json.event && r.json.event.place})`);
  const ZUBAR = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { id: ZUBAR, place: '' } });
  expect(r.status === 200 && r.json.event.place === '', 'místo jde smazat');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Dlouhé', day: den(2), place: 'x'.repeat(201) } });
  expect(r.status === 400 && /místo|place/i.test(r.json.error), `místo nad 200 znaků = 400 (${r.status})`);

  console.log('== dávka: tréninky dětí, 3 termíny, místo, pozvaná B ==');
  const items = [
    { title: 'Fotbal – Tomáš', day: den(3), time: '16:00', end_time: '17:30', place: 'Hřiště Strahov' },
    { title: 'Fotbal – Tomáš', day: den(10), time: '16:00', end_time: '17:30', place: 'Hřiště Strahov' },
    { title: 'Fotbal – Tomáš', day: den(17), time: '16:00', end_time: '17:30', place: 'Hřiště Strahov', note: 'přinést chrániče' },
  ];
  const predB = (await notif(B, 'type = "event_invited"')).length;
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items, participants: ['b@e2e.cz'], remind_before_min: 60 } });
  expect(r.status === 200 && (r.json.events || []).length === 3, `dávka 3 událostí (${r.status} ${JSON.stringify(r.json).slice(0, 200)})`);
  const serie = r.json.series;
  expect(!!serie && r.json.events.every((e) => e.series === serie), `všechny nesou stejnou sérii (${serie})`);
  expect(r.json.events.every((e) => e.place === 'Hřiště Strahov' && e.remind === true && e.remind_before_min === 60 && e.end_time === '17:30'), 'místo, konec a připomínka u každé');
  expect(r.json.events[2].note === 'přinést chrániče', 'poznámka u položky');
  const pozvani = (await notif(B, 'type = "event_invited"')).length - predB;
  expect(pozvani === 1, `pozvaná B dostala JEDNU notifikaci za dávku (${pozvani})`);
  expect((await notif(B, 'type = "event_invited"')).some((n) => /3×/.test(n.text) && /Fotbal/.test(n.text)), 'text notifikace říká počet a název');
  expect((await udalosti(B)).filter((e) => e.series === serie).length === 3, 'B vidí všechny 3');

  console.log('== pozvánka poslaná podruhé: duplicity se přeskočí ==');
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: items.concat([{ title: 'fotbal – tomáš', day: den(24), time: '16:00' }]) } });
  expect(r.status === 200 && r.json.events.length === 1 && (r.json.skipped || []).length === 3, `3 už v kalendáři, 1 nová (${r.status} ${r.json.events && r.json.events.length}/${(r.json.skipped || []).length})`);
  expect(r.json.series === '', 'jedna nová událost = bez série');
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: [{ title: 'Seminář', day: den(5), time: '10:00' }, { title: 'Seminář', day: den(5), time: '10:00' }] } });
  expect(r.status === 200 && r.json.events.length === 1 && r.json.skipped.length === 1, 'stejná položka 2× v jedné dávce = 1 založená');

  console.log('== vše, nebo nic ==');
  const pocetPred = (await udalosti(A)).length;
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: [{ title: 'Přednáška 1', day: den(6), time: '09:00' }, { title: 'Přednáška 2', day: '2026-13-45', time: '09:00' }] } });
  expect(r.status === 400 && /č\. 2|#2/.test(r.json.error) && /Přednáška 2/.test(r.json.error), `vadná položka č. 2 = 400 s číslem a názvem (${r.status} ${r.json.error})`);
  expect((await udalosti(A)).length === pocetPred, 'nezapsala se ani první položka');
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: [] } });
  expect(r.status === 400, 'prázdná dávka = 400');
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: Array.from({ length: 31 }, (_, i) => ({ title: 'X', day: den(30 + i) })) } });
  expect(r.status === 400 && /30/.test(r.json.error), `31 položek = 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { items: [{ title: 'Y', day: den(8) }], participants: ['nikdo@e2e.cz'] } });
  expect(r.status === 400, 'neznámý pozvaný = 400');
  expect((await udalosti(A)).length === pocetPred, 'pořád nic navíc');

  console.log('== sdílené kalendáře: nepřítomnost ne, zdroj hlídá překryv i uvnitř dávky ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Dovolené', kind: 'absence' } });
  expect(r.status === 200, 'kalendář nepřítomností');
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { calendar: 'Dovolené', items: [{ title: 'Volno', day: den(9) }, { title: 'Volno', day: den(11) }] } });
  expect(r.status === 400 && /nepřítomnost|time off/i.test(r.json.error), `nepřítomnost v dávce = 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Učebna', kind: 'resource' } });
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Doučování', day: den(4), time: '10:00', end_time: '11:00', calendar: 'Učebna' } });
  expect(r.status === 200, 'C rezervovala učebnu');
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { calendar: 'Učebna', items: [{ title: 'Kurz', day: den(4), time: '08:00' }, { title: 'Kurz', day: den(4), time: '10:30' }] } });
  expect(r.status === 400 && /obsazen|booked/i.test(r.json.error) && /č\. 2|#2/.test(r.json.error), `překryv s rezervací = 400 u položky č. 2 (${r.json.error})`);
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { calendar: 'Učebna', items: [{ title: 'Kurz A', day: den(14), time: '08:00', end_time: '10:00' }, { title: 'Kurz B', day: den(14), time: '09:00' }] } });
  expect(r.status === 400 && /Kurz A/.test(r.json.error), `překryv dvou položek téže dávky = 400 (${r.json.error})`);
  expect(!(await udalosti(A)).some((e) => /^Kurz/.test(e.title)), 'žádný kurz se nezapsal');
  // rozpis poslaný podruhé do zdroje = přeskočit, ne „obsazeno“ (/checkup 2. 11.)
  const ucebna = [{ title: 'Seminář DPH', day: den(15), time: '08:00', end_time: '09:00' }, { title: 'Seminář DPH', day: den(16), time: '08:00', end_time: '09:00' }];
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { calendar: 'Učebna', items: ucebna } });
  expect(r.status === 200 && r.json.events.length === 2, `série do učebny (${r.status} ${r.json.error || ''})`);
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { calendar: 'Učebna', items: ucebna } });
  expect(r.status === 200 && r.json.events.length === 0 && (r.json.skipped || []).length === 2, `tatáž série do učebny podruhé = vše přeskočeno, ne kolize (${r.status} ${r.json.error || (r.json.skipped || []).length})`);
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { calendar: 'Učebna', items: [ucebna[0], ucebna[0]] } });
  expect(r.status === 200 && r.json.events.length === 0 && r.json.skipped.length === 2, 'stejná položka 2× do zdroje = duplicita, ne kolize');
  // duplicita jen v TÉMŽE kalendáři: osobní „Seminář“ nepřeskočí zápis do sdíleného kalendáře
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Firma', kind: 'shared' } });
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { calendar: 'Firma', items: [{ title: 'Seminář', day: den(5), time: '10:00' }] } });
  expect(r.status === 200 && r.json.events.length === 1, `stejný název/den/čas v jiném kalendáři se založí (${r.status} ${(r.json.skipped || []).length})`);

  console.log('== pořadí: položky v libovolném pořadí → chronologicky, notifikace „od“ nejdřívějšího ==');
  const predB2 = (await notif(B, 'type = "event_invited"')).length;
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { participants: ['b@e2e.cz'], items: [
    { title: 'Kroužek', day: den(19), time: '17:00' }, { title: 'Kroužek', day: den(5), time: '17:00' }, { title: 'Kroužek', day: den(12), time: '17:00' }] } });
  expect(r.status === 200 && r.json.events.map((e) => e.day).join() === [den(5), den(12), den(19)].join(), `odpověď seřazená (${(r.json.events || []).map((e) => e.day)})`);
  const nKr = (await notif(B, 'type = "event_invited"')).slice(predB2).concat((await notif(B, 'type = "event_invited"'))).find((n) => /Kroužek/.test(n.text));
  const [, mm, dd] = den(5).split('-').map(Number);
  expect(!!nKr && (nKr.text.includes(den(5)) || nKr.text.includes(`${dd}. ${mm}.`) || nKr.text.includes(`${dd}.${mm}.`)), `notifikace „od“ nejdřívějšího termínu (${nKr && nKr.text})`);

  console.log('== vše, nebo nic i při chybě AŽ V ZÁPISU (transakce) ==');
  // strop událostí na uživatele se hlídá až v saveEvent uvnitř transakce: D má strop−2 → dávka 3 = 3. položka selže,
  // první dvě se NESMÍ zapsat (bez transakce by zůstaly)
  await inst.register('d@e2e.cz');
  const D = await inst.login('d@e2e.cz');
  const dId = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'd@e2e.cz', password: H.PW } })).json.record.id;
  const STROP = 2000; // MAX_EVENTS_PER_USER
  let napln = 0;
  for (let i = 0; i < STROP - 2; i += 40) {
    const davka = await Promise.all(Array.from({ length: Math.min(40, STROP - 2 - i) }, () =>
      inst.api('POST', '/api/collections/events/records', { token: ST, body: { owner: dId, title: 'plnivo', day: den(40) } })));
    napln += davka.filter((x) => x.status === 200).length;
  }
  expect(napln === STROP - 2, `D má ${napln} událostí (strop − 2)`);
  r = await inst.api('POST', '/api/kb/events/batch', { token: D, body: { items: [{ title: 'T1', day: den(41) }, { title: 'T2', day: den(42) }, { title: 'T3', day: den(43) }] } });
  expect(r.status === 400 && /č\. 3|#3/.test(r.json.error), `3. položka narazila na strop → 400 s číslem položky (${r.status} ${r.json.error})`);
  expect(!(await udalosti(D)).some((e) => /^T[123]$/.test(e.title)), 'T1 ani T2 se nezapsaly — transakce vrátila vše');

  console.log('== smazání celé série ==');
  r = await inst.api('POST', '/api/kb/events/delete-series', { token: B, body: { series: serie } });
  expect(r.status === 404, `pozvaná B sérii nesmaže (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete-series', { token: C, body: { series: serie } });
  expect(r.status === 404, `cizí C sérii nesmaže (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete-series', { token: A, body: { series: serie } });
  expect(r.status === 200 && r.json.events_deleted === 3, `autorka smazala sérii (${r.status} ${r.json.events_deleted})`);
  expect(!(await udalosti(B)).some((e) => e.series === serie), 'B už ze série nic nevidí');
  expect((await udalosti(A)).some((e) => e.day === den(24) && /fotbal/i.test(e.title)), 'událost mimo sérii zůstala');

  console.log('== připomínka nese místo ==');
  const ZA20 = den(20);
  r = await inst.api('POST', '/api/kb/events/batch', { token: A, body: { remind_before_min: 30, items: [{ title: 'Přednáška: Fyzika I', day: ZA20, time: '10:00', place: 'Posluchárna T1' }, { title: 'Přednáška: Fyzika I', day: den(27), time: '10:00', place: 'Posluchárna T1' }] } });
  expect(r.status === 200 && r.json.events.length === 2, 'série přednášek');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA20 + ' 09:30' } });
  expect(r.status === 200 && r.json.sent >= 1, `připomínka odešla (${r.json.sent})`);
  const pr = (await notif(A, 'type = "reminder"')).find((n) => /Fyzika/.test(n.text));
  expect(!!pr && /Posluchárna T1/.test(pr.text), `text připomínky obsahuje místo (${pr && pr.text})`);

  console.log('== v1 API: dávka, neznámé pole, hint location → place ==');
  const keyA = (await inst.api('POST', '/api/kb/api-keys', { token: A, body: { label: 'v1', scope: 'read_write' } })).json.token;
  const v1 = (method, path, body) => inst.api(method, '/api/kb' + path, { bearer: keyA, body });
  r = await v1('POST', '/v1/events/batch', { items: [{ title: 'Golf', day: den(12), time: '15:00', location: 'Golf Hostivař' }] });
  expect(r.status === 400 && /place/.test(r.json.error), `neznámé pole location v položce = 400 s nápovědou place (${r.json.error})`);
  r = await v1('POST', '/v1/events/batch', { items: [{ title: 'Golf', day: den(12), time: '15:00' }], priority: 'high' });
  expect(r.status === 400, 'neznámé pole dávky = 400');
  r = await v1('POST', '/v1/events/batch', { items: [{ title: 'Golf', day: den(12), time: '15:00', place: 'Golf Hostivař' }, { title: 'Golf', day: den(19), time: '15:00', place: 'Golf Hostivař' }] });
  expect(r.status === 200 && r.json.events.length === 2 && r.json.events[0].place === 'Golf Hostivař', `v1 dávka (${r.status})`);
  const golf = r.json.series;
  r = await v1('POST', '/v1/events', { title: 'Golf navíc', day: den(26), place: 'Hostivař' });
  expect(r.status === 200 && r.json.event.place === 'Hostivař', 'v1 jednotlivá událost s place');
  r = await v1('GET', `/v1/events?from=${den(12)}&to=${den(12)}`);
  expect(r.status === 200 && (r.json.events || []).some((e) => e.place === 'Golf Hostivař'), 'výpis v1 nese place');
  r = await v1('POST', `/v1/events/series/${golf}/delete`, {});
  expect(r.status === 200 && r.json.events_deleted === 2, `v1 smazání série (${r.status})`);

  console.log('== export nese místo ==');
  r = await inst.api('GET', '/api/kb/export', { token: A });
  expect(r.status === 200, `export (${r.status})`);
  const exp = (r.json.events || []).filter((e) => /Fyzika/.test(e.title));
  expect(exp.length === 2 && exp.every((e) => e.place === 'Posluchárna T1' && !!e.series), 'export obsahuje place i series');

  console.log('== import vrátí i sérii (jinak by zmizelo „Smazat celou sérii“) ==');
  r = await inst.api('POST', '/api/kb/events/delete-series', { token: A, body: { series: exp[0].series } });
  expect(r.status === 200 && r.json.events_deleted === 2, 'série smazána před importem');
  r = await inst.api('POST', '/api/kb/import-all', { token: A, body: { format: 'killbottleneck.export/1', events: exp } });
  expect(r.status === 200 && r.json.events_imported === 2, `import 2 událostí (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
  const imp = (await udalosti(A)).filter((e) => /Fyzika/.test(e.title));
  expect(imp.length === 2 && imp.every((e) => e.series === exp[0].series && e.place === 'Posluchárna T1'), `po importu tatáž série a místo (${imp.map((e) => e.series)})`);
  r = await inst.api('POST', '/api/kb/events/delete-series', { token: A, body: { series: exp[0].series } });
  expect(r.status === 200 && r.json.events_deleted === 2, 'importovanou sérii jde smazat najednou');

  inst.stop();
}, { nazev: 'Z POZVÁNKY' });
