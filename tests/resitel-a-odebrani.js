// Sedm pohledů (analýza 20. 8. 2026), jisté opravy z 25. 8. 2026:
//  P6-01  řešitel z v1 API/MCP musí být člen instance nebo viditelný externí
//         kontakt — neznámý e-mail = 400 s nápovědou (dřív libovolný řetězec,
//         úkol vypadal přiřazený a nikdo ho nedostal)
//  P6-02  GET /v1/members přes API klíč (dřív jen session) — členové + kontakty
//  P3-01  Můj den: counts.delegatedOverdue = mnou zadaná práce po termínu
//  P3-02  komu se práce odebere / předá jinému, dostane node_unassigned
//         (ze session PATCH i z v1 update_node)
// Čerstvý kontejner na :20531.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20531';
const NAME = 'flowmap-e2e-resitel';
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
  // starý build (mutační běh) vrací u neznámé routy SPA (HTML, 200) → json=null;
  // {} místo null, ať sada doběhne až ke konci a změří všechny kontroly
  return { status: res.status, json: json && typeof json === 'object' ? json : {} };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
const den = (posun) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + posun); return d.toISOString().slice(0, 10); };
const notifs = async (token, type) => ((await api('GET', '/api/collections/notifications/records?perPage=200', { token })).json.items || []).filter((n) => n.type === type);

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -p 20531:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    await reg('anna@x.cz'); await reg('bara@x.cz'); await reg('cyril@x.cz');
    const A = await login('anna@x.cz'), B = await login('bara@x.cz'), C = await login('cyril@x.cz');
    const keyOf = async (session, scope) =>
      (await api('POST', '/api/kb/api-keys', { token: session, body: { label: scope, scope } })).json.token;
    const aRW = await keyOf(A, 'read_write');
    const aR = await keyOf(A, 'read');
    // externí kontakt Anny (veřejný) + privátní kontakt Báry (Anna ho vidět nesmí)
    const ucetni = (await api('POST', '/api/collections/external_contacts/records', {
      token: A, body: { name: 'Účetní Nováková', note: '' } })).json;
    const tajny = (await api('POST', '/api/collections/external_contacts/records', {
      token: B, body: { name: 'Tajný dodavatel', note: '', private: true } })).json;
    const pseudo = (id) => `ext-${id}@kontakt.invalid`;

    console.log('== P6-02: /v1/members přes klíč ==');
    let r = await api('GET', '/api/kb/v1/members');
    expect(r.status === 401 && !!r.json.error, `bez klíče 401 (${r.status})`);
    r = await api('GET', '/api/kb/v1/members', { bearer: aR });
    const emails = (r.json.members || []).map((m) => m.email).sort();
    expect(r.status === 200 && emails.join(',') === 'anna@x.cz,bara@x.cz,cyril@x.cz', `read klíč vidí členy (${emails.join(',')})`);
    const m0 = (r.json.members || [])[0] || {};
    expect(m0.notify_prefs === undefined && m0.token_hash === undefined && 'role' in m0, 'bezpečná podmnožina polí (role ano, notify_prefs ne)');
    const kontakty = (r.json.external_contacts || []).map((c) => c.owner_email);
    expect(kontakty.includes(pseudo(ucetni.id)) && !kontakty.includes(pseudo(tajny.id)),
      `kontakty: veřejný ano, cizí privátní ne (${kontakty.join(',')})`);
    r = await api('GET', '/api/kb/members', { bearer: aR });
    expect(r.status === 401 || r.status === 403, `session routa /members klíčem dál NEjde (${r.status})`);

    console.log('== P6-01: řešitel jen člen / viditelný kontakt ==');
    r = await api('POST', '/api/kb/v1/maps', { bearer: aRW, body: { title: 'Projekt', tree: [
      { title: 'Krok', owner: 'nikdo@x.cz' }] } });
    expect(r.status === 400 && /nikdo@x\.cz/.test(r.json.error || ''), `create_map s neznámým řešitelem → 400 (${r.status}: ${r.json.error})`);
    r = await api('POST', '/api/kb/v1/maps', { bearer: aRW, body: { title: 'Projekt', tree: [
      { title: 'Krok', children: [{ title: 'Vnořený', owner: 'barra@x.cz' }] }] } });
    expect(r.status === 400 && /bara@x\.cz/.test(r.json.error || ''), `překlep ve vnořené položce → 400 s nápovědou „bara@x.cz" (${r.json.error})`);
    r = await api('POST', '/api/kb/v1/maps', { bearer: aRW, body: { title: 'Projekt', tree: [
      { title: 'Krok', owner: pseudo(tajny.id) }] } });
    expect(r.status === 400, `cizí privátní kontakt jako řešitel → 400 (${r.status})`);
    r = await api('POST', '/api/kb/v1/maps', { bearer: aRW, body: { title: 'Projekt', tree: [
      { title: 'Pro Báru', owner: 'bara@x.cz', deadline: den(-3) },
      { title: 'Pro účetní', owner: pseudo(ucetni.id) },
      { title: 'Velká písmena', owner: 'Cyril@x.cz' },
    ] } });
    expect(r.status === 200, `člen, vlastní kontakt i jiná velikost písmen projdou (${r.status}: ${r.json.error || ''})`);
    const mapId = r.json.id;
    let updated = r.json.updated;
    r = await api('GET', `/api/kb/v1/maps/${mapId}`, { bearer: aR });
    // tree[0] = vrchol, položky osnovy jsou jeho děti (stejně jako v v1-api.js)
    const kroky = ((r.json.tree || [])[0] || {}).children || [];
    const proBaru = kroky.find((n) => n.title === 'Pro Báru');
    const proUcetni = kroky.find((n) => n.title === 'Pro účetní');
    expect(!!proBaru && !!proUcetni, 'strom má oba kroky');
    r = await api('POST', `/api/kb/v1/maps/${mapId}/nodes`, { bearer: aRW, body: { base_updated: updated, items: [{ title: 'Další', owner: 'ghost@x.cz' }] } });
    expect(r.status === 400, `add_nodes s neznámým řešitelem → 400 (${r.status})`);
    r = await api('POST', `/api/kb/v1/maps/${mapId}/nodes/${(proUcetni || {}).id}`, { bearer: aRW, body: { base_updated: updated, owner: 'ghost@x.cz' } });
    expect(r.status === 400, `update_node s neznámým řešitelem → 400 (${r.status})`);
    r = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: A });
    expect((r.json.nodes || []).every((n) => (n.data || {}).owner !== 'ghost@x.cz'), 'do mapy se ghost@x.cz nedostal');

    console.log('== P3-01: „u druhých po termínu" v Můj den ==');
    r = await api('GET', `/api/kb/my-day?today=${den(0)}`, { token: A });
    expect(r.status === 200 && (r.json.counts || {}).delegatedOverdue === 1 && (r.json.counts || {}).overdue === 0,
      `Anna: vlastní po termínu 0, u druhých po termínu 1 (${(r.json.counts || {}).overdue}/${(r.json.counts || {}).delegatedOverdue})`);
    // Bára mapu NEVIDÍ (v1 create_map ji nesdílí — na rozdíl od OwnerSelect v UI,
    // který povýšení sdílení nabídne) → v jejím Můj den práce není. Známý rozdíl
    // API × UI, ne součást této opravy (zapsáno k rozhodnutí); tady se jen měří.
    r = await api('GET', `/api/kb/my-day?today=${den(0)}`, { token: B });
    expect((r.json.counts || {}).delegatedOverdue === 0, `Bára: u druhých 0 (${(r.json.counts || {}).delegatedOverdue})`);

    console.log('== P3-02: odebrání / předání práce se oznamuje ==');
    let assigned = await notifs(B, 'node_assigned');
    expect(assigned.length === 1, `Bára dostala node_assigned ze založení (${assigned.length})`);
    // v1 update_node: Anna PŘEDÁ krok Cyrilovi
    r = await api('GET', `/api/kb/v1/maps/${mapId}`, { bearer: aR }); updated = r.json.updated;
    r = await api('POST', `/api/kb/v1/maps/${mapId}/nodes/${(proBaru || {}).id}`, { bearer: aRW, body: { base_updated: updated, owner: 'cyril@x.cz' } });
    expect(r.status === 200, `předání kroku Cyrilovi přes v1 (${r.status})`);
    let un = await notifs(B, 'node_unassigned');
    expect(un.length === 1 && /jin|someone else/.test(un[0].text || ''), `Bára: node_unassigned „předán jinému" (${un.length}: ${(un[0] || {}).text})`);
    expect((await notifs(C, 'node_assigned')).length === 1, 'Cyril dostal node_assigned');
    // session PATCH (jako z editoru): Anna Cyrilovi krok ODEBERE (owner = "")
    r = await api('GET', `/api/collections/goalmaps/records/${mapId}`, { token: A });
    const nodes = (r.json.nodes || []).map((n) => (n.id === (proBaru || {}).id ? { ...n, data: { ...n.data, owner: '' } } : n));
    r = await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: A, body: { nodes } });
    expect(r.status === 200, `odebrání řešitele PATCHem mapy (${r.status})`);
    un = await notifs(C, 'node_unassigned');
    expect(un.length === 1 && /odebral|off your plate/.test(un[0].text || ''), `Cyril: node_unassigned „odebral" (${un.length}: ${(un[0] || {}).text})`);
    expect((await notifs(B, 'node_unassigned')).length === 1, 'Bára nedostala nic navíc (jen původní předání)');
    // sám sobě nic: Anna si krok vezme a zase pustí
    const nodes2 = nodes.map((n) => (n.id === (proBaru || {}).id ? { ...n, data: { ...n.data, owner: 'anna@x.cz' } } : n));
    await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: A, body: { nodes: nodes2 } });
    await api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: A, body: { nodes } });
    expect((await notifs(A, 'node_unassigned')).length === 0, 'vlastní odebrání se sobě neoznamuje');
    // typ musí být v katalogu (select v kolekci) — jinak by zápis padal tiše
    r = await api('GET', '/api/collections/notifications/records?perPage=1', { token: B });
    expect(r.status === 200, 'notifikace čitelné (typ prošel migrací select pole)');
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} resitel-a-odebrani: ${pass} OK, ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
