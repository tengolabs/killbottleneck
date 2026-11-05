// Oznámení „nová verze“ přežije úklid notifikací (S7-01, 3. kolo analýzy, 4. 11. 2026).
//
// Jedinou závorou oznamNovouVerzi je řádek `notifications.dedup_key = "verze:<v>"`. Cron
// prune_notifications maže přečtené starší 30 dní a cokoli staršího 180 dní — do 4. 11. 2026
// i tyhle řádky, takže na instanci, která měsíc neaktualizovala, přišlo všem „Nová verze …“
// znovu (a po dalším přečtení + 30 dnech zase). Sada: oznámení se „zestárne“ přímo v DB
// (jako hlaseni-chyby.js: kontejner stojí, python3 + sqlite nad kopií data.db), spustí se
// prune a nova_verze (PB cron API) → žádné nové oznámení nevznikne.
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/nova-verze-prune.js
const { execSync } = require('child_process');
const fs = require('fs');
const H = require('./_harness');
const { expect, sleep } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'nova-verze-prune', env: { KB_VERSION: 'v0.98-beta', KB_UVODNI_MAPA: 0 } });
  await inst.register('a@example.com');
  await inst.register('b@example.com');
  const A = await inst.login('a@example.com');
  const B = await inst.login('b@example.com');
  const ST = await inst.superuser();
  const verze = async (token) => ((await inst.api('GET', '/api/collections/notifications/records?perPage=50&filter=type%3D%27new_version%27', { token })).json.items || []);
  const spustCron = async (id) => (await inst.api('POST', `/api/crons/${id}`, { token: ST })).status;

  console.log('== oznámení přišlo (bootstrap/cron) ==');
  await spustCron('nova_verze');
  await sleep(1500);
  const a1 = await verze(A), b1 = await verze(B);
  expect(a1.length === 1 && b1.length === 1, `oba účty mají právě jedno oznámení v0.98-beta (${a1.length}, ${b1.length})`);
  if (!a1.length || !b1.length) return;
  const precteno = await inst.api('PATCH', `/api/collections/notifications/records/${a1[0].id}`, { token: A, body: { read: true } });
  expect(precteno.status === 200 && precteno.json.read === true, 'a@ si oznámení přečetl');

  console.log('== zestárnutí: a@ přečtené −40 dní, b@ nepřečtené −200 dní ==');
  inst.pause();
  const tmp = `/tmp/kb-prune-${process.pid}.db`;
  const skript = `/tmp/kb-prune-${process.pid}.py`;
  execSync(`docker cp ${inst.name}:/app/pb_data/data.db ${tmp}`, { stdio: 'ignore' });
  fs.writeFileSync(skript, [
    'import sqlite3, sys',
    'c = sqlite3.connect(sys.argv[1])',
    `c.execute("UPDATE notifications SET created = datetime('now','-40 days') WHERE id = ?", ("${a1[0].id}",))`,
    `c.execute("UPDATE notifications SET created = datetime('now','-200 days') WHERE id = ?", ("${b1[0].id}",))`,
    'c.commit(); c.close()',
  ].join('\n'));
  execSync(`python3 ${skript} ${tmp}`, { stdio: 'ignore' });
  execSync(`docker cp ${tmp} ${inst.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
  fs.rmSync(skript, { force: true }); fs.rmSync(tmp, { force: true });
  await inst.resume();
  const ST2 = await inst.superuser();
  const stare = (await inst.api('GET', '/api/collections/notifications/records?perPage=50&filter=type%3D%27new_version%27', { token: ST2 })).json.items || [];
  expect(stare.length === 2 && stare.every((n) => new Date(n.created).getTime() < Date.now() - 39 * 86400000), `obě oznámení jsou v DB stará (${stare.map((n) => n.created).join(', ')})`);

  console.log('== prune + nova_verze: nic nového nesmí vzniknout ==');
  const s1 = (await inst.api('POST', '/api/crons/prune_notifications', { token: ST2 })).status;
  expect(s1 === 204 || s1 === 200, `prune_notifications spuštěn (${s1})`);
  await sleep(1000);
  const poPrune = await inst.api('GET', '/api/collections/notifications/records?perPage=50&filter=type%3D%27new_version%27', { token: ST2 });
  expect((poPrune.json.items || []).length === 2, `úklid řádky o verzi NESMAZAL (${(poPrune.json.items || []).length} zůstaly)`);
  const s2 = (await inst.api('POST', '/api/crons/nova_verze', { token: ST2 })).status;
  expect(s2 === 204 || s2 === 200, `nova_verze spuštěn (${s2})`);
  await sleep(1500);
  const a2 = await verze(A), b2 = await verze(B);
  expect(a2.length === 1 && b2.length === 1, `po úklidu žádné nové oznámení téže verze (a: ${a2.length}, b: ${b2.length})`);
  expect(a2.length && a2[0].id === a1[0].id && a2[0].read === true, 'a@ má pořád TEN SAMÝ (přečtený) řádek, ne čerstvý nepřečtený');
  expect(b2.length && b2[0].id === b1[0].id, 'b@ má pořád TEN SAMÝ řádek (180denní úklid ho nechal)');

  console.log('== ostatní notifikace úklid dál maže ==');
  // kontrolní vzorek: obyčejná přečtená notifikace starší 30 dní zmizí (úklid není vypnutý, jen šetří verze:)
  const nova = await inst.api('POST', '/api/collections/notifications/records', { token: ST2, body: { user: (await inst.api('GET', '/api/collections/users/records?filter=email%3D%27a%40example.com%27', { token: ST2 })).json.items[0].id, type: 'map_shared', text: 'stará', read: true, dedup_key: 'test:stara' } });
  expect(nova.status === 200, `kontrolní notifikace založena (${nova.status})`);
  if (nova.status === 200) {
    inst.pause();
    execSync(`docker cp ${inst.name}:/app/pb_data/data.db ${tmp}`, { stdio: 'ignore' });
    fs.writeFileSync(skript, ['import sqlite3, sys', 'c = sqlite3.connect(sys.argv[1])', `c.execute("UPDATE notifications SET created = datetime('now','-40 days') WHERE id = ?", ("${nova.json.id}",))`, 'c.commit(); c.close()'].join('\n'));
    execSync(`python3 ${skript} ${tmp}`, { stdio: 'ignore' });
    execSync(`docker cp ${tmp} ${inst.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
    fs.rmSync(skript, { force: true }); fs.rmSync(tmp, { force: true });
    await inst.resume();
    const ST3 = await inst.superuser();
    await inst.api('POST', '/api/crons/prune_notifications', { token: ST3 });
    await sleep(1000);
    const zbyla = await inst.api('GET', `/api/collections/notifications/records/${nova.json.id}`, { token: ST3 });
    expect(zbyla.status === 404, `stará přečtená notifikace jiného typu zmizela (${zbyla.status})`);
    expect((await verze(A)).length === 1, 'a verze: řádek zůstal i po druhém úklidu');
  }
}, { nazev: 'NOVÁ VERZE × PRUNE' });
