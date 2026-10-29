// STYL MAPY Projekt × Proces (Richard 21. 10. 2026, maketa 8099/kb-proces
// schválena 25. 10.). goalmaps.kind = "process": zakládá ho kdokoli při
// založení (REST, v1/MCP, import), přepíná JEN vlastník a jen "" ↔ "process";
// "org" zůstává serverové. Proces se nedokončuje: v portfoliu nemá %, má
// zdraví běhu; jeho kroky se nehlásí jako „nehýbe se" (Můj den, Organizace,
// odznak stagnace v editoru).
// Data VŽDY z kontejneru (past UTC×hostitel).
const H = require('./_harness');
const { expect } = H;

const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });

H.beh(async () => {
  // KB_STUCK_DAYS=-1: i dnešní pohyb je „starý" → každý kandidát stagnuje (vzor ui-organizace-hrdla)
  const inst = await H.startInstance({ slug: 'proces-typ', env: { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_STUCK_DAYS: -1 } });
  const { api } = inst;
  await inst.register('a@example.com'); // první = admin, vlastník
  await inst.register('b@example.com'); // editor sdílené mapy
  await inst.register('c@example.com'); // cizí
  const A = await inst.login('a@example.com');
  const B = await inst.login('b@example.com');
  const C = await inst.login('c@example.com');
  const tok = (x) => x.token || x;
  const dnes = inst.exec('date +%F').trim();
  const plusDny = (n) => {
    const [y, m, d] = dnes.split('-').map(Number);
    const x = new Date(Date.UTC(y, m - 1, d + n));
    return x.toISOString().slice(0, 10);
  };
  const klic = (await api('POST', '/api/kb/api-keys', { token: tok(A), body: { label: 'rw', scope: 'read_write' } })).json.token;
  const v1 = (method, path, body) => api(method, `/api/kb/v1${path}`, { headers: { Authorization: `Bearer ${klic}` }, body });
  const fresh = async (id, t = A) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token: tok(t) })).json;

  console.log('== založení: kind process projde, org se zahodí ==');
  // kroky se přidávají DRUHÝM uložením — teprve update zapíše do záznamníku
  // „created" (razítko pohybu); bez něj stagnace „neví" a mlčí
  const pridejKroky = async (mapa, kroky) => {
    const f0 = await fresh(mapa.id);
    return api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: tok(A), body: {
      nodes: f0.nodes.concat(kroky.map((k) => node(k.id, k.data))),
      edges: f0.edges.concat(kroky.map((k) => ({ id: `e-${k.id}`, source: 'root', target: k.id }))),
      base_updated: f0.updated,
    } });
  };
  let r = await api('POST', '/api/collections/goalmaps/records', { token: tok(A), body: {
    title: 'Úklid kanceláře', kind: 'process',
    nodes: [node('root', { apexText: 'Úklid kanceláře', title: 'Úklid kanceláře', status: 'todo' }, 'apexNode')], edges: [],
  } });
  expect(r.status === 200 && r.json.kind === 'process', `REST create s kind=process → proces (${r.status} ${r.json.kind})`);
  const proc = r.json;
  r = await pridejKroky(proc, [
    { id: 'P1', data: { title: 'Popis kroku bez rytmu', status: 'todo', owner: 'a@example.com' } },
    { id: 'P2', data: { title: 'Vynést koše', status: 'todo', owner: 'a@example.com', deadline: plusDny(-2) } },
  ]);
  expect(r.status === 200 && (await fresh(proc.id)).kind === 'process', `kroky přidány, styl se uložením obsahu nezměnil (${r.status})`);
  r = await api('POST', '/api/collections/goalmaps/records', { token: tok(A), body: { title: 'Pokus o org', kind: 'org', nodes: [], edges: [] } });
  expect(r.status === 200 && r.json.kind === '', `kind=org z requestu se zahodí (${r.json.kind})`);
  r = await api('POST', '/api/collections/goalmaps/records', { token: tok(A), body: {
    title: 'E-shop', nodes: [node('root', { apexText: 'E-shop', title: 'E-shop', status: 'todo' }, 'apexNode')], edges: [],
  } });
  const proj = r.json;
  await pridejKroky(proj, [{ id: 'X', data: { title: 'Projektový krok bez termínu', status: 'todo', owner: 'a@example.com' } }]);
  expect(proj.kind === '', 'bez kind = projekt');

  console.log('== přepnutí stylu: jen vlastník, jen "" ↔ process ==');
  // pravidla opakování: čisté (srovná server podle stylu) a ručně upravené (zůstane) — /checkup 29. 10.
  const ulozP = (nazev, akce) => api('POST', '/api/kb/rules/save', { token: tok(A), body: { map: proj.id, name: nazev, node_id: 'X',
    trigger: { type: 'node_status_changed', status: 'done' }, conditions: [], actions: akce } });
  const cisteR = (await ulozP('Opakování X', [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'weekly' }])).json.rule;
  const vlastniR = (await ulozP('Vlastní', [{ type: 'set_status', status: 'todo' }])).json.rule;
  const akceP = async (id) => (((await api('GET', `/api/kb/rules?map=${proj.id}`, { token: tok(A) })).json || {}).rules || []).find((x) => x.id === id)?.actions || [];
  expect(!!cisteR && !!vlastniR, 'pravidla opakování v projektu');
  await api('POST', '/api/kb/share', { token: tok(A), body: { mapId: proj.id, action: 'share', email: 'b@example.com', permission: 'edit' } });
  let f = await fresh(proj.id);
  r = await api('PATCH', `/api/collections/goalmaps/records/${proj.id}`, { token: tok(B), body: { kind: 'process', base_updated: f.updated } });
  f = await fresh(proj.id);
  expect(f.kind === '', `sdílený editor styl NEpřepne (${r.status}, kind="${f.kind}")`);
  r = await api('PATCH', `/api/collections/goalmaps/records/${proj.id}`, { token: tok(A), body: { kind: 'process', base_updated: f.updated } });
  f = await fresh(proj.id);
  expect(r.status === 200 && f.kind === 'process', `vlastník přepne projekt → proces (${r.status} ${f.kind})`);
  let ak = await akceP(cisteR.id);
  expect(ak.length === 3 && ak[2].type === 'reset_subtree', `do procesu: čisté opakování dostalo obnovu podkroků na serveru (${JSON.stringify(ak)})`);
  expect((await akceP(vlastniR.id)).length === 1, 'ručně upravené pravidlo beze změny');
  r = await api('PATCH', `/api/collections/goalmaps/records/${proj.id}`, { token: tok(A), body: { kind: 'org', base_updated: f.updated } });
  f = await fresh(proj.id);
  expect(f.kind === 'process', `ani vlastník neudělá z mapy org (${f.kind})`);
  r = await api('PATCH', `/api/collections/goalmaps/records/${proj.id}`, { token: tok(A), body: { kind: '', base_updated: f.updated } });
  f = await fresh(proj.id);
  expect(r.status === 200 && f.kind === '', `a zpátky proces → projekt (${f.kind})`);
  ak = await akceP(cisteR.id);
  expect(ak.length === 2 && !ak.some((x) => x.type === 'reset_subtree'), `zpátky na projekt: obnova podkroků pryč, projekt jako dřív (${JSON.stringify(ak)})`);
  r = await api('POST', '/api/kb/org-map', { token: tok(A) });
  const orgId = r.json && (r.json.id || (r.json.map && r.json.map.id));
  if (orgId) {
    const fo = await fresh(orgId);
    await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: tok(A), body: { kind: 'process', base_updated: fo.updated } });
    expect((await fresh(orgId)).kind === 'org', 'org mapa zůstane org i po pokusu o proces');
  } else {
    expect(false, `org mapu se nepodařilo založit pro kontrolu (${r.status})`);
  }

  console.log('== v1 / MCP cesta: kind při založení, výpis i detail ==');
  r = await v1('POST', '/maps', { title: 'Měsíční účetnictví', kind: 'process', tree: [{ title: 'Zaplatit DPH', owner: 'a@example.com', deadline: plusDny(3) }] });
  expect(r.status === 200 && r.json.kind === 'process', `v1 create kind=process (${r.status} ${r.json.kind})`);
  const v1Proc = r.json.id;
  expect((await fresh(v1Proc)).kind === 'process', 'v1 mapa je v DB proces');
  r = await v1('POST', '/maps', { title: 'Špatně', kind: 'org', tree: [] });
  expect(r.status === 400 && /project|process/.test(JSON.stringify(r.json)), `v1 kind=org → 400 s výčtem (${r.status})`);
  r = await v1('POST', '/maps', { title: 'Projekt přes API', kind: 'project', tree: [] });
  expect(r.status === 200 && r.json.kind === 'project' && (await fresh(r.json.id)).kind === '', 'v1 kind=project → v DB ""');
  r = await v1('GET', '/maps');
  const radek = (r.json.maps || []).find((m) => m.id === v1Proc);
  expect(radek && radek.kind === 'process', 'GET /v1/maps nese kind');
  r = await v1('GET', `/maps/${v1Proc}`);
  expect(r.json.kind === 'process' && r.json.health && r.json.health.recurring === 0, `GET /v1/maps/{id}: kind + health u procesu (${JSON.stringify(r.json.health || {}).slice(0, 80)})`);
  r = await v1('GET', `/maps/${proj.id}`);
  expect(r.json.kind === 'project' && r.json.health === undefined, 'projekt health nemá');

  console.log('== MCP (HTTP) get_map a get_portfolio mluví o procesu ==');
  const mcp = async (name, args) => (await api('POST', '/mcp', { headers: { Authorization: `Bearer ${klic}` }, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })).json;
  let mr = await mcp('get_map', { map_id: v1Proc });
  const mText = JSON.stringify(mr);
  expect(/kind: process/.test(mText) && /keeps running/.test(mText), `get_map hlásí proces (${mText.slice(0, 160)})`);
  mr = await mcp('create_map', { title: 'MCP proces', kind: 'process', outline: [{ title: 'Krok' }] });
  expect(/kind: process/.test(JSON.stringify(mr)), 'MCP create_map kind=process');

  console.log('== Organizace (portfolio): proces bez %, se zdravím; jeho kroky nestagnují ==');
  await api('POST', '/api/kb/share', { token: tok(A), body: { mapId: proc.id, action: 'set_team_access', access: 'read' } });
  await api('POST', '/api/kb/share', { token: tok(A), body: { mapId: proj.id, action: 'set_team_access', access: 'read' } });
  r = await api('GET', `/api/kb/portfolio?today=${dnes}`, { token: tok(A) });
  const P = r.json;
  const pProc = (P.sections.projects || []).find((p) => p.id === proc.id);
  const pProj = (P.sections.projects || []).find((p) => p.id === proj.id);
  expect(pProc && pProc.kind === 'process' && pProc.pct === null, `proces v portfoliu: kind=process, pct=null (${pProc && pProc.pct})`);
  expect(pProc && pProc.health && pProc.health.recurring === 0, 'proces nese health');
  expect(pProj && pProj.kind === 'project' && typeof pProj.pct === 'number', 'projekt dál s %');
  expect(P.counts.processes === 1 && P.counts.projects === (P.sections.projects || []).length, `counts: processes=1, projects = všechny mapy jako dřív (${P.counts.processes}/${P.counts.projects})`);
  const idx = (id) => (P.sections.projects || []).findIndex((p) => p.id === id);
  expect(idx(proc.id) > idx(proj.id), 'procesy jsou v seznamu až za projekty');
  const stuckTitles = (P.sections.stuck || []).map((x) => x.title);
  expect(stuckTitles.includes('Projektový krok bez termínu'), `projektový krok bez pohybu stagnuje (${stuckTitles.join(', ')})`);
  expect(!stuckTitles.includes('Popis kroku bez rytmu'), 'krok PROCESU bez rytmu nestagnuje');
  expect((P.sections.overdue || []).some((x) => x.title === 'Vynést koše'), 'krok procesu po termínu je v „po termínu"');

  console.log('== Můj den: kroky procesu do „nehýbe se" nejdou, panel je přizná ==');
  r = await api('GET', `/api/kb/my-day?today=${dnes}`, { token: tok(A) });
  const D = r.json;
  const dStuck = (D.sections.stuck || []).map((x) => x.title);
  expect(dStuck.includes('Projektový krok bez termínu') && !dStuck.includes('Popis kroku bez rytmu'), `Můj den: stagnuje jen projektový krok (${dStuck.join(', ')})`);
  expect((D.stuckProcess || []).some((x) => x.title === 'Popis kroku bez rytmu') && D.counts.stuckProcess >= 1, `stuckProcess vysvětluje vynechaný krok (${JSON.stringify(D.stuckProcess)})`);
  const vSekcich = [].concat(D.sections.later || [], D.sections.noDate || []).map((x) => x.title);
  expect(vSekcich.includes('Popis kroku bez rytmu'), 'vynechaný krok procesu zůstal v sekci bez termínu');

  console.log('== odznak stagnace v editoru (/map-activity) u procesu prázdný ==');
  r = await api('GET', `/api/kb/map-activity?map=${proc.id}&today=${dnes}`, { token: tok(A) });
  expect(r.status === 200 && Object.keys(r.json.stagnant || {}).length === 0, `proces: žádné stagnující uzly (${JSON.stringify(r.json.stagnant)})`);
  r = await api('GET', `/api/kb/map-activity?map=${proj.id}&today=${dnes}`, { token: tok(A) });
  expect(Object.keys(r.json.stagnant || {}).includes('X'), 'projekt: krok X stagnuje (kontrola, že práh opravdu platí)');

  console.log('== /process-health: kdo mapu vidí; cizí 404, veřejná i bez přihlášení ==');
  r = await api('GET', `/api/kb/process-health?map=${proc.id}&today=${dnes}`, { token: tok(B) });
  expect(r.status === 200 && r.json.kind === 'process', `člen týmu (čtení) health vidí (${r.status})`);
  const cizi = (await api('POST', '/api/collections/goalmaps/records', { token: tok(C), body: { title: 'Cizí proces', kind: 'process', nodes: [], edges: [] } })).json;
  r = await api('GET', `/api/kb/process-health?map=${cizi.id}`, { token: tok(A) });
  expect(r.status === 404, `cizí soukromá mapa → 404 (${r.status})`);
  r = await api('GET', `/api/kb/process-health?map=${cizi.id}`);
  expect(r.status === 404, `anonym na soukromou → 404 (${r.status})`);
  await api('POST', '/api/kb/share', { token: tok(C), body: { mapId: cizi.id, action: 'toggle_public' } });
  const pub = await fresh(cizi.id, C);
  expect(!!pub.is_public, `mapa zveřejněná (/share toggle_public: ${pub.is_public})`);   // dřív expect(true…) — /checkup 29. 10.
  r = await api('GET', `/api/kb/process-health?map=${cizi.id}`);
  expect(r.status === 200 && r.json.recurring === 0 && r.json.runs30 === undefined && r.json.last === undefined,
    `veřejná mapa → anonym vidí rytmus a včas/po termínu, ne historii průchodů (${r.status} ${JSON.stringify(r.json).slice(0, 90)})`);
  r = await api('GET', `/api/kb/process-health?map=${cizi.id}`, { token: tok(C) });
  expect(r.status === 200 && r.json.runs30 === 0 && 'last' in r.json, `vlastník vidí i historii průchodů (${JSON.stringify(r.json).slice(0, 90)})`);
  r = await api('GET', `/api/kb/process-rhythms?maps=${cizi.id},${proj.id}`, { token: tok(A) });
  expect(r.status === 200 && r.json.maps && cizi.id in r.json.maps && proj.id in r.json.maps, `/process-rhythms: viditelné mapy naráz (${r.status} ${Object.keys((r.json || {}).maps || {}).length})`);
  r = await api('GET', `/api/kb/process-rhythms?maps=${cizi.id}`);
  expect(r.status === 401, `/process-rhythms bez přihlášení → 401 (${r.status})`);

  console.log('== export → import přenese styl ==');
  r = await api('POST', '/api/kb/map-import', { token: tok(A), body: { format: 'killbottleneck.map/1', map: { title: 'Import procesu', kind: 'process', nodes: [node('root', { apexText: 'Import', title: 'Import', status: 'todo' }, 'apexNode')], edges: [] } } });
  const impId = r.json && (r.json.id || (r.json.map && r.json.map.id));
  expect(r.status === 200 && impId && (await fresh(impId)).kind === 'process', `import s kind=process → proces (${r.status})`);
  r = await api('POST', '/api/kb/map-import', { token: tok(A), body: { format: 'killbottleneck.map/1', map: { title: 'Import org', kind: 'org', nodes: [node('root', { apexText: 'Org', title: 'Org', status: 'todo' }, 'apexNode')], edges: [] } } });
  const imp2 = r.json && (r.json.id || (r.json.map && r.json.map.id));
  expect(imp2 && (await fresh(imp2)).kind === '', 'import nikdy nezaloží org mapu');
  r = await api('GET', '/api/kb/export', { token: tok(A) });
  const exp = JSON.stringify(r.json || {});
  expect(r.status !== 200 || exp.includes('"kind":"process"'), 'export všech dat nese kind');

  console.log('== šablona procesu: systémová šablona nese map_kind ==');
  r = await api('GET', `/api/collections/templates/records?perPage=200&filter=${encodeURIComponent('owner = ""')}`, { token: tok(A) });
  const tpl = (r.json.items || []).find((x) => x.title === 'Týdenní provoz kanceláře');
  expect(tpl && tpl.map_kind === 'process' && (tpl.rules || []).length === 3, `systémová šablona procesu se 3 opakovacími pravidly (${tpl && tpl.map_kind})`);
  expect(tpl && tpl.rules.every((x) => x.actions.some((a) => a.type === 'reset_subtree')), 'pravidla šablony obnovují podkroky');
}, { nazev: 'PROCES-TYP' });
