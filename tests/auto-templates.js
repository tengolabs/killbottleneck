// Opakované šablony (auto_templates) — hodinová brána v lokální TZ + guard + force.
// Čerstvý kontejner na :20493 s TZ=Europe/Prague. Ověřuje:
//  - autoHour() čte FLOWMAP_AUTO_HOUR s bezpečným defaultem 5 a rozsahem 0–23 (unit);
//  - superuser routa /api/flowmap/run-auto-templates založí projekt ze šablony, která
//    má „svůj den" v LOKÁLNÍ (pražské) TZ, a to právě jednou (guard auto_last);
//  - šablona na jiný den se nezaloží.
// Pozn.: čistou hodinovou bránu (necron, bez force) nelze e2e spustit bez řízení
// systémových hodin — pokrývá ji unit test autoHour + jednoduchost podmínky
// `!force && getHours() < autoHour()`; force cestu (superuser routa) testujeme e2e.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20493';
const NAME = 'flowmap-e2e-auto';
const SU = { email: 'su@e2e.local', pw: 'superheslo123' };
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

// „dnešek" a den v týdnu tak, jak je počítá server v pražské TZ (helper: Po=1..Ne=7)
const pragueToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' });
const pragueDow = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' })); return ((d.getDay() + 6) % 7) + 1; };

(async () => {
  // --- UNIT: autoHour() ---
  console.log('== unit: autoHour ==');
  global.$os = { getenv: (k) => process.env[k] || '' };
  const helpers = require('../server/pb_hooks/helpers.js');
  const cases = [['', 5], ['5', 5], ['0', 0], ['23', 23], ['24', 5], ['-1', 5], ['abc', 5], ['6', 6]];
  for (const [val, want] of cases) {
    if (val === '') delete process.env.FLOWMAP_AUTO_HOUR; else process.env.FLOWMAP_AUTO_HOUR = val;
    expect(helpers.autoHour() === want, `autoHour("${val}") = ${want} (dostal ${helpers.autoHour()})`);
  }
  delete process.env.FLOWMAP_AUTO_HOUR;

  // --- E2E: force routa v pražské TZ ---
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -e FLOWMAP_AUTO_HOUR=5 -p 20493:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    // superuser (force routa) + běžný uživatel = vlastník šablony/projektu
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;
    await api('POST', '/api/collections/users/records', { body: { email: 'owner@e2e.local', password: PW, passwordConfirm: PW } });
    const auth = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'owner@e2e.local', password: PW } })).json;
    const OT = auth.token, owner = auth.record.id;

    const ownerMaps = async () => (await api('GET', `/api/collections/goalmaps/records?perPage=200&filter=${encodeURIComponent(`owner="${owner}"`)}`, { token: ST })).json.items;

    console.log('== e2e: šablona due DNES (pražský den) ==');
    const dow = pragueDow();
    // šablonu zakládá VLASTNÍK (hook nastaví owner z přihlášení)
    const tpl = (await api('POST', '/api/collections/templates/records', { token: OT, body: {
      title: 'E2E auto šablona', node_type: 'mise',
      ai_nodes: [{ id: 'n1', title: 'Kořen', parentId: null }],
      auto_create: 'weekly', auto_day: dow, auto_last: '',
    } })).json;
    expect(!!tpl.id, `šablona založena (owner z hooku, due day=${dow})`);

    const before = (await ownerMaps()).length;
    const r1 = (await api('POST', '/api/flowmap/run-auto-templates', { token: ST, body: {} })).json;
    await sleep(200);
    const after1 = await ownerMaps();
    expect(r1.created === 1, `první běh: created=1 (dostal ${r1.created})`);
    expect(after1.length === before + 1, `vznikl 1 projekt vlastníka (${before}->${after1.length})`);

    const tpl2 = (await api('GET', `/api/collections/templates/records/${tpl.id}`, { token: ST })).json;
    expect(tpl2.auto_last === pragueToday(), `guard auto_last = pražský dnešek ${pragueToday()} (${tpl2.auto_last})`);

    const r2 = (await api('POST', '/api/flowmap/run-auto-templates', { token: ST, body: {} })).json;
    await sleep(200);
    expect(r2.created === 0 && (await ownerMaps()).length === after1.length, 'druhý běh týž den nezaloží duplikát');

    console.log('== e2e: šablona na JINÝ den ==');
    const other = (dow % 7) + 1;
    await api('PATCH', `/api/collections/templates/records/${tpl.id}`, { token: ST, body: { auto_day: other, auto_last: '' } });
    const cur = (await ownerMaps()).length;
    const r3 = (await api('POST', '/api/flowmap/run-auto-templates', { token: ST, body: {} })).json;
    await sleep(200);
    expect(r3.created === 0 && (await ownerMaps()).length === cur, `jiný den (day=${other}) nezaloží`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} auto-templates: ${pass} OK, ${fail} FAIL`);
  process.exit(fail === 0 ? 0 : 1);
})();
