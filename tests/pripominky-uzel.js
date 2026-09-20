// PŘIPOMÍNKY K UZLŮM (node_reminders): per-user připomínka „den před termínem v 16:00"
// (Richard 18. 9. 2026), RELATIVNÍ k termínu — termín se NIKDY nemění, připomínka
// ho sleduje (po posunu termínu se přepočítá den, hook goalmaps).
//
// Co se hlídá: uzel bez termínu = 400, upsert (jedna na člověka a uzel), RLS
// (B nevidí A), minutový cron /run-reminders s podvrženým „teď" → notifikace
// typu reminder s map/node_id, dedup (2. běh = 0), posun termínu PATCHem mapy →
// nový den + starý čas nevystřelí, hotový uzel → připomínka smazána, připomínka
// do minulosti = 400, PB CRUD zamčený, termínový souhrn (deadline) a připomínka
// jsou dva typy — žádná duplicita.
//
// Mutační důkaz: na image z main kolekce node_reminders neexistuje → routa 404.
// Kontejner v TZ=Europe/Prague.
const H = require('./_harness');
const { expect } = H;

const den = (posun) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + posun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'pripominky', env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0, KB_TEST_CLOCK: 1 } });
  const ST = await inst.superuser();
  for (const e of ['a@e2e.cz', 'b@e2e.cz']) await inst.register(e);
  const A = await inst.login('a@e2e.cz');
  const B = await inst.login('b@e2e.cz');
  const notif = async (token, filtr) => (await inst.api('GET', `/api/collections/notifications/records?perPage=50&filter=${encodeURIComponent(filtr || 'id != ""')}`, { token })).json.items || [];

  const ZA3 = den(3), ZA2 = den(2), ZA5 = den(5), ZA4 = den(4), VCERA = den(-1);
  const nodes = [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kavárna', title: 'Kavárna', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Nabídka pro Nováka', status: 'todo', owner: 'a@e2e.cz', deadline: ZA3 } },
    { id: 'n2', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Bez termínu', status: 'todo', owner: 'a@e2e.cz' } },
    { id: 'n3', type: 'goalNode', position: { x: 0, y: 3 }, data: { title: 'Včerejší', status: 'todo', owner: 'a@e2e.cz', deadline: VCERA } },
  ];
  const edges = [1, 2, 3].map((i) => ({ id: `e${i}`, source: 'root', target: `n${i}` }));
  let r = await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Kavárna', nodes, edges } });
  expect(r.status === 200, 'mapa založena');
  const map = r.json;

  console.log('== validace ==');
  r = await inst.api('POST', '/api/collections/node_reminders/records', { token: A, body: { map: map.id, node_id: 'n1', time: '09:00' } });
  expect(r.status === 400 || r.status === 403, `PB CRUD create je zamčený (${r.status})`);
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n2', offset_days: 0, time: '09:00' } });
  expect(r.status === 400 && /termín|deadline/i.test(r.json.error), `uzel bez termínu = 400 (${r.json && r.json.error})`);
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n1', offset_days: 1, time: '9:00' } });
  expect(r.status === 400 && /HH:MM/.test(r.json.error), 'čas 9:00 (bez nuly) = 400');
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n1', offset_days: 40, time: '09:00' } });
  expect(r.status === 400, 'offset 40 dní = 400');
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n3', offset_days: 0, time: '09:00' } });
  expect(r.status === 400 && /pryč|passed/i.test(r.json.error), `připomínka do minulosti = 400 (${r.json && r.json.error})`);
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'neni', offset_days: 0, time: '09:00' } });
  expect(r.status === 404, 'neexistující uzel = 404');
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: B, body: { map: map.id, node_id: 'n1', offset_days: 0, time: '09:00' } });
  expect(r.status === 404, 'cizí mapa (B nevidí) = 404');

  console.log('== založení: den před termínem v 16:00 ==');
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n1', offset_days: 1, time: '16:00' } });
  expect(r.status === 200 && r.json.reminder && r.json.reminder.day === ZA2, `den = termín − 1 = ${ZA2} (${r.status}, ${r.json && JSON.stringify(r.json.reminder)})`);
  expect(r.json.node_title === 'Nabídka pro Nováka' && r.json.deadline === ZA3, 'odpověď nese název uzlu a termín');
  const rid = r.json.reminder.id;
  // upsert: druhé uložení mění čas, nezakládá druhý záznam
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n1', offset_days: 1, time: '15:00' } });
  expect(r.status === 200 && r.json.reminder.id === rid && r.json.reminder.time === '15:00', 'upsert: stejný záznam, nový čas');
  let seznam = (await inst.api('GET', `/api/kb/node-reminders?map=${map.id}`, { token: A })).json.reminders;
  expect(seznam.length === 1, 'jedna připomínka na uzel');
  expect(((await inst.api('GET', '/api/collections/node_reminders/records', { token: B })).json.items || []).length === 0, 'RLS: B připomínku A nevidí');
  expect(((await inst.api('GET', '/api/collections/node_reminders/records', { token: A })).json.items || []).length === 1, 'RLS: A svou připomínku vidí (pro ikonu v kalendáři)');

  console.log('== cron ==');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA2 + ' 14:59' } });
  expect(r.json.sent === 0, 'před časem nic');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA2 + ' 15:00' } });
  expect(r.json.sent === 1, `v 15:00 odesláno 1 (${r.json.sent})`);
  let rem = await notif(A, 'type = "reminder"');
  expect(rem.length === 1 && rem[0].map === map.id && rem[0].node_id === 'n1' && /Nabídka pro Nováka/.test(rem[0].text) && rem[0].text.indexOf(ZA3) >= 0,
    `reminder s map/node_id, názvem a termínem (${rem[0] && rem[0].text})`);
  expect((await notif(B, 'type = "reminder"')).length === 0, 'B nic');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA2 + ' 15:01' } });
  expect(r.json.sent === 0, 'druhý běh = 0 (fired_at)');
  seznam = (await inst.api('GET', `/api/kb/node-reminders?map=${map.id}`, { token: A })).json.reminders;
  expect(seznam[0].fired === true, 'DTO říká fired');

  console.log('== posun termínu PATCHem mapy → připomínka sleduje termín ==');
  const nodes2 = JSON.parse(JSON.stringify(nodes));
  nodes2[1].data.deadline = ZA5;
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: { nodes: nodes2 } });
  expect(r.status === 200, 'termín posunut na +5');
  seznam = (await inst.api('GET', `/api/kb/node-reminders?map=${map.id}`, { token: A })).json.reminders;
  expect(seznam.length === 1 && seznam[0].day === ZA4 && seznam[0].fired === false, `den přepočten na ${ZA4} a připomínka znovu platí (${JSON.stringify(seznam[0])})`);
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA2 + ' 15:00' } });
  expect(r.json.sent === 0, 'starý čas už nestřílí');
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA4 + ' 15:00' } });
  expect(r.json.sent === 1, 'nový čas ano');
  expect((await notif(A, 'type = "reminder"')).length === 2, 'dvě různé připomínky (dva termíny)');

  console.log('== termínový souhrn a připomínka = dva typy ==');
  r = await inst.api('POST', '/api/kb/run-deadline-notices', { token: ST });
  const dl = await notif(A, 'type = "deadline"');
  expect(dl.length >= 1, 'souhrn deadline (včerejší uzel) přišel zvlášť');
  expect((await notif(A, 'type = "reminder"')).length === 2, 'připomínek stále 2 — souhrn je nezdvojil');

  console.log('== odsdílení mapy → připomínka spolupracovníka končí (nesmí dál vynášet termíny) ==');
  r = await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'share', mapId: map.id, email: 'b@e2e.cz', permission: 'read' } });
  expect(r.status === 200, 'mapa sdílena B ke čtení');
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: B, body: { map: map.id, node_id: 'n1', offset_days: 0, time: '10:00' } });
  expect(r.status === 200, 'B si nastavil připomínku na sdílený uzel');
  r = await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'unshare', mapId: map.id, memberEmail: 'b@e2e.cz' } });
  expect(r.status === 200, `sdílení B odebráno (${r.status})`);
  r = await inst.api('POST', '/api/kb/run-reminders', { token: ST, body: { at: ZA5 + ' 10:00' } });
  expect((await notif(B, 'type = "reminder"')).length === 0, 'B po odsdílení připomínku NEDOSTAL');
  expect(((await inst.api('GET', '/api/collections/node_reminders/records', { token: B })).json.items || []).length === 0, 'a jeho připomínka byla smazána');
  const nodesX = JSON.parse(JSON.stringify(nodes2)); nodesX[1].data.deadline = ZA5;
  r = await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'share', mapId: map.id, email: 'b@e2e.cz', permission: 'read' } });
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: B, body: { map: map.id, node_id: 'n1', offset_days: 0, time: '11:00' } });
  await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'unshare', mapId: map.id, memberEmail: 'b@e2e.cz' } });
  await inst.api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: { nodes: nodesX } });
  expect(((await inst.api('GET', '/api/collections/node_reminders/records', { token: B })).json.items || []).length === 0, 'i přepočet po uložení mapy připomínku bez přístupu smaže');

  console.log('== hotový uzel → připomínka pryč; na hotový uzel nejde založit; smazání ==');
  const nodes3 = JSON.parse(JSON.stringify(nodes2));
  nodes3[1].data.status = 'done';
  await inst.api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: { nodes: nodes3 } });
  seznam = (await inst.api('GET', `/api/kb/node-reminders?map=${map.id}`, { token: A })).json.reminders;
  expect(seznam.length === 0, 'po dokončení uzlu připomínka smazána');
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n1', offset_days: 0, time: '08:00' } });
  expect(r.status === 400 && /hotov|done/i.test(r.json.error), 'připomínka na hotový uzel = 400 (cron by ji tiše smazal)');
  nodes3[1].data.status = 'todo';
  await inst.api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: { nodes: nodes3 } });
  r = await inst.api('POST', '/api/kb/node-reminders/save', { token: A, body: { map: map.id, node_id: 'n1', offset_days: 0, time: '08:00' } });
  expect(r.status === 200 && r.json.reminder.day === ZA5, 'nová připomínka v den termínu');
  r = await inst.api('POST', '/api/kb/node-reminders/delete', { token: B, body: { id: r.json.reminder.id } });
  expect(r.status === 404, 'cizí smazat = 404');
  r = await inst.api('POST', '/api/kb/node-reminders/delete', { token: A, body: { id: (await inst.api('GET', `/api/kb/node-reminders?map=${map.id}`, { token: A })).json.reminders[0].id } });
  expect(r.status === 200, 'vlastník smazal');
  expect((await inst.api('GET', `/api/kb/node-reminders?map=${map.id}`, { token: A })).json.reminders.length === 0, 'seznam prázdný');

  inst.stop();
}, { nazev: 'PRIPOMINKY-UZEL' });
