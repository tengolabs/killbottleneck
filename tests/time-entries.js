// Měření času (time_entries) + číselník klientů — hooky, RLS, jediný běžící timer.
// Čerstvý kontejner na :20495. Ověřuje:
//  - start timeru bez started → server doplní; druhý start AUTOMATICKY zavře první
//    (jeden běžící záznam na uživatele) a dopočítá duration;
//  - duration_min počítá výhradně server (podvržená hodnota se přepíše);
//  - ended < started → 400; owner pole nejdou přepsat;
//  - client se dědí z mapy (denormalizace při create);
//  - goalmaps.client smí měnit jen vlastník mapy (sdílený editor ne);
//  - RLS: cizí záznamy času nevidět/needitovat; klienty čte každý přihlášený,
//    upravuje autor nebo admin (první registrovaný = admin).
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20495';
const NAME = 'flowmap-e2e-time';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -p 20495:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    // A = první registrovaný (admin), B = běžný user
    await api('POST', '/api/collections/users/records', { body: { email: 'a@e2e.local', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/users/records', { body: { email: 'b@e2e.local', password: PW, passwordConfirm: PW } });
    const authA = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@e2e.local', password: PW } })).json;
    const authB = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'b@e2e.local', password: PW } })).json;
    const AT = authA.token, BT = authB.token;

    console.log('== klienti ==');
    const c1 = (await api('POST', '/api/collections/clients/records', { token: AT, body: { name: 'ACME s.r.o.', color: '#f59e0b' } })).json;
    expect(!!c1.id, `A (admin) založil klienta (${c1.id})`);
    const c2 = (await api('POST', '/api/collections/clients/records', { token: BT, body: { name: 'Bclient' } })).json;
    expect(!!c2.id, `B (user) založil klienta (${c2.id})`);
    const listB = (await api('GET', '/api/collections/clients/records', { token: BT })).json;
    expect(listB.items?.length === 2, `klienty vidí každý přihlášený (B vidí ${listB.items?.length})`);
    const guestList = await api('GET', '/api/collections/clients/records', {});
    expect((guestList.json.items || []).length === 0 || guestList.status >= 400, `host klienty nevidí`);
    expect(c2.owner === authB.record.id && c2.owner_email === 'b@e2e.local', `owner klienta doplní server z přihlášení (${c2.owner === authB.record.id})`);
    const cSpoof = (await api('POST', '/api/collections/clients/records', { token: BT, body: { name: 'Spoof', owner: authA.record.id, owner_email: 'a@e2e.local' } })).json;
    expect(cSpoof.owner === authB.record.id, `podvržený owner klienta server přepsal (${cSpoof.owner === authB.record.id})`);
    const updOwn = await api('PATCH', `/api/collections/clients/records/${c2.id}`, { token: BT, body: { note: 'můj klient' } });
    expect(updOwn.status === 200, `autor smí upravit vlastního klienta (dostal ${updOwn.status})`);
    const updForeign = await api('PATCH', `/api/collections/clients/records/${c1.id}`, { token: BT, body: { name: 'hack' } });
    expect(updForeign.status >= 400, `B nesmí upravit cizího klienta (dostal ${updForeign.status})`);
    const updAdmin = await api('PATCH', `/api/collections/clients/records/${c2.id}`, { token: AT, body: { name: 'Bclient (admin edit)' } });
    expect(updAdmin.status === 200, `admin smí upravit cizího klienta (dostal ${updAdmin.status})`);

    console.log('== goalmaps.client — jen vlastník ==');
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: AT, body: {
      title: 'Projekt ACME', client: c1.id, edges: [],
      nodes: [{ id: 'node-123', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'Uzel ACME', status: 'todo' } }],
    } })).json;
    expect(map.client === c1.id, `vlastník založil mapu s klientem (${map.client})`);
    await api('POST', '/api/flowmap/share', { token: AT, body: { action: 'share', mapId: map.id, email: 'b@e2e.local', permission: 'edit' } });
    const bEdit = await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: BT, body: { title: 'Projekt ACME (B)', client: c2.id } });
    expect(bEdit.status === 200 && bEdit.json.client === c1.id, `sdílený editor mapu upraví, ale klienta NEZMĚNÍ (client=${bEdit.json?.client})`);
    const aEdit = await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: AT, body: { client: c2.id } });
    expect(aEdit.status === 200 && aEdit.json.client === c2.id, `vlastník klienta změní (client=${aEdit.json?.client})`);
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: AT, body: { client: c1.id } }); // vrátit

    console.log('== timer: jeden běžící záznam ==');
    const t1 = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { ended: '', label: 'první' } })).json;
    expect(!!t1.id && !!t1.started && t1.ended === '', `start bez started → server doplnil (${t1.started})`);
    await sleep(1100);
    const t2 = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { ended: '', label: 'druhý' } })).json;
    expect(!!t2.id && t2.ended === '', `druhý timer běží (${t2.id})`);
    const t1after = (await api('GET', `/api/collections/time_entries/records/${t1.id}`, { token: AT })).json;
    expect(t1after.ended !== '', `první timer se startem druhého automaticky zavřel (ended=${t1after.ended})`);
    const runningA = (await api('GET', `/api/collections/time_entries/records?filter=${encodeURIComponent("ended = ''")}`, { token: AT })).json;
    expect(runningA.items?.length === 1, `běží právě jeden záznam (${runningA.items?.length})`);

    console.log('== duration počítá server ==');
    const stopped = (await api('PATCH', `/api/collections/time_entries/records/${t2.id}`, { token: AT, body: { ended: new Date().toISOString(), duration_min: 9999, note: 'hotovo' } })).json;
    expect(stopped.duration_min < 9999, `podvržené duration_min server přepsal (${stopped.duration_min})`);
    const manual = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { started: '2026-07-20T10:00:00.000Z', ended: '2026-07-20T11:30:00.000Z', note: 'ruční zápis' } })).json;
    expect(manual.duration_min === 90, `ruční zápis 1,5 h → duration 90 (${manual.duration_min})`);
    const badRange = await api('POST', '/api/collections/time_entries/records', { token: AT, body: { started: '2026-07-20T11:00:00.000Z', ended: '2026-07-20T10:00:00.000Z' } });
    expect(badRange.status === 400, `ended < started → 400 (dostal ${badRange.status})`);
    const ownerSpoof = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { started: '2026-07-20T08:00:00.000Z', ended: '2026-07-20T08:30:00.000Z', owner: authB.record.id, owner_email: 'b@e2e.local' } })).json;
    expect(ownerSpoof.owner === authA.record.id, `owner nejde podvrhnout (${ownerSpoof.owner === authA.record.id})`);

    console.log('== dědění klienta z mapy ==');
    const inherited = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { started: '2026-07-20T12:00:00.000Z', ended: '2026-07-20T12:30:00.000Z', map: map.id } })).json;
    expect(inherited.client === c1.id, `záznam na mapě zdědil klienta mapy (${inherited.client === c1.id})`);

    console.log('== server validuje přiřazení mapy (viditelnost + node_id) ==');
    const privMap = (await api('POST', '/api/collections/goalmaps/records', { token: AT, body: { title: 'Privátní A', nodes: [], edges: [] } })).json;
    const bForeign = await api('POST', '/api/collections/time_entries/records', { token: BT, body: { started: '2026-07-20T09:00:00.000Z', ended: '2026-07-20T09:30:00.000Z', map: privMap.id } });
    expect(bForeign.status === 400, `záznam nejde přiřadit k cizí neviditelné mapě (dostal ${bForeign.status})`);
    const badNode = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { started: '2026-07-20T09:00:00.000Z', ended: '2026-07-20T09:30:00.000Z', map: map.id, node_id: 'neexistujici-uzel' } })).json;
    expect(badNode.node_id === '', `node_id mimo mapu server vyčistí („${badNode.node_id}")`);

    console.log('== node_id + inbox do zásobníku ==');
    const nodeEntry = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { started: '2026-07-20T13:00:00.000Z', ended: '2026-07-20T13:20:00.000Z', map: map.id, node_id: 'node-123' } })).json;
    expect(nodeEntry.node_id === 'node-123', `záznam jde přiřadit k uzlu (${nodeEntry.node_id})`);
    // stop nepřiřazeného měření S poznámkou → nápad do zásobníku
    const t3 = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { ended: '', label: 'telefonát' } })).json;
    await sleep(1100);
    await api('PATCH', `/api/collections/time_entries/records/${t3.id}`, { token: AT, body: { ended: new Date().toISOString(), note: 'Telefonní hovor s Novákem' } });
    const ideas1 = (await api('GET', `/api/collections/buffer_nodes/records?filter=${encodeURIComponent("title ~ 'Telefonní hovor'")}`, { token: AT })).json;
    expect(ideas1.items?.length === 1 && ideas1.items[0].description.includes('Měřeno'), `nepřiřazené+poznámka → nápad v zásobníku („${ideas1.items?.[0]?.description}")`);
    // stop PŘIŘAZENÉHO měření s poznámkou → nápad NEvzniká
    const t4 = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { ended: '', map: map.id, label: 'práce na mapě' } })).json;
    await api('PATCH', `/api/collections/time_entries/records/${t4.id}`, { token: AT, body: { ended: new Date().toISOString(), note: 'Přiřazená práce' } });
    const ideas2 = (await api('GET', `/api/collections/buffer_nodes/records?filter=${encodeURIComponent("title ~ 'Přiřazená práce'")}`, { token: AT })).json;
    expect((ideas2.items || []).length === 0, `přiřazené měření nápad nezakládá (${(ideas2.items || []).length})`);
    // stop bez poznámky → nápad NEvzniká
    const before = (await api('GET', '/api/collections/buffer_nodes/records', { token: AT })).json.totalItems;
    const t5 = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { ended: '' } })).json;
    await api('PATCH', `/api/collections/time_entries/records/${t5.id}`, { token: AT, body: { ended: new Date().toISOString() } });
    const after = (await api('GET', '/api/collections/buffer_nodes/records', { token: AT })).json.totalItems;
    expect(after === before, `bez poznámky nápad nevzniká (${before}→${after})`);

    console.log('== auto-stop zapomenutých stopek ==');
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local superheslo123`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'superheslo123' } })).json.token;
    const stale = (await api('POST', '/api/collections/time_entries/records', { token: AT, body: { started: new Date(Date.now() - 13 * 3600000).toISOString(), ended: '', label: 'zapomenuté stopky' } })).json;
    expect(!!stale.id && stale.ended === '', `běžící záznam starý 13 h založen (${stale.id})`);
    const rAuto = await api('POST', '/api/flowmap/run-auto-stop', { token: ST });
    expect(rAuto.status === 200 && rAuto.json.stopped === 1, `auto-stop zavřel právě 1 záznam (dostal ${JSON.stringify(rAuto.json)})`);
    const staleAfter = (await api('GET', `/api/collections/time_entries/records/${stale.id}`, { token: AT })).json;
    expect(staleAfter.duration_min === 720 && staleAfter.note.includes('auto-stop'), `zavřen na 720 min + poznámka (${staleAfter.duration_min}, „${staleAfter.note}")`);
    const rAuto2 = await api('POST', '/api/flowmap/run-auto-stop', { token: ST });
    expect(rAuto2.json.stopped === 0, `druhý běh nic nezavírá (${rAuto2.json.stopped})`);
    const ideasAuto = (await api('GET', `/api/collections/buffer_nodes/records?filter=${encodeURIComponent("title ~ 'zapomenuté stopky'")}`, { token: AT })).json;
    expect((ideasAuto.items || []).length === 0, `auto-stop nápad do zásobníku NEzakládá (${(ideasAuto.items || []).length})`);
    const notifsA = (await api('GET', `/api/collections/notifications/records?filter=${encodeURIComponent("type = 'timer_autostop'")}`, { token: AT })).json;
    expect(notifsA.items?.length === 1, `vlastníkovi přišla notifikace timer_autostop (${notifsA.items?.length})`);
    const rAutoGuest = await api('POST', '/api/flowmap/run-auto-stop', {});
    expect(rAutoGuest.status === 404, `auto-stop routa bez superusera = 404 (${rAutoGuest.status})`);

    console.log('== RLS time_entries ==');
    const listBT = (await api('GET', '/api/collections/time_entries/records', { token: BT })).json;
    expect(listBT.items?.length === 0, `B nevidí cizí záznamy času (${listBT.items?.length})`);
    const stealB = await api('GET', `/api/collections/time_entries/records/${manual.id}`, { token: BT });
    expect(stealB.status === 404, `B nepřečte cizí záznam přes id (${stealB.status})`);
    const patchB = await api('PATCH', `/api/collections/time_entries/records/${manual.id}`, { token: BT, body: { note: 'hack' } });
    expect(patchB.status === 404, `B needituje cizí záznam (${patchB.status})`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }

  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
