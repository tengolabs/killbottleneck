// API e2e — a finished time entry cannot be "finished" again (code analysis 4, finding F6-04).
//
// A tab that did not learn its timer was closed elsewhere (a new timer started in another tab
// or on the phone closes the old one; the 12 h auto-stop) kept ticking, and its Stop sent
// `ended = now` for the CLOSED entry. The server accepted it and recomputed the length, so the
// same time was counted twice. The end of an entry is now written once:
//   • a later end, an earlier end and re-opening (ended = '') of a finished entry → 409, nothing changes
//   • exception: an entry closed by the 12 h auto-stop may have its end moved EARLIER by its owner
//   • project / note of a finished entry stay editable (that is all the time overview edits)
//   • stopping a RUNNING entry, manual entries and re-sending the same end still work
// The browser side (two real tabs) is in ui-chyby4-ruzne.js.
const H = require('./_harness');
const { expect } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'stopky2', env: { KB_UVODNI_MAPA: 0 } });
  const reg = async (email, extra) => { const r = await inst.register(email, extra || {}); if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`); return { id: r.json.id, token: await inst.login(email) }; };
  const A = await reg('a@stopky.cz');
  const E = await reg('en@stopky.cz', { language: 'en' });
  const col = '/api/collections/time_entries/records';
  const zaznam = async (kdo, id) => (await inst.api('GET', `${col}/${id}`, { token: kdo.token })).json;
  const iso = (ms) => new Date(ms).toISOString();
  const cas = (s) => new Date(String(s).replace(' ', 'T')).getTime();
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A.token, body: { title: 'Stopky', owner: A.id, nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Stopky', title: 'Stopky', status: 'todo' } }], edges: [] } })).json;

  console.log('== nový start zavře běžící záznam; pozdější Stop ze staré karty ho už nepřepíše ==');
  const t0 = Date.now();
  let r = await inst.api('POST', col, { token: A.token, body: { started: iso(t0 - 30 * 60000), ended: '', label: 'Prvni' } });
  expect(r.status === 200 && !r.json.ended, `první měření běží (${r.status})`);
  const PRVNI = r.json.id;
  r = await inst.api('POST', col, { token: A.token, body: { started: iso(t0 - 1000), ended: '', label: 'Druhe' } });
  expect(r.status === 200, `druhé měření spuštěno (${r.status})`);
  const DRUHE = r.json.id;
  const zavreny = await zaznam(A, PRVNI);
  expect(!!zavreny.ended && zavreny.duration_min >= 29 && zavreny.duration_min <= 31, `server první měření zavřel (${zavreny.duration_min} min)`);

  r = await inst.api('PATCH', `${col}/${PRVNI}`, { token: A.token, body: { ended: iso(t0 + 3 * 3600000) } });
  expect(r.status === 409, `Stop ze staré karty (pozdější konec) na zavřený záznam → 409 (${r.status})`);
  expect(/už bylo ukončeno jinde/.test((r.json || {}).message || ''), `odpověď říká česky proč („${(r.json || {}).message}")`);
  let po = await zaznam(A, PRVNI);
  expect(po.ended === zavreny.ended && po.duration_min === zavreny.duration_min, `konec ani délka se nezměnily (${po.duration_min} min, konec ${po.ended})`);

  r = await inst.api('PATCH', `${col}/${PRVNI}`, { token: A.token, body: { ended: iso(t0 - 20 * 60000), note: 'zkraceni' } });
  expect(r.status === 409, `ani dřívější konec nejde (${r.status})`);
  r = await inst.api('PATCH', `${col}/${PRVNI}`, { token: A.token, body: { ended: '' } });
  expect(r.status === 409, `zavřený záznam nejde znovu rozběhnout (${r.status})`);
  po = await zaznam(A, PRVNI);
  expect(po.ended === zavreny.ended && po.duration_min === zavreny.duration_min && po.note !== 'zkraceni', 'po odmítnutých pokusech je záznam beze změny (ani poznámka z odmítnutého požadavku)');
  const bezi = ((await inst.api('GET', `${col}?filter=${encodeURIComponent("ended = ''")}`, { token: A.token })).json.items || []).map((x) => x.id);
  expect(bezi.length === 1 && bezi[0] === DRUHE, 'druhé měření běží dál, nic dalšího');

  console.log('== přiřazení a poznámka zavřeného záznamu jdou upravit dál (přehled času) ==');
  r = await inst.api('PATCH', `${col}/${PRVNI}`, { token: A.token, body: { map: mapa.id, note: 'doplneno' } });
  expect(r.status === 200 && r.json.map === mapa.id && r.json.note === 'doplneno', `projekt a poznámka zavřeného záznamu se uloží (${r.status})`);
  expect(r.json.ended === zavreny.ended && r.json.duration_min === zavreny.duration_min, 'konec a délka při tom zůstaly');
  r = await inst.api('PATCH', `${col}/${PRVNI}`, { token: A.token, body: { ended: zavreny.ended, label: 'Prvni prejmenovano' } });
  expect(r.status === 200 && r.json.label === 'Prvni prejmenovano', `požadavek, který posílá TÝŽ konec, projde (${r.status})`);

  console.log('== běžící měření jde zastavit jednou ==');
  const konec = iso(Date.now());
  r = await inst.api('PATCH', `${col}/${DRUHE}`, { token: A.token, body: { ended: konec } });
  expect(r.status === 200 && Math.abs(cas(r.json.ended) - cas(konec)) < 1000, `Stop běžícího měření projde (${r.status})`);
  r = await inst.api('PATCH', `${col}/${DRUHE}`, { token: A.token, body: { ended: iso(Date.now() + 3600000) } });
  expect(r.status === 409, `druhý Stop téhož měření pozdějším časem → 409 (${r.status})`);
  expect(Math.abs(cas((await zaznam(A, DRUHE)).ended) - cas(konec)) < 1000, 'konec zůstal z prvního Stop');

  console.log('== ruční záznam (od–do) a anglický účet ==');
  r = await inst.api('POST', col, { token: A.token, body: { started: iso(t0 - 5 * 3600000), ended: iso(t0 - 4 * 3600000), label: 'Rucni' } });
  expect(r.status === 200 && r.json.duration_min === 60, `ruční záznam od–do vznikne s dopočtenou délkou (${r.status}, ${r.json && r.json.duration_min} min)`);
  r = await inst.api('POST', col, { token: E.token, body: { started: iso(t0 - 10 * 60000), ended: iso(t0 - 5 * 60000), label: 'Manual' } });
  const EN = r.json.id;
  r = await inst.api('PATCH', `${col}/${EN}`, { token: E.token, body: { ended: iso(t0) } });
  expect(r.status === 409 && /already been stopped elsewhere/.test((r.json || {}).message || ''), `anglický účet dostane anglickou větu („${(r.json || {}).message}")`);
  expect((await zaznam(E, EN)).duration_min === 5, 'a záznam zůstal 5 min');

  console.log('== záznam zavřený pojistkou po 12 h: konec jde opravit dřív, později ne ==');
  // The notice of the 12 h auto-stop asks the owner to correct the entry (Richard's decision 14 Nov 2026):
  // the end may move earlier; a later end is still the Stop of a tab that kept ticking.
  const ST = await inst.superuser();
  const t1 = Date.now();
  r = await inst.api('POST', col, { token: E.token, body: { started: iso(t1 - 13 * 3600000), ended: '', label: 'Forgotten' } });
  const ZAP = r.json.id;
  r = await inst.api('POST', '/api/flowmap/run-auto-stop', { token: ST });
  let az = await zaznam(E, ZAP);
  expect(r.status === 200 && !!az.ended && az.duration_min === 720 && /auto-stop/.test(az.note || ''), `pojistka zapomenutý záznam zavřela na 12 h (${r.status}, ${az.duration_min} min)`);
  r = await inst.api('PATCH', `${col}/${ZAP}`, { token: E.token, body: { ended: iso(t1) } });
  expect(r.status === 409, `pozdější konec (Stop ze staré karty) → 409 (${r.status})`);
  r = await inst.api('PATCH', `${col}/${ZAP}`, { token: E.token, body: { ended: '' } });
  expect(r.status === 409, `znovu rozběhnout nejde (${r.status})`);
  r = await inst.api('PATCH', `${col}/${ZAP}`, { token: E.token, body: { ended: iso(t1 - 14 * 3600000) } });
  expect(r.status >= 400, `konec před začátkem nejde (${r.status})`);
  expect((await zaznam(E, ZAP)).duration_min === 720, 'po odmítnutých pokusech má záznam dál 720 min');
  r = await inst.api('PATCH', `${col}/${ZAP}`, { token: E.token, body: { ended: iso(t1 - 13 * 3600000 + 90 * 60000) } });
  az = await zaznam(E, ZAP);
  expect(r.status === 200 && az.duration_min === 90, `dřívější konec projde a délka se přepočítá (${r.status}, ${az.duration_min} min)`);
  r = await inst.api('PATCH', `${col}/${ZAP}`, { token: A.token, body: { ended: iso(t1 - 13 * 3600000 + 30 * 60000) } });
  expect(r.status >= 400 && (await zaznam(E, ZAP)).duration_min === 90, `cizí účet konec opravit nemůže (${r.status})`);
}, { nazev: 'STOPKY-DVOJI-STOP' });
