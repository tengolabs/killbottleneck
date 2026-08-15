// Regrese na dvě bezpečnostní díry nalezené panelem 2026-07-26.
//
// 1) RLS nových kolekcí (node_files, agent_runs) používala `map.shared_with ~ …`.
//    `~` je v PocketBase PODŘETĚZEC, ne shoda prvku, takže mapa sdílená
//    s `bob@firma.cz` byla přístupná komukoli, kdo si zaregistruje `b@firma.cz`.
//    Stejnou chybu už repo jednou řešilo (migrace 1751900001 → 013), proto tenhle
//    test: aby se potřetí nevrátila.
//    POZOR: čte se přes kolekci i přes /api/files (soubor je `protected`, ale
//    `protected` řeší jen token, ne to, ČÍ soubor to je).
//
// 2) `automationRequestedBy` je serverem spravované pole. Když si ho klient smí
//    nastavit, vznikne kanál na doručení libovolného textu libovolnému uživateli:
//    útočník ve VLASTNÍ mapě označí za žadatele oběť, dopíše automatizaci a oběti
//    přistane notifikace s jeho textem.
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-share-rules';
const PORT = 20517;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

const uploadFile = async (token, mapId, nodeId, name, content) => {
  const form = new FormData();
  form.append('map', mapId);
  form.append('node_id', nodeId);
  form.append('name', name);
  form.append('size', String(content.length));
  form.append('file', new Blob([content], { type: 'text/plain' }), name);
  const res = await fetch(`${BASE}/api/collections/node_files/records`, { method: 'POST', headers: { Authorization: token }, body: form });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

const nodesWith = (extra) => ([
  { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
  { id: 'n1', type: 'goalNode', position: { x: 0, y: 100 }, data: Object.assign({ title: 'Krok', status: 'todo' }, extra) },
]);
const EDGES = [{ id: 'e1', source: 'root', target: 'n1' }];

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    // bob@ = legitimní kolega, b@ = útočník s e-mailem, který je PODŘETĚZCEM
    await reg('alice@firma.cz');
    await reg('bob@firma.cz');
    await reg('b@firma.cz');
    const ALICE = await login('alice@firma.cz');
    const BOB = await login('bob@firma.cz');
    const MALLORY = await login('b@firma.cz');

    const map = (await api('POST', '/api/collections/goalmaps/records', {
      token: ALICE, body: { title: 'Soukromá', nodes: nodesWith({}), edges: EDGES },
    })).json;
    await api('POST', '/api/flowmap/share', { token: ALICE, body: { action: 'share', mapId: map.id, email: 'bob@firma.cz', permission: 'edit' } });
    const up = await uploadFile(ALICE, map.id, 'n1', 'tajne.txt', 'DUVERNY OBSAH');
    expect(up.status === 200, `Alice nahrála přílohu (${up.status})`);
    const fileId = up.json.id;

    console.log('== podřetězcový e-mail se k cizím datům NEDOSTANE ==');
    let r = await api('GET', '/api/collections/node_files/records', { token: MALLORY });
    expect(r.json?.totalItems === 0, `útočník nevidí přílohy ve výpisu (${r.json?.totalItems})`);
    r = await api('GET', `/api/collections/node_files/records/${fileId}`, { token: MALLORY });
    expect(r.status === 404 || r.status === 403, `útočník nepřečte záznam přílohy (${r.status})`);
    r = await api('GET', '/api/collections/agent_runs/records', { token: MALLORY });
    expect(r.json?.totalItems === 0, `útočník nevidí běhy automatizací (${r.json?.totalItems})`);
    r = await uploadFile(MALLORY, map.id, 'n1', 'podvrh.txt', 'x');
    expect(r.status === 400 || r.status === 403, `útočník NENAHRAJE přílohu do cizí mapy (${r.status})`);

    // soubor je `protected` — token řeší JEN autentizaci, ne vlastnictví,
    // takže vlastní token útočníka nesmí stačit na cizí soubor
    const tok = await fetch(`${BASE}/api/files/token`, { method: 'POST', headers: { Authorization: MALLORY } });
    const fileToken = (await tok.json()).token;
    const dl = await fetch(`${BASE}/api/files/node_files/${fileId}/${up.json.file}?token=${fileToken}`);
    expect(dl.status !== 200, `útočník nestáhne obsah cizí přílohy (${dl.status})`);

    console.log('== legitimní přístup zůstal ==');
    r = await api('GET', '/api/collections/node_files/records', { token: BOB });
    expect(r.json?.totalItems === 1, `kolega se sdílením přílohu vidí (${r.json?.totalItems})`);
    r = await uploadFile(BOB, map.id, 'n1', 'kolega.txt', 'ok');
    expect(r.status === 200, `kolega s právem úprav přílohu nahraje (${r.status})`);
    r = await api('GET', '/api/collections/node_files/records', { token: ALICE });
    expect(r.json?.totalItems === 2, `vlastník vidí obě přílohy (${r.json?.totalItems})`);

    console.log('== sdílení jen pro čtení nesmí nahrávat (spouští automatizaci) ==');
    await reg('read@firma.cz');
    const READER = await login('read@firma.cz');
    await api('POST', '/api/flowmap/share', { token: ALICE, body: { action: 'share', mapId: map.id, email: 'read@firma.cz', permission: 'read' } });
    r = await api('GET', '/api/collections/node_files/records', { token: READER });
    expect(r.json?.totalItems === 2, `čtenář přílohy vidí (${r.json?.totalItems})`);
    r = await uploadFile(READER, map.id, 'n1', 'ctenar.txt', 'x');
    expect(r.status === 400 || r.status === 403, `čtenář přílohu NENAHRAJE (${r.status})`);

    console.log('== nepřihlášený host ==');
    r = await api('GET', '/api/collections/node_files/records');
    expect(!r.json?.totalItems, `host nevidí nic (${r.json?.totalItems})`);

    console.log('== žadatele o automatizaci plní server, ne klient ==');
    // útočník ve VLASTNÍ mapě označí za žadatele oběť
    const spoof = (await api('POST', '/api/collections/goalmaps/records', {
      token: MALLORY,
      body: {
        title: 'Podvrh',
        nodes: nodesWith({ title: 'PODVRŽENÝ TEXT', automationWanted: true, automationRequestedBy: 'bob@firma.cz' }),
        edges: EDGES,
      },
    })).json;
    let saved = (await api('GET', `/api/collections/goalmaps/records/${spoof.id}`, { token: MALLORY })).json;
    expect(saved.nodes.find((n) => n.id === 'n1').data.automationRequestedBy === 'b@firma.cz',
      `server přepsal žadatele na skutečného autora (${saved.nodes.find((n) => n.id === 'n1').data.automationRequestedBy})`);

    // a teď dopsat automatizaci → notifikace smí jít jen útočníkovi samotnému
    const bobBefore = (await api('GET', `/api/collections/notifications/records?perPage=1&filter=${encodeURIComponent('type="automation_ready"')}`, { token: BOB })).json.totalItems;
    await api('PATCH', `/api/collections/goalmaps/records/${spoof.id}`, {
      token: MALLORY,
      body: {
        nodes: saved.nodes.map((n) => (n.id === 'n1'
          ? { ...n, data: { ...n.data, executorKind: 'automation', executorName: 'n8n podvrh' } } : n)),
        edges: EDGES,
      },
    });
    const bobAfter = (await api('GET', `/api/collections/notifications/records?perPage=1&filter=${encodeURIComponent('type="automation_ready"')}`, { token: BOB })).json.totalItems;
    expect(bobAfter === bobBefore, `oběti nepřistála podvržená notifikace (${bobBefore} → ${bobAfter})`);

    console.log('== odškrtnuté přání pole uklidí ==');
    saved = (await api('GET', `/api/collections/goalmaps/records/${spoof.id}`, { token: MALLORY })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${spoof.id}`, {
      token: MALLORY,
      body: {
        nodes: saved.nodes.map((n) => (n.id === 'n1'
          ? { ...n, data: { ...n.data, automationWanted: true, automationRequestedBy: 'bob@firma.cz', executorName: '', executorKind: 'human' } } : n)),
        edges: EDGES,
      },
    });
    saved = (await api('GET', `/api/collections/goalmaps/records/${spoof.id}`, { token: MALLORY })).json;
    expect(saved.nodes.find((n) => n.id === 'n1').data.automationRequestedBy === 'b@firma.cz',
      'ani při opakovaném pokusu se cizí e-mail neuloží');
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} SHARE RULES REGRESSION PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
