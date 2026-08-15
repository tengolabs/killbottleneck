// Obnova hesla rukou správce — jediná cesta na instanci BEZ pošty.
//
// Proč tahle sada vznikla: první provedení (11. 8. 2026) vypadalo hotově a ruční
// zkouška ho odklepla, protože ověřovala jen návratový kód 200. Panel /checkup pak
// našel, že SLIBOVANÉ OZNÁMENÍ „někdo ti změnil heslo" se nikdy neuloží — typ chyběl
// v migraci, zápis skončil na validaci a výjimku spolkl `catch`. Heslo se změnilo,
// oběť se nedozvěděla nic. Tichá výměna hesla je přesně to, čemu má funkce bránit.
//
// Proto se tu netestuje „vrátilo to 200", ale DŮSLEDKY: nové heslo platí, staré ne,
// relace padá, a oznámení SKUTEČNĚ EXISTUJE a nejde vypnout.
const { execSync } = require('child_process');

const NAME = 'kb-e2e-reset-hesla';
const PORT = 20981;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'TestHeslo.2026';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* prázdné tělo */ }
  return { status: res.status, json };
}

async function ucet(email, role) {
  await api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
  const a = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  return { token: a.json?.token, id: a.json?.record?.id };
}

(async () => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch (e) { /* startuje */ }
    await sleep(1000);
  }

  console.log('== příprava: admin + člen + druhý admin ==');
  const admin = await ucet('sef@firma.cz');          // první účet = admin
  const clen = await api('POST', '/api/kb/invite', { token: admin.token, body: { email: 'clen@firma.cz', role: 'user' } });
  expect(clen.status === 200, `člen pozván (${clen.status})`);
  const admin2 = await api('POST', '/api/kb/invite', { token: admin.token, body: { email: 'sef2@firma.cz', role: 'admin' } });
  expect(admin2.status === 200, `druhý admin pozván (${admin2.status})`);

  console.log('== kdo SMÍ a kdo NE ==');
  const clenTok = (await api('POST', '/api/collections/users/auth-with-password',
    { body: { identity: 'clen@firma.cz', password: clen.json.temp_password } })).json?.token;
  expect((await api('POST', '/api/kb/reset-user-password', { body: { email: 'clen@firma.cz' } })).status === 401,
    'nepřihlášený → 401');
  expect((await api('POST', '/api/kb/reset-user-password', { token: clenTok, body: { email: 'sef@firma.cz' } })).status === 403,
    'běžný uživatel → 403');
  // Richardova rozhodnutí 11. 8.: ani sobě, ani jinému adminovi
  expect((await api('POST', '/api/kb/reset-user-password', { token: admin.token, body: { email: 'sef@firma.cz' } })).status === 400,
    'admin SÁM SOBĚ → 400 (jinak si zneplatní vlastní relaci a bez pošty se vyzamkne)');
  expect((await api('POST', '/api/kb/reset-user-password', { token: admin.token, body: { email: 'sef2@firma.cz' } })).status === 403,
    'admin JINÉMU ADMINOVI → 403 (jinak si dva správci přeberou instanci)');
  // pole místo řetězce nesmí projít
  expect((await api('POST', '/api/kb/reset-user-password', { token: admin.token, body: { email: ['clen@firma.cz'] } })).status === 400,
    'e-mail jako pole → 400');

  console.log('== obnova členovi: co se doopravdy stane ==');
  const stary = (await api('POST', '/api/collections/users/auth-with-password',
    { body: { identity: 'clen@firma.cz', password: clen.json.temp_password } })).json?.token;
  const r = await api('POST', '/api/kb/reset-user-password', { token: admin.token, body: { email: 'clen@firma.cz' } });
  expect(r.status === 200 && !!r.json?.temp_password, `bez pošty vrátí dočasné heslo (${r.status})`);
  expect((await api('POST', '/api/collections/users/auth-with-password',
    { body: { identity: 'clen@firma.cz', password: clen.json.temp_password } })).status === 400,
    'STARÉ heslo už neplatí');
  const novy = await api('POST', '/api/collections/users/auth-with-password',
    { body: { identity: 'clen@firma.cz', password: r.json.temp_password } });
  expect(novy.status === 200, 'NOVÉ heslo platí');
  expect((await api('POST', '/api/collections/users/auth-refresh', { token: stary })).status === 401,
    'stará relace je zneplatněná (jinak by útočník zůstal uvnitř)');

  console.log('== ⚠️ POPLACH: oznámení MUSÍ vzniknout a NESMÍ jít vypnout ==');
  await sleep(600);
  const notif = (await api('GET', '/api/collections/notifications/records?perPage=50', { token: novy.json.token })).json?.items || [];
  const pr = notif.filter((n) => n.type === 'password_reset');
  expect(pr.length === 1, `člen má oznámení o změně hesla (${pr.length}) — TOHLE propadlo prvnímu provedení`);
  expect(/sef@firma\.cz/.test(pr[0]?.text || ''), `a je v něm, KDO to udělal („${(pr[0]?.text || '').slice(0, 60)}")`);

  // pokus vypnout si poplach v předvolbách nesmí projít
  await api('PATCH', `/api/collections/users/records/${novy.json.record.id}`, {
    token: novy.json.token, body: { notify_prefs: { password_reset: { in_app: false, email: false } } },
  });
  const po = (await api('GET', `/api/collections/users/records/${novy.json.record.id}`, { token: novy.json.token })).json;
  const ulozeno = (po?.notify_prefs || {}).password_reset;
  expect(!ulozeno, 'předvolba pro poplach se ani neuloží (nejde ho potlačit PATCHem)');

  const r2 = await api('POST', '/api/kb/reset-user-password', { token: admin.token, body: { email: 'clen@firma.cz' } });
  const tok2 = (await api('POST', '/api/collections/users/auth-with-password',
    { body: { identity: 'clen@firma.cz', password: r2.json.temp_password } })).json?.token;
  await sleep(600);
  const notif2 = ((await api('GET', '/api/collections/notifications/records?perPage=50', { token: tok2 })).json?.items || [])
    .filter((n) => n.type === 'password_reset');
  expect(notif2.length === 2, `po pokusu o vypnutí poplach přišel ZASE (${notif2.length})`);

  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  console.log(`\n${fail ? '🔴' : '🟢'} RESET HESLA PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
