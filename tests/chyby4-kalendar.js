// Code analysis 4, wave 4 — calendar, reminders and the monthly rhythm:
//   S5-03  the night the clocks go forward: "30 min before" comes before the event, not after its start
//   S5-05  no reminders for events of an archived calendar or for a rejected absence request
//          (not stamped: unarchiving brings the reminder back)
//   S5-06  monthly rhythm with a fixed day: after ticking off, the server continues on that day of the
//          SAME month when the deadline was moved before it — as the calendar shows and the help says
// The container runs in TZ=Europe/Prague with KB_TEST_CLOCK=1 (the cron gets a forged "now").
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-kalendar.js
const path = require('path');
const { pathToFileURL } = require('url');
const H = require('./_harness');
const { expect } = H;

const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'chyby4-kalendar',
    env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0, KB_TEST_CLOCK: 1 } });
  const ST = await inst.superuser();
  for (const e of ['a@e2e.cz', 'b@e2e.cz', 'c@e2e.cz']) await inst.register(e); // a = admin
  const A = await inst.login('a@e2e.cz');
  const B = await inst.login('b@e2e.cz');
  const C = await inst.login('c@e2e.cz');
  const notif = async (token, filtr) => (await inst.api('GET', `/api/collections/notifications/records?perPage=100&filter=${encodeURIComponent(filtr || 'id != ""')}`, { token })).json.items || [];
  const run = async (at) => { const r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at } }); return r.status === 200 ? r.json.sent : `HTTP ${r.status}`; };
  const udalost = async (token, body) => { const r = await inst.api('POST', '/api/kb/events/save', { token, body }); if (r.status !== 200) throw new Error(`events/save ${r.status} ${JSON.stringify(r.json)}`); return r.json.event; };
  const razitko = async (id) => (await inst.api('GET', `/api/collections/events/records/${id}`, { token: ST })).json.reminded_at;
  expect(inst.exec('date +%Z').trim().startsWith('CE'), `kontejner běží v pražském čase (${inst.exec('date +%Z').trim()})`);

  // next year's change to summer time: the last Sunday of March (no fixed year — the suite must not expire)
  const ROK = Number(inst.exec('date +%Y').trim()) + 1;
  const p2 = (x) => String(x).padStart(2, '0');
  const posledniNedele = new Date(Date.UTC(ROK, 2, 31)); posledniNedele.setUTCDate(31 - posledniNedele.getUTCDay());
  const DST = `${ROK}-03-${p2(posledniNedele.getUTCDate())}`;
  const PRED = `${ROK}-03-${p2(posledniNedele.getUTCDate() - 1)}`;
  console.log(`== S5-03: noc na letní čas (${DST}, 02:00 → 03:00) ==`);
  // 03:15 CEST − 30 min = 01:45 CET; 03:30 − 60 min = 01:30 CET; 04:10 − 90 min = 01:40 CET (the hour 02:xx does not exist)
  const e1 = await udalost(A, { title: 'Odjezd na letiště', day: DST, time: '03:15', remind_before_min: 30 });
  expect(await run(`${DST} 01:44`) === 0, 'událost 03:15, 30 min předem: v 01:44 ještě nic');
  const s1 = await run(`${DST} 01:45`);
  expect(s1 === 1, `v 01:45 zimního času připomínka odešla (${s1}) — dřív až ve 03:45, půl hodiny PO začátku`);
  expect((await notif(A, 'type = "reminder"')).some((n) => n.event_id === e1.id && /03:15/.test(n.text)), 'připomínka nese událost a její čas 03:15');
  expect(await run(`${DST} 03:45`) === 0, 've 03:45 už nic dalšího (odesláno jednou)');
  const e2 = await udalost(A, { title: 'Vlak', day: DST, time: '03:30', remind_before_min: 60 });
  expect(await run(`${DST} 01:29`) === 0, 'událost 03:30, 60 min předem: v 01:29 ještě nic');
  const s2 = await run(`${DST} 01:30`);
  expect(s2 === 1 && !!(await razitko(e2.id)), `v 01:30 odešla (${s2}) — dřív přesně v 03:30, tedy v okamžiku začátku`);
  const e4 = await udalost(A, { title: 'Letadlo', day: DST, time: '04:10', remind_before_min: 90 });
  expect(await run(`${DST} 01:39`) === 0, 'událost 04:10, 90 min předem: v 01:39 ještě nic');
  const s2b = await run(`${DST} 01:40`);
  expect(s2b === 1 && !!(await razitko(e4.id)), `v 01:40 odešla (${s2b}) — dřív ve 03:40, jen 30 min předem`);
  // controls: what must NOT change — the same times a day earlier, an ordinary event on the day of the
  // change, and "a day before" across the change at the same hour of the clock (not an hour off)
  const e3 = await udalost(A, { title: 'Den předem', day: PRED, time: '03:15', remind_before_min: 30 });
  expect(await run(`${PRED} 02:44`) === 0 && await run(`${PRED} 02:45`) === 1 && !!(await razitko(e3.id)), 'kontrola: o den dřív 03:15/30 min → 02:45 jako vždy');
  await udalost(A, { title: 'Dopoledne', day: DST, time: '09:00', remind_before_min: 30 });
  expect(await run(`${DST} 08:29`) === 0 && await run(`${DST} 08:30`) === 1, 'kontrola: běžná událost v den změny času 09:00/30 min → 08:30');
  const e5 = await udalost(A, { title: 'Porada po změně času', day: DST, time: '15:00', remind_before_min: 1440 });
  expect(await run(`${PRED} 14:59`) === 0 && await run(`${PRED} 15:00`) === 1 && !!(await razitko(e5.id)), 'kontrola: „den předem“ přes změnu času přijde ve stejnou hodinu (15:00), ne o hodinu jinde');
  let r;

  console.log('== S5-05: archivovaný kalendář — připomínka nechodí, po odarchivaci zase ano ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Projekt X', kind: 'shared' } });
  const CAL = r.json.calendar.id;
  const kick = await udalost(A, { title: 'Kickoff X', day: `${ROK}-06-10`, time: '14:00', calendar: CAL, participants: ['b@e2e.cz'], remind_before_min: 30 });
  const osobni = await udalost(A, { title: 'Osobní schůzka', day: `${ROK}-06-10`, time: '14:00', remind_before_min: 30 });
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: CAL, archived: true } });
  expect(r.status === 200 && r.json.calendar.archived === true, 'kalendář archivován');
  const vidiB = (await inst.api('GET', `/api/kb/events?from=${ROK}-06-01&to=${ROK}-06-30`, { token: B })).json;
  expect(!JSON.stringify(vidiB || {}).includes('Kickoff X'), 'pozvaná B akci v kalendáři nevidí');
  const predB = (await notif(B, 'type = "reminder"')).length;
  const s3 = await run(`${ROK}-06-10 13:30`);
  expect(s3 === 1, `v čas připomínky odešla jen osobní událost, ne akce z archivu (${s3}; dřív 3)`);
  expect((await notif(B, 'type = "reminder"')).length === predB && !(await notif(A, 'type = "reminder"')).some((n) => n.event_id === kick.id), 'A ani B nemají připomínku na akci, kterou nikdo nevidí');
  expect((await notif(A, 'type = "reminder"')).some((n) => n.event_id === osobni.id), 'kontrola: osobní událost ve stejný čas připomenuta');
  expect((await razitko(kick.id)) === '', 'akce v archivu NENÍ označená jako vyřízená');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { id: CAL, archived: false } });
  const s4 = await run(`${ROK}-06-10 13:40`);
  expect(r.status === 200 && s4 === 2 && !!(await razitko(kick.id)), `po odarchivaci připomínka dojde autorovi i pozvané (${s4})`);
  expect((await notif(B, 'type = "reminder"')).some((n) => n.event_id === kick.id), 'B má připomínku Kickoff X');

  console.log('== S5-05: zamítnutá žádost o volno — připomínka nechodí; schválená a čekající ano ==');
  r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Nepřítomnosti', kind: 'absence', needs_approval: true } });
  expect(r.status === 200 && r.json.calendar.needs_approval === true, `kalendář nepřítomností se schvalováním (${r.status})`);
  const ABS = r.json.calendar.id;
  const zamitnuta = await udalost(C, { title: 'Dovolená C', day: `${ROK}-06-21`, calendar: ABS, remind: true });
  const schvalena = await udalost(C, { title: 'Lékař C', day: `${ROK}-06-21`, calendar: ABS, remind: true });
  const cekajici = await udalost(B, { title: 'Volno B', day: `${ROK}-06-21`, calendar: ABS, remind: true });
  expect(zamitnuta.status === 'requested' && schvalena.status === 'requested' && cekajici.status === 'requested', 'tři žádosti čekají na schválení');
  r = await inst.api('POST', '/api/kb/events/decide', { token: A, body: { id: zamitnuta.id, decision: 'rejected' } });
  expect(r.status === 200 && r.json.event.status === 'rejected', `správce zamítl (${r.status})`);
  r = await inst.api('POST', '/api/kb/events/decide', { token: A, body: { id: schvalena.id, decision: 'approved' } });
  expect(r.status === 200 && r.json.event.status === 'approved', `správce schválil (${r.status})`);
  const s5 = await run(`${ROK}-06-21 07:00`);
  const remC = await notif(C, 'type = "reminder"');
  expect(!remC.some((n) => n.event_id === zamitnuta.id), `žadatel NEdostal „Připomínka: Dovolená C dnes“ na zamítnutou žádost (${remC.map((n) => n.text).join(' | ')})`);
  expect(remC.some((n) => n.event_id === schvalena.id), 'schválená nepřítomnost připomenuta');
  expect((await notif(B, 'type = "reminder"')).some((n) => n.event_id === cekajici.id), 'čekající žádost (ještě nerozhodnutá) připomenuta jako dosud');
  expect(s5 === 2 && (await razitko(zamitnuta.id)) === '', `odeslány právě 2, zamítnutá bez razítka (${s5})`);

  console.log('== S5-06: „každý měsíc 15.“ s termínem předsunutým na 6. → po odškrtnutí 15. téhož měsíce ==');
  const rok = Number(inst.exec('date +%Y').trim()) + 1; // next year: the deadline, not today, is the base
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Proces',
    nodes: [node('root', { apexText: 'Proces', title: 'Proces', status: 'todo' }, 'apexNode'),
      node('M1', { title: 'Uzávěrka', status: 'todo', deadline: `${rok}-09-06` }),
      node('M2', { title: 'Kvartál', status: 'todo', deadline: `${rok}-09-06` }),
      node('M3', { title: 'Po patnáctém', status: 'todo', deadline: `${rok}-09-20` }),
      node('M4', { title: 'Bez pevného dne', status: 'todo', deadline: `${rok}-09-06` })],
    edges: ['M1', 'M2', 'M3', 'M4'].map((id) => ({ id: 'e' + id, source: 'root', target: id })),
  } })).json;
  expect(!!mapa.id, 'projekt založen');
  const pravidlo = async (nodeId, akce) => {
    const x = await inst.api('POST', '/api/kb/rules/save', { token: A, body: { map: mapa.id, name: 'Opakování ' + nodeId, node_id: nodeId,
      trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'set_status', status: 'todo' }, Object.assign({ type: 'set_deadline' }, akce)] } });
    expect(x.status === 200, `pravidlo ${nodeId} uloženo (${x.status} ${x.json && x.json.error ? x.json.error : ''})`);
  };
  await pravidlo('M1', { advance: 'monthly', month_day: 15 });
  await pravidlo('M2', { advance: 'monthly', every: 3, month_day: 15 });
  await pravidlo('M3', { advance: 'monthly', month_day: 15 });
  await pravidlo('M4', { advance: 'monthly' });
  const fresh = async () => (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: A })).json;
  const odskrtni = async (id) => {
    const f = await fresh();
    const x = await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: A, body: { base_updated: f.updated, edges: f.edges,
      nodes: f.nodes.map((n) => (n.id === id ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)) } });
    if (x.status !== 200) throw new Error(`PATCH ${x.status} ${JSON.stringify(x.json)}`);
    return (await fresh()).nodes.find((n) => n.id === id).data;
  };
  const R = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'rhythm.js')).href);
  const dnes = inst.exec('date +%F').trim();
  let d = await odskrtni('M1');
  expect(d.deadline === `${rok}-09-15` && d.status === 'todo', `každý měsíc 15., termín 6. 9. → 15. 9. (${d.deadline}; dřív 15. 10.)`);
  expect(R.nextDue(`${rok}-09-06`, { freq: 'monthly', every: 1, day: 15 }, dnes) === d.deadline, 'server = náhled v aplikaci (lib/rhythm.js nextDue)');
  d = await odskrtni('M1');
  expect(d.deadline === `${rok}-10-15`, `druhé odškrtnutí: z 15. 9. na 15. 10. (${d.deadline})`);
  d = await odskrtni('M2');
  expect(d.deadline === `${rok}-09-15` && R.nextDue(`${rok}-09-06`, { freq: 'monthly', every: 3, day: 15 }, dnes) === d.deadline, `každý 3. měsíc 15., termín 6. 9. → 15. 9. (${d.deadline}; dřív 15. 12.)`);
  d = await odskrtni('M2');
  expect(d.deadline === `${rok}-12-15`, `druhé odškrtnutí: o tři měsíce na 15. 12. (${d.deadline})`);
  d = await odskrtni('M3');
  expect(d.deadline === `${rok}-10-15`, `kontrola: termín 20. 9. (po 15.) → 15. 10. jako dosud (${d.deadline})`);
  d = await odskrtni('M4');
  expect(d.deadline === `${rok}-10-06`, `kontrola: měsíčně bez pevného dne, termín 6. 9. → 6. 10. jako dosud (${d.deadline})`);

  console.log('== S5-06: parita server × aplikace na zdrojích (KB_TEST_PRODUCT_DIR = jiný strom) ==');
  const ROOT = process.env.KB_TEST_PRODUCT_DIR || path.join(__dirname, '..');
  global.__hooks = path.join(ROOT, 'server', 'pb_hooks');
  const SH = require(path.join(global.__hooks, 'helpers.js'));
  const RZ = await import(pathToFileURL(path.join(ROOT, 'frontend', 'src', 'lib', 'rhythm.js')).href);
  const SkutecnyDate = Date;
  const vCase = (iso, fn) => {
    global.Date = class extends SkutecnyDate { constructor(...a) { super(...(a.length ? a : [iso])); } static now() { return new SkutecnyDate(iso).getTime(); } };
    try { return fn(); } finally { global.Date = SkutecnyDate; }
  };
  let porovnano = 0; const neshody = [];
  const rytmy = [];
  for (const every of [1, 2, 3, 4]) { for (const day of [0, 1, 15, 28, 29, 30, 31]) rytmy.push({ freq: 'monthly', every, day }); }
  for (let t = 0; t < 365; t += 9) {
    const today = RZ.addDays('2027-01-01', t);
    for (let o = -40; o <= 40; o += 3) {
      const dl = RZ.addDays(today, o);
      for (const ry of rytmy) {
        const fe = RZ.nextDue(dl, ry.day ? ry : { freq: ry.freq, every: ry.every }, today);
        const srv = vCase(`${today}T12:00:00Z`, () => SH.dalsiTermin(dl, 'monthly', { every: ry.every, monthDay: ry.day || undefined }));
        porovnano++;
        if (fe !== srv && neshody.length < 5) neshody.push(JSON.stringify({ today, dl, ry, srv, fe }));
        else if (fe !== srv) neshody.push('');
      }
    }
  }
  expect(neshody.length === 0, `měsíční rytmy (každý 1.–4. měsíc × den 1/15/28–31/bez dne): ${porovnano} porovnání, neshod ${neshody.length}${neshody.length ? ' — ' + neshody.filter(Boolean).join(' ') : ''}`);
}, { nazev: 'CHYBY4 KALENDÁŘ' });
