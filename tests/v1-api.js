// ⚠️ Rozpočet: klíč aRW má write rate-limit 30/min a test s ním dělá ~23 zápisů
// (počítá se KAŽDÝ autentizovaný write pokus vč. 400/404/409). Při přidávání
// checků s aRW hlídej součet, jinak test začne flakat na 429 — klidně si vydej
// další klíč (create klíče jde přes session, nepočítá se).
// v1 API pro MCP/integrace (autentizace API klíčem): scope vynucení, izolace
// uživatelů (cizí = 404), create_map → get_map roundtrip, add_nodes + konflikt 409
// + řetězení updated, update_node (vč. odblokování → notifikace), delete_node
// podstromu (apex zakázán), odstraněné /v1/tasks (410 + zákaz create), normalizace vstupu,
// rate-limit 429, body 413, žádná eskalace klíčem. Čerstvý kontejner na :20502.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20502';
const NAME = 'flowmap-e2e-v1api';
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, { token, bearer, body } = {}) => {
  const res = await fetch(BASE + path, {
    method, headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p 20502:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    await reg('a@x.cz'); await reg('b@x.cz');
    const A = await login('a@x.cz'), B = await login('b@x.cz');
    const keyOf = async (session, scope) =>
      (await api('POST', '/api/flowmap/api-keys', { token: session, body: { label: scope, scope } })).json.token;
    const aRW = await keyOf(A, 'read_write');
    const aRO = await keyOf(A, 'read');
    const bRW = await keyOf(B, 'read_write');
    // base_updated je povinné → před každým zápisem si vyzvedni aktuální verzi mapy
    const ver = async (mid) => (await api('GET', `/api/flowmap/v1/maps/${mid}`, { bearer: aRW })).json.updated;

    console.log('== scope ==');
    let r = await api('POST', '/api/flowmap/v1/maps', { bearer: aRO, body: { title: 'x' } });
    expect(r.status === 403, `read klíč nesmí zapisovat (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: aRO });
    expect(r.status === 200, `read klíč čte (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: aRW });
    expect(r.status === 200, `read_write klíč čte taky (${r.status})`);

    console.log('== create_map ze stromu ==');
    r = await api('POST', '/api/flowmap/v1/maps', { bearer: aRW, body: {
      title: 'Vydání aplikace', apex_text: 'Vydat aplikaci v1.0',
      tree: [
        { title: 'Příprava', deadline: '2026-09-01', children: [
          { title: 'Napsat changelog' },
          { title: 'Otestovat build', status: 'done' },
        ] },
        { title: 'Nasazení', owner: 'b@x.cz', wait_for_children: true, children: [{ title: 'Deploy skript' }] },
      ] } });
    expect(r.status === 200 && r.json.id && r.json.updated, `create_map 200 s id+updated (${r.status})`);
    const mapId = r.json.id;
    let updated = r.json.updated;
    expect(r.json.tree.length === 1 && r.json.tree[0].type === 'apex' && r.json.tree[0].title === 'Vydat aplikaci v1.0',
      'odpověď = strom s apexem');
    expect(r.json.tree[0].children.length === 2 && r.json.tree[0].children[0].title === 'Příprava'
      && r.json.tree[0].children[0].children[1].status === 'done',
      'strom drží pořadí, vnořené položky i status');
    // layout: pozice reálně rozložené (přes session zkontrolovat nodes)
    r = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: A });
    const xs = new Set(r.json.nodes.map((n) => n.position.x));
    const ys = new Set(r.json.nodes.map((n) => n.position.y));
    expect(r.json.nodes.length === 6 && ys.size >= 3 && xs.size >= 2,
      `layout dopočítal pozice (6 uzlů, ${ys.size} úrovní)`);
    expect(r.json.owner_email === 'a@x.cz', 'owner z klíče, ne z body');
    r = await api('POST', '/api/flowmap/v1/maps', { bearer: aRW, body: { tree: [] } });
    expect(r.status === 400, `create_map bez title 400 (${r.status})`);
    r = await api('POST', '/api/flowmap/v1/maps', { bearer: aRW, body: { title: 'x', tree: [{ title: 'a', deadline: 'pozítří' }] } });
    expect(r.status === 400, `nesmyslný deadline 400 (${r.status})`);
    const many = Array.from({ length: 201 }, (_, i) => ({ title: 't' + i }));
    r = await api('POST', '/api/flowmap/v1/maps', { bearer: aRW, body: { title: 'x', tree: many } });
    expect(r.status === 400, `>200 položek 400 (${r.status})`);

    console.log('== get_map + izolace ==');
    r = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { bearer: aRW });
    expect(r.status === 200 && r.json.tree[0].children.length === 2, `get_map vrací strom (${r.status})`);
    const child1 = r.json.tree[0].children[0].children[0]; // Napsat changelog
    const waitNode = r.json.tree[0].children[1]; // Nasazení (wait_for_children, owner b)
    const waitChild = waitNode.children[0]; // Deploy skript
    r = await api('GET', `/api/flowmap/v1/maps/${mapId}`, { bearer: bRW });
    expect(r.status === 404, `cizí klíč mapu nevidí — 404, ne 403 (${r.status})`);
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes`, { bearer: bRW, body: { items: [{ title: 'hack' }] } });
    expect(r.status === 404, `cizí klíč nepřidá uzly (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps/neexistuje123', { bearer: aRW });
    expect(r.status === 404, `neexistující mapa 404 — stejné jako cizí (${r.status})`);

    console.log('== add_nodes + konflikt ==');
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes`, { bearer: aRW,
      body: { parent_id: child1.id, items: [{ title: 'Podbod A' }, { title: 'Podbod B' }], base_updated: updated } });
    expect(r.status === 200 && r.json.added_ids.length === 2, `add_nodes pod uzel (${r.status})`);
    expect(r.json.updated && r.json.updated !== updated, 'updated se posunul');
    const staleUpdated = updated;
    updated = r.json.updated;
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes`, { bearer: aRW,
      body: { items: [{ title: 'X' }], base_updated: staleUpdated } });
    expect(r.status === 409, `stará base_updated → 409 (${r.status})`);
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes`, { bearer: aRW,
      body: { items: [{ title: 'X' }] } });
    expect(r.status === 400, `CHYBÍ base_updated → 400 (povinné, ${r.status})`);
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes`, { bearer: aRW,
      body: { items: [{ title: 'Na apex bez parent_id' }], base_updated: updated } });
    expect(r.status === 200, `bez parent_id se věší na apex (${r.status})`);
    updated = r.json.updated;
    expect(r.json.tree[0].children.length === 3, 'apex má 3 děti');
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes`, { bearer: aRW,
      body: { parent_id: 'ghost', items: [{ title: 'x' }], base_updated: updated } });
    expect(r.status === 404, `neexistující parent 404 (${r.status})`);

    console.log('== update_node + odblokování ==');
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${child1.id}`, { bearer: aRW,
      body: { title: 'Changelog hotový text', deadline: '2026-08-15', base_updated: updated } });
    expect(r.status === 200 && r.json.node.title === 'Changelog hotový text', `update title+deadline (${r.status})`);
    updated = r.json.updated;
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${child1.id}`, { bearer: aRW, body: { status: 'hotovo', base_updated: updated } });
    expect(r.status === 400, `neznámý status 400, ne tichý fallback (${r.status})`);
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/ghost`, { bearer: aRW, body: { status: 'done', base_updated: updated } });
    expect(r.status === 404, `neznámý uzel 404 (${r.status})`);
    // dokončení posledního dítěte čekajícího uzlu (owner b@x.cz) → node_unblocked pro B
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${waitChild.id}`, { bearer: aRW, body: { status: 'done', base_updated: updated } });
    expect(r.status === 200, `dokončení dítěte čekajícího uzlu (${r.status})`);
    updated = r.json.updated;
    r = await api('GET', '/api/collections/notifications/records', { token: B });
    const unb = (r.json.items || []).filter((n) => n.type === 'node_unblocked');
    expect(unb.length === 1, `B dostal node_unblocked notifikaci jako z UI (${unb.length})`);
    // pozice se update_nodem nemění (žádný relayout) — ověř přes session
    r = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: A });
    const posOk = r.json.nodes.every((n) => typeof n.position.x === 'number');
    expect(posOk && r.json.nodes.find((n) => n.data && n.data.title === 'Changelog hotový text'),
      'data zapsána, pozice zůstaly číselné');

    console.log('== delete_node podstromu ==');
    const treeNow = (await api('GET', `/api/flowmap/v1/maps/${mapId}`, { bearer: aRW })).json;
    const priprava = treeNow.tree[0].children.find((c) => c.title === 'Příprava');
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${priprava.id}/delete`, { bearer: aRW, body: { base_updated: await ver(mapId) } });
    expect(r.status === 200 && r.json.deleted_count === 5, `smazán uzel + podstrom (${r.json.deleted_count} uzlů)`);
    const apexId = treeNow.tree[0].id;
    r = await api('POST', `/api/flowmap/v1/maps/${mapId}/nodes/${apexId}/delete`, { bearer: aRW, body: { base_updated: await ver(mapId) } });
    expect(r.status === 400, `apex smazat nejde (${r.status})`);
    // smazání posledního nehotového dítěte čekajícího uzlu → node_unblocked jako z UI
    r = await api('POST', '/api/flowmap/v1/maps', { bearer: aRW, body: { title: 'Unblock delete', tree: [
      { title: 'Čekárna', owner: 'b@x.cz', wait_for_children: true, children: [{ title: 'Brzda' }] },
    ] } });
    const ubMapId = r.json.id;
    const brzdaId = ((await api('GET', `/api/flowmap/v1/maps/${ubMapId}`, { bearer: aRW })).json
      .tree[0].children[0].children[0] || {}).id;
    r = await api('POST', `/api/flowmap/v1/maps/${ubMapId}/nodes/${brzdaId}/delete`, { bearer: aRW, body: { base_updated: await ver(ubMapId) } });
    expect(r.status === 200, `smazání blokujícího dítěte (${r.status})`);
    r = await api('GET', '/api/collections/notifications/records', { token: B });
    expect((r.json.items || []).filter((n) => n.type === 'node_unblocked').length === 2,
      'delete_node poslal node_unblocked jako z UI');

    console.log('== legacy data (tolerance nedotčených uzlů) ==');
    // mapa se "starými" hodnotami (deadline mimo formát, dlouhý title, cizí status)
    // založená přes UI cestu (kolekce) — v1 zápis JINÉHO uzlu ji nesmí rozbít ani změnit
    const longTitle = 'Ž'.repeat(300);
    r = await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Legacy', nodes: [
      { id: 'lg1', type: 'goalNode', position: { x: 0, y: 0 },
        data: { title: longTitle, status: 'stary-stav', description: '', deadline: '31.12.', owner: '' } },
      { id: 'lg2', type: 'goalNode', position: { x: 300, y: 0 },
        data: { title: 'Normální', status: 'todo', description: '', deadline: '', owner: '' } },
    ], edges: [] } });
    const legacyMapId = r.json.id;
    r = await api('POST', `/api/flowmap/v1/maps/${legacyMapId}/nodes/lg2`, { bearer: aRW, body: { status: 'done', base_updated: await ver(legacyMapId) } });
    expect(r.status === 200, `v1 update vedle legacy uzlu projde (${r.status})`);
    r = await api('GET', `/api/collections/goalmaps/records/${legacyMapId}`, { token: A });
    const lg1 = r.json.nodes.find((n) => n.id === 'lg1');
    expect(lg1.data.title === longTitle && lg1.data.status === 'stary-stav' && lg1.data.deadline === '31.12.',
      'nedotčený legacy uzel zůstal beze změny (title/status/deadline)');

    console.log('== tasks: rozhraní odstraněno (slovník 17. 8. 2026) ==');
    // Úkol = uzel s řešitelem nebo termínem. Samostatné položky zanikly:
    // v1 rozhraní vrací 410 s vysvětlením a PB kolekce tasks nejde plnit
    // uživatelem (create hook 403) — jediná cesta k práci je /nodes.
    r = await api('GET', `/api/flowmap/v1/tasks?map=${mapId}`, { bearer: aRW });
    expect(r.status === 410 && /node|uzel/i.test(r.json.error || ''),
      `GET /v1/tasks → 410 s vysvětlením (${r.status})`);
    r = await api('POST', '/api/flowmap/v1/tasks', { bearer: aRW,
      body: { title: 'Zavolat klientovi', map: mapId, node_id: 'x' } });
    expect(r.status === 410, `POST /v1/tasks → 410 (${r.status})`);
    r = await api('POST', '/api/flowmap/v1/tasks/nejake-id', { bearer: aRW, body: { status: 'done' } });
    expect(r.status === 410, `POST /v1/tasks/{id} → 410 (${r.status})`);
    // 410 chodí i bez platného klíče? Ne — autentizace se drží (401 bez klíče),
    // ať odstraněná cesta neprozrazuje nic anonymům.
    r = await api('GET', '/api/flowmap/v1/tasks');
    expect(r.status === 401, `GET /v1/tasks bez klíče → 401, ne 410 (${r.status})`);
    // PB kolekce: uživatelské založení položky je zakázané (superuser = fixtury)
    r = await api('POST', '/api/collections/tasks/records', { token: A,
      body: { title: 'Pokus o položku', map: mapId, status: 'todo' } });
    // dvě vrstvy zákazu: createRule=null (400 z pravidel) + hook (403) — obě znamenají NE
    expect(r.status === 400 || r.status === 403, `create v kolekci tasks jako uživatel neprojde (${r.status})`);

    console.log('== limity a eskalace ==');
    r = await api('POST', '/api/flowmap/v1/maps', { bearer: aRW,
      body: { title: 'big', description: 'x'.repeat(2 * 1024 * 1024 + 100), tree: [] } });
    expect(r.status === 413, `tělo >2 MB → 413 (${r.status})`);
    r = await api('GET', '/api/flowmap/ai-settings', { bearer: aRW });
    expect(r.status === 401, `API klíč nefunguje na ai-settings (${r.status})`);
    r = await api('GET', '/api/collections/goalmaps/records', { bearer: aRW });
    const pbItems = (r.json && r.json.items) || [];
    if (r.status === 200 && !r.json) console.log('  DEBUG PB kolekce: status 200, body není JSON');
    expect(r.status !== 200 || pbItems.length === 0,
      `API klíč neotevře PB kolekce (${r.status}, ${pbItems.length} záznamů)`);
    // rate-limit: write 30/min na klíč — 31. zápis v jedné minutě spadne
    const rlKey = await keyOf(B, 'read_write');
    r = await api('POST', '/api/flowmap/v1/maps', { bearer: rlKey, body: { title: 'RL', tree: [] } });
    const rlMap = r.json.id;
    let got429 = false;
    // 70 pokusů: i při přetečení minutového okna uprostřed smyčky se limit
    // (30 zápisů/min) v některém okně naplní
    for (let i = 0; i < 70 && !got429; i++) {
      const rr = await api('POST', `/api/flowmap/v1/maps/${rlMap}/nodes`, { bearer: rlKey, body: { items: [{ title: 'n' + i }] } });
      if (rr.status === 429) got429 = true;
    }
    expect(got429, 'write rate-limit 429 (30 zápisů/min na klíč)');
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 200));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
