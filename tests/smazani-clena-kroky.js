// Deleting a member: their OPEN steps can pass to another member (decision 15 Nov 2026).
//
// Before: the steps of a deleted member stayed assigned to the address for ever and nothing
// offered to pass them on. Now the administrator may name a member in the delete
// (`?reassign_to=<e-mail>`); without it the steps stay on the address (the app shows
// "former member" there).
//
// What is measured (the administrator does what the dialog in user administration does:
// GET /users/{id}/maps[?reassign_to=] → DELETE the account[?reassign_to=]):
//   • the summary counts the open steps in the projects that STAY (never the ones in the
//     member's private projects, never finished steps, never archived projects) and says
//     how many of them the chosen member would receive;
//   • a wrong target (no account, the deleted account itself) is refused BEFORE the delete;
//   • after the delete the open steps passed only in the projects the new assignee can
//     see (named share, team access, a project handed over to them); a step in somebody's
//     private project stays on the old address and the project stays closed to them;
//   • finished steps keep their author; the new assignee is told once per project;
//   • without a target nothing is reassigned.
const H = require('./_harness');
const { expect } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'smazkroky', env: { KB_UVODNI_MAPA: 0, TZ: 'Europe/Prague' } });
  const ST = await inst.superuser();
  const ucet = async (email) => {
    const r = await inst.register(email, {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    const token = await inst.login(email);
    // entering the app writes users.last_login — only such an account can take a project over
    const l = await inst.api('POST', '/api/collections/loginlogs/records', { token, body: {} });
    if (l.status !== 200) throw new Error(`loginlog ${email}: ${l.status}`);
    return { id: r.json.id, email, token };
  };
  const su = (method, path, body) => inst.api(method, path, { token: ST, body });
  const pocet = async (col, filter) => (await su('GET', `/api/collections/${col}/records?perPage=200${filter ? '&filter=' + encodeURIComponent(filter) : ''}`)).json.items || [];
  const krok = (id, x, owner, status) => ({ id, type: 'goalNode', position: { x, y: 300 }, data: { title: 'Krok ' + id, status: status || 'todo', nodeType: 'normal', owner: owner || '' } });
  const mapa = async (kdo, title, kroky) => {
    const body = {
      title, owner: kdo.id, owner_email: kdo.email,
      nodes: [{ id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } }].concat(kroky),
      edges: kroky.map((k) => ({ id: 'e-' + k.id, source: 'R', target: k.id })),
    };
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body });
    if (r.status !== 200) throw new Error(`mapa ${title}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const share = async (kdo, body) => {
    const r = await inst.api('POST', '/api/kb/share', { token: kdo.token, body });
    if (r.status !== 200) throw new Error(`sdílení ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.json)}`);
  };
  const resitele = async (id) => {
    const m = (await su('GET', `/api/collections/goalmaps/records/${id}`)).json;
    const out = {};
    for (const n of m.nodes || []) if (n.type === 'goalNode') out[n.id] = (n.data || {}).owner || '';
    return out;
  };

  const admin = await ucet('admin@kr.cz');          // the first account = administrator
  const odch = await ucet('odchazejici@kr.cz');
  const kolega = await ucet('kolega@kr.cz');
  const novy = await ucet('novy@kr.cz');            // receives the steps
  const druhy = await ucet('druhy@kr.cz');          // deleted without a target

  console.log('== příprava: kde má odcházející člen kroky ==');
  // the colleague's project, shared only with the leaving member — the new assignee does not see it
  const CIZI = await mapa(kolega, 'KOLEGUV-SOUKROMY', [krok('a1', 0, odch.email), krok('a2', 200, kolega.email)]);
  await share(kolega, { action: 'share', mapId: CIZI.id, email: odch.email, permission: 'edit' });
  // the administrator's project shared with both: an open step, a step in progress, a finished one
  const SDIL = await mapa(admin, 'SDILENY', [krok('b1', 0, odch.email), krok('b2', 200, odch.email, 'in_progress'), krok('b3', 400, odch.email, 'done'), krok('b4', 600, admin.email)]);
  await share(admin, { action: 'share', mapId: SDIL.id, email: odch.email, permission: 'edit' });
  await share(admin, { action: 'share', mapId: SDIL.id, email: novy.email, permission: 'read' });
  // the member's own private project goes with the account — its steps do not count
  const PRIV = await mapa(odch, 'JEHO-SOUKROMY', [krok('c1', 0, odch.email)]);
  // the member's project with a co-admin: handed over to the co-admin inside the delete
  const PRED = await mapa(odch, 'JEHO-SE-SPOLUSPRAVCEM', [krok('d1', 0, odch.email)]);
  await share(odch, { action: 'share', mapId: PRED.id, email: novy.email, permission: 'edit' });
  // a team project of the colleague — everybody sees it
  const TYM = await mapa(kolega, 'TYMOVY', [krok('e1', 0, odch.email)]);
  await share(kolega, { action: 'set_team_access', mapId: TYM.id, access: 'read' });
  await share(kolega, { action: 'share', mapId: TYM.id, email: odch.email, permission: 'edit' });
  // an archived project: closed work, left alone
  const ARCH = await mapa(admin, 'ARCHIVOVANY', [krok('f1', 0, odch.email)]);
  await share(admin, { action: 'share', mapId: ARCH.id, email: novy.email, permission: 'edit' });
  let r = await inst.api('PATCH', `/api/collections/goalmaps/records/${ARCH.id}`, { token: admin.token, body: { archived: true } });
  expect(r.status === 200 && r.json.archived === true, `předpoklad: projekt je v archivu (${r.status})`);
  // a step of the second member, deleted later without a target
  const DRUH = await mapa(admin, 'PRO-DRUHEHO', [krok('g1', 0, druhy.email)]);
  await share(admin, { action: 'share', mapId: DRUH.id, email: druhy.email, permission: 'edit' });

  console.log('== souhrn před smazáním ==');
  r = await inst.api('GET', `/api/kb/users/${odch.id}/maps`, { token: admin.token });
  expect(r.status === 200 && r.json.steps && r.json.steps.open === 5 && r.json.steps.maps === 4 && r.json.steps.reassignable === null,
    `souhrn: 5 otevřených kroků ve 4 projektech, které zůstanou; bez vybraného člověka žádné číslo přeřazení (${JSON.stringify(r.json.steps)})`);
  r = await inst.api('GET', `/api/kb/users/${odch.id}/maps?reassign_to=${encodeURIComponent(novy.email)}`, { token: admin.token });
  expect(r.status === 200 && r.json.steps.open === 5 && r.json.steps.reassignable === 4,
    `pro vybraného člena: přeřadí se 4 z 5 (krok v cizím soukromém projektu ne) (${JSON.stringify(r.json.steps)})`);
  expect(!/KOLEGUV-SOUKROMY|JEHO-SOUKROMY/.test(JSON.stringify(r.json)), 'souhrn neprozradí názvy soukromých projektů');
  r = await inst.api('GET', `/api/kb/users/${odch.id}/maps?reassign_to=${encodeURIComponent(novy.email.toUpperCase())}`, { token: admin.token });
  expect(r.status === 200 && r.json.steps.reassignable === 4, `adresa s velkými písmeny najde téhož člena (${r.status})`);
  r = await inst.api('GET', `/api/kb/users/${odch.id}/maps?reassign_to=${encodeURIComponent('nikdo@kr.cz')}`, { token: admin.token });
  expect(r.status === 400, `souhrn pro adresu bez účtu: 400 (${r.status})`);
  r = await inst.api('GET', `/api/kb/users/${odch.id}/maps?reassign_to=${encodeURIComponent(odch.email)}`, { token: admin.token });
  expect(r.status === 400, `souhrn s přeřazením na mazaný účet: 400 (${r.status})`);
  r = await inst.api('GET', `/api/kb/users/${odch.id}/maps?reassign_to=${encodeURIComponent(novy.email)}`, { token: kolega.token });
  expect(r.status === 403, `souhrn smí číst jen administrátor (${r.status})`);

  console.log('== špatný cíl přeřazení smazání zastaví ==');
  r = await inst.api('DELETE', `/api/collections/users/records/${odch.id}?reassign_to=${encodeURIComponent('nikdo@kr.cz')}`, { token: admin.token });
  expect(r.status === 400, `smazání s přeřazením na adresu bez účtu: 400 (${r.status})`);
  r = await inst.api('DELETE', `/api/collections/users/records/${odch.id}?reassign_to=${encodeURIComponent(odch.email)}`, { token: admin.token });
  expect(r.status === 400, `smazání s přeřazením na sebe sama: 400 (${r.status})`);
  expect((await su('GET', `/api/collections/users/records/${odch.id}`)).status === 200, 'účet po odmítnutých pokusech dál existuje');
  expect((await resitele(SDIL.id)).b1 === odch.email, 'a kroky se nepohnuly');

  console.log('== smazání s přeřazením ==');
  r = await inst.api('DELETE', `/api/collections/users/records/${odch.id}?reassign_to=${encodeURIComponent(novy.email)}`, { token: admin.token });
  expect(r.status === 204, `smazání prošlo (${r.status} ${JSON.stringify(r.json || '')})`);
  let k = await resitele(SDIL.id);
  expect(k.b1 === novy.email && k.b2 === novy.email, `sdílený projekt: oba otevřené kroky přešly (${JSON.stringify(k)})`);
  expect(k.b3 === odch.email, `hotový krok si autora nechal (${k.b3})`);
  expect(k.b4 === admin.email, 'cizí krok se nezměnil');
  const sd = (await su('GET', `/api/collections/goalmaps/records/${SDIL.id}`)).json;
  expect(sd.nodes.find((n) => n.id === 'b2').data.status === 'in_progress', 'stav rozpracovaného kroku zůstal');
  const pr = (await su('GET', `/api/collections/goalmaps/records/${PRED.id}`)).json;
  expect(pr.owner === novy.id && (await resitele(PRED.id)).d1 === novy.email, `předaný projekt: vlastníkem je spolusprávce a krok přešel na něj (${pr.owner_email})`);
  expect((await resitele(TYM.id)).e1 === novy.email, 'týmový projekt: krok přešel');
  expect((await resitele(CIZI.id)).a1 === odch.email, 'cizí soukromý projekt: krok zůstal na staré adrese');
  expect((await inst.api('GET', `/api/collections/goalmaps/records/${CIZI.id}`, { token: novy.token })).status === 404, 'a nový řešitel ten projekt dál nevidí');
  expect((await pocet('map_shares', `map="${CIZI.id}"`)).length === 0 && (await pocet('share_invites', `map="${CIZI.id}"`)).length === 0, 'v cizím projektu nevzniklo žádné sdílení ani čekající pozvánka');
  expect((await resitele(ARCH.id)).f1 === odch.email, 'archivovaný projekt zůstal, jak byl');
  expect((await su('GET', `/api/collections/goalmaps/records/${PRIV.id}`)).status === 404, 'soukromý projekt člena zanikl s účtem');
  const zvon = (await pocet('notifications', `user="${novy.id}"`)).filter((n) => /přešly jeho otevřené kroky|open steps/.test(n.text));
  expect(zvon.length === 3 && [SDIL.id, PRED.id, TYM.id].every((id) => zvon.some((n) => n.map === id)), `nový řešitel dostal jedno upozornění na každý ze 3 projektů (${zvon.length})`);
  expect(zvon.some((n) => n.map === SDIL.id && /SDILENY/.test(n.text) && /2/.test(n.text)), 'upozornění jmenuje projekt a počet kroků');
  const zmeny = await pocet('map_changes', `map="${SDIL.id}" && field="owner"`);
  expect(zmeny.filter((z) => z.item_id === 'b1' || z.item_id === 'b2').length === 2 && zmeny.filter((z) => z.item_id === "b1" || z.item_id === "b2").every((z) => z.actor_email === admin.email),
    `změna řešitele je v záznamu změn projektu (${zmeny.length})`);
  // the new assignee really works on the step: a reader may finish THEIR step
  r = await inst.api('POST', '/api/kb/node-status', { token: novy.token, body: { mapId: SDIL.id, nodeId: 'b1', status: 'done' } });
  expect(r.status === 200, `nový řešitel svůj krok dokončí i s právem jen číst (${r.status} ${JSON.stringify(r.json || '').slice(0, 120)})`);

  console.log('== smazání bez přeřazení nic nepřeřadí ==');
  r = await inst.api('GET', `/api/kb/users/${druhy.id}/maps`, { token: admin.token });
  expect(r.status === 200 && r.json.steps.open === 1 && r.json.steps.maps === 1, `souhrn druhého člena: 1 krok (${JSON.stringify(r.json.steps)})`);
  r = await inst.api('DELETE', `/api/collections/users/records/${druhy.id}`, { token: admin.token });
  expect(r.status === 204, `smazání bez přeřazení prošlo (${r.status})`);
  expect((await resitele(DRUH.id)).g1 === druhy.email, 'krok zůstal na adrese smazaného člena');
}, { nazev: 'SMAZANI-CLENA-KROKY' });
