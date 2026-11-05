// „Dnes“ bez `today` od klienta = den INSTANCE (TZ), ne UTC (S5-05, 3. kolo analýzy, 4. 11. 2026).
//
// Klient `today` posílá vždy, ale asistent (get_my_day, get_portfolio), noční sumáře a v1 bez
// `today` šly do dayMath bez něj — a fallback byl UTC den. Zbytek instance (crony, dnes() v promptu,
// datum sumáře, /events) počítá v TZ kontejneru, takže mezi půlnocí a 2:00 (Praha) měl tentýž uzel
// kbelík „po termínu“ místo „dnes“. Sada: kontejner v pásmu, kde se právě TEĎ místní den liší od UTC
// (volí se podle hodiny spuštění — tak test nikdy nezávisí na štěstí), uzel s termínem = místní dnešek:
// /my-day bez `today` i v1 /portfolio bez `today` musí dát místní den a kbelík „dnes“, shodně
// s /my-day?today=<místní den>, který posílá klient.
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/my-day-den-instance.js
const H = require('./_harness');
const { expect } = H;

// UTC dopoledne → pásmo 12 h ZA UTC (místní den = včerejšek UTC); odpoledne → 14 h PŘED UTC (zítřek UTC).
// Etc/GMT+12 = UTC−12 (znaménko POSIX je obráceně), Etc/GMT-14 = UTC+14; obě bez letního času.
const utcHodina = new Date().getUTCHours();
const TZ = utcHodina < 12 ? 'Etc/GMT+12' : 'Etc/GMT-14';
const posunH = utcHodina < 12 ? -12 : 14;
const denV = (posun) => { const d = new Date(Date.now() + posun * 3600000); return d.toISOString().slice(0, 10); };
const mistni = denV(posunH);
const utc = denV(0);

H.beh(async () => {
  expect(mistni !== utc, `místní den instance (${mistni}, ${TZ}) se liší od UTC (${utc}) — jinak by sada nic nedokázala`);
  const inst = await H.startInstance({ slug: 'my-day-tz', env: { TZ: TZ, KB_UVODNI_MAPA: 0 } });
  await inst.register('admin@example.com');
  const A = await inst.login('admin@example.com');
  const klic = (await inst.api('POST', '/api/kb/api-keys', { token: A, body: { label: 'r', scope: 'read' } })).json.token;
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Termíny', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Termíny', title: 'Termíny', status: 'todo' } },
      { id: 'dnes', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'TERMIN-MISTNI-DNES', status: 'todo', owner: 'admin@example.com', deadline: mistni } },
      { id: 'utc', type: 'goalNode', position: { x: 200, y: 200 }, data: { title: 'TERMIN-UTC-DNES', status: 'todo', owner: 'admin@example.com', deadline: utc } },
    ], edges: [{ id: 'e1', source: 'root', target: 'dnes' }, { id: 'e2', source: 'root', target: 'utc' }] } })).json;
  expect(!!map.id, 'mapa s uzly na místní a UTC dnešek založena');
  const kbelik = (d, nazev) => Object.keys(d.sections || {}).find((k) => (d.sections[k] || []).some((it) => it.title === nazev)) || '(nikde)';

  console.log('== /my-day BEZ today = den instance ==');
  let r = await inst.api('GET', '/api/kb/my-day', { token: A });
  expect(r.status === 200 && r.json.today === mistni, `today bez parametru = místní den ${mistni} (${r.json && r.json.today})`);
  expect(kbelik(r.json, 'TERMIN-MISTNI-DNES') === 'today', `uzel s místním termínem je v kbelíku „dnes“ (${kbelik(r.json, 'TERMIN-MISTNI-DNES')})`);
  const sParametrem = await inst.api('GET', `/api/kb/my-day?today=${mistni}`, { token: A });
  expect(sParametrem.status === 200 && JSON.stringify(sParametrem.json.counts) === JSON.stringify(r.json.counts), 'bez today = totéž, co posílá klient s today=<místní den>');

  console.log('== v1 /portfolio BEZ today (asistent, MCP) ==');
  r = await inst.api('GET', '/api/kb/v1/portfolio', { bearer: klic });
  expect(r.status === 200 && r.json.today === mistni, `v1 portfolio bez today = místní den (${r.json && r.json.today})`);
  r = await inst.api('GET', '/api/kb/portfolio', { token: A });
  expect(r.status === 200 && r.json.today === mistni, `session /portfolio bez today = místní den (${r.json && r.json.today})`);
  r = await inst.api('GET', `/api/kb/my-day?today=${utc}`, { token: A });
  expect(r.status === 200 && r.json.today === utc && kbelik(r.json, 'TERMIN-UTC-DNES') === 'today', 'explicitní today klienta má dál přednost');
}, { nazev: 'MŮJ DEN DEN INSTANCE' });
