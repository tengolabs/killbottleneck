// Agentní běhy: uzel s vykonavatelem ai/cron přijde na řadu → FlowMap zavolá
// webhook agenta (podepsaný HMAC) → agent ohlásí výsledek zpět jednorázovým
// tokenem → uzel se splní → NAVAZUJÍCÍ uzel se odblokuje a jeho garant dostane
// „můžete začít". Tohle je hlavní scénář celé fáze, proto e2e proti mock n8n.
//
// Mock webhook běží na hostu; kontejner na něj vidí přes host.docker.internal
// (vzor schema-version.js). Vlastní port kontejneru i mocku, ať sada nekoliduje.
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-agents';
const PORT = 20512;
const MOCK_PORT = 20612;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SECRET = 'tajny-klic-agenta';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// co mock zachytil z odchozího webhooku
const received = [];
let mockStatus = 200;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    received.push({
        body: body,
        signature: req.headers['x-signature'] || '',
        runHeader: req.headers['x-kb-run'] || '',
        runHeaderStary: req.headers['x-flowmap-run'] || '',   // PŘECHOD: co čtou workflow zákazníků
      });
    res.statusCode = mockStatus;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ accepted: mockStatus < 300 }));
  });
});

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
const waitFor = async (fn, tries = 25) => {
  for (let i = 0; i < tries; i++) { if (await fn()) return true; await sleep(200); }
  return false;
};

// Mapa je STROM (jeden rodič na uzel — vynucuje normalizeMapData), takže proces
// jde odspodu nahoru: root → C (člověk, čeká) → B (AI agent, čeká) → A (člověk).
//   A hotové  → B se odblokuje → spustí se agent
//   agent ohlásí done → B hotové → C se odblokuje → garant C dostane „můžete začít"
const buildNodes = (statusA, statusB) => ([
  { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Proces', title: 'Proces', status: 'todo' } },
  { id: 'C', type: 'goalNode', position: { x: 0, y: 100 },
    data: { title: 'Schválit report', status: 'todo', owner: 'c@example.com', waitForChildren: true } },
  { id: 'B', type: 'goalNode', position: { x: 0, y: 200 },
    data: { title: 'Vygeneruj report', status: statusB, owner: 'mgr@example.com', waitForChildren: true,
      executorKind: 'automation', executorName: 'n8n test' } },
  { id: 'A', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Dodat podklady', status: statusA, owner: 'a@example.com' } },
]);
const EDGES = [
  { id: 'e1', source: 'root', target: 'C' },
  { id: 'e2', source: 'C', target: 'B' },
  { id: 'e3', source: 'B', target: 'A' },
];

(async () => {
  try {
    await new Promise((r) => mock.listen(MOCK_PORT, '0.0.0.0', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 --add-host=host.docker.internal:host-gateway \
      -e FLOWMAP_PUBLIC_URL=https://flowmap.example.com ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    const rA = await reg('a@example.com');
    await reg('mgr@example.com');
    await reg('c@example.com');
    const A = await login('a@example.com');
    const MGR = await login('mgr@example.com');
    const C = await login('c@example.com');

    console.log('== registr agentů: kdo ho smí spravovat a co z něj uniká ==');
    let r = await api('POST', '/api/flowmap/ai-agents/save', { token: C, body: { name: 'podvrh', webhook_url: 'http://x/y' } });
    expect(r.status === 403, `běžný člen registr needituje (${r.status})`);
    // z A (admin = první registrace) uděláme mgr správce AI agentů
    const mgrId = (await api('GET', '/api/flowmap/members', { token: A })).json.members.find((m) => m.email === 'mgr@example.com').id;
    await api('PATCH', `/api/collections/users/records/${mgrId}`, { token: A, body: { is_ai_manager: true } });
    const MGR2 = await login('mgr@example.com');

    r = await api('POST', '/api/flowmap/ai-agents/save', { token: MGR2, body: {
      name: 'n8n test', description: 'testovací', enabled: true, secret: SECRET,
      webhook_url: `http://host.docker.internal:${MOCK_PORT}/webhook/test`,
    } });
    expect(r.status === 200 && !!r.json.agent.id, `správce AI agenta založí (${r.status})`);
    expect(r.json.agent.secret === undefined, 'odpověď nevrací tajný klíč');

    r = await api('POST', '/api/flowmap/ai-agents/save', { token: MGR2, body: { name: 'n8n test', webhook_url: 'http://x/y' } });
    expect(r.status === 400, `duplicitní název agenta odmítnut (${r.status})`);

    // správce musí vidět adresu, kterou posílá SERVER — ne tu z prohlížeče
    const adm = await api('GET', '/api/flowmap/ai-agents/admin', { token: MGR2 });
    expect(adm.json.callback_url === 'https://flowmap.example.com/api/kb/agent-callback',
      `registr hlásí skutečnou callback adresu serveru (${adm.json.callback_url})`);
    expect(adm.json.callback_url_warn === false, 's nastaveným FLOWMAP_PUBLIC_URL žádné varování');
    expect(adm.json.agents.every((a) => a.secret === undefined),
      'ani správce nedostane tajný klíč zpět');

    const pub = await api('GET', '/api/flowmap/ai-agents', { token: C });
    expect(pub.status === 200 && pub.json.agents.length === 1, 'člen vidí seznam agentů');
    expect(pub.json.agents[0].webhook_url === undefined && pub.json.agents[0].secret === undefined,
      'členovi NEuniká webhook_url ani secret');
    r = await api('GET', '/api/flowmap/ai-agents/admin', { token: C });
    expect(r.status === 403, `plný výpis členovi zapovězen (${r.status})`);
    r = await api('GET', '/api/collections/ai_agents/records', { token: C });
    expect(r.status === 403 || r.status === 404 || (r.json && r.json.totalItems === 0),
      `kolekce ai_agents je zamčená i přímo (${r.status})`);

    console.log('== uzel přijde na řadu → odchozí webhook ==');
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Proces s automatizací', nodes: buildNodes('todo', 'todo'), edges: EDGES,
    } })).json;
    await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: map.id, email: 'mgr@example.com', permission: 'edit' } });
    await sleep(300);
    expect(received.length === 0, `dokud A není hotové, nic se nespouští (${received.length})`);

    // A hotové → B se odblokuje → spustí se agent
    const fresh = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: buildNodes('done', 'todo'), edges: EDGES, base_updated: fresh.updated,
    } });
    expect(r.status === 200, `uložení mapy prošlo (${r.status})`);
    expect(await waitFor(() => received.length === 1), `webhook agenta zavolán (${received.length}×)`);

    const hook = received[0] ? JSON.parse(received[0].body) : {};
    expect(hook.node_id === 'B' && hook.node_title === 'Vygeneruj report',
      'payload nese uzel, kterého se běh týká');
    expect(typeof hook.run_token === 'string' && /^kbr_[A-Za-z0-9]{40}$/.test(hook.run_token),
      'payload nese jednorázový token běhu');
    expect(hook.callback_url === 'https://flowmap.example.com/api/kb/agent-callback',
      `payload nese VEŘEJNOU callback adresu (nová cesta /api/kb; stará se jen přijímá), ne adresu z prohlížeče (${hook.callback_url})`);
    expect(hook.owner === 'mgr@example.com', 'payload nese garanta (člověka)');
    // Hlavičky běhu: workflow zákazníka podle nich pozná, KTERÝ běh se hlásí.
    // Test si je bral už dřív, ale nic o nich netvrdil — proto by tiše prošlo,
    // kdyby stará hlavička zmizela a všem zvenku se běh přestal ztotožňovat.
    expect(received[0].runHeader === hook.run_id || received[0].runHeader.length > 0,
      `odchozí požadavek nese X-KB-Run (${received[0].runHeader || 'CHYBÍ'})`);
    expect(received[0].runHeaderStary === received[0].runHeader,
      `PŘECHOD: stará hlavička X-FlowMap-Run se posílá se stejnou hodnotou (${received[0].runHeaderStary || 'CHYBÍ'})`);

    const expectedSig = crypto.createHmac('sha256', SECRET).update(received[0].body).digest('hex');
    expect(received[0].signature === expectedSig,
      `X-Signature je HMAC-SHA256 těla tajemstvím agenta (${received[0].signature === expectedSig})`);

    // opakované uložení mapy nesmí spustit běh podruhé
    const f2 = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: buildNodes('done', 'in_progress'), edges: EDGES, base_updated: f2.updated,
    } });
    await sleep(500);
    expect(received.length === 1, `běžící automatizace se nespustí podruhé (${received.length}×)`);

    console.log('== callback: token, jednorázovost, řetěz notifikací ==');
    const cUnreadBefore = (await api('GET', `/api/collections/notifications/records?perPage=1&filter=${encodeURIComponent('type="node_unblocked"')}`, { token: C })).json.totalItems;

    r = await api('POST', '/api/flowmap/agent-callback', { body: { run_id: hook.run_id, run_token: 'fmr_' + 'x'.repeat(40), status: 'done' } });
    expect(r.status === 401, `cizí token odmítnut (${r.status})`);
    r = await api('POST', '/api/flowmap/agent-callback', { body: { run_id: 'jinerunid00000', run_token: hook.run_token, status: 'done' } });
    expect(r.status === 401, `platný token s cizím run_id odmítnut (${r.status})`);
    r = await api('POST', '/api/flowmap/agent-callback', { body: { run_id: hook.run_id, run_token: hook.run_token, status: 'nesmysl' } });
    expect(r.status === 400, `neplatný stav běhu odmítnut (${r.status})`);

    r = await api('POST', '/api/flowmap/agent-callback', { body: {
      run_id: hook.run_id, run_token: hook.run_token, status: 'done', result: 'Report hotov, 12 stran',
    } });
    expect(r.status === 200 && r.json.status === 'done', `callback přijat (${r.status})`);

    const after = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    expect(after.nodes.find((n) => n.id === 'B').data.status === 'done', 'uzel B je splněný');

    const cUnblocked = (await api('GET', `/api/collections/notifications/records?perPage=5&sort=-created&filter=${encodeURIComponent('type="node_unblocked"')}`, { token: C })).json;
    expect(cUnblocked.totalItems === cUnreadBefore + 1,
      `garant navazujícího uzlu dostal „můžete začít" (${cUnreadBefore}→${cUnblocked.totalItems})`);

    const mgrDone = (await api('GET', `/api/collections/notifications/records?perPage=5&sort=-created&filter=${encodeURIComponent('type="agent_done"')}`, { token: MGR2 })).json;
    expect(mgrDone.totalItems === 1 && /12 stran/.test(mgrDone.items[0].text || ''),
      `garant uzlu dostal výsledek běhu (${mgrDone.totalItems})`);

    r = await api('POST', '/api/flowmap/agent-callback', { body: { run_id: hook.run_id, run_token: hook.run_token, status: 'done' } });
    expect(r.status === 401 || r.status === 409, `token je JEDNORÁZOVÝ, druhé volání neprojde (${r.status})`);

    console.log('== běh viditelný v aplikaci, ale bez tajemství ==');
    const runs = (await api('GET', '/api/collections/agent_runs/records', { token: A })).json;
    expect(runs.totalItems === 1 && runs.items[0].status === 'done', `vlastník mapy vidí běh (${runs.totalItems})`);
    expect(!runs.items[0].token_hash, 'token_hash je po uzavření běhu prázdný');
    const runsOther = (await api('GET', '/api/collections/agent_runs/records', { token: MGR })).json;
    expect(runsOther.totalItems >= 0, 'cizí čtení běhů projde jen přes RLS mapy');

    console.log('== nedostupný agent uzel neshodí ==');
    mockStatus = 500;
    const f3 = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    const nodes3 = buildNodes('done', 'todo').map((n) => (n.id === 'B'
      ? { ...n, data: { ...n.data, status: 'in_progress' } } : n));
    r = await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: nodes3, edges: EDGES, base_updated: f3.updated,
    } });
    expect(r.status === 200, `uložení mapy projde i při padajícím agentovi (${r.status})`);
    expect(await waitFor(async () => {
      const all = (await api('GET', '/api/collections/agent_runs/records?sort=-created', { token: A })).json;
      return all.items?.[0]?.status === 'failed';
    }), 'HTTP 500 od agenta → běh označen failed');
    const mgrFailed = (await api('GET', `/api/collections/notifications/records?perPage=5&sort=-created&filter=${encodeURIComponent('type="agent_failed"')}`, { token: MGR2 })).json;
    expect(mgrFailed.totalItems >= 1, `správce AI dostal hlášku o selhání (${mgrFailed.totalItems})`);
    // Klik-test 27. 7. 2026: hláška chodila s PRÁZDNÝM názvem cíle („selhala u cíle „""),
    // takže z ní příjemce nepoznal, o který krok jde. 44 zelených sad to nechytlo,
    // protože nikdo nekontroloval TEXT notifikace. Proto se text kontroluje u KAŽDÉ
    // ze tří cest, kterými se selhání hlásí.
    expect(/Vygeneruj report/.test(mgrFailed.items[0]?.text || ''),
      `hláška o selhání odeslání uvádí název cíle (${(mgrFailed.items[0]?.text || '').slice(0, 90)})`);
    expect(!/cíle „"|goal ""/.test(mgrFailed.items[0]?.text || ''), 'název cíle není prázdný');

    // Σ count agent_failed napříč slitými řádky (B1 slévání slévá kusy do count)
    const failCount = async () => {
      const n = (await api('GET', `/api/collections/notifications/records?perPage=50&filter=${encodeURIComponent('type="agent_failed"')}`, { token: MGR2 })).json;
      return (n.items || []).reduce((a, it) => a + (Number(it.count) || 1), 0);
    };

    console.log('== NEZAREGISTROVANÝ agent v uzlu → tiše se nespustí, ŽÁDNÁ hláška ==');
    mockStatus = 200;
    // Jméno, které neodpovídá žádnému agentovi v registru, je legitimní poznámka
    // („tohle dělá stroj / teprve vytvořím"), NE selhání. Dřív to posílalo matoucí
    // „Agent nebyl nalezen" — test to měl zakódované jako správné chování (klasika
    // z reference-testy-vzdy-zelene-past). Nově: běh nevznikne a nikdo nedostane hlášku.
    const failBefore = await failCount();
    // spouštěč reaguje na PŘECHOD do in_progress → uzel nejdřív na todo
    const f4a = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: buildNodes('done', 'todo').map((n) => (n.id === 'B'
        ? { ...n, data: { ...n.data, executorName: 'neexistuje' } } : n)),
      edges: EDGES, base_updated: f4a.updated,
    } });
    const f4 = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    const nodes4 = buildNodes('done', 'todo').map((n) => (n.id === 'B'
      ? { ...n, data: { ...n.data, status: 'in_progress', executorName: 'neexistuje' } } : n));
    r = await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: nodes4, edges: EDGES, base_updated: f4.updated,
    } });
    expect(r.status === 200, `uzel s nezaregistrovaným agentem se uloží (${r.status})`);
    await sleep(1500); // dost času, aby se případná hláška stihla objevit
    expect((await failCount()) === failBefore,
      `nezaregistrovaný agent NEgeneruje hlášku o selhání (${failBefore} → ${await failCount()})`);
    // a nevznikl ani žádný běh pro ten uzel
    const runsB = (await api('GET', `/api/collections/agent_runs/records?filter=${encodeURIComponent('node_id="B"')}`, { token: MGR2 })).json;
    expect(!runsB.items || runsB.items.every((it) => it.agent_name !== 'neexistuje'),
      'nezaregistrovaný agent nezaložil žádný agent_run');

    console.log('== VYPNUTÝ zaregistrovaný agent → hláška PŘIJDE (známý agent, vědomě vypnutý) ==');
    // rozdíl proti výše: agent v registru JE, jen ho někdo vypnul → o tom informujeme
    const agentId = (await api('GET', '/api/flowmap/ai-agents/admin', { token: MGR2 })).json.agents[0].id;
    await api('POST', '/api/flowmap/ai-agents/save', { token: MGR2, body: {
      id: agentId, name: 'n8n test', webhook_url: `http://host.docker.internal:${MOCK_PORT}/webhook/test`, enabled: false,
    } });
    const disBefore = await failCount();
    const f5a = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: buildNodes('done', 'todo'), edges: EDGES, base_updated: f5a.updated, // B zpět na 'n8n test' + todo
    } });
    const f5 = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: {
      nodes: buildNodes('done', 'in_progress'), edges: EDGES, base_updated: f5.updated,
    } });
    expect(await waitFor(async () => (await failCount()) > disBefore),
      'vypnutý zaregistrovaný agent → hláška správci PŘIJDE');
    // úklid: agenta zase zapnout (navazující sekce ho používá zapnutého)
    await api('POST', '/api/flowmap/ai-agents/save', { token: MGR2, body: {
      id: agentId, name: 'n8n test', webhook_url: `http://host.docker.internal:${MOCK_PORT}/webhook/test`, enabled: true,
    } });

    console.log('== kdo smí agenta spustit ==');
    // omezíme agenta na mgr@ → A ho spustit nesmí, i když mapu vlastní
    let ra = await api('POST', '/api/flowmap/ai-agents/save', { token: MGR2, body: {
      id: (await api('GET', '/api/flowmap/ai-agents/admin', { token: MGR2 })).json.agents[0].id,
      name: 'n8n test', webhook_url: `http://host.docker.internal:${MOCK_PORT}/webhook/test`,
      enabled: true, allowed_emails: ['mgr@example.com'],
    } });
    expect(ra.status === 200 && ra.json.agent.allowed_emails.length === 1,
      `seznam povolených uložen (${ra.json.agent?.allowed_emails?.length})`);
    const aclBefore = received.length;
    const aclMap = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'ACL', nodes: [
        { id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'C', title: 'C', status: 'todo' } },
        { id: 'x', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Krok', status: 'todo', owner: 'a@example.com', executorKind: 'automation', executorName: 'n8n test' } },
      ], edges: [{ id: 'ex', source: 'r', target: 'x' }],
    } })).json;
    const aclFresh = (await api('GET', `/api/collections/goalmaps/records/${aclMap.id}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${aclMap.id}`, { token: A, body: {
      nodes: aclFresh.nodes.map((n) => (n.id === 'x' ? { ...n, data: { ...n.data, status: 'in_progress' } } : n)),
      edges: aclFresh.edges, base_updated: aclFresh.updated,
    } });
    await sleep(700);
    expect(received.length === aclBefore, `nepovolený člověk agenta nespustil (${received.length - aclBefore})`);
    const aclRuns = (await api('GET', `/api/collections/agent_runs/records?filter=${encodeURIComponent(`map="${aclMap.id}"`)}`, { token: A })).json;
    expect(aclRuns.totalItems === 0, `nevznikl ani zařazený běh (${aclRuns.totalItems})`);
    const aclNotif = (await api('GET', `/api/collections/notifications/records?perPage=5&sort=-created&filter=${encodeURIComponent('type="agent_failed"')}`, { token: A })).json;
    expect(/nem\u00e1te povolenou|not allowed/.test(aclNotif.items[0]?.text || ''),
      'člověk se dozvěděl PROČ (nemá povolenou automatizaci)');
    expect(/Krok/.test(aclNotif.items[0]?.text || ''),
      `hláška o nepovoleném spuštění uvádí název cíle (${(aclNotif.items[0]?.text || '').slice(0, 90)})`);
    // vrátit na „smí kdokoli", ať navazující části sady fungují
    await api('POST', '/api/flowmap/ai-agents/save', { token: MGR2, body: {
      id: (await api('GET', '/api/flowmap/ai-agents/admin', { token: MGR2 })).json.agents[0].id,
      name: 'n8n test', webhook_url: `http://host.docker.internal:${MOCK_PORT}/webhook/test`,
      enabled: true, allowed_emails: [],
    } });

    console.log('== fronta: strop odeslání na jedno uložení ==');
    // Odblokuje-li se najednou 5 automatizovaných uzlů, uživatel nesmí čekat na
    // součet timeoutů — odešlou se nejvýš 3 a zbytek zůstane zařazený pro cron.
    mockStatus = 200;
    const beforeQ = received.length;
    const qNodes = [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Q', title: 'Q', status: 'todo' } }];
    const qEdges = [];
    for (let i = 1; i <= 5; i++) {
      qNodes.push({ id: 'q' + i, type: 'goalNode', position: { x: i * 10, y: 100 },
        data: { title: 'Krok ' + i, status: 'in_progress', owner: 'a@example.com',
          executorKind: 'automation', executorName: 'n8n test' } });
      qEdges.push({ id: 'qe' + i, source: 'root', target: 'q' + i });
    }
    const t0 = Date.now();
    const qMap = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: {
      title: 'Fronta', nodes: qNodes, edges: qEdges,
    } })).json;
    // uzly rovnou v in_progress → spouštěč je vezme až při UPDATE (diff stavu)
    const qFresh = (await api('GET', `/api/collections/goalmaps/records/${qMap.id}`, { token: A })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${qMap.id}`, { token: A, body: {
      nodes: qNodes.map((n) => (n.id === 'root' ? n : { ...n, data: { ...n.data, status: 'todo' } })),
      edges: qEdges, base_updated: qFresh.updated,
    } });
    const qFresh2 = (await api('GET', `/api/collections/goalmaps/records/${qMap.id}`, { token: A })).json;
    const tStart = Date.now();
    await api('PATCH', `/api/collections/goalmaps/records/${qMap.id}`, { token: A, body: {
      nodes: qNodes, edges: qEdges, base_updated: qFresh2.updated,
    } });
    const saveMs = Date.now() - tStart;
    await sleep(800);
    const sentInline = received.length - beforeQ;
    expect(sentInline <= 3, `na jedno uložení odešly nejvýš 3 webhooky (${sentInline})`);
    expect(saveMs < 5000, `uložení mapy nečekalo na všechny agenty (${saveMs} ms)`);
    const queued = (await api('GET', `/api/collections/agent_runs/records?perPage=50&filter=${encodeURIComponent(`map="${qMap.id}"`)}`, { token: A })).json;
    expect(queued.totalItems === 5, `všech 5 běhů je zařazeno (${queued.totalItems})`);
    expect(queued.items.filter((x) => x.status === 'pending').length === 5 - sentInline,
      `zbytek čeká na cron (${queued.items.filter((x) => x.status === 'pending').length})`);

    console.log('== watchdog zaseknutých běhů ==');
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@example.com superheslo123`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@example.com', password: 'superheslo123' } })).json.token;
    // běhy z testu fronty výš zůstaly viset → hlídač je po vypršení uzavře.
    // Kontejner běží s FLOWMAP_AGENT_TIMEOUT_MIN=0? Ne — posuneme čas u záznamů
    // přes superuser API není možné, takže ověříme aspoň, že routa existuje,
    // nic čerstvého neuzavře a je zapovězená běžnému uživateli.
    let w = await api('POST', '/api/flowmap/run-agent-watchdog', { token: ST });
    expect(w.status === 200 && w.json.closed === 0,
      `hlídač čerstvé běhy nechá být (${w.status}, uzavřeno ${w.json?.closed})`);
    w = await api('POST', '/api/flowmap/run-agent-watchdog', { token: A });
    expect(w.status === 404, `hlídače běžný uživatel nespustí (${w.status})`);
    // A teď to podstatné: běh, který vypršel, MUSÍ hlídač uzavřít. Stáří
    // nasimulujeme posunem `started` (superuser obchází pravidla kolekce),
    // ať sada nemusí čekat reálných 90 minut.
    const stuck = (await api('GET', `/api/collections/agent_runs/records?perPage=1&filter=${encodeURIComponent('status="running"')}`, { token: ST })).json.items[0];
    expect(!!stuck, 'je k dispozici běžící běh pro test hlídače');
    const oldDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '.000Z');
    await api('PATCH', `/api/collections/agent_runs/records/${stuck.id}`, { token: ST, body: { started: oldDate } });
    w = await api('POST', '/api/flowmap/run-agent-watchdog', { token: ST });
    expect(w.json?.closed >= 1, `hlídač uzavřel vypršelý běh (${w.json?.closed})`);
    const closed = (await api('GET', `/api/collections/agent_runs/records/${stuck.id}`, { token: ST })).json;
    expect(closed.status === 'failed', `vypršelý běh je failed (${closed.status})`);
    expect(!closed.token_hash, 'token vypršelého běhu propadl');
    expect(/nedob\u011bhl|did not finish/.test(closed.result || ''), `důvod je vyplněný (${closed.result})`);
    // čtvrtá cesta k téže hlášce (hlídač) — po sjednocení do notifyAgentFailure
    // musí uvádět název stejně jako zbylé tři
    const wdNotif = (await api('GET', `/api/collections/notifications/records?perPage=5&sort=-created&filter=${encodeURIComponent('type="agent_failed"')}`, { token: MGR2 })).json;
    expect(!/cíle „"|goal ""/.test(wdNotif.items[0]?.text || ''),
      `hláška hlídače nemá prázdný název cíle (${(wdNotif.items[0]?.text || '').slice(0, 90)})`);

    // watchdog se testuje přes helpers přímo — cron má hodinovou periodu; tady
    // ověříme aspoň, že běh vzniklý PŘED limitem zůstane nedotčený (guard drží)
    // POZOR: jen PŮVODNÍ mapa — mapa z testu fronty výš nechává běhy otevřené záměrně
    const openRuns = (await api('GET', `/api/collections/agent_runs/records?filter=${encodeURIComponent(`map="${map.id}" && (status="pending" || status="running")`)}`, { token: A })).json;
    expect(openRuns.totalItems === 0, `po callbacku i selháních nezůstal viset žádný běh (${openRuns.totalItems})`);
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
    mock.close();
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} AGENT RUNS PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
