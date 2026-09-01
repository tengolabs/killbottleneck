// v1 API / MCP: API KLÍČ JEDNÁ ZA SVÉHO VLASTNÍKA (krok 4c vlny „sedm pohledů", rozhodnutí 25.–26. 8. 2026).
// Hlídá tabulku práv 1:1: vlastní/edit/team-edit = plný zápis; work = jen stav vlastního uzlu; read/team-read = jen čtení;
//   cizí soukromá i cizí VEŘEJNÁ mapa = 404; klíč se scope read nikdy nezapíše; role se nečte (člen dostane
//   /v1/portfolio = svůj rozsah); auto-sdílení řešiteli (work, jen nahoru, ne vlastník/ext kontakt, ne od týmového
//   editora); MCP get_portfolio = stejná čísla jako stránka Organizace.
// MUTAČNĚ: proti buildu bez kroku 4c (kb-krok4c-main) padá — sdílené mapy tam vrací 404.
// Port 20572. Seed map přes v1 klíč vlastníka (rozpočet 30 zápisů/min — hlídat), úkoly superuserem.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20572';
const NAME = 'flowmap-e2e-api-klic-vlastnik';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (offset) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

const api = async (path, { token, bearer, body, method } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch { /* SPA HTML na starém buildu → {} */ }
  return { status: res.status, json: json || {} };
};
const register = async (email) => {
  const rec = (await api('/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } })).json;
  const r = await api('/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  const klic = (await api('/api/kb/api-keys', { token: r.json.token, body: { label: 'rw', scope: 'read_write' } })).json.token;
  const ro = (await api('/api/kb/api-keys', { token: r.json.token, body: { label: 'ro', scope: 'read' } })).json.token;
  return { token: r.json.token, id: rec.id, email, klic, ro };
};
let rpcId = 1;
const mcp = async (key, name, args) => {
  const r = await api('/mcp', { bearer: key, body: { jsonrpc: '2.0', id: rpcId++, method: 'tools/call', params: { name, arguments: args || {} } } });
  const res = r.json.result || {};
  return { status: r.status, isError: !!res.isError, text: (res.content || []).map((c) => c.text || '').join('\n') };
};
const findNode = (tree, title) => {
  for (const n of tree || []) { if (n.title === title) return n; const c = findNode(n.children, title); if (c) return c; }
  return null;
};

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 -p 20572:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const V = await register('vlastnik@e2e.cz');   // první = admin, vlastník všech map
    const R = await register('ctenar@e2e.cz');     // sdílení „číst"
    const W = await register('spoluprac@e2e.cz');  // sdílení „spolupracovat" (work)
    const E = await register('editor@e2e.cz');     // sdílení „upravovat" (edit)
    const T = await register('tymak@e2e.cz');      // jen týmový přístup
    const X = await register('cizi@e2e.cz');       // nikde nesdíleno
    const share = (u, mapId, body) => api('/api/kb/share', { token: u.token, body: { mapId, ...body } });
    const shares = async (mapId) => {
      const r = await api(`/api/collections/map_shares/records?perPage=50&filter=${encodeURIComponent(`map = "${mapId}"`)}`, { token: V.token });
      const out = {}; for (const it of r.json.items || []) out[it.email] = it.permission; return out;
    };
    const v1 = (u, path, body, method) => api(`/api/kb/v1${path}`, { bearer: u.klic, body, method });
    const ver = async (u, mapId) => (await v1(u, `/maps/${mapId}`)).json.updated;

    console.log('== seed: 5 map vlastníka + org mapa ==');
    // M1 SDILENA: řešitelé W a E (→ auto-sdílení work), uzel V s termínem (zadal V), uzel bez řešitele, uzel s úkolem pro W
    let r = await v1(V, '/maps', { title: 'SDILENA', tree: [
      { title: 'N-W', owner: W.email },
      { title: 'N-E', owner: E.email },
      { title: 'N-V', owner: V.email, deadline: day(5) },
      { title: 'N-CIZI' },
      { title: 'N-TASK' },
    ] });
    expect(r.status === 200, `create_map SDILENA (${r.status})`);
    expect(Array.isArray(r.json.shared) && r.json.shared.includes(W.email) && r.json.shared.includes(E.email) && !r.json.shared.includes(V.email),
      `odpověď create_map říká, komu se nasdílelo: ${JSON.stringify(r.json.shared)}`);
    const M1 = r.json.id;
    const nid = (tree, t) => (findNode(tree, t) || {}).id;
    const N = { W: nid(r.json.tree, 'N-W'), E: nid(r.json.tree, 'N-E'), V: nid(r.json.tree, 'N-V'), CIZI: nid(r.json.tree, 'N-CIZI'), TASK: nid(r.json.tree, 'N-TASK') };
    // TYM-READ: T tu NENÍ řešitel při založení (create_map by ho auto-nasdílel na work) — svou práci
    // dostane až úkolem od superusera níž, takže zůstane na úrovni „týmový read + vlastní práce"
    const M2r = await v1(V, '/maps', { title: 'TYM-READ', tree: [{ title: 'N2-T' }] });
    const M2 = M2r.json.id;
    const N2T = nid(M2r.json.tree, 'N2-T');
    const M3r = await v1(V, '/maps', { title: 'TYM-EDIT', tree: [{ title: 'N3-TERMIN', deadline: day(7) }, { title: 'N3-VOLNY' }] });
    const M3 = M3r.json.id;
    const N3 = { TERMIN: nid(M3r.json.tree, 'N3-TERMIN'), VOLNY: nid(M3r.json.tree, 'N3-VOLNY') };
    const M4 = (await v1(V, '/maps', { title: 'SOUKROMA', tree: [{ title: 'N4' }] })).json.id;
    const M5 = (await v1(V, '/maps', { title: 'VEREJNA', tree: [{ title: 'N5' }] })).json.id;
    expect(!!(M2 && M3 && M4 && M5), 'založeny TYM-READ, TYM-EDIT, SOUKROMA, VEREJNA');
    await share(V, M1, { action: 'share', email: R.email, permission: 'read' });
    await share(V, M2, { action: 'set_team_access', access: 'read' });
    await share(V, M3, { action: 'set_team_access', access: 'edit' });
    await share(V, M5, { action: 'toggle_public', is_public: true });
    // org mapa (kind=org) — zakládá admin; /org-map vrací { map }
    const orgR = await api('/api/kb/org-map', { token: V.token, body: {} });
    const org = { id: ((orgR.json || {}).map || {}).id };
    expect(!!org.id, `org mapa založena adminem (${orgR.status} ${org.id})`);
    // úkol pro W na uzlu bez garanta (právo plyne z práce i přes úkol)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    r = await api('/api/collections/tasks/records', { token: ST, body: { map: M1, node_id: N.TASK, owner: V.id, owner_email: V.email, title: 'UKOL-PRO-W', status: 'todo', assignee_email: W.email } });
    expect(r.status === 200, `úkol pro W na N-TASK (${r.status})`);
    r = await api('/api/collections/tasks/records', { token: ST, body: { map: M2, node_id: N2T, owner: V.id, owner_email: V.email, title: 'UKOL-PRO-T', status: 'todo', assignee_email: T.email } });
    expect(r.status === 200, `úkol pro T na N2-T v TYM-READ (${r.status})`);

    console.log('== auto-sdílení řešitelům při create_map ==');
    let sh = await shares(M1);
    expect(sh[W.email] === 'work' && sh[E.email] === 'work', `řešitelé W a E dostali sdílení work (${JSON.stringify(sh)})`);
    expect(!sh[V.email], 'pro vlastníka řádek sdílení nevznikl');
    expect(sh[R.email] === 'read', 'R má read (ruční sdílení)');
    // E povýšit na edit (spolusprávce) — auto-sdílení pak nesmí snížit
    r = await share(V, M1, { action: 'update_permission', memberEmail: E.email, permission: 'edit' });
    expect(r.status === 200, `E povýšen na edit (${r.status})`);

    console.log('== viditelnost: list + get (tabulka práv) ==');
    const listOf = async (u) => { const l = await v1(u, '/maps'); const o = {}; for (const m of l.json.maps || []) o[m.title] = m.access; return o; };
    const lR = await listOf(R);
    expect(lR.SDILENA === 'read' && lR['TYM-READ'] === 'read' && lR['TYM-EDIT'] === 'edit' && !lR.SOUKROMA && !lR.VEREJNA,
      `R vidí SDILENA(read), TYM-READ(read), TYM-EDIT(edit); ne SOUKROMA ani VEREJNA (${JSON.stringify(lR)})`);
    const lW = await listOf(W);
    expect(lW.SDILENA === 'work', `W vidí SDILENA jako work (${lW.SDILENA})`);
    const lE = await listOf(E);
    expect(lE.SDILENA === 'edit', `E vidí SDILENA jako edit (${lE.SDILENA})`);
    const lV = await listOf(V);
    expect(lV.SDILENA === 'owner' && lV.SOUKROMA === 'owner' && lV.VEREJNA === 'owner', `vlastník má access=owner (${lV.SDILENA})`);
    const lX = await listOf(X);
    expect(!lX.SDILENA && !lX.SOUKROMA && !lX.VEREJNA && lX['TYM-READ'] === 'read' && lX['TYM-EDIT'] === 'edit',
      `X (nesdíleno) vidí jen týmové mapy (${JSON.stringify(lX)})`);
    r = await v1(R, `/maps/${M1}`);
    expect(r.status === 200 && r.json.access === 'read' && r.json.tree.length === 1, `R get_map SDILENA 200 + access=read (${r.status})`);
    r = await v1(X, `/maps/${M1}`);
    expect(r.status === 404, `X: cizí soukromá SDILENA → 404 (${r.status})`);
    r = await v1(X, `/maps/${M4}`);
    expect(r.status === 404, `X: SOUKROMA → 404 (${r.status})`);
    r = await v1(X, `/maps/${M5}`);
    expect(r.status === 404, `X: cizí VEŘEJNÁ vývěska → 404, ne pracovní přístup (${r.status})`);
    r = await v1(R, `/maps/${M5}`);
    expect(r.status === 404, `ani R (sdílený jinde) veřejnou cizí mapu přes klíč nevidí (${r.status})`);
    r = await v1(R, `/maps/${M1}/rules`);
    expect(r.status === 403, `R pravidla sdílené mapy NEVIDÍ — 403 jako session /rules (${r.status})`);
    r = await v1(R, `/maps/${M1}/rule-runs`);
    expect(r.status === 403, `R běhy pravidel nevidí — 403 (${r.status})`);
    r = await v1(E, `/maps/${M1}/rules`);
    expect(r.status === 200, `E (edit) pravidla vidí (${r.status})`);
    r = await v1(X, `/maps/${M1}/rules`);
    expect(r.status === 404, `X pravidla cizí mapy nevidí (${r.status})`);

    console.log('== scope read nikdy nezapíše, úroveň ho nepovýší ==');
    let base = await ver(E, M1);
    r = await api(`/api/kb/v1/maps/${M1}/nodes`, { bearer: E.ro, body: { items: [{ title: 'ro' }], base_updated: base } });
    expect(r.status === 403, `editorův klíč se scope read → 403 (${r.status})`);
    r = await api(`/api/kb/v1/maps/${M1}/nodes/${N.CIZI}`, { bearer: V.ro, body: { status: 'done', base_updated: base } });
    expect(r.status === 403, `vlastníkův read klíč nezmění ani stav (${r.status})`);

    console.log('== read / team-read: jen čtení ==');
    r = await v1(R, `/maps/${M1}/nodes`, { items: [{ title: 'r' }], base_updated: base });
    expect(r.status === 403 && /práv|access|right/i.test(r.json.error || ''), `R add_nodes → 403 (${r.status}: ${r.json.error})`);
    r = await v1(R, `/maps/${M1}/nodes/${N.CIZI}`, { status: 'done', base_updated: base });
    expect(r.status === 403, `R update_node cizího uzlu → 403 (${r.status})`);
    r = await v1(R, `/maps/${M1}/nodes/${N.V}`, { status: 'done', base_updated: base });
    expect(r.status === 403, `R (jen číst, bez vlastní práce) ani stav → 403 (${r.status})`);
    r = await v1(R, `/maps/${M1}/nodes/${N.CIZI}/delete`, { base_updated: base });
    expect(r.status === 403, `R delete → 403 (${r.status})`);
    r = await v1(R, `/maps/${M1}/rules`, { name: 'r', trigger: { type: 'status_changed' }, actions: [] });
    expect(r.status === 403, `R create_rule → 403 (${r.status})`);
    const base2 = await ver(T, M2);
    r = await v1(T, `/maps/${M2}/nodes`, { items: [{ title: 't' }], base_updated: base2 });
    expect(r.status === 403, `týmový read: add_nodes → 403 (${r.status})`);
    sh = await shares(M2);
    expect(!sh[T.email], `T je na TYM-READ jen přes tým, bez jmenovitého řádku (${JSON.stringify(sh)})`);
    // Richard 26. 8. 2026 (volba A): klíč = jako aplikace → i čtenář (týmový read) s vlastní prací
    // přepne stav SVÉHO uzlu (právo plyne z práce, /node-status), ale nic víc
    r = await v1(T, `/maps/${M2}/nodes/${N2T}`, { status: 'done', base_updated: base2 });
    expect(r.status === 200 && r.json.node.status === 'done', `týmový read + vlastní úkol: přes klíč stav změní — 200 jako v aplikaci (${r.status})`);
    r = await v1(T, `/maps/${M2}/nodes/${N2T}`, { title: 'x', base_updated: r.json.updated });
    expect(r.status === 403, `týmový read: jiné pole než status → 403 (${r.status})`);
    r = await api('/api/kb/node-status', { token: T.token, body: { mapId: M2, nodeId: N2T, status: 'in_progress' } });
    expect(r.status === 200, `…a v aplikaci (/node-status) totéž — 200 (${r.status})`);

    console.log('== work: jen stav vlastního uzlu (zrcadlo /node-status) ==');
    base = await ver(W, M1);
    r = await v1(W, `/maps/${M1}/nodes/${N.W}`, { status: 'in_progress', base_updated: base });
    expect(r.status === 200 && r.json.node.status === 'in_progress', `W: status svého uzlu (garant) → 200 (${r.status})`);
    base = r.json.updated || await ver(W, M1);
    r = await v1(W, `/maps/${M1}/nodes/${N.TASK}`, { status: 'in_progress', base_updated: base });
    expect(r.status === 200, `W: status uzlu, kde má ÚKOL jako řešitel → 200 (${r.status})`);
    base = r.json.updated || await ver(W, M1);
    r = await v1(W, `/maps/${M1}/nodes/${N.CIZI}`, { status: 'done', base_updated: base });
    expect(r.status === 403, `W: cizí uzel → 403 (${r.status})`);
    r = await v1(W, `/maps/${M1}/nodes/${N.W}`, { title: 'přejmenováno', base_updated: base });
    expect(r.status === 403 && /status|stav/i.test(r.json.error || ''), `W: jiné pole než status → 403 (${r.status}: ${r.json.error})`);
    r = await v1(W, `/maps/${M1}/nodes/${N.W}`, { status: 'done', deadline: day(9), base_updated: base });
    expect(r.status === 403, `W: status + termín naráz → 403 (${r.status})`);
    r = await v1(W, `/maps/${M1}/nodes`, { items: [{ title: 'w' }], base_updated: base });
    expect(r.status === 403, `W: add_nodes → 403 (${r.status})`);
    r = await v1(W, `/maps/${M1}/nodes/${N.W}/delete`, { base_updated: base });
    expect(r.status === 403, `W: delete vlastního uzlu → 403 (${r.status})`);
    r = await v1(W, `/maps/${M1}/rules`, { name: 'w', trigger: { type: 'status_changed' }, actions: [] });
    expect(r.status === 403, `W: create_rule → 403 (${r.status})`);
    r = await v1(W, `/maps/${M1}/rules`);
    expect(r.status === 403, `W: list_rules → 403 (jako v aplikaci) (${r.status})`);
    r = await v1(W, `/maps/${M1}`);
    expect(r.status === 200 && (findNode(r.json.tree, 'N-W') || {}).status === 'in_progress' && (findNode(r.json.tree, 'N-CIZI') || {}).status !== 'done',
      'v mapě: N-W in_progress, N-CIZI nezměněn');

    console.log('== edit / team-edit: plný zápis, ale stráže editora (ne vlastníka) ==');
    base = await ver(E, M1);
    r = await v1(E, `/maps/${M1}/nodes`, { items: [{ title: 'N-OD-E' }], base_updated: base });
    expect(r.status === 200 && r.json.added_ids.length === 1, `E add_nodes → 200 (${r.status})`);
    const nOdE = r.json.added_ids[0];
    base = r.json.updated;
    r = await v1(E, `/maps/${M1}/nodes/${N.CIZI}`, { title: 'N-CIZI-E', status: 'done', base_updated: base });
    expect(r.status === 200 && r.json.node.title === 'N-CIZI-E', `E update_node cizího uzlu vč. title → 200 (${r.status})`);
    base = r.json.updated;
    r = await v1(E, `/maps/${M1}/nodes/${N.V}`, { deadline: day(20), base_updated: base });
    expect(r.status === 400 && /termín|deadline/i.test(r.json.error || ''), `E nezmění existující termín zadaný vlastníkem — 400 (${r.status}: ${r.json.error})`);
    r = await v1(E, `/maps/${M1}/nodes/${nOdE}/delete`, { base_updated: base });
    expect(r.status === 200 && r.json.deleted_count === 1, `E delete svého uzlu → 200 (${r.status})`);
    r = await v1(E, `/maps/${M1}/rules`, { name: 'od-E', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'hotovo' }] });
    expect(r.status === 200 && r.json.rule && r.json.rule.id, `E create_rule → 200 (${r.status} ${r.json.error || ''})`);
    r = await v1(E, `/maps/${M1}/rules/${(r.json.rule || {}).id}/delete`, {});
    expect(r.status === 200, `E delete_rule → 200 (${r.status})`);
    const base3 = await ver(T, M3);
    r = await v1(T, `/maps/${M3}/nodes`, { items: [{ title: 'N3-OD-T', owner: X.email }], base_updated: base3 });
    expect(r.status === 200, `týmový edit: add_nodes → 200 (${r.status})`);
    r = await v1(T, `/maps/${M3}/nodes/${N3.TERMIN}`, { deadline: day(30), base_updated: r.json.updated });
    expect(r.status === 400, `týmový edit: cizí termín nepřepíše — 400 (${r.status})`);
    sh = await shares(M3);
    expect(!sh[X.email], `týmový editor NENÍ spolusprávce → řešitele X auto-nesdílel (${JSON.stringify(sh)})`);
    // …a odpověď add_nodes to přizná prázdným `shared` (klient/LLM ví, že řešitel mapu neuvidí)
    r = await v1(T, `/maps/${M3}/nodes`, { items: [{ title: 'N3-OD-T-2', owner: X.email }], base_updated: (await v1(T, `/maps/${M3}`)).json.updated });
    expect(r.status === 200 && Array.isArray(r.json.shared) && r.json.shared.length === 0, `add_nodes týmového editora: shared=[] (${JSON.stringify(r.json.shared)})`);
    r = await v1(V, '/maps');
    expect(!(r.json.maps || []).some((m) => m.title === 'Organizační struktura'), 'GET /v1/maps org mapu nevypisuje (jako Projekty v aplikaci)');

    console.log('== auto-sdílení při update_node (vlastník) ==');
    base = await ver(V, M1);
    // N-E je nehotový (N-CIZI už editor označil done — hotové Můj den neukazuje)
    r = await v1(V, `/maps/${M1}/nodes/${N.E}`, { owner: R.email, base_updated: base });
    expect(r.status === 200, `V přiřadí R (dosud read) (${r.status} ${r.json.error || ''})`);
    base = r.json.updated;
    sh = await shares(M1);
    expect(sh[R.email] === 'work', `R povýšen read → work (${sh[R.email]})`);
    expect(sh[E.email] === 'edit', `E zůstal edit (nikdy dolů) (${sh[E.email]})`);
    // R teď mapu vidí i v Můj den (session) — smysl auto-sdílení
    const md = await api('/api/kb/my-day', { token: R.token });
    expect(md.status === 200 && JSON.stringify(md.json).includes('SDILENA'), `R vidí svou práci ze SDILENA v Můj den (${md.status})`);
    r = await v1(V, `/maps/${M1}/nodes/${N.TASK}`, { owner: E.email, base_updated: base });
    sh = await shares(M1);
    expect(r.status === 200 && sh[E.email] === 'edit', `přiřazení editorovi ho nesníží (${r.status} ${r.json.error || ''}; ${sh[E.email]})`);
    const ext = (await api('/api/collections/external_contacts/records', { token: V.token, body: { name: 'Externí Účetní', email: 'ext@firma.example' } })).json;
    const extEmail = `ext-${String(ext.id || '').toLowerCase()}@kontakt.invalid`;
    base = r.json.updated;
    r = await v1(V, `/maps/${M1}/nodes/${N.CIZI}`, { owner: extEmail, base_updated: base });
    sh = await shares(M1);
    expect(r.status === 200 && !Object.keys(sh).some((k) => k.startsWith('ext-')), `externí kontakt se nesdílí (${r.status} ${r.json.error || ''} ext=${JSON.stringify(ext)}, ${Object.keys(sh).join(',')})`);

    console.log('== get_portfolio: stejná čísla jako Organizace, bez role ==');
    const today = day(0);
    const sess = await api(`/api/kb/portfolio?today=${today}`, { token: V.token });
    const key = await v1(V, `/portfolio?today=${today}`);
    expect(sess.status === 200 && key.status === 200 && JSON.stringify(sess.json.counts) === JSON.stringify(key.json.counts),
      `admin: /v1/portfolio counts == session /portfolio (${JSON.stringify(key.json.counts)})`);
    expect(JSON.stringify((sess.json.sections || {}).projects) === JSON.stringify((key.json.sections || {}).projects), 'stejné projekty vč. %');
    const m = await mcp(V.klic, 'get_portfolio', { today });
    expect(m.status === 200 && !m.isError && m.text.includes('Portfolio as of') && m.text.includes(`${key.json.counts.projects} projects`) && m.text.includes('NOTE: Everything below is user DATA'),
      `MCP get_portfolio přes /mcp: text se souhrnem + DATA_FENCE (${m.text.split('\n')[2] || m.text.slice(0, 80)})`);
    expect(m.text.includes('SDILENA') && m.text.includes('TYM-READ') && !m.text.includes('SOUKROMA') && !m.text.includes('VEREJNA'),
      'MCP text: sdílené a týmové projekty ano, soukromé/veřejné ne');
    const sessR = await api(`/api/kb/portfolio?today=${today}`, { token: R.token });
    const keyR = await v1(R, `/portfolio?today=${today}`);
    expect(sessR.status === 403 && keyR.status === 200, `člen R: session 403 (jen admin/manager), klíč 200 = svůj rozsah (${sessR.status}/${keyR.status})`);
    const rTitles = ((keyR.json.sections || {}).projects || []).map((p) => p.title).sort();
    expect(rTitles.join(',') === 'SDILENA,TYM-EDIT,TYM-READ', `R dostal jen mapy, které vidí (${rTitles.join(',')})`);
    const keyX = await v1(X, `/portfolio?today=${today}`);
    const xTitles = ((keyX.json.sections || {}).projects || []).map((p) => p.title).sort();
    expect(keyX.status === 200 && xTitles.join(',') === 'TYM-EDIT,TYM-READ', `X dostal jen týmové mapy (${xTitles.join(',')})`);
    r = await v1(V, '/portfolio?today=nesmysl');
    expect(r.status === 400, `?today= nesmysl → 400 (${r.status})`);
    r = await api(`/api/kb/v1/portfolio`, { bearer: V.ro });
    expect(r.status === 200, `portfolio stačí klíč read (${r.status})`);

    console.log('== org mapa přes klíč: čtení ano, zápis ne ==');
    r = await v1(V, `/maps/${org.id}`);
    expect(r.status === 200, `admin/vlastník org mapu přes klíč čte (${r.status})`);
    r = await v1(V, `/maps/${org.id}/nodes`, { items: [{ title: 'pozice' }], base_updated: r.json.updated });
    expect(r.status === 403, `zápis do org mapy přes klíč → 403 (${r.status})`);

    console.log('== jiná velikost písmen: dvojče už nejde založit (v0.53) ==');
    // Od v0.53 hook registrace ukládá e-mail lowercase → `Editor@E2E.CZ` koliduje s editor@e2e.cz
    // a unikát ho odmítne. (Do v0.52 tu sekce hlídala opak: dvojče jako samostatný účet bez práv;
    // celá třída problémů zmizela s migrací users_email_lowercase.)
    r = await api('/api/collections/users/records', { body: { email: 'Editor@E2E.CZ', password: PW, passwordConfirm: PW } });
    expect(r.status !== 200, `registrace dvojčete Editor@E2E.CZ neprojde (${r.status})`);
    // mixed-case zápis řešitele se vstřícně přeloží na JEDINÝ existující účet
    // (resolveOwner: přesná shoda → bez ohledu na velikost písmen, 1 kandidát = přijmout)
    base = await ver(V, M1);
    r = await v1(V, `/maps/${M1}/nodes/${N.TASK}`, { owner: 'EDITOR@e2e.cz', base_updated: base });
    sh = await shares(M1);
    expect(r.status === 200 && sh[E.email] === 'edit' && !sh['EDITOR@e2e.cz'] && !sh['Editor@E2E.CZ'],
      `řešitel EDITOR@e2e.cz padne na editor@e2e.cz — edit zůstává, žádný mixed-case řádek (${r.status}: ${JSON.stringify(sh)})`);

    console.log('== nepřihlášený a neplatný klíč beze změny ==');
    r = await api(`/api/kb/v1/maps/${M1}`);
    expect(r.status === 401, `bez klíče 401 (${r.status})`);
    r = await api('/api/kb/v1/portfolio', { bearer: 'kb_user_neplatny000000000000' });
    expect(r.status === 401, `neplatný klíč 401 (${r.status})`);
  } catch (e) {
    fail++;
    console.log('  ❌ výjimka:', e && e.stack || e);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} api-klic-vlastnik: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
