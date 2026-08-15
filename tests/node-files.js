// Přílohy u uzlu a jejich předání automatizaci.
// Scénář Richarda (26.7.): u kroku „vytvořit titulky" nahraju hotový soubor a tím
// se rovnou rozjede automatizace, která ho zpracuje — místo vyplňování formuláře.
//
// Hlídá i to podstatné kolem bezpečnosti: soubor je v kolekci `protected`, takže
// jediná cesta ven pro stroj bez účtu vede přes token JEHO běhu — a ten platí jen
// pro TEN uzel a jen dokud běh běží.
const http = require('http');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-node-files';
const PORT = 20515;
const MOCK_PORT = 20615;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const received = [];
const mock = http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => { b += c; });
  req.on('end', () => {
    try { received.push(JSON.parse(b)); } catch { /* nezajímavé tělo */ }
    res.end('{}');
  });
});

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

(async () => {
  try {
    await new Promise((r) => mock.listen(MOCK_PORT, '0.0.0.0', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 --add-host=host.docker.internal:host-gateway \
      -e FLOWMAP_PUBLIC_URL=http://127.0.0.1:${PORT} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await reg('a@example.com');
    const rM = await reg('m@example.com');
    const rC = await reg('c@example.com');
    const A = await login('a@example.com');
    await api('PATCH', `/api/collections/users/records/${rM.json.id}`, { token: A, body: { is_ai_manager: true } });
    const M = await login('m@example.com');
    const C = await login('c@example.com');
    await api('POST', '/api/flowmap/ai-agents/save', { token: M, body: {
      name: 'n8n titulky', enabled: true, secret: 'tajne',
      webhook_url: `http://host.docker.internal:${MOCK_PORT}/hook`,
    } });

    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'YouTube video',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Video', title: 'Video', status: 'todo' } },
        { id: 'tit', type: 'goalNode', position: { x: 0, y: 100 },
          data: { title: 'Vytvořit titulky', status: 'todo', owner: 'a@example.com',
            executorKind: 'automation', executorName: 'n8n titulky' } },
        { id: 'rucni', type: 'goalNode', position: { x: 200, y: 100 },
          data: { title: 'Sestříhat video', status: 'todo', owner: 'a@example.com' } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'tit' }, { id: 'e2', source: 'root', target: 'rucni' }],
    } })).json;

    console.log('== nahrání přílohy ==');
    let r = await uploadFile(A, map.id, 'rucni', 'poznamky.txt', 'jen poznámky');
    expect(r.status === 200, `příloha k ručnímu kroku nahrána (${r.status})`);
    await sleep(500);
    expect(received.length === 0, `u kroku BEZ automatizace se nic nespustí (${received.length})`);

    const before = received.length;
    r = await uploadFile(A, map.id, 'tit', 'titulky.sbv', '0:00:01.000,0:00:03.000\nAhoj světe\n');
    expect(r.status === 200, `příloha k automatizovanému kroku nahrána (${r.status})`);
    for (let i = 0; i < 25 && received.length === before; i++) await sleep(200);
    expect(received.length === before + 1, `nahrání souboru spustilo automatizaci (${received.length - before}×)`);

    const hook = received[received.length - 1];
    expect(hook.node_id === 'tit', 'běh se týká uzlu, ke kterému se nahrávalo');
    expect(Array.isArray(hook.files) && hook.files.length === 1 && hook.files[0].name === 'titulky.sbv',
      `payload nese přílohu (${JSON.stringify(hook.files?.[0]?.name)})`);
    expect(typeof hook.files_url === 'string' && /\/api\/flowmap\/agent-files$/.test(hook.files_url),
      `payload nese živý seznam příloh (${hook.files_url})`);

    console.log('== agent si soubor vyzvedne svým tokenem ==');
    expect(!/run_token=/.test(hook.files[0].url) && !/run_token=/.test(hook.files_url),
      'token NENÍ v adrese (skončil by v logu proxy) — posílá se hlavičkou');
    const dl = await fetch(hook.files[0].url, { headers: { 'X-Run-Token': hook.run_token } });
    const txt = await dl.text();
    expect(dl.status === 200 && /Ahoj světe/.test(txt), `agent stáhl obsah přílohy (${dl.status})`);

    // soubor přidaný AŽ ZA BĚHU musí být v živém seznamu (agent nemusí čekat na další běh)
    await uploadFile(A, map.id, 'tit', 'druhy.txt', 'dodatek');
    const live = await (await fetch(hook.files_url, { headers: { 'X-Run-Token': hook.run_token } })).json();
    expect(live.files?.length === 2, `živý seznam vidí i soubor přidaný za běhu (${live.files?.length})`);
    expect(received.length === before + 1, 'druhý soubor už běžící automatizaci nespustil podruhé');

    console.log('== co se ven NEDOSTANE ==');
    let bad = await fetch(hook.files[0].url, { headers: { 'X-Run-Token': `fmr_${'x'.repeat(40)}` } });
    expect(bad.status === 401, `cizí token soubor nedostane (${bad.status})`);
    bad = await fetch(`${BASE}/api/flowmap/agent-file/${hook.files[0].id}`);
    expect(bad.status === 401, `bez tokenu soubor nedostane (${bad.status})`);
    // token zní na uzel `tit`, příloha `rucni` mu nepatří
    const otherFile = (await api('GET', `/api/collections/node_files/records?filter=${encodeURIComponent('node_id="rucni"')}`, { token: A })).json.items[0];
    bad = await fetch(`${BASE}/api/flowmap/agent-file/${otherFile.id}`, { headers: { 'X-Run-Token': hook.run_token } });
    expect(bad.status === 404, `token nepustí k příloze JINÉHO uzlu (${bad.status})`);

    console.log('== RLS: přílohy vidí jen lidé s přístupem k mapě ==');
    r = await api('GET', '/api/collections/node_files/records', { token: C });
    expect(r.json?.totalItems === 0, `cizí člověk přílohy nevidí (${r.json?.totalItems})`);
    r = await uploadFile(C, map.id, 'tit', 'podvrh.txt', 'x');
    expect(r.status === 400 || r.status === 403, `cizí člověk přílohu nenahraje (${r.status})`);
    await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: map.id, email: 'c@example.com', permission: 'edit' } });
    r = await api('GET', '/api/collections/node_files/records', { token: C });
    expect(r.json?.totalItems === 3, `po nasdílení přílohy vidí (${r.json?.totalItems})`);

    console.log('== kvóta na přílohy projektu ==');
    const big = 'x'.repeat(400 * 1024); // 400 kB na kus
    let quotaHit = false;
    for (let i = 0; i < 12; i++) {
      const rr = await uploadFile(A, map.id, 'rucni', `velky${i}.txt`, big);
      if (rr.status !== 200) { quotaHit = /MB|limit|příliš/.test(JSON.stringify(rr.json)); break; }
    }
    expect(!quotaHit, 'běžné přílohy se do kvóty vejdou (limit je na projekt, ne na soubor)');

    console.log('== po doběhnutí běhu token propadá ==');
    await api('POST', '/api/flowmap/agent-callback', { body: {
      run_id: hook.run_id, run_token: hook.run_token, status: 'done', result: 'přeloženo do 3 jazyků',
    } });
    const after = await fetch(hook.files[0].url, { headers: { 'X-Run-Token': hook.run_token } });
    expect(after.status === 401, `doběhlý běh soubor nevydá (${after.status})`);
    const afterList = await fetch(hook.files_url, { headers: { 'X-Run-Token': hook.run_token } });
    expect(afterList.status === 401, `ani seznam příloh (${afterList.status})`);

    console.log('== smazání přílohy ==');
    const del = await fetch(`${BASE}/api/collections/node_files/records/${otherFile.id}`, { method: 'DELETE', headers: { Authorization: A } });
    expect(del.status === 204 || del.status === 200, `autor přílohu smaže (${del.status})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
    mock.close();
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} NODE FILES PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
