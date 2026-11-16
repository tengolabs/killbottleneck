// The password-reset brake counts per CALLER (decision 16 Nov 2026).
//
// Before: 3 resets of one account in 10 minutes, one counter shared by everybody. A structure manager who used
// the three attempts blocked the administrator's reset of the same account. Now each caller has their own three
// attempts per account; the brake itself (4th → 429, parallel burst counted atomically) stays.
const { execSync } = require('child_process');

const NAME = 'kb-e2e-reset-hesla-pocitadlo';
const PORT = 20983;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TestHeslo.2026';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'cs', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* empty body */ }
  return { status: res.status, json };
}
const login = async (email, password) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password } })).json || {};
const reset = (token, email) => api('POST', '/api/kb/reset-user-password', { token, body: { email } });

(async () => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d -e KB_RATE_LIMITS=0 -e KB_PURPOSE_ASK=0 --name ${NAME} -e TZ=Europe/Prague -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* starting */ }
    await sleep(1000);
  }

  console.log('== příprava: administrátor, správce struktury, dva členové ==');
  await api('POST', '/api/collections/users/records', { body: { email: 'sef@firma.cz', password: PW, passwordConfirm: PW, language: 'cs' } });
  const A = (await login('sef@firma.cz', PW)).token;
  const pozvi = async (email) => (await api('POST', '/api/kb/invite', { token: A, body: { email, role: 'user' } })).json || {};
  const sprava = await pozvi('sprava@firma.cz');
  await pozvi('clen@firma.cz');
  await pozvi('clen2@firma.cz');
  const S0 = await login('sprava@firma.cz', sprava.temp_password);
  expect((await api('PATCH', `/api/collections/users/records/${S0.record?.id}`, { token: A, body: { is_org_manager: true } })).status === 200, 'správce struktury má příznak');
  const S = (await login('sprava@firma.cz', sprava.temp_password)).token;

  console.log('== správce struktury vyčerpá své tři pokusy ==');
  const s = [];
  for (let i = 0; i < 4; i++) s.push(await reset(S, 'clen@firma.cz'));
  expect(s.slice(0, 3).every((r) => r.status === 200 && !!r.json?.temp_password), `první tři obnovy projdou (${s.slice(0, 3).map((r) => r.status).join(',')})`);
  expect(s[3].status === 429 && /třikrát/.test(s[3].json?.error || ''), `čtvrtá → 429 s vysvětlením (${s[3].status} „${s[3].json?.error}")`);

  console.log('== administrátor má vlastní počítadlo ==');
  const a1 = await reset(A, 'clen@firma.cz');
  expect(a1.status === 200 && !!a1.json?.temp_password, `administrátor tentýž účet obnoví, i když správce struktury pokusy vyčerpal (${a1.status})`);
  expect(!!(await login('clen@firma.cz', a1.json?.temp_password)).token, 'heslo od administrátora platí');
  expect((await login('clen@firma.cz', s[2].json?.temp_password)).token === undefined, 'poslední heslo od správce struktury už neplatí');
  const a2 = await reset(A, 'clen@firma.cz'); const a3 = await reset(A, 'clen@firma.cz'); const a4 = await reset(A, 'clen@firma.cz');
  expect(a2.status === 200 && a3.status === 200, `druhá a třetí obnova administrátora projdou (${a2.status},${a3.status})`);
  expect(a4.status === 429, `i administrátor má strop: čtvrtá → 429 (${a4.status})`);
  expect(!!(await login('clen@firma.cz', a3.json?.temp_password)).token, 'odmítnutá obnova heslo nezměnila');

  console.log('== počítadla se navzájem neovlivňují ==');
  expect((await reset(S, 'clen@firma.cz')).status === 429, 'obnovy administrátora správci struktury pokusy nevrátily (stále 429)');
  expect((await reset(S, 'clen2@firma.cz')).status === 200, 'jiný účet není dotčen (správce struktury)');

  console.log('== souběh: šest obnov naráz od jednoho volajícího ==');
  const burst = await Promise.all([1, 2, 3, 4, 5, 6].map(() => reset(A, 'clen2@firma.cz')));
  const ok = burst.filter((r) => r.status === 200).length, odm = burst.filter((r) => r.status === 429).length;
  expect(ok === 3 && odm === 3, `projdou právě tři, tři dostanou 429 (${ok} / ${odm})`);

  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  console.log(`\n${fail ? '🔴' : '🟢'} RESET-HESLA-POCITADLO PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
