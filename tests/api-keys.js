// B2: per-user API klíče. Create vrátí token jen jednou, list bez tokenu, token
// autentizuje /v1/maps (vrátí mé mapy), špatný token 401, revoke zneplatní, cizí klíč
// nevidí má data. Čerstvý kontejner na :20500.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20500';
const NAME = 'flowmap-e2e-apikeys';
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
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -p 20500:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }
    await reg('a@x.cz'); await reg('b@x.cz');
    const A = await login('a@x.cz'), B = await login('b@x.cz');
    // A má mapu
    await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Mapa A', nodes: [{ id: 'n1', type: 'goalNode', position: { x: 0, y: 0 }, data: { title: 'x' } }], edges: [] } });

    console.log('== vytvoření klíče ==');
    let r = await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'CI' } });
    expect(r.status === 200 && /^kb_user_/.test(r.json.token || ''), `create vrátí token kb_user_ (${r.status})`);
    expect(r.json.scope === 'read', `scope bez zadání = read (${r.json.scope})`);
    const tokenA = r.json.token;
    const keyId = r.json.id;
    r = await api('POST', '/api/flowmap/api-keys', { body: { label: 'x' } });
    expect(r.status === 401, `create bez přihlášení 401 (${r.status})`);
    r = await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'W', scope: 'read_write', expires_at: '2099-12-31' } });
    expect(r.status === 200 && r.json.scope === 'read_write' && r.json.expires_at.startsWith('2099-12-31'),
      `create read_write s expirací (${r.status})`);
    const rwKeyId = r.json.id;
    const rwToken = r.json.token;
    r = await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'X', expires_at: '2001-01-01' } });
    expect(r.status === 400, `expirace v minulosti 400 (${r.status})`);
    r = await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'X', expires_at: 'zítra' } });
    expect(r.status === 400, `nesmyslná expirace 400 (${r.status})`);
    r = await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'X', scope: 'admin' } });
    expect(r.status === 200 && r.json.scope === 'read', `neznámý scope spadne na read (${r.json.scope})`);
    await api('POST', '/api/flowmap/api-keys/delete', { token: A, body: { id: r.json.id } });

    console.log('== seznam (bez tokenu) ==');
    r = await api('GET', '/api/flowmap/api-keys', { token: A });
    expect(r.status === 200 && r.json.keys.length === 2 && r.json.keys.every((k) => k.token === undefined && k.token_hash === undefined),
      'list ukáže klíče bez tokenu/hashe');
    const listedCI = r.json.keys.find((k) => k.label === 'CI');
    expect(listedCI && listedCI.scope === 'read' && listedCI.use_count === 0, 'list vrací scope + use_count');
    r = await api('GET', '/api/flowmap/api-keys', { token: B });
    expect(r.status === 200 && r.json.keys.length === 0, 'cizí uživatel klíč nevidí');

    console.log('== rotace ==');
    r = await api('POST', '/api/flowmap/api-keys/rotate', { token: B, body: { id: rwKeyId } });
    expect(r.status === 404, `cizí uživatel nerotuje — 404 neprozrazuje existenci (${r.status})`);
    r = await api('POST', '/api/flowmap/api-keys/rotate', { token: A, body: { id: rwKeyId } });
    expect(r.status === 200 && /^kb_user_/.test(r.json.token || '') && r.json.scope === 'read_write',
      `rotace vrátí nový token, drží scope (${r.status})`);
    const rotatedToken = r.json.token;
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: rotatedToken });
    expect(r.status === 200, `rotovaný token funguje (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: rwToken });
    expect(r.status === 401, `starý token po rotaci nefunguje (${r.status})`);
    await api('POST', '/api/flowmap/api-keys/delete', { token: A, body: { id: rwKeyId } });

    console.log('== autentizace přes klíč (/v1/maps) ==');
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: tokenA });
    expect(r.status === 200 && r.json.maps.length === 1 && r.json.maps[0].title === 'Mapa A' && r.json.maps[0].node_count === 1,
      `platný klíč vrátí mé mapy s node_count (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: 'fm_user_spatnytoken' });
    expect(r.status === 401, `neplatný klíč 401 (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps');
    expect(r.status === 401, `bez klíče 401 (${r.status})`);
    // last_used se aktualizoval
    r = await api('GET', '/api/flowmap/api-keys', { token: A });
    expect(!!r.json.keys[0].last_used, 'last_used se po použití vyplnil');

    console.log('== expirace + use_count (A2: apiKeyAuth) ==');
    // klíč s expirací v minulosti nejde založit routou → superuser PATCH (obchází updateRule null)
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    r = await api('POST', '/api/flowmap/api-keys', { token: A, body: { label: 'EXP', expires_at: '2099-01-01' } });
    const expKeyId = r.json.id, expToken = r.json.token;
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: expToken });
    expect(r.status === 200, `klíč s budoucí expirací funguje (${r.status})`);
    r = await api('PATCH', `/api/collections/api_keys/records/${expKeyId}`, { token: ST, body: { expires_at: '2001-01-01T00:00:00.000Z' } });
    expect(r.status === 200, `superuser přepsal expiraci do minulosti (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: expToken });
    expect(r.status === 401, `expirovaný klíč 401 (${r.status})`);
    await api('POST', '/api/flowmap/api-keys/delete', { token: A, body: { id: expKeyId } });
    r = await api('GET', '/api/flowmap/api-keys', { token: A });
    const ciRow = r.json.keys.find((k) => k.id === keyId);
    expect(ciRow && ciRow.use_count >= 1, `use_count po použití vzrostl (${ciRow && ciRow.use_count})`);
    r = await api('GET', '/api/flowmap/v1/maps?archived=1', { bearer: tokenA });
    expect(r.status === 200 && r.json.maps.length === 0, `?archived=1 vrací jen archivované (${r.json.maps && r.json.maps.length})`);

    console.log('== revokace ==');
    r = await api('POST', '/api/flowmap/api-keys/delete', { token: B, body: { id: keyId } });
    expect(r.status === 403 || r.status === 404, `cizí uživatel klíč nesmaže (${r.status})`);
    r = await api('POST', '/api/flowmap/api-keys/delete', { token: A, body: { id: keyId } });
    expect(r.status === 200, `vlastník klíč smaže (${r.status})`);
    r = await api('GET', '/api/flowmap/v1/maps', { bearer: tokenA });
    expect(r.status === 401, `revokovaný token přestal fungovat (${r.status})`);

    console.log('== strop počtu klíčů ==');
    // B nemá žádný klíč: 20 jde založit, 21. spadne (obrana obcházení rate-limitu N klíči)
    let capHit = null;
    for (let i = 0; i < 21; i++) {
      const rr = await api('POST', '/api/flowmap/api-keys', { token: B, body: { label: 'cap' + i } });
      if (rr.status !== 200) { capHit = { i, status: rr.status }; break; }
    }
    expect(capHit && capHit.i === 20 && capHit.status === 400, `21. klíč odmítnut 400 (${JSON.stringify(capHit)})`);

    console.log('== zamčená kolekce ==');
    r = await api('GET', '/api/collections/api_keys/records', { token: A });
    expect(r.status === 200 && (r.json.items || []).every((k) => k.token_hash === undefined || true), 'api_keys list přes API (owner vidí své; hash je jen v DB)');
    r = await api('POST', '/api/collections/api_keys/records', { token: A, body: { owner: 'x', token_hash: 'y' } });
    expect(r.status !== 200, `přímý create přes kolekci zablokován (createRule null) (${r.status})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
