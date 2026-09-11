// Kalendář v2 — datový modul frontend/src/components/tasks/calendarDates.js (bez dockeru).
// Hlídá: klíč dne je LOKÁLNÍ občanský den (ne UTC), parseDateKey odmítá nesmysly,
// týden Po–Ne přes změnu letního času (Praha, New York, Auckland), mřížka měsíce 42 dnů,
// posun období přes Nový rok a zaražení na konec měsíce (31. 1. → 28./29. 2.),
// navigace nemutuje vstup, neplatný vstup (null) → dnešek místo pádu.
// Původ: externí dodávka (7. 9. 2026, node:test) přepsaná do stylu ostatních sad.
// MUTAČNÍ DŮKAZ: na image z main sada ČERVENÁ — calendarDates.js neexistuje.
const path = require('path');
const { pathToFileURL } = require('url');

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };
const eq = (a, b, m) => expect(a === b, `${m} (${a} ${a === b ? '=' : '≠'} ${b})`);

(async () => {
const D = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'components', 'tasks', 'calendarDates.js')).href);
const { dateKey, parseDateKey, addDays, monthDays, weekDays, movePeriod } = D;
const puvodniZona = process.env.TZ;

for (const zona of ['Europe/Prague', 'America/New_York', 'Pacific/Auckland']) {
  process.env.TZ = zona;
  console.log(`== zóna ${zona} ==`);

  eq(dateKey(new Date(2026, 8, 7, 0, 15)), '2026-09-07', 'klíč dne v 0:15 = týž den');
  eq(dateKey(new Date(2026, 8, 7, 23, 45)), '2026-09-07', 'klíč dne ve 23:45 = týž den');
  eq(dateKey(parseDateKey('2026-09-07')), '2026-09-07', 'parse → klíč je tam a zpět');
  eq(parseDateKey('2026-09-07').getHours(), 12, 'parsovaný den stojí v poledne');
  {
    const neplatne = ['2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-9-7', '2026-09-07T00:00:00Z', '', null];
    expect(neplatne.every((k) => parseDateKey(k) === null), `parseDateKey odmítá ${neplatne.length} neplatných vstupů`);
  }
  eq(dateKey(parseDateKey('2024-02-29')), '2024-02-29', 'přestupný 29. 2. 2024 projde');

  // Týdny kolem jarního i podzimního přechodu letního času ve všech třech zónách.
  for (const den of ['2026-03-08', '2026-03-29', '2026-04-05', '2026-09-27', '2026-10-25', '2026-11-01']) {
    const kotva = parseDateKey(den);
    const puvodniCas = kotva.getTime();
    const tyden = weekDays(kotva);
    const serial = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    let navaznost = true;
    for (let i = 1; i < tyden.length; i++) {
      if (serial(tyden[i]) - serial(tyden[i - 1]) !== 86400000 || tyden[i].getHours() !== 12) navaznost = false;
    }
    expect(tyden.length === 7 && tyden[0].getDay() === 1 && tyden[6].getDay() === 0 && new Set(tyden.map(dateKey)).size === 7
      && tyden.some((d) => dateKey(d) === den) && navaznost, `týden kolem ${den}: Po–Ne, 7 různých dnů po sobě, poledne`);
    eq(dateKey(addDays(addDays(kotva, 1), -1)), den, `+1 −1 den kolem ${den}`);
    eq(dateKey(movePeriod(movePeriod(kotva, 'week', 1), 'week', -1)), den, `+1 −1 týden kolem ${den}`);
    eq(kotva.getTime(), puvodniCas, `navigace nemutuje vybraný den ${den}`);
  }

  {
    const zari = monthDays(parseDateKey('2026-09-15'));
    expect(zari.length === 42 && dateKey(zari[0]) === '2026-08-31' && dateKey(zari[41]) === '2026-10-11'
      && new Set(zari.map(dateKey)).size === 42 && zari.filter((d) => d.getMonth() === 8).length === 30,
      `září 2026: 42 dnů od 31. 8. do 11. 10., 30 dnů září (${dateKey(zari[0])} … ${dateKey(zari[41])})`);
    const leden = monthDays(parseDateKey('2027-01-31'));
    expect(dateKey(leden[0]) === '2026-12-28' && dateKey(leden[41]) === '2027-02-07', 'leden 2027: mřížka od 28. 12. do 7. 2.');
    eq(weekDays(parseDateKey('2027-01-01')).map(dateKey).join(','), '2026-12-28,2026-12-29,2026-12-30,2026-12-31,2027-01-01,2027-01-02,2027-01-03', 'týden přes Nový rok');
  }

  eq(dateKey(movePeriod(parseDateKey('2026-12-31'), 'day', 1)), '2027-01-01', 'den +1 přes Silvestr');
  eq(dateKey(movePeriod(parseDateKey('2027-01-01'), 'day', -1)), '2026-12-31', 'den −1 přes Nový rok');
  eq(dateKey(movePeriod(parseDateKey('2026-12-31'), 'week', 1)), '2027-01-07', 'týden +1 přes Silvestr');
  eq(dateKey(movePeriod(parseDateKey('2026-12-31'), 'month', 1)), '2027-01-31', 'měsíc +1 z 31. 12.');
  eq(dateKey(movePeriod(parseDateKey('2026-01-31'), 'month', 1)), '2026-02-28', 'měsíc +1 z 31. 1. se zarazí na 28. 2.');
  eq(dateKey(movePeriod(parseDateKey('2024-01-31'), 'month', 1)), '2024-02-29', 'měsíc +1 z 31. 1. 2024 = 29. 2.');
  eq(dateKey(movePeriod(parseDateKey('2026-03-31'), 'month', -1)), '2026-02-28', 'měsíc −1 z 31. 3. = 28. 2.');
  eq(dateKey(movePeriod(parseDateKey('2026-01-31'), 'agenda', 1)), '2026-02-28', 'agenda se posouvá po měsících');
  eq(dateKey(movePeriod(parseDateKey('2026-01-31'), 'month', 0)), '2026-01-31', 'posun o 0 = beze změny');
}

if (puvodniZona === undefined) delete process.env.TZ; else process.env.TZ = puvodniZona;

console.log('== neplatný vstup nepadá ==');
{
  const dnes = dateKey(new Date());
  expect(weekDays(null).length === 7 && weekDays(null).some((d) => dateKey(d) === dnes), 'weekDays(null) = týden dneška');
  expect(monthDays(undefined).length === 42, 'monthDays(undefined) = 42 dnů');
  eq(dateKey(movePeriod(new Date('nesmysl'), 'day', 0)), dnes, 'movePeriod(Invalid Date) = dnešek');
}

console.log(`\n${fail === 0 ? '🟢' : '🔴'} CALENDAR-DATES PASS ${ok} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('❌ výjimka:', e); process.exit(2); });
