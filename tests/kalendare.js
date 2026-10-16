// SDÍLENÉ KALENDÁŘE (týmový kalendář, 14. 10. 2026): kalendář jako entita —
// firemní (shared), zasedačka (resource), nepřítomnosti (absence).
//
// Co se hlídá: kalendáře zakládá jen admin/manager (člen 403), jméno jednoznačné
// bez ohledu na velikost písmen, druh se po založení nemění, archivace i smazání s událostmi;
// událost ve sdíleném kalendáři vidí KAŽDÝ člen (routa i RLS), mění ji autor +
// správce/manažer (cizí člen 403); write_access=admins; konec události (end_day /
// end_time) a jeho validace; vícedenní událost v okně od–do; přesun dne drží délku;
// nepřítomnost: kdo je pryč (/away), zapsaná za druhého (ten ji smí měnit);
// zdroj: bez času 400, bez konce +60 min, překryv 409 s kolizí a next_free,
// navazující projde, úprava sebe sama nekoliduje; připomínka u sdílené události
// chodí jen autorovi; osobní událost zůstává soukromá i před adminem;
// nová instance (bez KB_UVODNI_MAPA=0) má výchozí Firemní + Nepřítomnosti v jazyce prvního správce.
//
// Mutační důkaz: na image z main (bez /calendars) padá už první kontrola.
const H = require('./_harness');
const { expect } = H;

const den = (posun) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + posun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const minusMin = (day, time, min) => {
  const [y, m, d] = day.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
  const x = new Date(y, m - 1, d, hh, mm); x.setMinutes(x.getMinutes() - min);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'kalendare', env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0, KB_TEST_CLOCK: 1 } });
  const ST = await inst.superuser();
  for (const e of ['a@e2e.cz', 'b@e2e.cz', 'c@e2e.cz', 'd@e2e.cz']) await inst.register(e);
  const A = await inst.login('a@e2e.cz'); // první = admin
  const uid = async (email) => (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent(`email="${email}"`), { token: ST })).json.items[0].id;
  let r = await inst.api('PATCH', `/api/collections/users/records/${await uid('b@e2e.cz')}`, { token: A, body: { role: 'manager' } });
  expect(r.status === 200, 'b je manažer');
  const B = await inst.login('b@e2e.cz');
  const C = await inst.login('c@e2e.cz');
  const D = await inst.login('d@e2e.cz');
  const notif = async (token, filtr) => (await inst.api('GET', `/api/collections/notifications/records?perPage=50&filter=${encodeURIComponent(filtr || 'id != ""')}`, { token })).json.items || [];
  const udalosti = async (token, q) => ((await inst.api('GET', '/api/kb/events' + (q || ''), { token })).json.events || []);

  console.log('== kalendáře zakládá jen správce/manažer ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: C, body: { name: 'Firemní', kind: 'shared' } });
  expect(r.status === 403, `člen zakládá kalendář = 403 (${r.status})`);
  r = await inst.api('POST', '/api/collections/calendars/records', { token: A, body: { name: 'Přímo', kind: 'shared' } });
  expect(r.status === 400 || r.status === 403, `PB CRUD create kalendáře je zamčený (${r.status})`);
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: '', kind: 'shared' } });
  expect(r.status === 400 && /název|name/i.test(r.json.error), 'bez názvu = 400');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'X', kind: 'cokoli' } });
  expect(r.status === 400 && /shared/.test(r.json.error), 'neznámý druh = 400 s výčtem');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Firemní', kind: 'shared', color: '#0ea5e9', description: 'společné akce' } });
  expect(r.status === 200 && r.json.calendar && r.json.calendar.kind === 'shared' && r.json.calendar.can_manage === true, `admin založil Firemní (${r.status})`);
  const FIREMNI = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'firemní', kind: 'absence' } });
  expect(r.status === 400 && /existuje|exists/.test(r.json.error), 'stejný název bez ohledu na velikost písmen = 400');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: B, body: { name: 'Zasedačka', kind: 'resource' } });
  expect(r.status === 200, `manažer založil Zasedačku (${r.status})`);
  const ZASEDACKA = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Nepřítomnosti', kind: 'absence' } });
  expect(r.status === 200 && r.json.calendar.needs_approval === false, 'Nepřítomnosti založeny, schvalování výchozí VYPNUTO');
  const NEPRITOMNOSTI = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: ZASEDACKA, kind: 'shared' } });
  expect(r.status === 400 && /druh|kind/i.test(r.json.error), 'druh se po založení nemění');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: ZASEDACKA, color: 'modrá' } });
  expect(r.status === 400, 'barva mimo #RRGGBB = 400');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: C, body: { id: FIREMNI, name: 'Hack' } });
  expect(r.status === 403, 'člen nemění kalendář');
  const seznamC = (await inst.api('GET', '/api/kb/calendars', { token: C })).json.calendars;
  expect(seznamC.length === 3 && seznamC.every((c) => c.can_manage === false && c.can_write === true), `člen vidí 3 kalendáře, can_manage false, can_write true (${JSON.stringify(seznamC.map((c) => c.name))})`);
  expect(seznamC.map((c) => c.name).join(',') === 'Firemní,Nepřítomnosti,Zasedačka', 'seznam řazený podle názvu');
  expect(((await inst.api('GET', '/api/collections/calendars/records', { token: D })).json.items || []).length === 3, 'kalendáře jdou číst i přes RLS (realtime)');

  console.log('== událost ve sdíleném kalendáři vidí každý, mění autor + správce/manažer ==');
  const ZA3 = den(3);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Vánoční večírek', day: ZA3, time: '18:00', calendar: 'firemni' } });
  expect(r.status === 200 && r.json.event.calendar === FIREMNI && r.json.event.calendar_name === 'Firemní' && r.json.event.kind === 'shared', `člen zapsal do Firemní podle názvu (${r.status} ${r.json && r.json.error})`);
  const VECIREK = r.json.event.id;
  expect(r.json.event.can_edit === true && r.json.event.mine === true, 'autor can_edit');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'X', day: ZA3, calendar: 'Neexistuje' } });
  expect(r.status === 404 && /Neexistuje/.test(r.json.error), 'neznámý kalendář = 404 se jménem');
  const dSeznam = await udalosti(D);
  const dVecirek = dSeznam.find((e) => e.id === VECIREK);
  expect(!!dVecirek && dVecirek.mine === false && dVecirek.can_edit === false, 'd (ne účastník) vidí firemní akci, can_edit false');
  expect(((await inst.api('GET', '/api/collections/events/records', { token: D })).json.items || []).some((e) => e.id === VECIREK), 'd ji vidí i přes RLS');
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { id: VECIREK, title: 'Hack' } });
  expect(r.status === 403, `cizí člen nemění firemní akci (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete', { token: D, body: { id: VECIREK } });
  expect(r.status === 403, 'cizí člen ji nemaže');
  r = await inst.api('POST', '/api/kb/events/save', { token: B, body: { id: VECIREK, title: 'Vánoční večírek 2026' } });
  expect(r.status === 200 && r.json.event.title === 'Vánoční večírek 2026', `manažer firemní akci upraví (${r.status})`);
  const bVecirek = (await udalosti(B)).find((e) => e.id === VECIREK);
  expect(bVecirek.can_edit === true, 'manažer má can_edit u sdílené události');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: VECIREK, calendar: '' } });
  expect(r.status === 200 && r.json.event.calendar === '' && r.json.event.kind === '', 'autor přesune do osobního (calendar = "")');
  expect(!(await udalosti(D)).some((e) => e.id === VECIREK), 'd už osobní událost nevidí');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: VECIREK, calendar: FIREMNI } });
  expect(r.status === 200 && r.json.event.calendar === FIREMNI, 'a zpět do Firemní podle id');

  console.log('== write_access = admins ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: FIREMNI, write_access: 'admins' } });
  expect(r.status === 200 && r.json.calendar.write_access === 'admins', 'Firemní jen pro správce');
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { title: 'Pokus', day: ZA3, calendar: FIREMNI } });
  expect(r.status === 403 && /správce|admin/i.test(r.json.error), 'člen do admins kalendáře nezapíše (403)');
  r = await inst.api('POST', '/api/kb/events/save', { token: B, body: { title: 'Porada vedení', day: ZA3, time: '09:00', calendar: FIREMNI } });
  expect(r.status === 200, 'manažer ano');
  expect((await inst.api('GET', '/api/kb/calendars', { token: D })).json.calendars.find((c) => c.id === FIREMNI).can_write === false, 'can_write false pro člena');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: VECIREK, title: 'Vánoční večírek' } });
  expect(r.status === 200, 'autor svou událost v admins kalendáři dál mění (právo zápisu se týká nových)');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: FIREMNI, write_access: 'all' } });

  console.log('== konec události: validace, normalizace, okno od–do, přesun drží délku ==');
  const ZA5 = den(5), ZA9 = den(9);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Špatně', day: ZA5, end_day: den(4) } });
  expect(r.status === 400 && /před|before/.test(r.json.error), 'end_day před day = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Špatně', day: ZA5, end_time: '11:00' } });
  expect(r.status === 400 && /time/.test(r.json.error), 'end_time bez time = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Špatně', day: ZA5, time: '11:00', end_time: '10:00' } });
  expect(r.status === 400 && /před|before/.test(r.json.error), 'end_time před time = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Špatně', day: ZA5, end_day: '2026-13-45' } });
  expect(r.status === 400 && /datum|date/i.test(r.json.error), 'neplatný end_day = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Stejný den', day: ZA5, end_day: ZA5, time: '10:00', end_time: '11:30' } });
  expect(r.status === 200 && r.json.event.end_day === '' && r.json.event.end_time === '11:30', 'end_day = day se ukládá jako prázdný (týž den)');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Dovolená', day: ZA5, end_day: ZA9, calendar: 'Nepřítomnosti' } });
  expect(r.status === 200 && r.json.event.kind === 'absence' && r.json.event.end_day === ZA9, `vícedenní nepřítomnost (${r.status} ${r.json && r.json.error})`);
  const DOVOLENA = r.json.event.id;
  expect(JSON.stringify(r.json.event.away) === JSON.stringify(['c@e2e.cz']) && r.json.event.status === '', 'away = autor (bez účastníků), status prázdný (bez schvalování)');
  expect((await udalosti(D, `?from=${den(7)}&to=${den(7)}`)).some((e) => e.id === DOVOLENA), 'okno uprostřed vícedenní události ji obsahuje');
  expect(!(await udalosti(D, `?from=${den(10)}&to=${den(20)}`)).some((e) => e.id === DOVOLENA), 'okno po konci ji neobsahuje');
  const jenNepr = await udalosti(D, `?calendar=Nepřítomnosti`);
  expect(jenNepr.length >= 1 && jenNepr.every((e) => e.calendar === NEPRITOMNOSTI), 'filtr ?calendar= jen jeden kalendář');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: DOVOLENA, day: den(6) } });
  expect(r.status === 200 && r.json.event.end_day === den(10), `přesun dne bez end_day posune i konec (délka drží: ${r.json.event.end_day})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: DOVOLENA, day: ZA5, end_day: ZA9 } });

  console.log('== kdo je pryč (/away), nepřítomnost zapsaná za druhého ==');
  let away = (await inst.api('GET', '/api/kb/away', { token: D })).json;
  expect(away.from === den(0) && away.to === den(14), `výchozí okno dnes…+14 (${away.from} ${away.to})`);
  expect(away.away.length === 1 && away.away[0].email === 'c@e2e.cz' && away.away[0].from === ZA5 && away.away[0].to === ZA9 && away.away[0].title === 'Dovolená' && away.away[0].calendar === 'Nepřítomnosti', `c je pryč ${ZA5}–${ZA9} (${JSON.stringify(away.away)})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: B, body: { title: 'Lékař', day: den(2), calendar: NEPRITOMNOSTI, participants: ['d@e2e.cz'] } });
  expect(r.status === 200 && JSON.stringify(r.json.event.away) === JSON.stringify(['d@e2e.cz']), `manažer zapsal nepřítomnost za d (${JSON.stringify(r.json.event && r.json.event.away)})`);
  const LEKAR = r.json.event.id;
  expect((await notif(D, 'type = "event_invited"')).some((n) => n.event_id === LEKAR), 'd dostal notifikaci, že je zapsaný');
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { id: LEKAR, note: 'od 8 do 10' } });
  expect(r.status === 200, 'd (ten, koho se týká) svou nepřítomnost upraví');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: LEKAR, note: 'hack' } });
  expect(r.status === 403, 'cizí člen cizí nepřítomnost nemění');
  r = await inst.api('POST', '/api/kb/events/save', { token: B, body: { title: 'Já a d', day: den(3), calendar: NEPRITOMNOSTI, participants: ['b@e2e.cz', 'd@e2e.cz'] } });
  expect(r.status === 200 && r.json.event.away.length === 2 && r.json.event.away.indexOf('b@e2e.cz') >= 0, 'u nepřítomnosti se autor z účastníků NEvyřazuje');
  const JAAD = r.json.event.id;
  away = (await inst.api('GET', '/api/kb/away', { token: C, })).json.away;
  expect(away.filter((x) => x.email === 'd@e2e.cz').length === 2 && away.some((x) => x.email === 'b@e2e.cz'), `away má řádek na člověka a událost (${away.length})`);
  expect(away[0].from <= away[away.length - 1].from, 'řazeno od začátku');
  r = await inst.api('GET', `/api/kb/away?from=${den(5)}&to=${den(5)}`, { token: C });
  expect(r.json.away.length === 1 && r.json.away[0].email === 'c@e2e.cz', 'okno jednoho dne uprostřed dovolené');
  await inst.api('POST', '/api/kb/events/delete', { token: B, body: { id: JAAD } });

  console.log('== zdroj (zasedačka): čas povinný, bez konce +60 min, překryv 409 + next_free ==');
  const ZA4 = den(4);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Schůzka', day: ZA4, calendar: 'zasedacka' } });
  expect(r.status === 400 && /čas|time/i.test(r.json.error), 'rezervace bez času = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Schůzka s klientem', day: ZA4, time: '10:00', calendar: 'zasedacka' } });
  expect(r.status === 200 && r.json.event.end_time === '11:00' && r.json.event.kind === 'resource', `bez konce = +60 min (${r.json.event && r.json.event.end_time})`);
  const SCHUZKA = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { title: 'Pohovor', day: ZA4, time: '10:30', end_time: '11:30', calendar: ZASEDACKA } });
  expect(r.status === 409 && r.json.collision && r.json.collision.id === SCHUZKA && /10:00–11:00/.test(r.json.error), `překryv = 409 s kolizí (${r.status} ${r.json && r.json.error})`);
  expect(r.json.next_free && r.json.next_free.day === ZA4 && r.json.next_free.time === '11:00' && r.json.next_free.end_time === '12:00', `next_free = 11:00–12:00 (${JSON.stringify(r.json.next_free)})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { title: 'Pohovor', day: ZA4, time: '11:00', end_time: '12:00', calendar: ZASEDACKA } });
  expect(r.status === 200, `navazující 11:00–12:00 projde (${r.status})`);
  const POHOVOR = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: SCHUZKA, end_time: '11:30' } });
  expect(r.status === 409 && r.json.collision.id === POHOVOR, 'prodloužení do cizí rezervace = 409');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: SCHUZKA, time: '09:30', end_time: '10:30' } });
  expect(r.status === 200, 'úprava vlastní rezervace nekoliduje sama se sebou');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Ráno', day: ZA4, time: '09:00', end_time: '10:00', calendar: ZASEDACKA } });
  expect(r.status === 409 && r.json.next_free && r.json.next_free.time === '12:00', `next_free přeskočí oba bloky (09:30–10:30, 11:00–12:00) = 12:00 (${JSON.stringify(r.json.next_free)})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Celý den', day: ZA4, time: '08:00', end_day: den(5), end_time: '08:00', calendar: ZASEDACKA } });
  expect(r.status === 409 && r.json.next_free === null, 'vícedenní rezervace přes obsazený den = 409 bez next_free');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Jiný den', day: den(11), time: '10:00', calendar: ZASEDACKA } });
  expect(r.status === 200, 'jiný den volný');

  console.log('== připomínka u sdílené události jen autorovi (ne celé firmě) ==');
  const ZA2 = den(2);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Snídaně týmu', day: ZA2, time: '08:00', calendar: FIREMNI, remind_before_min: 30 } });
  expect(r.status === 200, 'firemní akce s připomínkou');
  const predC = (await notif(C, 'type = "reminder"')).length;
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: minusMin(ZA2, '08:00', 30) } });
  expect(r.status === 200 && r.json.sent === 1, `připomínka odešla jen 1× (autor) (${r.json && r.json.sent})`);
  expect((await notif(C, 'type = "reminder"')).length === predC, 'člen bez pozvání připomínku nedostal');

  console.log('== osobní událost zůstává soukromá i před adminem; archivace kalendáře ==');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Zubař', day: ZA3, time: '15:00' } });
  const ZUBAR = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { id: ZUBAR, title: 'Hack' } });
  expect(r.status === 404, `admin cizí osobní událost nevidí (${r.status})`);
  r = await inst.api('POST', '/api/kb/calendars/save', { token: B, body: { name: 'Auto', kind: 'resource' } });
  const AUTO = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Cesta', day: ZA3, time: '07:00', calendar: AUTO } });
  const CESTA = r.json.event.id;
  r = await inst.api('POST', '/api/kb/calendars/save', { token: B, body: { id: AUTO, archived: true } });
  expect(r.status === 200 && r.json.calendar.archived === true && r.json.calendar.can_write === false, 'kalendář archivován');
  expect(!(await udalosti(C)).some((e) => e.id === CESTA), 'události archivovaného kalendáře se v seznamu neukazují');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Cesta 2', day: ZA3, time: '07:00', calendar: AUTO } });
  expect(r.status === 400 && /archiv/i.test(r.json.error), 'do archivovaného se nezapisuje');
  r = await inst.api('POST', '/api/kb/events/delete', { token: A, body: { id: VECIREK } });
  expect(r.status === 200, 'admin smaže firemní akci kolegy');

  console.log('== smazání kalendáře i s událostmi (správce/manažer); archivace zůstává ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: B, body: { name: 'Omyl', kind: 'shared' } });
  const OMYL = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'V omylu', day: den(60), calendar: OMYL } });
  const VOMYLU = r.json.event.id;
  expect((await inst.api('GET', '/api/kb/calendars', { token: A })).json.calendars.find((c) => c.id === OMYL).events_count === 1, 'DTO kalendáře nese počet událostí');
  r = await inst.api('POST', '/api/kb/calendars/delete', { token: C, body: { id: OMYL } });
  expect(r.status === 403, 'člen kalendář nesmaže (403)');
  r = await inst.api('POST', '/api/kb/calendars/delete', { token: B, body: { id: OMYL } });
  expect(r.status === 200 && r.json.events_deleted === 1, `manažer smazal kalendář i s 1 událostí (${r.status} ${JSON.stringify(r.json)})`);
  expect(!(await inst.api('GET', '/api/kb/calendars', { token: A })).json.calendars.some((c) => c.id === OMYL), 'kalendář je pryč');
  expect((await inst.api('GET', `/api/collections/events/records/${VOMYLU}`, { token: C })).status === 404, 'a jeho událost taky');
  r = await inst.api('POST', '/api/kb/calendars/delete', { token: A, body: { id: 'neexistuje' } });
  expect(r.status === 404, 'neznámé id = 404');

  console.log('== viditelnost jako u projektů: kalendář jen pro vybrané členy ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Vedení', kind: 'shared', visibility: 'members', members: ['b@e2e.cz'] } });
  expect(r.status === 200 && r.json.calendar.visibility === 'members' && JSON.stringify(r.json.calendar.members) === JSON.stringify(['b@e2e.cz']), `kalendář Vedení jen pro b (${JSON.stringify(r.json.calendar && r.json.calendar.members)})`);
  const VEDENI = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'X', kind: 'shared', visibility: 'tajne' } });
  expect(r.status === 400, 'neznámá viditelnost = 400');
  expect(!(await inst.api('GET', '/api/kb/calendars', { token: C })).json.calendars.some((c) => c.id === VEDENI), 'člen C kalendář Vedení v seznamu nemá');
  expect(!((await inst.api('GET', '/api/collections/calendars/records', { token: C })).json.items || []).some((c) => c.id === VEDENI), 'ani přes RLS');
  expect((await inst.api('GET', '/api/kb/calendars', { token: B })).json.calendars.some((c) => c.id === VEDENI), 'vybraný člen b ho vidí');
  expect((await inst.api('GET', '/api/kb/calendars', { token: A })).json.calendars.some((c) => c.id === VEDENI), 'správce-zakladatel ho vidí');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Porada vedení', day: den(40), time: '09:00', calendar: 'Vedení' } });
  expect(r.status === 200, 'správce zapsal poradu vedení');
  const PORADA = r.json.event.id;
  expect(!(await udalosti(C, `?from=${den(40)}&to=${den(40)}`)).some((e) => e.id === PORADA), 'C poradu vedení v /events nevidí');
  expect(!((await inst.api('GET', '/api/collections/events/records?filter=' + encodeURIComponent(`day="${den(40)}"`), { token: C })).json.items || []).some((e) => e.id === PORADA), 'ani přes RLS (realtime)');
  expect((await udalosti(B, `?from=${den(40)}&to=${den(40)}`)).some((e) => e.id === PORADA), 'b ji vidí');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Hack', day: den(41), calendar: 'Vedení' } });
  expect(r.status === 404, 'C do skrytého kalendáře nezapíše (404, jméno se neprozradí)');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: PORADA, title: 'Hack' } });
  expect(r.status === 404, 'C skrytou událost ani neupraví (404)');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Tajné', kind: 'absence', visibility: 'members', members: [] } });
  const TAJNE = r.json.calendar.id;
  // správce, který není člen ani zakladatel = jako u soukromého projektu NEVIDÍ (Richard 15. 10. „srovnat“)
  r = await inst.api('POST', '/api/kb/calendars/save', { token: B, body: { name: 'Jen manažer', kind: 'shared', visibility: 'members', members: ['c@e2e.cz'] } });
  const JENMAN = r.json.calendar.id;
  expect(r.status === 200 && !(await inst.api('GET', '/api/kb/calendars', { token: A })).json.calendars.some((c) => c.id === JENMAN), 'správce A kalendář manažera „jen pro vybrané“ bez členství NEVIDÍ');
  expect(!((await inst.api('GET', '/api/collections/calendars/records', { token: A })).json.items || []).some((c) => c.id === JENMAN), 'ani přes RLS');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Jen pro C a B', day: den(43), calendar: JENMAN } });
  expect(r.status === 200 && !(await udalosti(A, `?from=${den(43)}&to=${den(43)}`)).some((e) => e.id === r.json.event.id), 'ani jeho události');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: JENMAN, name: 'Hack' } });
  expect(r.status === 404, 'ani ho nemění (404)');
  r = await inst.api('POST', '/api/kb/calendars/delete', { token: A, body: { id: JENMAN } });
  expect(r.status === 404, 'ani nemaže (404)');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: B, body: { id: JENMAN, members: ['c@e2e.cz', 'a@e2e.cz'] } });
  expect(r.status === 200 && (await inst.api('GET', '/api/kb/calendars', { token: A })).json.calendars.some((c) => c.id === JENMAN), 'po přidání mezi členy správce vidí');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: JENMAN, members: ['c@e2e.cz'] } });
  expect(r.status === 200 && r.json.calendar.members.indexOf('a@e2e.cz') >= 0, 'kdo kalendář zužuje a není zakladatel, zůstane v něm sám (neschová si ho)');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: B, body: { id: TAJNE, name: 'Hack' } });
  expect(r.status === 404, 'manažer bez členství skrytý kalendář nemění (404, jako soukromý projekt)');
  r = await inst.api('POST', '/api/kb/calendars/delete', { token: B, body: { id: TAJNE } });
  expect(r.status === 404, 'ani nemaže (404)');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Tajná dovolená', day: den(50), end_day: den(52), calendar: TAJNE, participants: ['a@e2e.cz'] } });
  expect(r.status === 200, 'správce zapsal nepřítomnost do skrytého kalendáře');
  expect((await inst.api('GET', `/api/kb/away?from=${den(50)}&to=${den(52)}`, { token: C })).json.away.length === 0, 'kdo je pryč: skrytý kalendář se členovi nepočítá');
  expect((await inst.api('GET', `/api/kb/away?from=${den(50)}&to=${den(52)}`, { token: A })).json.away.length === 1, 'správci ano');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: VEDENI, members: ['b@e2e.cz', 'd@e2e.cz'] } });
  expect(r.status === 200 && r.json.calendar.members.length === 2, 'správce přidal d mezi vybrané');
  expect((await udalosti(D, `?from=${den(40)}&to=${den(40)}`)).some((e) => e.id === PORADA), 'd poradu vedení hned vidí');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: VEDENI, visibility: 'all' } });
  expect(r.status === 200 && (await udalosti(C, `?from=${den(40)}&to=${den(40)}`)).some((e) => e.id === PORADA), 'přepnutí na celý tým → vidí i C');

  console.log('== schvalování nepřítomností (výchozí vypnuto): zapnout na kalendáři → žádost → správci/manažeři → rozhodnutí ==');
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { title: 'Bez schvalování', day: den(20), calendar: NEPRITOMNOSTI } });
  expect(r.status === 200 && r.json.event.status === '', 'bez schvalování: status prázdný');
  r = await inst.api('POST', '/api/kb/events/decide', { token: A, body: { id: r.json.event.id, decision: 'approved' } });
  expect(r.status === 400 && /schval|approval/i.test(r.json.error), 'rozhodovat jde jen tam, kde se schvaluje (400)');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: NEPRITOMNOSTI, needs_approval: true } });
  expect(r.status === 200 && r.json.calendar.needs_approval === true, 'správce zapnul schvalování');
  const predA = (await notif(A, 'type = "absence_requested"')).length;
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { title: 'Dovolená u moře', day: den(30), end_day: den(34), calendar: NEPRITOMNOSTI } });
  expect(r.status === 200 && r.json.event.status === 'requested', `nová nepřítomnost čeká na schválení (${r.json.event && r.json.event.status})`);
  const ZADOST = r.json.event.id;
  const zA = await notif(A, 'type = "absence_requested"');
  expect(zA.length === predA + 1 && zA[0].event_id === ZADOST && /d@e2e.cz/.test(zA[0].text) && /Dovolená u moře/.test(zA[0].text), `admin dostal žádost s event_id a jménem (${zA[0] && zA[0].text})`);
  expect((await notif(B, 'type = "absence_requested"')).length === 1 && (await notif(C, 'type = "absence_requested"')).length === 0, 'manažer žádost dostal, člen ne');
  r = await inst.api('GET', `/api/kb/away?from=${den(30)}&to=${den(34)}`, { token: C });
  expect(r.json.away.length === 0, 'neschválená nepřítomnost se nepočítá do „kdo je pryč“');
  r = await inst.api('POST', '/api/kb/events/decide', { token: C, body: { id: ZADOST, decision: 'approved' } });
  expect(r.status === 403, 'člen nerozhoduje (403)');
  r = await inst.api('POST', '/api/kb/events/decide', { token: B, body: { id: ZADOST, decision: 'cokoli' } });
  expect(r.status === 400 && /approved/.test(r.json.error), 'neznámé rozhodnutí = 400');
  r = await inst.api('POST', '/api/kb/events/decide', { token: B, body: { id: ZADOST, decision: 'approved', note: 'Přeju hezkou dovolenou' } });
  expect(r.status === 200 && r.json.event.status === 'approved' && r.json.event.decision_note === 'Přeju hezkou dovolenou', `manažer schválil (${r.status} ${r.json && r.json.error})`);
  const rozh = await notif(D, 'type = "absence_decided"');
  expect(rozh.length === 1 && /schválil|approved/i.test(rozh[0].text) && /Přeju hezkou dovolenou/.test(rozh[0].text) && rozh[0].event_id === ZADOST, `žadatel dostal rozhodnutí s poznámkou (${rozh[0] && rozh[0].text})`);
  r = await inst.api('GET', `/api/kb/away?from=${den(30)}&to=${den(34)}`, { token: C });
  expect(r.json.away.length === 1 && r.json.away[0].email === 'd@e2e.cz', 'schválená nepřítomnost je v „kdo je pryč“');
  r = await inst.api('POST', '/api/kb/events/decide', { token: A, body: { id: ZADOST, decision: 'rejected', note: 'Kolize s inventurou' } });
  expect(r.status === 200 && r.json.event.status === 'rejected', 'rozhodnutí jde změnit (zamítnuto)');
  expect((await notif(D, 'type = "absence_decided"')).length === 2, 'žadatel dostal i druhé rozhodnutí');
  expect(!(await udalosti(C, `?from=${den(30)}&to=${den(34)}`)).some((e) => e.id === ZADOST), 'zamítnutou nepřítomnost kolega v kalendáři nevidí');
  expect((await udalosti(D, `?from=${den(30)}&to=${den(34)}`)).some((e) => e.id === ZADOST && e.status === 'rejected'), 'žadatel ji vidí se stavem rejected');
  r = await inst.api('GET', `/api/kb/away?from=${den(30)}&to=${den(34)}`, { token: C });
  expect(r.json.away.length === 0, 'zamítnutá není v „kdo je pryč“');
  expect((await udalosti(A, `?from=${den(30)}&to=${den(34)}`)).some((e) => e.id === ZADOST && e.status === 'rejected' && e.decision_note === 'Kolize s inventurou'), 'správce zamítnutou vidí (může rozhodnutí změnit) i s poznámkou');

  console.log('== panel 15. 10.: schvalování nejde obejít úpravou; poznámka rozhodnutí jen dotyčným; nepřítomnost za kolegu jen správce ==');
  // (a) přesun osobní události do kalendáře se schvalováním = žádost
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { title: 'Soukromě', day: den(36) } });
  const SOUKROME = r.json.event.id;
  const predA2 = (await notif(A, 'type = "absence_requested"')).length;
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { id: SOUKROME, calendar: NEPRITOMNOSTI } });
  expect(r.status === 200 && r.json.event.status === 'requested', `přesun do kalendáře se schvalováním = nová žádost (${r.json.event && r.json.event.status})`);
  expect((await notif(A, 'type = "absence_requested"')).length === predA2 + 1, 'správce žádost z přesunu dostal');
  expect((await inst.api('GET', `/api/kb/away?from=${den(36)}&to=${den(36)}`, { token: C })).json.away.length === 0, 'přesunutá nepřítomnost není „pryč“, dokud se neschválí');
  // (b) prodloužení schválené = znovu žádost, rozhodnutí vynulováno
  r = await inst.api('POST', '/api/kb/events/decide', { token: B, body: { id: SOUKROME, decision: 'approved', note: 'OK, ale jen den' } });
  expect(r.status === 200 && r.json.event.status === 'approved', 'manažer schválil');
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { id: SOUKROME, end_day: den(45) } });
  expect(r.status === 200 && r.json.event.status === 'requested' && r.json.event.decision_note === '', `prodloužení schválené nepřítomnosti = znovu žádost bez staré poznámky (${r.json.event && r.json.event.status})`);
  expect((await notif(A, 'type = "absence_requested"')).length === predA2 + 2, 'správce dostal i žádost o prodloužení');
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { id: SOUKROME, note: 'jen poznámka' } });
  expect(r.status === 200 && r.json.event.status === 'requested' && (await notif(A, 'type = "absence_requested"')).length === predA2 + 2, 'změna poznámky stav nemění a nespamuje správce');
  // (c) poznámka rozhodnutí: dotyčný a správce ano, kolega ne
  r = await inst.api('POST', '/api/kb/events/decide', { token: B, body: { id: SOUKROME, decision: 'approved', note: 'Nahradí si to' } });
  const okno = `?from=${den(36)}&to=${den(45)}`;
  expect((await udalosti(D, okno)).find((e) => e.id === SOUKROME).decision_note === 'Nahradí si to', 'žadatel poznámku vidí');
  expect((await udalosti(A, okno)).find((e) => e.id === SOUKROME).decision_note === 'Nahradí si to', 'správce poznámku vidí');
  expect((await udalosti(C, okno)).find((e) => e.id === SOUKROME).decision_note === '', 'kolega poznámku k cizímu rozhodnutí NEvidí');
  // (d) přesun ven z nepřítomností = bez stavu
  r = await inst.api('POST', '/api/kb/events/save', { token: D, body: { id: SOUKROME, calendar: '' } });
  expect(r.status === 200 && r.json.event.status === undefined, 'přesun do osobního kalendáře stav smaže');
  // (e) nepřítomnost za kolegu: člen 403, manažer OK (výše)
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Za kolegu', day: den(37), calendar: NEPRITOMNOSTI, participants: ['d@e2e.cz'] } });
  expect(r.status === 403 && /správce|admin/i.test(r.json.error), `člen nepřítomnost za kolegu nezapíše (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { title: 'Za sebe', day: den(37), calendar: NEPRITOMNOSTI, participants: ['c@e2e.cz'] } });
  expect(r.status === 200 && JSON.stringify(r.json.event.away) === JSON.stringify(['c@e2e.cz']), 'člen za sebe výslovně ano');
  // (f) export: zamítnutá cizí nepřítomnost a cizí poznámka v exportu člena nejsou
  r = await inst.api('POST', '/api/kb/events/decide', { token: A, body: { id: r.json.event.id, decision: 'rejected', note: 'DŮVĚRNÉ' } });
  const ZAMITNUTA = r.json.event.id;
  const exC = (await inst.api('GET', '/api/kb/export', { token: C })).json;
  const exD = (await inst.api('GET', '/api/kb/export', { token: D })).json;
  expect(exC.events.some((e) => e.id === ZAMITNUTA && e.status === 'rejected' && e.decision_note === 'DŮVĚRNÉ'), 'export žadatele zamítnutou i s poznámkou má');
  expect(!exD.events.some((e) => e.id === ZAMITNUTA) && !JSON.stringify(exD.events).includes('DŮVĚRNÉ'), 'export kolegy zamítnutou cizí nepřítomnost ani poznámku neobsahuje');
  expect(!exD.events.some((e) => e.decision_note && e.owner_email !== 'd@e2e.cz' && (e.away || []).indexOf('d@e2e.cz') < 0), 'export kolegy nenese žádnou CIZÍ poznámku k rozhodnutí (svou ano)');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: NEPRITOMNOSTI, needs_approval: false } });
  // (g) nezvaný člen firemní akci „neopustí“ (dřív 200 a událost mu zůstala)
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Školení', day: den(38), time: '09:00', calendar: FIREMNI } });
  const SKOLENI = r.json.event.id;
  r = await inst.api('POST', '/api/kb/events/leave', { token: C, body: { id: SKOLENI } });
  expect(r.status === 400 && /pozván|invited/i.test(r.json.error), `nezvaný firemní akci neopouští (${r.status} ${r.json && r.json.error})`);
  expect((await udalosti(C, `?from=${den(38)}&to=${den(38)}`)).some((e) => e.id === SKOLENI), 'a dál ji vidí');
  // (h) anonym přes přímé PB API nic (dřív četl celý kalendář)
  for (const col of ['calendars', 'events']) {
    r = await inst.api('GET', `/api/collections/${col}/records?perPage=5`);
    expect(r.status !== 200 || (r.json.items || []).length === 0, `anonym ${col}: ${r.status}, ${(r.json && r.json.items || []).length} záznamů`);
  }
  r = await inst.api('GET', `/api/collections/events/records/${SKOLENI}`);
  expect(r.status === 404 || r.status === 403, `anonym detail události = ${r.status}`);
  // přihlášený člen přes přímé API: zamítnutou cizí a archivovanou nevidí (RLS = routa)
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Archiv', kind: 'shared' } });
  const ARCHIV = r.json.calendar.id;
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'V archivu', day: den(39), calendar: ARCHIV } });
  const VARCHIVU = r.json.event.id;
  await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: ARCHIV, archived: true } });
  const primoD = (await inst.api('GET', '/api/collections/events/records?perPage=500', { token: D })).json.items || [];
  expect(primoD.length > 0 && !primoD.some((e) => e.id === ZAMITNUTA) && !primoD.some((e) => e.id === VARCHIVU) && primoD.some((e) => e.id === SKOLENI), `člen přes přímé API: firemní ano, zamítnutá cizí ne, archivovaná ne (${primoD.length})`);
  const primoA = (await inst.api('GET', '/api/collections/events/records?perPage=500', { token: A })).json.items || [];
  expect(primoA.some((e) => e.id === ZAMITNUTA), 'správce přes přímé API zamítnutou vidí');
  // (i) import kalendáře: jen přesná shoda názvu („Firem“ není „Firemní“)
  r = await inst.api('POST', '/api/kb/import-all', { token: A, body: { format: 'killbottleneck.export/1', calendars: [{ name: 'Firem', kind: 'shared' }, { name: 'firemní', kind: 'shared' }] } });
  expect(r.status === 200 && r.json.calendars_imported === 1 && r.json.calendars_skipped === 1, `import: „Firem“ založen, „firemní“ (= Firemní) přeskočen (${JSON.stringify(r.json)})`);

  console.log('== Můj den: firemní akce v „Dnes v kalendáři“ se jménem kalendáře, nepřítomnosti jen jako „Dnes chybí“ ==');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Snídaně s týmem', day: den(0), time: '08:30', end_time: '09:00', calendar: FIREMNI } });
  expect(r.status === 200, 'admin zapsal dnešní firemní akci');
  r = await inst.api('POST', '/api/kb/events/save', { token: B, body: { title: 'Nemoc', day: den(0), end_day: den(1), calendar: NEPRITOMNOSTI, participants: ['d@e2e.cz'] } });
  expect(r.status === 200, 'manažer zapsal dnešní nemoc za d');
  const mujDenC = (await inst.api('GET', `/api/kb/my-day?today=${den(0)}`, { token: C })).json;
  const evC = (mujDenC.sections && mujDenC.sections.events) || [];
  expect(evC.some((e) => e.title === 'Snídaně s týmem' && e.calendar === 'Firemní' && e.time === '08:30' && e.end_time === '09:00'), `C (nepozvaný) vidí firemní akci v Můj den se jménem kalendáře (${JSON.stringify(evC)})`);
  expect(!evC.some((e) => e.title === 'Nemoc'), 'nepřítomnost kolegy se NEvypisuje mezi událostmi');
  const awayC = (mujDenC.sections && mujDenC.sections.away) || [];
  expect(awayC.length === 1 && awayC[0].email === 'd@e2e.cz' && awayC[0].until === den(1) && awayC[0].title === 'Nemoc', `„Dnes chybí“ = d do ${den(1)} (${JSON.stringify(awayC)})`);
  const mujDenD = (await inst.api('GET', `/api/kb/my-day?today=${den(0)}`, { token: D })).json;
  expect(((mujDenD.sections && mujDenD.sections.away) || []).some((a) => a.email === 'd@e2e.cz'), 'i d sám sebe vidí v „Dnes chybí“');
  await inst.api('POST', '/api/kb/events/delete', { token: B, body: { id: r.json.event.id } });

  console.log('== v1 API: kalendáře, události s kalendářem/koncem, kdo je pryč, nápověda cizích polí ==');
  const keyA = (await inst.api('POST', '/api/kb/api-keys', { token: A, body: { label: 'v1-a', scope: 'read_write' } })).json.token;
  const keyC = (await inst.api('POST', '/api/kb/api-keys', { token: C, body: { label: 'v1-c', scope: 'read_write' } })).json.token;
  const v1 = (key, method, path, body) => inst.api(method, '/api/kb' + path, { bearer: key, body });
  r = await v1(keyC, 'POST', '/v1/calendars', { name: 'Sklad', kind: 'resource' });
  expect(r.status === 403, `v1: člen nezakládá kalendář (${r.status})`);
  r = await v1(keyA, 'POST', '/v1/calendars', { name: 'Sklad', kind: 'resource', colour: '#000000' });
  expect(r.status === 400 && /color/.test(r.json.error), 'v1: neznámé pole kalendáře = 400 s nápovědou');
  r = await v1(keyA, 'POST', '/v1/calendars', { name: 'Sklad', kind: 'resource', color: '#123456', write_access: 'admins' });
  expect(r.status === 200 && r.json.calendar.write_access === 'admins', `v1: admin založil Sklad (${r.status})`);
  const SKLAD = r.json.calendar.id;
  r = await v1(keyA, 'POST', `/v1/calendars/${SKLAD}`, { description: 'regál 3' });
  expect(r.status === 200 && r.json.calendar.description === 'regál 3', 'v1: úprava kalendáře');
  r = await v1(keyA, 'POST', '/v1/calendars/neexistuje', { description: 'x' });
  expect(r.status === 404, 'v1: neznámé id kalendáře = 404');
  r = await v1(keyC, 'GET', '/v1/calendars');
  expect(r.status === 200 && r.json.calendars.some((c) => c.id === SKLAD && c.can_write === false), 'v1: člen vidí kalendář, can_write false (admins)');
  r = await v1(keyC, 'POST', '/v1/events', { title: 'Výdej', day: den(12), time: '08:00', room: 'Sklad' });
  expect(r.status === 400 && /calendar/.test(r.json.error) && /room/.test(r.json.error), `v1: cizí pole room → nápověda calendar (${r.json && r.json.error})`);
  r = await v1(keyC, 'POST', '/v1/events', { title: 'Výdej', day: den(12), time: '08:00', end: '09:00' });
  expect(r.status === 400 && /end_time/.test(r.json.error), 'v1: cizí pole end → nápověda end_time/end_day');
  r = await v1(keyC, 'POST', '/v1/events', { title: 'Výdej', day: den(12), time: '08:00', calendar: 'Sklad' });
  expect(r.status === 403, 'v1: člen do admins kalendáře nezapíše');
  r = await v1(keyA, 'POST', '/v1/events', { title: 'Inventura', day: den(12), end_day: den(13), time: '08:00', end_time: '16:00', calendar: 'Sklad' });
  expect(r.status === 200 && r.json.event.kind === 'resource' && r.json.event.end_day === den(13) && r.json.event.end_time === '16:00', `v1: vícedenní rezervace (${r.status} ${r.json && r.json.error})`);
  const INVENTURA = r.json.event.id;
  r = await v1(keyA, 'POST', '/v1/events', { title: 'Výdej', day: den(13), time: '10:00', end_time: '11:00', calendar: SKLAD });
  expect(r.status === 409 && r.json.collision.id === INVENTURA && r.json.next_free && r.json.next_free.time === '16:00', `v1: kolize s vícedenní rezervací = 409, next_free až po jejím konci 16:00 (${JSON.stringify(r.json.next_free)})`);
  r = await v1(keyC, 'GET', `/v1/events?calendar=Sklad&from=${den(13)}&to=${den(13)}`);
  expect(r.status === 200 && r.json.events.length === 1 && r.json.events[0].id === INVENTURA && r.json.events[0].can_edit === false, 'v1: člen vidí rezervaci ve Skladu (okno uprostřed), can_edit false');
  r = await v1(keyC, 'GET', `/v1/away?from=${ZA5}&to=${ZA5}`);
  expect(r.status === 200 && r.json.away.length === 1 && r.json.away[0].email === 'c@e2e.cz', 'v1: /away');
  r = await v1(keyC, 'POST', `/v1/events/${INVENTURA}/delete`, {});
  expect(r.status === 403, 'v1: člen cizí rezervaci nemaže');
  r = await v1(keyA, 'POST', `/v1/events/${INVENTURA}`, { calendar: '' });
  expect(r.status === 200 && r.json.event.calendar === '' && r.json.event.end_day === den(13), 'v1: přesun do osobního drží konec');

  inst.stop();

  // VÝCHOZÍ KALENDÁŘE NOVÉ INSTANCE (Richard 15. 10. 2026): bez KB_UVODNI_MAPA=0 dostane
  // první správce „Firemní“ + „Nepřítomnosti“ v jazyce registrace; druhý účet nic nezdvojí.
  const inst2 = await H.startInstance({ slug: 'kalendare-vychozi', env: { TZ: 'Europe/Prague' } });
  r = await inst2.register('boss@e2e.cz', { language: 'en' });
  expect(r.status === 200, `výchozí: první správce (en) zaregistrován (${r.status})`);
  await inst2.register('dva@e2e.cz');
  const BOSS = await inst2.login('boss@e2e.cz');
  const DVA = await inst2.login('dva@e2e.cz');
  let vych = (await inst2.api('GET', '/api/kb/calendars', { token: DVA })).json.calendars || [];
  expect(vych.map((c) => `${c.name}[${c.kind}]`).join(',') === 'Company[shared],Time off[absence]', `nová instance má Company + Time off, člen je vidí (${vych.map((c) => c.name).join(',')})`);
  expect(vych.every((c) => c.visibility === 'all' && c.write_access === 'all' && c.needs_approval === false && c.archived === false && c.can_write === true), 'výchozí: celý tým vidí, každý zapisuje, schvalování vypnuté');
  r = await inst2.api('POST', '/api/kb/events/save', { token: DVA, body: { title: 'Dovolená', day: ZA5, end_day: ZA9, calendar: 'Time off' } });
  expect(r.status === 200 && r.json.event.kind === 'absence', `výchozí: člen hned zapíše dovolenou do Time off (${r.status} ${r.json && r.json.error})`);
  r = await inst2.api('POST', '/api/kb/calendars/delete', { token: BOSS, body: { id: vych[0].id } });
  expect(r.status === 200, 'výchozí: správce může Company smazat');
  await inst2.register('tri@e2e.cz');
  vych = (await inst2.api('GET', '/api/kb/calendars', { token: BOSS })).json.calendars || [];
  expect(vych.length === 1 && vych[0].name === 'Time off', `další registrace výchozí kalendáře nezakládá znovu (${vych.map((c) => c.name).join(',')})`);
  inst2.stop();

  // česká registrace = české názvy (a KB_UVODNI_MAPA=0 je úplně vypne — ověřeno celou sadou výš: inst začínala prázdná)
  const inst3 = await H.startInstance({ slug: 'kalendare-vychozi-cs', env: { TZ: 'Europe/Prague' } });
  await inst3.register('sef@e2e.cz', { language: 'cs' });
  const SEF = await inst3.login('sef@e2e.cz');
  vych = (await inst3.api('GET', '/api/kb/calendars', { token: SEF })).json.calendars || [];
  expect(vych.map((c) => c.name).join(',') === 'Firemní,Nepřítomnosti', `česká instance má Firemní + Nepřítomnosti (${vych.map((c) => c.name).join(',')})`);
  inst3.stop();
}, { nazev: 'KALENDARE' });
