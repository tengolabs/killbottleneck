// Code analysis 4, finding S5-01 — two bookings of the same resource at the same moment.
//
// saveEvent checked the collision and saved ~70 lines later, outside any transaction: several
// bookings of one slot sent at once all passed the check and all were saved — the meeting
// room then held two valid bookings and nobody was told.
//
// The suite does not rely on luck: every round fires a burst of bookings of ONE free slot
// (several accounts taking turns, session route and v1 route) and claims the invariant — exactly one 200,
// every other answer is 409 with the collision, exactly one booking in the calendar. The
// same for overlapping (not identical) times and for MOVING existing bookings into one slot.
// No LLM, no e-mail.
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-soubeh-rezervace.js
const H = require('./_harness');
const { expect } = H;

const KOL = 30;        // rounds of identical bookings
const NARAZ = 6;       // bookings fired at once in a round
const den = (i) => new Date(Date.UTC(2027, 2, 1) + i * 86400000).toISOString().slice(0, 10);

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'soubeh-rezervace', env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0 } });
  // eight accounts taking turns: one account may save 60 events a minute (/events/save brake) and
  // a 429 from the brake would hide the answer this suite is about
  const UCTY = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => x + '@e2e.cz');
  for (const e of UCTY) await inst.register(e);
  const TOK = [];
  for (const e of UCTY) TOK.push(await inst.login(e));
  const A = TOK[0]; // first account = admin
  let poradi = 0;
  const dalsi = () => TOK[poradi++ % TOK.length];
  let r = await inst.api('POST', '/api/kb/calendars/save', { token: A, body: { name: 'Zasedačka', kind: 'resource' } });
  expect(r.status === 200, `podklad: kalendář-zdroj založen (${r.status})`);
  const CAL = r.json.calendar.id;
  const keyA = (await inst.api('POST', '/api/kb/api-keys', { token: A, body: { label: 'rw', scope: 'read_write' } })).json.token;
  const vDen = async (d) => ((await inst.api('GET', `/api/kb/events?from=${d}&to=${d}&calendar=${CAL}`, { token: A })).json.events || []);
  const uloz = (token, body) => inst.api('POST', '/api/kb/events/save', { token, body: Object.assign({ calendar: CAL }, body) });

  console.log('== sériově: druhá rezervace téhož času = 409 + next_free (předpoklad sady) ==');
  r = await uloz(dalsi(), { title: 'První', day: den(0), time: '10:00', end_time: '11:00' });
  const r2 = await uloz(dalsi(), { title: 'Druhá', day: den(0), time: '10:00', end_time: '11:00' });
  expect(r.status === 200 && r2.status === 409 && r2.json.next_free && r2.json.next_free.time === '11:00', `sériově 200 a 409 s next_free (${r.status} ${r2.status})`);

  console.log(`== ${KOL} kol × ${NARAZ} rezervací téhož volného termínu naráz (různé účty) ==`);
  let dvojite = 0, bezViteze = 0, spatneOdpovedi = 0, bezKolize = 0;
  const priklady = [], jine = [];
  for (let k = 0; k < KOL; k++) {
    const d = den(1 + k);
    const odp = await Promise.all(Array.from({ length: NARAZ }, (_, i) => uloz(dalsi(), { title: `Kolo ${k} / ${i}`, day: d, time: '10:00', end_time: '11:00' })));
    const ok = odp.filter((x) => x.status === 200).length;
    const kolize = odp.filter((x) => x.status === 409);
    const ulozene = (await vDen(d)).filter((e) => e.time === '10:00');
    if (ok > 1 || ulozene.length > 1) { dvojite++; if (priklady.length < 3) priklady.push(`${d}: statusy ${odp.map((x) => x.status).join(',')}, v kalendáři ${ulozene.length}`); }
    if (ok < 1 || ulozene.length < 1) bezViteze++;
    if (ok + kolize.length !== NARAZ) { spatneOdpovedi++; const x = odp.find((y) => y.status !== 200 && y.status !== 409); if (jine.length < 3) jine.push(`${x.status} ${JSON.stringify(x.json).slice(0, 160)}`); }
    if (kolize.some((x) => !x.json || !x.json.collision || !x.json.next_free || x.json.next_free.time !== '11:00')) bezKolize++;
  }
  expect(dvojite === 0, `NIKDY dvě rezervace jednoho termínu (kol s dvojitou rezervací: ${dvojite} z ${KOL}${priklady.length ? ' — ' + priklady.join(' | ') : ''})`);
  expect(bezViteze === 0, `v každém kole jedna rezervace projde (kol bez rezervace: ${bezViteze})`);
  expect(spatneOdpovedi === 0, `odpovědi jsou jen 200 a 409 — žádná 400/500 ze souběhu (kol s jinou odpovědí: ${spatneOdpovedi}${jine.length ? ' — ' + jine.join(' | ') : ''})`);
  expect(bezKolize === 0, `každé odmítnutí nese kolizi a next_free 11:00 (kol s neúplným 409: ${bezKolize})`);

  console.log('== překrývající se (ne stejné) časy naráz: nikdy dva překryvy ==');
  const CASY = [['09:00', '10:30'], ['09:30', '11:00'], ['10:00', '11:30'], ['09:15', '09:45']];
  let prekryvy = 0;
  for (let k = 0; k < 10; k++) {
    const d = den(100 + k);
    await Promise.all(CASY.map((c, i) => uloz(dalsi(), { title: `Překryv ${k} / ${i}`, day: d, time: c[0], end_time: c[1] })));
    const ev = (await vDen(d)).sort((x, y) => x.time.localeCompare(y.time));
    let vadny = !ev.length;
    for (let i = 1; i < ev.length; i++) if (ev[i].time < ev[i - 1].end_time) vadny = true;
    if (vadny) prekryvy++;
  }
  expect(prekryvy === 0, `v žádném dni se dvě rezervace nepřekrývají a aspoň jedna vždy projde (vadných dní: ${prekryvy} z 10)`);

  console.log('== cesta v1 (API klíč) proti relaci naráz ==');
  let dvojiteV1 = 0;
  for (let k = 0; k < 10; k++) {
    const d = den(150 + k);
    const odp = await Promise.all([
      inst.api('POST', '/api/kb/v1/events', { bearer: keyA, body: { title: 'v1', day: d, time: '14:00', end_time: '15:00', calendar: CAL } }),
      uloz(dalsi(), { title: 'relace', day: d, time: '14:00', end_time: '15:00' }),
      inst.api('POST', '/api/kb/v1/events', { bearer: keyA, body: { title: 'v1 b', day: d, time: '14:00', end_time: '15:00', calendar: CAL } }),
    ]);
    const ulozene = await vDen(d);
    if (ulozene.length !== 1 || odp.filter((x) => x.status === 200).length !== 1) dvojiteV1++;
  }
  expect(dvojiteV1 === 0, `v1 i relace: vždy právě jedna rezervace (vadných kol: ${dvojiteV1} z 10)`);

  console.log('== přesun dvou hotových rezervací do téhož termínu naráz ==');
  let dvojitePresun = 0, ztracene = 0;
  for (let k = 0; k < 10; k++) {
    const d = den(200 + k);
    const t1 = dalsi(), t2 = dalsi();
    const e1 = (await uloz(t1, { title: 'Ranní', day: d, time: '08:00', end_time: '09:00' })).json.event;
    const e2 = (await uloz(t2, { title: 'Odpolední', day: d, time: '15:00', end_time: '16:00' })).json.event;
    const odp = await Promise.all([
      uloz(t1, { id: e1.id, time: '12:00', end_time: '13:00' }),
      uloz(t2, { id: e2.id, time: '12:00', end_time: '13:00' }),
    ]);
    const ev = await vDen(d);
    if (ev.filter((e) => e.time === '12:00').length !== 1 || odp.filter((x) => x.status === 200).length !== 1) dvojitePresun++;
    // the refused one stays where it was
    if (ev.length !== 2 || !ev.some((e) => e.time === '08:00' || e.time === '15:00')) ztracene++;
  }
  expect(dvojitePresun === 0, `přesun: v cílovém termínu vždy právě jedna rezervace (vadných kol: ${dvojitePresun} z 10)`);
  expect(ztracene === 0, `odmítnutá rezervace zůstala na původním místě (vadných kol: ${ztracene} z 10)`);

  console.log('== po souběhu: běžné chování beze změny ==');
  const dPo = den(300);
  r = await uloz(A, { title: 'Po všem', day: dPo, time: '10:00', end_time: '11:00' });
  const idPo = r.json.event && r.json.event.id;
  const posun = await uloz(A, { id: idPo, time: '10:30', end_time: '11:30' });
  expect(r.status === 200 && posun.status === 200 && posun.json.event.time === '10:30', `rezervace jde založit i posunout přes vlastní původní čas (${r.status} ${posun.status})`);
  r = await inst.api('POST', '/api/kb/events/save', { token: TOK[1], body: { title: 'Osobní', day: dPo, time: '10:30' } });
  expect(r.status === 200, `osobní událost (bez zdroje) ve stejný čas projde (${r.status})`);
}, { nazev: 'CHYBY4-SOUBEH-REZERVACE' });
