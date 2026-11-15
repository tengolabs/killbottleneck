// An administrator must not see or take over a PRIVATE project of another person
// (decision 11 Nov 2026; findings S4-01 / S3-02 of code analysis 4).
//
// What is measured:
//   • GET /users/{id}/maps lists by title only the projects the administrator already has
//     access to (team access / named share); private ones are a number, never a title or id;
//   • POST /maps/{id}/transfer by an administrator on a private project = 404 (as if it did
//     not exist) and nothing changes; on a project the administrator can see it works;
//   • the owner can still hand over their own (even private) project;
//   • every transfer leaves a row in the project's change log and — when somebody else than
//     the owner did it — a notification to the previous owner (in their language);
//   • POST /users/{id}/transfer-maps on a LIVING account moves only the visible projects,
//     keeps the previous owner as a co-admin and never touches the private ones;
//   • GET /users/map-counts gives the administrator one number per account (F4-06);
//   • DELETING the member hands the projects shared with other people to their co-admin —
//     the administrator still neither sees nor gets them — and the private ones go.
const H = require('./_harness');
const { expect } = H;

const telo = (title) => ({
  title,
  nodes: [
    { id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'TAJNY-CIL ' + title, title: '', status: 'todo' } },
    { id: 'a', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'TAJNY-KROK ' + title, status: 'todo', nodeType: 'normal' } },
  ],
  edges: [{ id: 'ea', source: 'R', target: 'a' }],
});

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'admsoukr', env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  const ucet = async (email, extra) => {
    const r = await inst.register(email, extra || {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    const token = await inst.login(email);
    // entering the app writes users.last_login; an account that has never signed in cannot become a co-admin owner
    await inst.api('POST', '/api/collections/loginlogs/records', { token, body: {} });
    return { id: r.json.id, email, token };
  };
  const admin = await ucet('admin@as.cz');           // first account = administrator
  const clen = await ucet('clen@as.cz');
  const kolega = await ucet('kolega@as.cz');
  const anglican = await ucet('en@as.cz', { language: 'en' });
  const mapa = async (kdo, title) => {
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body: Object.assign(telo(title), { owner: kdo.id, owner_email: kdo.email }) });
    if (r.status !== 200) throw new Error(`mapa ${title}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const share = (kdo, body) => inst.api('POST', '/api/kb/share', { token: kdo.token, body });
  const get = (kdo, id) => inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: kdo.token });
  const zmeny = async (id) => (await inst.api('GET', `/api/collections/map_changes/records?perPage=50&filter=${encodeURIComponent(`map="${id}" && field="owner" && item_id="${id}"`)}`, { token: ST })).json.items || [];
  const zvonecek = async (kdo) => (await inst.api('GET', `/api/collections/notifications/records?perPage=50&sort=-created&filter=${encodeURIComponent(`user="${kdo.id}"`)}`, { token: ST })).json.items || [];

  const P = await mapa(clen, 'SOUKROMA');
  const P2 = await mapa(clen, 'SOUKROMA-DVA');
  const T = await mapa(clen, 'TYMOVA');
  const S = await mapa(clen, 'SDILENA-S-ADMINEM');
  const K = await mapa(clen, 'SDILENA-S-KOLEGOU');
  let r = await share(clen, { action: 'set_team_access', mapId: T.id, access: 'read' });
  expect(r.status === 200, `předpoklad: týmový přístup nastaven (${r.status})`);
  r = await share(clen, { action: 'share', mapId: S.id, email: admin.email, permission: 'read' });
  expect(r.status === 200, `předpoklad: sdíleno s adminem ke čtení (${r.status})`);
  r = await share(clen, { action: 'share', mapId: K.id, email: kolega.email, permission: 'edit' });
  expect(r.status === 200, `předpoklad: sdíleno s kolegou (${r.status})`);

  console.log('== výpis projektů účtu: soukromé jen číslem ==');
  r = await inst.api('GET', `/api/kb/users/${clen.id}/maps`, { token: admin.token });
  const titulky = ((r.json || {}).maps || []).map((m) => m.title).sort();
  expect(r.status === 200 && r.json.count === 5, `count = všech 5 projektů účtu (${r.status} ${r.json && r.json.count})`);
  expect(JSON.stringify(titulky) === JSON.stringify(['SDILENA-S-ADMINEM', 'TYMOVA']), `názvem jen projekty, které admin vidí (${titulky.join(', ')})`);
  const surove = JSON.stringify(r.json);
  expect(!surove.includes('SOUKROMA') && !surove.includes(P.id) && !surove.includes(P2.id), 'soukromý projekt není v odpovědi názvem ani id');
  expect(!surove.includes('SDILENA-S-KOLEGOU') && !surove.includes(K.id), 'projekt sdílený jen s kolegou také ne');
  expect(r.json.private_count === 2 && r.json.hidden_shared_count === 1, `private_count 2, hidden_shared_count 1 (${r.json.private_count}, ${r.json.hidden_shared_count})`);
  r = await inst.api('GET', `/api/kb/users/${clen.id}/maps`, { token: kolega.token });
  expect(r.status === 403, `výpis jen administrátor (${r.status})`);

  console.log('== převzetí soukromého projektu administrátorem ==');
  r = await inst.api('POST', `/api/kb/maps/${P.id}/transfer`, { token: admin.token, body: { email: admin.email } });
  expect(r.status === 404, `admin soukromý projekt nepřevezme → 404 (${r.status})`);
  r = await inst.api('POST', `/api/kb/maps/${P.id}/transfer`, { token: admin.token, body: { email: kolega.email } });
  expect(r.status === 404, `ani ho nepředá někomu jinému (${r.status})`);
  r = await inst.api('POST', `/api/kb/maps/${K.id}/transfer`, { token: admin.token, body: { email: admin.email } });
  expect(r.status === 404, `projekt sdílený jen s kolegou admin také nepřevezme (${r.status})`);
  expect((await get(admin, P.id)).status === 404, 'admin soukromý projekt dál nevidí');
  const pPo = (await get(clen, P.id)).json;
  expect(pPo.owner === clen.id && pPo.owner_email === clen.email, 'soukromý projekt má dál svého vlastníka');
  expect((await zvonecek(clen)).length === 0 && (await zmeny(P.id)).length === 0, 'neúspěšný pokus nic nezapsal');

  console.log('== převzetí projektu, který admin vidí: nahlas ==');
  r = await inst.api('POST', `/api/kb/maps/${S.id}/transfer`, { token: admin.token, body: { email: admin.email } });
  expect(r.status === 200 && r.json.owner_email === admin.email, `sdílený projekt admin převzít smí (${r.status})`);
  let zm = await zmeny(S.id);
  expect(zm.length === 1 && zm[0].from === clen.email && zm[0].to === admin.email && zm[0].actor_email === admin.email,
    `převod je v záznamu změn projektu (${zm.length}: ${zm[0] && zm[0].from} → ${zm[0] && zm[0].to}, provedl ${zm[0] && zm[0].actor_email})`);
  let zv = (await zvonecek(clen)).filter((n) => n.map === S.id);
  expect(zv.length === 1 && zv[0].type === 'org_notice' && /admin@as\.cz převedl váš projekt „SDILENA-S-ADMINEM"/.test(zv[0].text) && /spolusprávcem/.test(zv[0].text),
    `původní vlastník dostal oznámení (${zv.length}: ${zv[0] && zv[0].text})`);
  const sPo = (await get(clen, S.id));
  expect(sPo.status === 200 && (sPo.json.shared_with_edit || []).includes(clen.email), 'původní vlastník zůstal spolusprávcem');
  // the change log is readable through the app route as well ("owner changed" group)
  r = await inst.api('GET', `/api/kb/map-changes?map=${S.id}&range=all`, { token: admin.token });
  const skup = (((r.json || {}).groups || {}).owner || []).filter((x) => x.id === S.id);
  expect(r.status === 200 && skup.length === 1 && skup[0].to === admin.email, `routa /map-changes převod ukazuje ve skupině „owner" (${r.status}, ${skup.length})`);

  console.log('== vlastník svůj (i soukromý) projekt předat smí ==');
  r = await inst.api('POST', `/api/kb/maps/${P2.id}/transfer`, { token: clen.token, body: { email: kolega.email } });
  expect(r.status === 200 && r.json.owner_email === kolega.email, `vlastník předal soukromý projekt kolegovi (${r.status})`);
  zm = await zmeny(P2.id);
  expect(zm.length === 1 && zm[0].actor_email === clen.email && zm[0].to === kolega.email, `i převod vlastníkem je v záznamu změn (${zm.length})`);
  expect((await zvonecek(clen)).filter((n) => n.map === P2.id).length === 0, 'sám sobě vlastník oznámení neposílá');
  // PATCH of the owner field takes the same path
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${P2.id}`, { token: kolega.token, body: { owner: clen.id } });
  expect(r.status === 200, `PATCH owner vlastníkem (${r.status})`);
  zm = await zmeny(P2.id);
  expect(zm.length === 2 && zm.some((x) => x.from === kolega.email && x.to === clen.email), `i PATCH pole owner je v záznamu změn (${zm.length})`);
  zv = (await zvonecek(clen)).filter((n) => n.map === P2.id);
  expect(zv.length === 0, 'nový vlastník není „původní vlastník" — oznámení nedostal');

  console.log('== hromadné převzetí u ŽIVÉHO účtu ==');
  r = await inst.api('POST', `/api/kb/users/${clen.id}/transfer-maps`, { token: kolega.token, body: {} });
  expect(r.status === 403, `jen administrátor (${r.status})`);
  r = await inst.api('POST', `/api/kb/users/${clen.id}/transfer-maps`, { token: admin.token, body: {} });
  expect(r.status === 200 && r.json.transferred === 1 && r.json.skipped.length === 0, `převeden jen projekt, který admin vidí — týmový (${r.status} ${JSON.stringify(r.json)})`);
  // SOUKROMA-DVA went to the colleague and back, so the colleague stayed its co-admin → it now counts as "shared with others"
  expect(r.json.private_count === 1 && r.json.hidden_shared_count === 2, `ostatní zůstaly a hlásí se jen počtem: private_count 1, hidden_shared_count 2 (${r.json.private_count}, ${r.json.hidden_shared_count})`);
  const vlastni = (await inst.api('GET', `/api/collections/goalmaps/records?perPage=50&filter=${encodeURIComponent(`owner="${clen.id}"`)}`, { token: ST })).json.items.map((m) => m.title).sort();
  expect(JSON.stringify(vlastni) === JSON.stringify(['SDILENA-S-KOLEGOU', 'SOUKROMA', 'SOUKROMA-DVA']), `živý účet o soukromé projekty nepřišel (${vlastni.join(', ')})`);
  const tPo = await get(clen, T.id);
  expect(tPo.status === 200 && tPo.json.owner === admin.id && (tPo.json.shared_with_edit || []).includes(clen.email), 'převzatý projekt živý účet dál vidí jako spolusprávce');
  zv = (await zvonecek(clen)).filter((n) => n.map === T.id);
  expect(zv.length === 1 && /převedl váš projekt „TYMOVA"/.test(zv[0].text), `o hromadném převzetí dostal oznámení (${zv.length})`);
  expect((await zmeny(T.id)).length === 1, 'a převod je v záznamu změn');
  expect((await get(admin, P.id)).status === 404, 'soukromý projekt admin nevidí ani potom');

  console.log('== oznámení v jazyce příjemce ==');
  const E = await mapa(anglican, 'ENGLISH-TEAM');
  await share(anglican, { action: 'set_team_access', mapId: E.id, access: 'edit' });
  r = await inst.api('POST', `/api/kb/maps/${E.id}/transfer`, { token: admin.token, body: { email: admin.email } });
  zv = (await zvonecek(anglican)).filter((n) => n.map === E.id);
  expect(r.status === 200 && zv.length === 1 && /transferred your project "ENGLISH-TEAM" to a new owner/.test(zv[0].text), `anglický účet dostal anglický text (${zv[0] && zv[0].text})`);

  console.log('== počty projektů na účet (Správa uživatelů) ==');
  r = await inst.api('GET', '/api/kb/users/map-counts', { token: admin.token });
  expect(r.status === 200 && r.json.counts[clen.id] === 3 && r.json.counts[admin.id] === 3, `admin dostane počty: člen 3, admin 3 (${r.status} ${JSON.stringify(r.json && r.json.counts)})`);
  r = await inst.api('GET', `/api/kb/users/${clen.id}/maps`, { token: admin.token });
  expect(r.json.count === 3, `a souhlasí s výpisem účtu (${r.json.count})`);
  r = await inst.api('GET', '/api/kb/users/map-counts', { token: clen.token });
  expect(r.status === 403, `člen počty nedostane (${r.status})`);

  console.log('== smazání člena: sdílené jen s jinými přejdou na spolusprávce, admin je dál nevidí ==');
  // the member now owns: SOUKROMA (private), SDILENA-S-KOLEGOU and SOUKROMA-DVA (the colleague is a co-admin of both)
  r = await inst.api('GET', `/api/kb/users/${clen.id}/maps`, { token: admin.token });
  const sm = (r.json || {}).summary || {};
  expect(sm.maps_to_coadmin === 2 && sm.maps_to_admin === 0 && sm.maps_private === 1, `dialog předem: 2 na spolusprávce, 0 na mě, 1 soukromý zanikne (${JSON.stringify([sm.maps_to_coadmin, sm.maps_to_admin, sm.maps_private])})`);
  const s2 = JSON.stringify(r.json);
  expect(!s2.includes('SOUKROMA') && !s2.includes('SDILENA-S-KOLEGOU') && !s2.includes(K.id) && !s2.includes(P.id) && !s2.includes(kolega.email), 'souhrn nejmenuje projekty ani spolusprávce, které admin nevidí');
  r = await inst.api('DELETE', `/api/collections/users/records/${clen.id}`, { token: admin.token });
  expect(r.status === 204, `účet smazán (${r.status} ${JSON.stringify(r.json)})`);
  const su = async (id) => inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: ST });
  expect((await su(K.id)).json.owner === kolega.id && (await su(P2.id)).json.owner === kolega.id, 'oba projekty sdílené s kolegou-spolusprávcem jsou teď jeho');
  expect((await get(admin, K.id)).status === 404 && (await get(admin, P2.id)).status === 404, 'mazající admin je nevidí ani po smazání účtu');
  expect((await su(P.id)).status === 404, 'soukromý projekt zanikl s účtem');
  r = await inst.api('GET', `/api/collections/goalmaps/records?perPage=200`, { token: admin.token });
  expect(r.status === 200 && !r.json.items.some((m) => /SOUKROMA|SDILENA-S-KOLEGOU/.test(m.title)), 'a nejsou ani v jeho seznamu projektů');
  zm = await zmeny(K.id);
  expect(zm.length === 1 && zm[0].from === clen.email && zm[0].to === kolega.email && zm[0].actor_email === admin.email, `předání je v záznamu změn (${zm.length})`);
  zv = (await zvonecek(kolega)).filter((n) => n.map === K.id && /byl smazán/.test(n.text));
  expect(zv.length === 1 && /Účet clen@as\.cz byl smazán\. Projekt „SDILENA-S-KOLEGOU" přešel na vás/.test(zv[0].text), `spolusprávce dostal oznámení (${zv[0] && zv[0].text})`);
  // the notification of the administrator's action must not reach the administrator's bell with a hidden title
  expect(!(await zvonecek(admin)).some((n) => /SDILENA-S-KOLEGOU|SOUKROMA/.test(n.text)), 'admin nedostal oznámení s názvem projektu, který nevidí');
}, { nazev: 'ADMIN-SOUKROME-MAPY' });
