// A1: produkt ověří schema_version od AI služby. Provider custom míří na lokální mock,
// který vrací zvolený schema_version; produkt musí nekompatibilní verzi odmítnout
// srozumitelnou chybou a kompatibilní (nebo chybějící) propustit.
const http = require('http');
const { execSync } = require('child_process');
const NAME = 'flowmap-e2e-schema';
const PORT = 20497;
const MOCK_PORT = 20506;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mockVersion = 1;
const mock = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const body = { questions: ['a', 'b', 'c'] };
  if (mockVersion !== null) body.schema_version = mockVersion;
  res.end(JSON.stringify(body));
});

const api = async (path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

(async () => {
  try {
    await new Promise((r) => mock.listen(MOCK_PORT, '0.0.0.0', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    // provider custom → advisor POST jde přímo na náš mock (host bridge IP)
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 --add-host=host.docker.internal:host-gateway \
      -e FLOWMAP_AI_PROVIDER=custom -e FLOWMAP_AI_URL=http://host.docker.internal:${MOCK_PORT}/v1/advisor ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    await api('/api/collections/users/records', { body: { email: 'a@x.cz', password: 'testheslo123', passwordConfirm: 'testheslo123' } });
    const T = (await api('/api/collections/users/auth-with-password', { body: { identity: 'a@x.cz', password: 'testheslo123' } })).json.token;

    console.log('== schema_version kontrola ==');
    mockVersion = 1;
    let r = await api('/api/flowmap/advisor', { token: T, body: { mode: 'questions', goal: 'test' } });
    expect(r.status === 200 && Array.isArray(r.json.questions), `verze 1 projde (${r.status})`);

    mockVersion = 2;
    r = await api('/api/flowmap/advisor', { token: T, body: { mode: 'questions', goal: 'test' } });
    expect(r.status === 502 && /nekompatibilní verzi/.test(r.json.error || ''), `verze 2 odmítnuta jasnou chybou (${r.status}: ${(r.json.error || '').slice(0, 40)})`);

    mockVersion = null; // schema_version chybí (ollama/custom bez verze)
    r = await api('/api/flowmap/advisor', { token: T, body: { mode: 'questions', goal: 'test' } });
    expect(r.status === 200, `chybějící verze propuštěna (zpětná kompat.) (${r.status})`);
  } catch (e) {
    fail++; console.log('  ❌ výjimka:', e.message.slice(0, 160));
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    mock.close();
    console.log(`\nVÝSLEDEK: ${pass} OK, ${fail} FAIL`);
    process.exit(fail ? 1 : 0);
  }
})();
