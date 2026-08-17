// ORGANIZAČNÍ STRUKTURA (mapa kind='org') — server e2e:
//  - založení jen adminem, IDEMPOTENTNÍ (druhá org mapa nikdy nevznikne)
//  - `kind` je server-spravované pole: create/PATCH ho z requestu zahodí
//  - /org-structure čte každý člen; /org-structure/assign jen admin
//    (validace: jen členové, držitel ≠ zástupce)
//  - úkoly a přílohy na org mapu NEPATŘÍ (400) — popisuje kdo je kdo, ne práci
//  - přejmenování organizace (org_settings) se propíše do vrcholu mapy
//  - druhý admin dostane edit sdílení (strukturu kreslí všichni admini)
const { execSync } = require('child_process');

const NAME = 'kb-e2e-org-map';
const PORT = 20791;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0, code = 1;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    await reg('a@example.com'); // první = admin
    await reg('b@example.com');
    await reg('c@example.com');
    const A = await login('a@example.com');
    const B = await login('b@example.com');

    console.log('== založení: jen admin, idempotentní ==');
    let r = await api('POST', '/api/kb/org-map', { token: B });
    expect(r.status === 403, `člen org mapu nezaloží (${r.status})`);
    r = await api('POST', '/api/kb/org-map', { token: A });
    expect(r.status === 200 && r.json.map && r.json.map.kind === 'org', 'admin založil org mapu (kind=org v DTO)');
    const orgId = r.json.map.id;
    const apex = (r.json.map.nodes || []).find((n) => n.type === 'apexNode');
    expect(!!apex && apex.data.apexText === 'Organizační struktura', 'vrchol nese výchozí název (org_settings zatím prázdné)');
    r = await api('POST', '/api/kb/org-map', { token: A });
    expect(r.status === 200 && r.json.map.id === orgId, 'druhé založení vrátí TUTÉŽ mapu (idempotence)');

    console.log('== kind je server-spravované pole ==');
    r = await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Falešná org', kind: 'org', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'x', title: 'x', status: 'todo' } }], edges: [] } });
    expect(r.status === 200 && !r.json.kind, `create hook kind z requestu zahodil (kind="${r.json.kind || ''}")`);
    const fakeId = r.json.id;
    r = await api('PATCH', `/api/collections/goalmaps/records/${fakeId}`, { token: A, body: { kind: 'org' } });
    expect(!((await api('GET', `/api/collections/goalmaps/records/${fakeId}`, { token: A })).json.kind), 'PATCH kind neprojde (server-spravované)');
    r = await api('GET', '/api/kb/org-structure', { token: B });
    expect(r.json.map_id === orgId, 'org mapa je pořád jen jedna (ta pravá)');

    console.log('== pozice: strom kreslí admin, tabulku čte každý ==');
    const f = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: A, body: {
      nodes: f.nodes.concat([
        { id: 'pos1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Kvality manager', status: 'todo', positionKind: 'position' } },
        { id: 'fun1', type: 'goalNode', position: { x: 200, y: 200 }, data: { title: 'Interní auditor', status: 'todo', positionKind: 'function' } },
      ]),
      edges: [{ id: 'e1', source: apex.id, target: 'pos1' }, { id: 'e2', source: apex.id, target: 'fun1' }],
      base_updated: f.updated,
    } });
    expect(r.status === 200, `admin nakreslil pozice (${r.status})`);
    r = await api('GET', '/api/kb/org-structure', { token: B });
    const rows = r.json.positions || [];
    expect(rows.length === 2 && rows.some((x) => x.title === 'Kvality manager' && x.position_kind === 'position')
      && rows.some((x) => x.title === 'Interní auditor' && x.position_kind === 'function'),
      'člen vidí strukturu vč. rozlišení pozice/funkce');

    console.log('== jmenování držitele a zástupce (assign) ==');
    r = await api('POST', '/api/kb/org-structure/assign', { token: B, body: { node_id: 'pos1', holder: 'b@example.com' } });
    expect(r.status === 403, `člen nejmenuje (${r.status})`);
    r = await api('POST', '/api/kb/org-structure/assign', { token: A, body: { node_id: 'pos1', holder: 'b@example.com', deputy: 'c@example.com' } });
    expect(r.status === 200 && r.json.position.holder === 'b@example.com' && r.json.position.deputy === 'c@example.com',
      'admin jmenoval držitele i zástupce pozice');
    r = await api('POST', '/api/kb/org-structure/assign', { token: A, body: { node_id: 'pos1', deputy: 'nikdo@jinde.example' } });
    expect(r.status === 400, `zástupce-nečlen se odmítne (${r.status})`);
    r = await api('POST', '/api/kb/org-structure/assign', { token: A, body: { node_id: 'pos1', deputy: 'b@example.com' } });
    expect(r.status === 400, `držitel ≠ zástupce téže pozice (${r.status})`);
    r = await api('POST', '/api/kb/org-structure/assign', { token: A, body: { node_id: 'neexistuje', holder: 'b@example.com' } });
    expect(r.status === 404, `neexistující pozice = 404 (${r.status})`);
    const mapNode = ((await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json.nodes || []).find((n) => n.id === 'pos1');
    expect(mapNode.data.holder === 'b@example.com' && mapNode.data.deputy === 'c@example.com',
      'jmenování je vidět PŘÍMO v mapě (jeden zdroj pravdy)');

    console.log('== úkoly a přílohy na org mapu nepatří ==');
    r = await api('POST', '/api/collections/tasks/records', { token: A, body: { title: 'Úkol na pozici', status: 'todo', map: orgId, node_id: 'pos1' } });
    expect(r.status === 400 || r.status === 403, `položka se odmítne všude — create je zakázaný (${r.status})`);
    r = await api('POST', '/api/collections/node_files/records', { token: A, body: { map: orgId, node_id: 'pos1', name: 'odkaz', url: 'https://example.com' } });
    expect(r.status === 400, `příloha na org mapě se odmítne (${r.status})`);

    console.log('== přejmenování organizace se propíše do vrcholu ==');
    r = await api('POST', '/api/collections/org_settings/records', { token: A, body: { name: 'Tengo s.r.o.' } });
    const orgSetId = r.json.id;
    await api('PATCH', `/api/collections/org_settings/records/${orgSetId}`, { token: A, body: { name: 'Tengo Labs s.r.o.' } });
    const apex2 = ((await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json.nodes || []).find((n) => n.type === 'apexNode');
    expect(apex2.data.apexText === 'Tengo Labs s.r.o.', 'vrchol org mapy nese nový název organizace');

    console.log('== druhý admin dostane edit sdílení ==');
    const bId = (await api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="b@example.com"')}`, { token: ST })).json.items[0].id;
    await api('PATCH', `/api/collections/users/records/${bId}`, { token: A, body: { role: 'admin' } });
    await api('POST', '/api/kb/org-map', { token: A }); // dorovnání sdílení
    const shares = (await api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${orgId}"`)}`, { token: ST })).json.items || [];
    expect(shares.some((s) => s.email === 'b@example.com' && s.permission === 'edit'), 'admin b má edit v map_shares (autorita)');
    r = await api('POST', '/api/kb/org-structure/assign', { token: B, body: { node_id: 'fun1', holder: 'a@example.com' } });
    expect(r.status === 200, `nový admin jmenuje přes assign (${r.status})`);

    console.log('== opravy z panelu: jmenování nejde obejít přímým PATCHem ==');
    const zmenPole = (nodes, id, pole, val) => nodes.map((n) => (n.id === id ? Object.assign({}, n, { data: Object.assign({}, n.data, { [pole]: val }) }) : n));
    let f2 = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: A, body: { nodes: zmenPole(f2.nodes, 'pos1', 'holder', 'cizi@nikde.example'), edges: f2.edges, base_updated: f2.updated } });
    expect(r.status === 400, `nečlen jako držitel přes přímý PATCH = 400 (${r.status})`);
    f2 = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: A, body: { nodes: zmenPole(f2.nodes, 'pos1', 'holder', 'c@example.com'), edges: f2.edges, base_updated: f2.updated } });
    expect(r.status === 400, `držitel=zástupce přes přímý PATCH = 400 (${r.status})`);

    console.log('== admin zakládá účet: deputy se validuje ==');
    r = await api('POST', '/api/collections/users/records', { token: A, body: { email: 'novy@example.com', password: PW, passwordConfirm: PW, deputy: 'neexistuje@example.com' } });
    expect(r.status === 400, `pozvánka s neplatným zástupcem = 400 (${r.status})`);

    console.log('== degradace admina odebere edit org mapy ==');
    await api('PATCH', `/api/collections/users/records/${bId}`, { token: A, body: { role: 'user' } });
    const sh2 = (await api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${orgId}"`)}`, { token: ST })).json.items || [];
    expect(!sh2.some((s) => s.email === 'b@example.com' && s.permission === 'edit'), 'map_shares po degradaci bez editu pro b');
    f2 = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: B, body: { nodes: f2.nodes, edges: f2.edges, base_updated: f2.updated } });
    expect(r.status >= 400, `degradovaný admin org mapu NEedituje (${r.status})`);
    r = await api('DELETE', `/api/collections/goalmaps/records/${orgId}`, { token: B });
    expect(r.status >= 400, `degradovaný admin org mapu NEsmaže (${r.status})`);

    console.log('== smazání člena uklidí zastupování ==');
    const cId = (await api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="c@example.com"')}`, { token: ST })).json.items[0].id;
    await api('DELETE', `/api/collections/users/records/${cId}`, { token: A });
    let struct = (await api('GET', '/api/kb/org-structure', { token: A })).json;
    expect((struct.positions.find((p) => p.node_id === 'pos1') || {}).deputy === '', 'smazaný ZÁSTUPCE z pozice zmizel');
    await api('DELETE', `/api/collections/users/records/${bId}`, { token: A }); // b drží pos1
    struct = (await api('GET', '/api/kb/org-structure', { token: A })).json;
    expect((struct.positions.find((p) => p.node_id === 'pos1') || {}).holder === '', 'pozice po odchodu DRŽITELE neobsazená');
    const no = (await api('GET', `/api/collections/notifications/records?perPage=50&filter=${encodeURIComponent('type="org_notice"')}`, { token: A })).json.items || [];
    expect(no.length >= 1 && no.some((n) => n.text.includes('Kvality manager')), 'admin dostal zprávu, že se pozice uvolnila');

    console.log('== archivovaná org mapa = struktura vypnutá, druhá nevznikne ==');
    f2 = (await api('GET', `/api/collections/goalmaps/records/${orgId}`, { token: A })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${orgId}`, { token: A, body: { archived: true, base_updated: f2.updated } });
    expect(r.status === 200, `admin-vlastník org mapu archivoval (${r.status})`);
    r = await api('GET', '/api/kb/org-structure', { token: A });
    expect(r.json.exists === false, 'archivovaná struktura platí jako neexistující');
    r = await api('POST', '/api/kb/org-map', { token: A });
    expect(r.status === 200 && r.json.map.id === orgId, 'založení vrátí TUTÉŽ (archivovanou) mapu — druhá nikdy nevznikne');

    console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    code = 1;
  } finally {
    // ⚠️ process.exit AŽ ZA úklidem (vzor rules-engine)
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  process.exit(code);
})();
