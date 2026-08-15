// OAuth cesta do users — MUTAČNÍ ověření serverových pojistek bez živého Googlu.
// Mock OIDC provider (node http server na hostu) + generický „oidc" provider v PB:
// backend create hook je provider-agnostický, takže oidc věrně zastupuje google.
// Ověřuje: (1) OAuth registrace bez setup_code na instanci s KB_SETUP_CODE SPADNE,
// (2) se správným kódem přes createData PROJDE (role/jazyk se nastaví jako u běžné
// registrace), (3) KB_MAX_USERS platí i pro OAuth registraci (403), přihlášení
// existujícího OAuth účtu ale jede dál, (4) brzda scrl počítá i neúspěšné OAuth
// pokusy — po 10 spadne i pokus se SPRÁVNÝM kódem (mutační důkaz, že brzda fíruje).
const http = require('http');
const { execSync } = require('child_process');
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK_PORT = 20599;
const A = { name: 'flowmap-e2e-oauthmut-a', port: 20499 }; // KB_SETUP_CODE
const B = { name: 'flowmap-e2e-oauthmut-b', port: 20500 }; // KB_MAX_USERS
const KOD = 'KB-MUT-777';

// identita, kterou mock zrovna vydává (test ji mezi voláními přepíná)
let identita = { sub: 'sub-1', email: 'oauth1@e2e.cz' };
// secret, který PB reálně poslal na token endpoint (Basic auth) — ověřuje, že
// nakonfigurovaný clientSecret se opravdu POUŽIJE, ne jen „figuruje" v kolekci
let tokenSecret = null;
const mock = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/token')) {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      // PB posílá client_id:client_secret jako Basic auth
      const a = req.headers.authorization || '';
      if (a.startsWith('Basic ')) {
        try { tokenSecret = Buffer.from(a.slice(6), 'base64').toString().split(':')[1] || null; } catch { /* nic */ }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'tok-' + identita.sub, token_type: 'Bearer', expires_in: 3600 }));
    });
    return;
  }
  if (req.url.startsWith('/userinfo')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ sub: identita.sub, email: identita.email, email_verified: true, name: 'OAuth Test' }));
    return;
  }
  res.writeHead(404); res.end();
});

const run = (c, env) => {
  execSync(`docker rm -f ${c.name} 2>/dev/null; true`);
  execSync(`docker run -d --name ${c.name} -p ${c.port}:8090 --add-host=host.docker.internal:host-gateway ${env} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
};
const waitReady = async (port) => {
  for (let i = 0; i < 30; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {} await sleep(1000); }
};
const superToken = async (c) => {
  execSync(`docker exec ${c.name} /app/pocketbase superuser upsert su@e2e.cz superheslo123`, { stdio: 'ignore' });
  const su = await (await fetch(`http://127.0.0.1:${c.port}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'su@e2e.cz', password: 'superheslo123' }),
  })).json();
  return su.token;
};
const zapniOidc = async (c, token) => {
  const col = await (await fetch(`http://127.0.0.1:${c.port}/api/collections/users`, { headers: { Authorization: token } })).json();
  col.oauth2.enabled = true;
  col.oauth2.providers = (col.oauth2.providers || []).filter((p) => p.name !== 'oidc').concat([{
    name: 'oidc', clientId: 'mock-client', clientSecret: 'mock-secret',
    authURL: `http://host.docker.internal:${MOCK_PORT}/auth`,
    tokenURL: `http://host.docker.internal:${MOCK_PORT}/token`,
    userInfoURL: `http://host.docker.internal:${MOCK_PORT}/userinfo`,
    pkce: false,
  }]);
  const r = await fetch(`http://127.0.0.1:${c.port}/api/collections/users`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ oauth2: col.oauth2 }),
  });
  if (!r.ok) throw new Error('nastavení oidc provideru selhalo: ' + (await r.text()).slice(0, 200));
};
// pokus o OAuth přihlášení/registraci; vrací {status, json}
const oauth = async (c, createData) => {
  const r = await fetch(`http://127.0.0.1:${c.port}/api/collections/users/auth-with-oauth2`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'oidc', code: 'mock-code', codeVerifier: 'mock-verifier',
      redirectURL: 'http://127.0.0.1/callback', createData: createData || {},
    }),
  });
  let j = {}; try { j = await r.json(); } catch { /* prázdné tělo */ }
  return { status: r.status, json: j };
};

(async () => {
  try {
    await new Promise((r) => mock.listen(MOCK_PORT, '0.0.0.0', r));

    console.log('== A: instance s KB_SETUP_CODE ==');
    run(A, `-e KB_SETUP_CODE=${KOD}`);
    await waitReady(A.port);
    const tokA = await superToken(A);
    await zapniOidc(A, tokA);

    identita = { sub: 'sub-1', email: 'oauth1@e2e.cz' };
    let r = await oauth(A); // bez setup_code
    expect(r.status >= 400, `OAuth registrace BEZ kódu spadne (HTTP ${r.status})`);
    let users = await (await fetch(`http://127.0.0.1:${A.port}/api/collections/users/records`, { headers: { Authorization: tokA } })).json();
    expect(users.totalItems === 0, 'Bez kódu žádný účet nevznikl');

    tokenSecret = null;
    r = await oauth(A, { setup_code: KOD, language: 'en' });
    expect(r.status === 200, `OAuth registrace SE správným kódem projde (HTTP ${r.status})`);
    // nakonfigurovaný clientSecret se REÁLNĚ použil (Basic auth na token endpoint) —
    // ne vakuózní „provider figuruje"; přímá odpověď na nález checkupu
    expect(tokenSecret === 'mock-secret', `PB poslal nakonfigurovaný clientSecret na token endpoint (dostal: ${JSON.stringify(tokenSecret)})`);
    users = await (await fetch(`http://127.0.0.1:${A.port}/api/collections/users/records`, { headers: { Authorization: tokA } })).json();
    const ucet = users.items.find((u) => u.email === 'oauth1@e2e.cz');
    expect(!!ucet, 'Účet vznikl s e-mailem z OIDC profilu');
    expect(ucet && ucet.role === 'admin', 'První účet dostal roli admin (hook běžel celý)');
    expect(ucet && ucet.language === 'en', 'Jazyk z createData se propsal (maily hned správně)');

    // přihlášení EXISTUJÍCÍHO účtu bez kódu musí projít (create hook nefíruje)
    r = await oauth(A);
    expect(r.status === 200, 'Přihlášení existujícího OAuth účtu bez kódu projde');

    console.log('== A: brzda scrl počítá i OAuth neúspěchy ==');
    identita = { sub: 'sub-rl', email: 'oauth-rl@e2e.cz' };
    let posledni = 0;
    for (let i = 0; i < 9; i++) { posledni = (await oauth(A, { setup_code: 'SPATNY' })).status; } // + 1 neúspěch z úvodu = 10
    expect(posledni >= 400, 'Špatný kód opakovaně padá');
    r = await oauth(A, { setup_code: KOD }); // správný kód, ale brzda už drží
    expect(r.status >= 400, `Po 10 neúspěších spadne i pokus se SPRÁVNÝM kódem (HTTP ${r.status}) — brzda fíruje i pro OAuth`);
    users = await (await fetch(`http://127.0.0.1:${A.port}/api/collections/users/records`, { headers: { Authorization: tokA } })).json();
    expect(users.totalItems === 1, 'Přes brzdu nevznikl žádný další účet');

    console.log('== B: KB_MAX_USERS platí i pro OAuth ==');
    run(B, '-e KB_MAX_USERS=2');
    await waitReady(B.port);
    const tokB = await superToken(B);
    await zapniOidc(B, tokB);

    identita = { sub: 'b-1', email: 'b1@e2e.cz' };
    expect((await oauth(B)).status === 200, '1. OAuth registrace projde');
    identita = { sub: 'b-2', email: 'b2@e2e.cz' };
    expect((await oauth(B)).status === 200, '2. OAuth registrace projde (strop 2 naplněn)');
    identita = { sub: 'b-3', email: 'b3@e2e.cz' };
    r = await oauth(B);
    expect(r.status === 403 || r.status === 400, `3. OAuth registrace nad strop SPADNE (HTTP ${r.status})`);
    const usersB = await (await fetch(`http://127.0.0.1:${B.port}/api/collections/users/records`, { headers: { Authorization: tokB } })).json();
    expect(usersB.totalItems === 2, 'Nad strop účet nevznikl');
    identita = { sub: 'b-1', email: 'b1@e2e.cz' };
    expect((await oauth(B)).status === 200, 'Přihlášení existujícího účtu jede i po naplnění stropu');
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 200));
  } finally {
    execSync(`docker rm -f ${A.name} ${B.name} 2>/dev/null; true`);
    mock.close();
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
