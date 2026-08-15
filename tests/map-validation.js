// B1: serverová validace uzlů/hran mapy při zápisu goalmaps. Tolerantní — reálný tvar
// mapy (cleanMapData) i prázdná mapa projdou; odmítne jen strukturálně poškozená data.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20499';
const NAME = 'flowmap-e2e-mapval';
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
    execSync(`docker run -d --name ${NAME} -p 20499:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    await api('POST', '/api/collections/users/records', { body: { email: 'a@x.cz', password: PW, passwordConfirm: PW } });
    const T = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: PW } })).json.token;
    const mk = (nodes, edges) => api('POST', '/api/collections/goalmaps/records', { token: T, body: { title: 'M', nodes, edges } });

    console.log('== validní data projdou ==');
    let r = await mk([], []);
    expect(r.status === 200, `prázdná mapa projde (${r.status})`);
    // reálný tvar z cleanMapData (frontend)
    const realNode = { id: 'node-1', type: 'goalNode', position: { x: 10, y: 20 }, data: { title: 'Cíl', status: 'todo', description: '', collapsed: false, color: '', nodeType: 'normal', goalType: '', apexText: '', deadline: '', owner: '', waitForChildren: false } };
    const apexNode = { id: 'node-0', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Mise', title: '', status: 'todo' } };
    const note = { id: 'note-1', type: 'note', position: { x: 5, y: 5 }, width: 220, height: 180, data: { text: 'x', color: '#fef9c3', width: 220, height: 180 } };
    r = await mk([apexNode, realNode, note], [{ id: 'edge-1', source: 'node-0', target: 'node-1' }]);
    expect(r.status === 200, `reálný tvar mapy (apex+goal+note+hrana) projde (${r.status})`);
    // API styl (type 'apex') jako v api-rls.js
    r = await mk([{ id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'C' } }], []);
    expect(r.status === 200, `API styl (type 'apex') projde (${r.status})`);
    // velká validní mapa (300 uzlů)
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, type: 'goalNode', position: { x: i, y: i }, data: { title: `${i}` } }));
    r = await mk(many, []);
    expect(r.status === 200, `velká validní mapa (300 uzlů) projde (${r.status})`);

    console.log('== poškozená data odmítnuta ==');
    r = await mk('neco', []);
    expect(r.status === 400, `nodes není pole → 400 (${r.status})`);
    r = await mk([{ type: 'goalNode', position: { x: 0, y: 0 } }], []);
    expect(r.status === 400, `uzel bez id → 400 (${r.status})`);
    r = await mk([{ id: 'n1', position: { x: 'a', y: 0 } }], []);
    expect(r.status === 400 && /pozice/.test(r.json?.message || JSON.stringify(r.json)), `uzel s nečíselnou pozicí → 400 (${r.status})`);
    r = await mk([{ id: 'n1', position: { x: 0, y: 0 } }], [{ id: 'e', source: 'n1' }]);
    expect(r.status === 400, `hrana bez target → 400 (${r.status})`);
    const tooMany = Array.from({ length: 1001 }, (_, i) => ({ id: `n${i}`, position: { x: 0, y: 0 } }));
    r = await mk(tooMany, []);
    expect(r.status === 400 && /max 1000|mnoho uzl/.test(r.json?.message || JSON.stringify(r.json)), `>1000 uzlů → 400 (${r.status})`);

    console.log('== mapa je STROM (kruh a druhý rodič přes REST neprojdou) ==');
    // Vada z 13. 8. 2026: mapu s kruhem šlo uložit i naklikat a rozvržení se na ní
    // zacyklilo — karta prohlížeče zatuhla na 100 % CPU. Strop v `apportion` je jen
    // pojistka; tady se hlídá, že taková mapa vůbec nevznikne.
    // ⚠️ MUTAČNĚ OVĚŘENO 13. 8. 2026: s vypnutou kontrolou v obou goalmaps hoocích
    // (create i update) vrátily všechny čtyři zákazy 200 místo 400 → sada zčervenala.
    const tri = (a, b, c) => [a, b, c].map((id) => ({ id, type: 'goalNode', position: { x: 0, y: 0 }, data: { title: id } }));
    r = await mk(tri('a', 'b', 'c'), [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'a' }]);
    expect(r.status === 400 && /strom/.test(r.json?.message || JSON.stringify(r.json)), `nová mapa s kruhem → 400 (${r.status})`);
    r = await mk(tri('a', 'b', 'c'), [{ id: 'e1', source: 'a', target: 'c' }, { id: 'e2', source: 'b', target: 'c' }]);
    expect(r.status === 400 && /strom/.test(r.json?.message || JSON.stringify(r.json)), `nová mapa s druhým rodičem → 400 (${r.status})`);
    // repro ze zadání: 4 uzly stačily
    r = await mk(
      [{ id: 'R', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'C' } }, ...tri('n2', 'n3', 'n4')],
      [{ id: 'e1', source: 'n2', target: 'n3' }, { id: 'e2', source: 'n3', target: 'R' },
        { id: 'e3', source: 'n4', target: 'n3' }, { id: 'e4', source: 'R', target: 'n3' }]);
    expect(r.status === 400, `repro ze zadání (4 uzly) → 400 (${r.status})`);
    // POZITIVNÍ protikontrola — kdyby kontrola zakazovala všechno, sada by prošla taky
    r = await mk(tri('a', 'b', 'c'), [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }]);
    expect(r.status === 200, `poctivý strom PROJDE (${r.status})`);
    const strom = r.json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${strom.id}`, { token: T, body: {
      edges: [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }, { id: 'e3', source: 'c', target: 'a' }] } });
    expect(r.status === 400, `kruh dodatečně PATCHem → 400 (${r.status})`);
    r = await api('PATCH', `/api/collections/goalmaps/records/${strom.id}`, { token: T, body: {
      edges: [{ id: 'e1', source: 'a', target: 'b' }] } });
    expect(r.status === 200, `odebrání hrany (oprava) projde (${r.status})`);

    console.log('== update stejná validace ==');
    const m = (await mk([{ id: 'n1', type: 'goalNode', position: { x: 0, y: 0 }, data: {} }], [])).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: T, body: { nodes: [{ id: 'n1', position: { x: 'bad', y: 0 } }] } });
    expect(r.status === 400, `update s poškozeným uzlem → 400 (${r.status})`);
    r = await api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: T, body: { nodes: [{ id: 'n1', type: 'goalNode', position: { x: 99, y: 99 }, data: { title: 'ok' } }] } });
    expect(r.status === 200, `update s validním uzlem projde (${r.status})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
