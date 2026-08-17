// Denní AI sumáře (daily_summaries) — cron/force generace, refresh routa, RLS.
// Čerstvý kontejner na :20494. Ověřuje:
//  - summaryHour() čte FLOWMAP_SUMMARY_HOUR s defaultem 6 a rozsahem 0–23 (unit);
//  - provider none: force routa generuje 0, refresh vrací 503;
//  - provider ollama (reálný model na E2E_OLLAMA_URL): force vygeneruje sumář JEN
//    uživateli s otevřenou prací, druhý běh 0 (idempotence, guard = dnešní záznam);
//  - refresh routa přegeneruje dnešní záznam (stále 1 řádek, updated se zvedne);
//  - RLS: sumář vidí jen vlastník, přímý create/update přes API je zamčený.
// Pozn.: hodinovou bránu (necron) kryje unit summaryHour — stejný vzor jako
// auto-templates.js; force cesta se testuje e2e.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20494';
const NAME = 'flowmap-e2e-summaries';
const SU = { email: 'su@e2e.local', pw: 'superheslo123' };
const PW = 'testheslo123';
const OLLAMA_URL = process.env.E2E_OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.E2E_OLLAMA_MODEL || 'gemma3:12b';
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
  // --- UNIT: summaryHour() ---
  console.log('== unit: summaryHour ==');
  global.$os = { getenv: (k) => process.env[k] || '' };
  const helpers = require('../server/pb_hooks/helpers.js');
  const cases = [['', 6], ['6', 6], ['0', 0], ['23', 23], ['24', 6], ['-1', 6], ['abc', 6], ['5', 5]];
  for (const [val, want] of cases) {
    if (val === '') delete process.env.FLOWMAP_SUMMARY_HOUR; else process.env.FLOWMAP_SUMMARY_HOUR = val;
    expect(helpers.summaryHour() === want, `summaryHour("${val}") = ${want} (dostal ${helpers.summaryHour()})`);
  }
  delete process.env.FLOWMAP_SUMMARY_HOUR;

  // --- UNIT: summaryAiConfig (env override vs fallback na aiConfig) ---
  console.log('== unit: summaryAiConfig ==');
  const mockApp = { findFirstRecordByFilter: () => { throw new Error('no ai_settings'); } };
  process.env.FLOWMAP_SUMMARY_PROVIDER = 'ollama';
  process.env.FLOWMAP_SUMMARY_URL = 'http://model:11434';
  process.env.FLOWMAP_SUMMARY_MODEL = 'gemma3:12b';
  let sc = helpers.summaryAiConfig(mockApp);
  expect(sc.provider === 'ollama' && sc.model === 'gemma3:12b' && sc.source === 'env-summary', `env override má přednost (${sc.source}/${sc.model})`);
  delete process.env.FLOWMAP_SUMMARY_PROVIDER;
  delete process.env.FLOWMAP_SUMMARY_URL;
  delete process.env.FLOWMAP_SUMMARY_MODEL;
  process.env.FLOWMAP_AI_PROVIDER = 'custom';
  sc = helpers.summaryAiConfig(mockApp);
  expect(sc.provider === 'custom' && sc.source === 'env', `bez override spadne na obecný aiConfig (${sc.source}/${sc.provider})`);
  delete process.env.FLOWMAP_AI_PROVIDER;

  // --- UNIT: findBlockingForOwnerServer (port frontend lib/waitStatus.js) ---
  console.log('== unit: findBlockingForOwnerServer ==');
  const blNodes = [
    { id: 'p', type: 'goalNode', data: { title: 'Vyvážená strava', waitForChildren: true, status: 'todo', owner: 'x@x.cz' } },
    { id: 'c', type: 'goalNode', data: { title: 'Pitný režim', status: 'todo', owner: 'a@e2e.local' } },
    { id: 'd', type: 'goalNode', data: { title: 'Hotový podcíl', status: 'done', owner: 'a@e2e.local' } },
  ];
  const blEdges = [{ id: 'e1', source: 'p', target: 'c' }, { id: 'e2', source: 'p', target: 'd' }];
  const bl = helpers.findBlockingForOwnerServer(blNodes, blEdges, 'a@e2e.local');
  expect(bl['c'] === 'Vyvážená strava' && !bl['d'], `nehotový uzel A blokuje čekajícího rodiče (${JSON.stringify(bl)})`);
  expect(Object.keys(helpers.findBlockingForOwnerServer(blNodes, blEdges, 'x@x.cz')).length === 0, `vlastník čekajícího uzlu sám neblokuje`);

  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e TZ=Europe/Prague -e KB_UVODNI_MAPA=0 -p 20494:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await sleep(1000); }

    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;
    // SLOVNÍK 17. 8. 2026: položky sází superuser (uživatelský create = 403)
    const uidOf = async (email) => ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email='${email}'`)}`, { token: ST })).json.items || [])[0].id;
    // A = aktivní s prací; B = aktivní bez práce; C = má práci, ale NEpřihlášený
    // (filtr FLOWMAP_SUMMARY_ACTIVE_DAYS ho z ranní dávky vynechá)
    await api('POST', '/api/collections/users/records', { body: { email: 'a@e2e.local', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/users/records', { body: { email: 'b@e2e.local', password: PW, passwordConfirm: PW } });
    await api('POST', '/api/collections/users/records', { body: { email: 'c@e2e.local', password: PW, passwordConfirm: PW } });
    const authA = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@e2e.local', password: PW } })).json;
    const authB = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'b@e2e.local', password: PW } })).json;
    const authC = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'c@e2e.local', password: PW } })).json;
    const AT = authA.token, BT = authB.token, CT = authC.token;
    // loginlog = „aktivita" (frontend ho zapisuje při každém přihlášení) — jen A a B
    await api('POST', '/api/collections/loginlogs/records', { token: AT, body: {} });
    await api('POST', '/api/collections/loginlogs/records', { token: BT, body: {} });
    // úkol vždy patří do projektu (server volné úkoly odmítá)
    // úkol navíc musí viset na KONKRÉTNÍM uzlu (ne vrcholu) — neutrální uzel bez
    // garanta a termínu, aby nepřidal žádnou „práci" navíc do sumářů
    const mapC = (await api('POST', '/api/collections/goalmaps/records', { token: CT, body: { title: 'C projekt', nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'C projekt', title: 'C projekt', status: 'todo' } }, { id: 'c1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Provoz', status: 'todo' } }], edges: [{ id: 'e-c1', source: 'apex', target: 'c1' }] } })).json;
    await api('POST', '/api/collections/tasks/records', { token: ST, body: { title: 'Úkol neaktivního C', status: 'todo', deadline: '2026-07-01', assignee_email: 'c@e2e.local', map: mapC.id, node_id: 'c1', owner: await uidOf('c@e2e.local'), owner_email: 'c@e2e.local' } });

    console.log('== e2e: provider none ==');
    const r0 = await api('POST', '/api/flowmap/run-daily-summaries', { token: ST });
    expect(r0.status === 200 && r0.json.generated === 0, `force s provider none generuje 0 (dostal ${JSON.stringify(r0.json)})`);
    const rf0 = await api('POST', '/api/flowmap/my-summary/refresh', { token: AT });
    expect(rf0.status === 503, `refresh s provider none = 503 (dostal ${rf0.status})`);
    const rGuest = await api('POST', '/api/flowmap/run-daily-summaries', {});
    expect(rGuest.status === 404, `force routa bez superusera = 404 (dostal ${rGuest.status})`);

    console.log('== e2e: provider ollama (reálný model) ==');
    // AI konfigurace přes zamčenou kolekci ai_settings (superuser obchází rules)
    await api('POST', '/api/collections/ai_settings/records', {
      token: ST, body: { provider: 'ollama', url: OLLAMA_URL, model: OLLAMA_MODEL },
    });
    // A: úkol po termínu + úkol na dnešek + „lákavý" projekt bez termínu
    // + uzel, který BLOKUJE čekající uzel jiného člověka (priorita č. 1)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' });
    // digest počítá jako panel Můj den: jen PŘIŘAZENÉ úkoly (assignee_email)
    const mapA = (await api('POST', '/api/collections/goalmaps/records', { token: AT, body: { title: 'Administrativa', nodes: [{ id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Administrativa', title: 'Administrativa', status: 'todo' } }, { id: 'a1', type: 'goalNode', position: { x: 0, y: 120 }, data: { title: 'Agenda', status: 'todo' } }], edges: [{ id: 'e-a1', source: 'apex', target: 'a1' }] } })).json;
    const uidA2 = await uidOf('a@e2e.local');
    await api('POST', '/api/collections/tasks/records', { token: ST, body: { title: 'Zaplatit fakturu Novák', status: 'todo', deadline: '2026-07-01', assignee_email: 'a@e2e.local', map: mapA.id, node_id: 'a1', owner: uidA2, owner_email: 'a@e2e.local' } });
    await api('POST', '/api/collections/tasks/records', { token: ST, body: { title: 'Připravit podklady pro schůzku', status: 'in_progress', deadline: today, assignee_email: 'a@e2e.local', map: mapA.id, node_id: 'a1', owner: uidA2, owner_email: 'a@e2e.local' } });
    await api('POST', '/api/collections/goalmaps/records', { token: AT, body: {
      title: 'Zdravý životní styl',
      nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Zdravý životní styl', title: 'Zdravý životní styl', status: 'todo', owner: '' } },
        { id: 'p', type: 'goalNode', position: { x: 0, y: 100 }, data: { title: 'Vyvážená strava', waitForChildren: true, status: 'todo', owner: 'kolega@jinde.cz' } },
        { id: 'c', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Pitný režim', status: 'todo', owner: 'a@e2e.local' } },
        { id: 's', type: 'goalNode', position: { x: 200, y: 100 }, data: { title: 'Budovat startup', status: 'in_progress', owner: 'a@e2e.local' } },
      ],
      edges: [{ id: 'e1', source: 'apex', target: 'p' }, { id: 'e2', source: 'p', target: 'c' }, { id: 'e3', source: 'apex', target: 's' }],
    } });

    const r1 = await api('POST', '/api/flowmap/run-daily-summaries', { token: ST });
    expect(r1.status === 200 && r1.json.generated === 1, `force vygeneroval právě 1 sumář — B nemá práci, C není aktivní (dostal ${JSON.stringify(r1.json)})`);
    const listC = (await api('GET', '/api/collections/daily_summaries/records', { token: CT })).json;
    expect(listC.items?.length === 0, `neaktivní C sumář z cronu nedostal (${listC.items?.length})`);
    const rfC = await api('POST', '/api/flowmap/my-summary/refresh', { token: CT });
    expect(rfC.status === 200 && (rfC.json.summary?.text || '').length > 30, `C si sumář dogeneruje při otevření (refresh routa) — status ${rfC.status}`);
    const r2 = await api('POST', '/api/flowmap/run-daily-summaries', { token: ST });
    expect(r2.status === 200 && r2.json.generated === 0, `druhý běh 0 — dnešní záznam = guard (dostal ${JSON.stringify(r2.json)})`);

    const listA = (await api('GET', '/api/collections/daily_summaries/records', { token: AT })).json;
    expect(listA.items?.length === 1, `A vidí svůj 1 sumář (dostal ${listA.items?.length})`);
    const sumA = listA.items?.[0] || {};
    expect(sumA.date === today && (sumA.text || '').length > 30, `sumář má dnešní datum a netriviální text (${sumA.date}, ${String(sumA.text || '').length} znaků)`);
    if (!(sumA.text || '').toLowerCase().includes('pitný režim')) console.log('  ⚠️ soft check: povzbuzení nezmiňuje blokující „Pitný režim" (priorita 1) — mrknout okem');
    console.log('  --- text sumáře A ---\n  ' + String(sumA.text || '').split('\n').join('\n  ') + '\n  ---');
    const listB = (await api('GET', '/api/collections/daily_summaries/records', { token: BT })).json;
    expect(listB.items?.length === 0, `B (bez práce) nemá sumář a cizí nevidí (dostal ${listB.items?.length})`);
    const stealB = await api('GET', `/api/collections/daily_summaries/records/${sumA.id}`, { token: BT });
    expect(stealB.status === 404, `B nepřečte A-sumář přes id = 404 (dostal ${stealB.status})`);

    console.log('== e2e: RLS zámek zápisu ==');
    const wA = await api('POST', '/api/collections/daily_summaries/records', { token: AT, body: { user: authA.record.id, date: '2026-01-01', text: 'podvrh' } });
    expect(wA.status >= 400, `přímý create uživatelem zamítnut (dostal ${wA.status})`);
    const uA = await api('PATCH', `/api/collections/daily_summaries/records/${sumA.id}`, { token: AT, body: { text: 'podvrh' } });
    expect(uA.status >= 400, `přímý update uživatelem zamítnut (dostal ${uA.status})`);

    console.log('== e2e: refresh routa ==');
    const rf1 = await api('POST', '/api/flowmap/my-summary/refresh', { token: AT });
    expect(rf1.status === 200 && (rf1.json.summary?.text || '').length > 30, `refresh vrátil nový text (status ${rf1.status})`);
    const rfAgain = await api('POST', '/api/flowmap/my-summary/refresh', { token: AT });
    expect(rfAgain.status === 429, `okamžitý druhý refresh = 429 rate-limit (dostal ${rfAgain.status})`);
    const listA2 = (await api('GET', '/api/collections/daily_summaries/records', { token: AT })).json;
    expect(listA2.items?.length === 1, `po refreshi stále 1 řádek — upsert, ne duplicita (dostal ${listA2.items?.length})`);
    expect(listA2.items?.[0]?.updated > sumA.updated, `updated se refreshem zvedl`);
    const rf2 = await api('POST', '/api/flowmap/my-summary/refresh', { token: BT });
    expect(rf2.status === 200 && rf2.json.summary === null && !!rf2.json.note, `refresh bez práce vrací summary:null + note (dostal ${JSON.stringify(rf2.json)})`);
  } finally {
    if (!process.env.KB_NECHAT_KONTEJNER) execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }

  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
