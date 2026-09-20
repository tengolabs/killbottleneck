// UDÁLOSTI (events): osobní položky kalendáře s časem, účastníky a připomínkou
// (Richard 18. 9. 2026: „notifikace i na věci bez projektu — zubař, telko").
//
// Co se hlídá: zápis JEN routami (PB CRUD je zamčený), validace dne/času,
// účastníci = existující členové (přesně, pak bez ohledu na velikost písmen),
// RLS (účastník vidí, cizí ne, cizí update = 404, účastník update = 403),
// „pozván" jen novým účastníkům, minutový cron /run-reminders s podvrženým „teď"
// (vlastník + účastník, e-mail HNED i v režimu digest), dedup (2. běh = 0),
// přesun dne = nová připomínka, catch-up okno 48 h, celodenní událost v 7:00.
//
// Mutační důkaz: na image z main (bez routy /events/save) padá už první kontrola.
// Kontejner běží v TZ=Europe/Prague — připomínky chodí v čase instance.
const H = require('./_harness');
const { expect } = H;

const den = (posun) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + posun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// "YYYY-MM-DD HH:MM" − minuty (lokálně; jen pro výpočet očekávaného času)
const minusMin = (day, time, min) => {
  const [y, m, d] = day.split('-').map(Number); const [hh, mm] = time.split(':').map(Number);
  const x = new Date(y, m - 1, d, hh, mm); x.setMinutes(x.getMinutes() - min);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

H.beh(async () => {
  const sink = await H.smtpSink();
  const inst = await H.startInstance({ slug: 'udalosti', addHostGateway: true,
    env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0, KB_TEST_CLOCK: 1 } });
  const ST = await inst.superuser();
  await sink.zapoj(inst, ST);
  for (const e of ['a@e2e.cz', 'b@e2e.cz', 'c@e2e.cz']) await inst.register(e);
  const A = await inst.login('a@e2e.cz');
  const B = await inst.login('b@e2e.cz');
  const C = await inst.login('c@e2e.cz');
  const notif = async (token, filtr) => (await inst.api('GET', `/api/collections/notifications/records?perPage=50&filter=${encodeURIComponent(filtr || 'id != ""')}`, { token })).json.items || [];

  const ZITRA = den(1);

  console.log('== zápis jen routami, validace ==');
  let r = await inst.api('POST', '/api/collections/events/records', { token: A, body: { title: 'Přímý zápis', day: ZITRA } });
  expect(r.status === 400 || r.status === 403, `PB CRUD create je zamčený (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { day: ZITRA } });
  expect(r.status === 400 && /název|title/i.test(r.json.error), `bez názvu = 400 (${r.json && r.json.error})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Zubař', day: '2026-13-45' } });
  expect(r.status === 400 && /datum|date/i.test(r.json.error), 'neplatný den 2026-13-45 = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Zubař', day: ZITRA, time: '25:70' } });
  expect(r.status === 400 && /HH:MM/.test(r.json.error), 'neplatný čas 25:70 = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Zubař', day: ZITRA, participants: ['nikdo@e2e.cz'] } });
  expect(r.status === 400 && /nikdo@e2e.cz/.test(r.json.error), `neznámý účastník = 400 s e-mailem (${r.json && r.json.error})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Zubař', day: ZITRA, participants: ['ext-abc@kontakt.invalid'] } });
  expect(r.status === 400 && /extern/i.test(r.json.error), 'externí kontakt jako účastník = 400');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Zubař', day: ZITRA, participants: ['a@e2e.cz'], remind_before_min: -5 } });
  expect(r.status === 400, 'záporný předstih = 400');

  console.log('== založení s účastníkem (B@ → b@), připomínka 30 min ==');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: {
    title: 'Zubař', day: ZITRA, time: '14:00', note: 'vzít kartičku', participants: ['B@e2e.cz', 'a@e2e.cz'], remind_before_min: 30 } });
  expect(r.status === 200 && r.json.event && r.json.event.id, `událost založena (${r.status})`);
  const ev = r.json.event;
  expect(ev.participants.length === 1 && ev.participants[0] === 'b@e2e.cz', `účastník kanonicky b@e2e.cz, vlastník vyřazen (${JSON.stringify(ev.participants)})`);
  expect(ev.remind === true && ev.remind_before_min === 30 && ev.mine === true, 'remind_before_min zapíná připomínku; mine = true');
  expect(ev.owner_email === 'a@e2e.cz' && ev.time === '14:00' && ev.note === 'vzít kartičku', 'DTO nese vlastníka, čas a poznámku');

  console.log('== viditelnost: účastník vidí, cizí ne ==');
  const seznamB = (await inst.api('GET', '/api/kb/events', { token: B })).json.events || [];
  expect(seznamB.length === 1 && seznamB[0].mine === false, 'B vidí událost v /events (mine = false)');
  const rlsB = (await inst.api('GET', '/api/collections/events/records', { token: B })).json.items || [];
  expect(rlsB.length === 1, 'B vidí událost i přes RLS (realtime v kalendáři)');
  const rlsC = (await inst.api('GET', '/api/collections/events/records', { token: C })).json.items || [];
  expect(rlsC.length === 0, 'C (cizí) přes RLS nic nevidí');
  r = await inst.api('POST', '/api/kb/events/save', { token: C, body: { id: ev.id, title: 'Hack' } });
  expect(r.status === 404, `cizí update = 404 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: B, body: { id: ev.id, title: 'Hack' } });
  expect(r.status === 403, `účastník update = 403 (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/delete', { token: B, body: { id: ev.id } });
  expect(r.status === 403, 'účastník smazat = 403');
  r = await inst.api('POST', '/api/kb/events/delete', { token: C, body: { id: ev.id } });
  expect(r.status === 404, 'cizí smazat = 404');

  console.log('== pozvání: jen novým účastníkům, ne vlastníkovi ==');
  let nB = await notif(B, 'type = "event_invited"');
  expect(nB.length === 1 && nB[0].event_id === ev.id && /Zubař/.test(nB[0].text), `B má event_invited s event_id (${nB.length})`);
  expect((await notif(A, 'type = "event_invited"')).length === 0, 'vlastník pozvánku nedostal');
  // opakované uložení se stejnými účastníky = žádná další pozvánka
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { id: ev.id, participants: ['b@e2e.cz'], note: 'x' } });
  expect(r.status === 200, 'úprava vlastníkem OK');
  nB = await notif(B, 'type = "event_invited"');
  expect(nB.length === 1, 'stejný účastník znovu → pozvánka jen jednou');

  console.log('== cron: připomínka 30 min před 14:00 vlastníkovi i účastníkovi, e-mail HNED i v digestu ==');
  // B má denní souhrn — připomínka s časem ho MUSÍ obejít
  r = await inst.api('PATCH', `/api/collections/users/records/${(await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="b@e2e.cz"'), { token: ST })).json.items[0].id}`,
    { token: B, body: { notify_email_mode: 'digest' } });
  expect(r.status === 200, 'B přepnut na digest');
  const FIRE = minusMin(ZITRA, '14:00', 30);
  r = await inst.api('POST', '/api/kb/run-reminders', { token: A, body: { at: FIRE } });
  expect(r.status === 404, 'run-reminders bez superusera = 404');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: minusMin(ZITRA, '14:00', 31) } });
  expect(r.status === 200 && r.json.sent === 0, `minutu před časem připomínky ještě nic (${r.json && r.json.sent})`);
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: FIRE } });
  expect(r.status === 200 && r.json.sent === 2, `v čas připomínky odesláno 2 (${r.json && r.json.sent})`);
  const remA = await notif(A, 'type = "reminder"');
  const remB = await notif(B, 'type = "reminder"');
  expect(remA.length === 1 && remA[0].event_id === ev.id && /Zubař/.test(remA[0].text) && /14:00/.test(remA[0].text), `A má reminder s event_id a časem (${remA[0] && remA[0].text})`);
  expect(remB.length === 1, 'B (účastník) má reminder');
  const maily = await H.waitFor(() => sink.maily.length >= 1 ? sink.maily : null, { timeout: 8000, popis: 'e-mail v jímce' }).catch(() => sink.maily);
  await H.sleep(1500); // kdyby přece jen přišel druhý (B) — nesmí
  expect(maily.length >= 1, `e-mail připomínky odešel (${maily.length} mailů)`);
  expect(!maily.some((m) => /b@e2e\.cz/.test(m)), 'pozvaný B e-mail NEdostal (bez vlastního zaškrtnutí — pozvánka bez souhlasu nesmí být e-mailový kanál)');
  expect(maily.some((m) => /a@e2e\.cz/.test(m)), 'vlastník A e-mail dostal (výchozí zapnutý u vlastní události)');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: minusMin(ZITRA, '14:00', 0) } });
  expect(r.json.sent === 0, 'druhý běh = 0 (reminded_at)');
  expect((await notif(A, 'type = "reminder"')).length === 1, 'žádná duplicita notifikace');

  console.log('== účastník s VÝSLOVNĚ zapnutým e-mailem ho dostane hned i v digestu ==');
  const uidB = (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="b@e2e.cz"'), { token: ST })).json.items[0].id;
  r = await inst.api('PATCH', `/api/collections/users/records/${uidB}`, { token: B, body: { notify_prefs: { reminder: { in_app: true, email: true } } } });
  expect(r.status === 200, 'B si e-mail u připomínek zapnul');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Kontrola', day: den(4), time: '10:00', participants: ['b@e2e.cz'], remind_before_min: 0 } });
  const predB = sink.maily.filter((m) => /b@e2e\.cz/.test(m)).length;
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: den(4) + ' 10:00' } });
  await H.waitFor(() => sink.maily.filter((m) => /b@e2e\.cz/.test(m)).length > predB, { timeout: 8000, popis: 'e-mail B' }).catch(() => {});
  expect(sink.maily.filter((m) => /b@e2e\.cz/.test(m)).length > predB, 'B (opt-in, digest) dostal e-mail připomínky hned');
  r = await inst.api('PATCH', `/api/collections/users/records/${uidB}`, { token: B, body: { notify_prefs: {} } });

  console.log('== minulá událost s připomínkou: tiše vyřízená, cron nic nepošle; strop 30 min i při update ==');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Ráno bylo', day: den(0), time: '00:01', remind_before_min: 0 } });
  expect(r.status === 200, 'událost dnes 00:01 (minulost) založena');
  const rano = r.json.event;
  const predRano = (await notif(A, 'type = "reminder"')).length;
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: den(0) + ' 23:59' } });
  expect((await notif(A, 'type = "reminder"')).length === predRano, 'minulá událost připomínku NEvystřelila');
  expect((await inst.api('GET', `/api/collections/events/records/${rano.id}`, { token: A })).json.reminded_at !== '', 'a je označená jako vyřízená');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Bez min', day: den(4), time: '12:00' } });
  expect(r.json.event.remind === false, 'bez připomínky = remind false');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { id: r.json.event.id, remind: true } });
  expect(r.json.event.remind === true && r.json.event.remind_before_min === 30, `zapnutí připomínky při úpravě = výchozích 30 min (${r.json.event.remind_before_min})`);

  console.log('== přesun dne = připomínka znovu platí ==');
  const POZITRI = den(2);
  const predPresunA = (await notif(A, 'type = "reminder"')).length;
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { id: ev.id, day: POZITRI } });
  expect(r.status === 200 && r.json.event.day === POZITRI, 'den přesunut');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: minusMin(POZITRI, '14:00', 30) } });
  expect(r.json.sent === 2, `po přesunu nová připomínka oběma (${r.json.sent})`);
  expect((await notif(A, 'type = "reminder"')).length === predPresunA + 1, 'A má o připomínku víc (jiný čas = jiný dedup klíč)');

  console.log('== předstih přes půlnoc: „den předem“ (1440) přijde DEN PŘED událostí, ne o půlnoci; 7 dní předem taky ==');
  const ZA6 = den(6), ZA10 = den(10);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Porada', day: ZA6, time: '14:00', remind_before_min: 1440 } });
  expect(r.status === 200, 'událost za 6 dní s předstihem den předem');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Veletrh', day: ZA10, time: '09:00', remind_before_min: 10080 } });
  expect(r.status === 200, 'událost za 10 dní s předstihem týden');
  // simulovaný čas jde jen DOPŘEDU (běh v minulosti by pozdější připomínky označil jako zmeškané — catch-up okno)
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: den(3) + ' 08:59' } });
  expect(r.json.sent === 0, '7 dní před veletrhem 8:59 ještě nic');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: den(3) + ' 09:00' } });
  expect(r.json.sent === 1 && (await notif(A, 'type = "reminder"')).some((n) => /Veletrh/.test(n.text)), `předstih týden vystřelí 7 dní před událostí (${r.json.sent})`);
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: den(5) + ' 13:59' } });
  expect(!(await notif(A, 'type = "reminder"')).some((n) => /Porada/.test(n.text)), 'den před poradou 13:59 ještě nic');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: den(5) + ' 14:00' } });
  expect(r.json.sent === 1 && (await notif(A, 'type = "reminder"')).some((n) => /Porada/.test(n.text)), `„den předem“ vystřelí den před událostí ve 14:00 (${r.json.sent})`);
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA10 + ' 00:00' } });
  expect(r.json.sent === 0, 'v den události už podruhé nic');

  console.log('== denní souhrn nezdvojí připomínku (už odešla hned) ==');
  const mailuPred = sink.maily.length;
  r = await inst.api('POST', '/api/kb/run-email-digests', { token: ST });
  expect(r.status === 200, `souhrn spuštěn (${r.status})`);
  await H.sleep(1000);
  const nove = sink.maily.slice(mailuPred).filter((m) => /b@e2e\.cz/.test(m));
  expect(nove.length >= 1, `B (digest) dostal denní souhrn (${nove.length})`);
  expect(nove.every((m) => !/P.ipom.nka|Reminder:/.test(m)), 'souhrn B NEOBSAHUJE připomínku (ta šla hned, ne podruhé)');
  expect(nove.some((m) => /pozval|invited/i.test(m)), 'ale obsahuje pozvání na událost (běžný typ)');

  console.log('== catch-up okno: stará připomínka se jen označí ==');
  const DAVNO = den(-5);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Stará schůzka', day: DAVNO, time: '10:00', remind_before_min: 15 } });
  const stara = r.json.event;
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: den(0) + ' 12:00' } });
  expect(r.json.sent === 0, 'připomínka starší než 48 h se neposílá');
  const rec = (await inst.api('GET', `/api/collections/events/records/${stara.id}`, { token: A })).json;
  expect(rec && rec.reminded_at !== '', 'ale je označená jako vyřízená (nebude se zkoušet pořád)');

  console.log('== celodenní událost: připomínka ráno v 7:00 ==');
  const ZA3 = den(3);
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Celý den', day: ZA3, remind: true } });
  expect(r.status === 200 && r.json.event.time === '' && r.json.event.remind === true, 'celodenní s připomínkou');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA3 + ' 06:59' } });
  expect(r.json.sent === 0, 'v 6:59 ještě ne');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA3 + ' 07:00' } });
  expect(r.json.sent === 1, 'v 7:00 ano');
  const celyDen = (await notif(A, 'type = "reminder"')).find((n) => /Celý den/.test(n.text));
  expect(!!celyDen && /dnes|today/.test(celyDen.text), `text celodenní připomínky říká „dnes" (${celyDen && celyDen.text})`);

  console.log('== předvolby: reminder jde vypnout, e-mail výchozí zapnutý jen u reminder ==');
  const uidA = (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="a@e2e.cz"'), { token: ST })).json.items[0].id;
  r = await inst.api('PATCH', `/api/collections/users/records/${uidA}`, { token: A, body: { notify_prefs: { reminder: { in_app: false, email: false } } } });
  expect(r.status === 200 && r.json.notify_prefs && r.json.notify_prefs.reminder && r.json.notify_prefs.reminder.in_app === false, 'notify_prefs.reminder se uloží');
  r = await inst.api('POST', '/api/kb/events/save', { token: A, body: { title: 'Ticho', day: ZA3, time: '09:00', remind_before_min: 0 } });
  const pred = (await notif(A, 'type = "reminder"')).length;
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA3 + ' 09:00' } });
  expect((await notif(A, 'type = "reminder"')).length === pred, 'vypnutý typ reminder → nic nepřišlo');

  console.log('== pozvaný se odebere sám (Richard 19. 9.); vlastník se neodebírá ==');
  r = await inst.api('POST', '/api/kb/events/leave', { token: C, body: { id: ev.id } });
  expect(r.status === 404, 'cizí leave = 404');
  r = await inst.api('POST', '/api/kb/events/leave', { token: A, body: { id: ev.id } });
  expect(r.status === 400, 'vlastník leave = 400 (má smazat)');
  r = await inst.api('POST', '/api/kb/events/leave', { token: B, body: { id: ev.id } });
  expect(r.status === 200, 'účastník leave = 200');
  expect(((await inst.api('GET', '/api/kb/events', { token: B })).json.events || []).every((e) => e.id !== ev.id), 'B událost už nevidí');
  expect(((await inst.api('GET', '/api/kb/events', { token: A })).json.events.find((e) => e.id === ev.id) || {}).participants.length === 0, 'vlastník vidí prázdný seznam účastníků');

  console.log('== smazání vlastníkem ==');
  r = await inst.api('POST', '/api/kb/events/delete', { token: A, body: { id: ev.id } });
  expect(r.status === 200, 'vlastník smazal');
  expect(((await inst.api('GET', '/api/kb/events', { token: B })).json.events || []).every((e) => e.id !== ev.id), 'B už událost nevidí');

  inst.stop();
}, { nazev: 'UDALOSTI' });
