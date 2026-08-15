// Automatizační pravidla — vrstva ROUT a ČASOVÝCH triggerů:
//  - session CRUD /rules* + /rule-runs: smí jen EDITOR mapy (owner/edit),
//    work sdílení a cizí uživatel dostanou 403
//  - validace tvaru (validateRuleInput) vrací srozumitelné 400 s důvodem
//  - strukturální limit 50 pravidel/mapa
//  - v1 API CRUD přes API klíč (read vs read_write scope)
//  - trigger `schedule` (daily/weekly) přes superuser /run-rule-schedule:
//    okno hodiny, dedup (druhé force spuštění týž den NEfiruje), weekly mimo den
//  - trigger `deadline_approaching` before/overdue + NEkolize s deadline_notices
const { execSync } = require('child_process');

const NAME = 'kb-e2e-rules-sched';
const PORT = 20731;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0, code = 1;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;

    await reg('vlastnik@example.com');
    await reg('editor@example.com');
    await reg('delnik@example.com');
    await reg('cizi@example.com');
    const V = await login('vlastnik@example.com');
    const dnesC = execSync(`docker exec ${NAME} date +%F`).toString().trim();
    const plusDny = (n) => {
      const [y, m, d] = dnesC.split('-').map(Number);
      const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };
    const kontDow = ((new Date(dnesC + 'T12:00:00').getDay() + 6) % 7) + 1; // 1=Po…7=Ne dle data kontejneru

    const map = (await api('POST', '/api/collections/goalmaps/records', { token: V, body: {
      title: 'Plánovaná mapa',
      nodes: [
        node('root', { apexText: 'P', title: 'P', status: 'todo' }, 'apexNode'),
        node('S', { title: 'Scope uzel', status: 'todo', owner: 'delnik@example.com' }),
        node('D1', { title: 'Termín zítra', status: 'todo', owner: 'delnik@example.com', deadline: plusDny(1) }),
        node('D2', { title: 'Propadlý včera', status: 'todo', owner: 'delnik@example.com', deadline: plusDny(-1) }),
        node('D3', { title: 'Hotový s termínem', status: 'done', owner: 'delnik@example.com', deadline: plusDny(1) }),
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'S' }, { id: 'e2', source: 'root', target: 'D1' },
        { id: 'e3', source: 'root', target: 'D2' }, { id: 'e4', source: 'root', target: 'D3' },
      ],
    } })).json;
    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId: map.id, email: 'editor@example.com', permission: 'edit' } });
    await api('POST', '/api/kb/share', { token: V, body: { action: 'share', mapId: map.id, email: 'delnik@example.com', permission: 'work' } });
    const E = await login('editor@example.com');
    const W = await login('delnik@example.com');
    const C = await login('cizi@example.com');

    console.log('== session CRUD: kdo smí pravidla spravovat ==');
    const telo = { map: map.id, name: 'Denní ohláška', node_id: 'S', trigger: { type: 'schedule', freq: 'daily', hour: 0 }, actions: [{ type: 'notify', to: 'node_owner', message: 'ranní kontrola' }] };
    let r = await api('POST', '/api/kb/rules/save', { token: W, body: telo });
    expect(r.status === 403, `work sdílení pravidla NEspravuje (${r.status})`);
    r = await api('POST', '/api/kb/rules/save', { token: C, body: telo });
    expect(r.status === 403, `cizí uživatel 403 (${r.status})`);
    r = await api('POST', '/api/kb/rules/save', { token: E, body: telo });
    expect(r.status === 200 && !!r.json.rule.id, `sdílený EDITOR pravidlo založí (${r.status})`);
    const rule1 = r.json.rule;
    expect(rule1.enabled === true && rule1.created_by === 'editor@example.com', 'default enabled + razítko autora');
    r = await api('GET', `/api/kb/rules?map=${map.id}`, { token: V });
    expect(r.status === 200 && r.json.rules.length === 1, `vlastník seznam vidí (${r.json.rules && r.json.rules.length})`);
    r = await api('GET', `/api/kb/rules?map=${map.id}`, { token: W });
    expect(r.status === 403, `work sdílení seznam pravidel nevidí (${r.status})`);

    console.log('== validace tvaru pravidla ==');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', trigger: { type: 'kdovi' }, actions: [{ type: 'notify', to: 'map_owner' }] } });
    expect(r.status === 400 && /trigger.type/.test(r.json.error), `neznámý trigger → 400 s důvodem (${r.json.error})`);
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', trigger: { type: 'node_status_changed' }, actions: [] } });
    expect(r.status === 400 && /actions/.test(r.json.error), 'prázdné akce → 400');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', node_id: 'neexistuje', trigger: { type: 'node_status_changed' }, actions: [{ type: 'notify', to: 'map_owner' }] } });
    expect(r.status === 400 && /node_id/.test(r.json.error), 'scope na neexistující uzel → 400');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', trigger: { type: 'schedule', freq: 'daily' }, actions: [{ type: 'set_status', status: 'done' }] } });
    expect(r.status === 400 && /node_id/.test(r.json.error), 'mapový schedule + akce na uzel → 400 (srozumitelně při uložení, ne selháním v noci)');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', trigger: { type: 'schedule', freq: 'weekly' }, actions: [{ type: 'notify', to: 'map_owner' }] } });
    expect(r.status === 400 && /weekday/.test(r.json.error), 'weekly bez weekday → 400');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', trigger: { type: 'node_status_changed' }, conditions: [{ field: 'deadline', op: 'before', value: 'zítra' }], actions: [{ type: 'notify', to: 'map_owner' }] } });
    expect(r.status === 400 && /YYYY-MM-DD/.test(r.json.error), 'before s ne-datem → 400');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', trigger: { type: 'node_status_changed' }, actions: [{ type: 'create_subnodes', items: [{ title: 'a', deadline: 'špatně' }] }] } });
    expect(r.status === 400 && /items/.test(r.json.error), 'rozbitá šablonka podUzlů se odmítne při ULOŽENÍ');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', node_id: 'S', trigger: { type: 'node_created' }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] } });
    expect(r.status === 400 && /node_created/.test(r.json.error), 'node_created se scope na uzel → 400 (mrtvé pravidlo)');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'x', trigger: { type: 'deadline_approaching', when: 'overdue', days: 0 }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] } });
    expect(r.status === 400 && /at least 1/.test(r.json.error), 'overdue s days:0 → 400 (koliduje s chováním)');

    console.log('== zapnout/vypnout bez plného tvaru + limit 50 ==');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, id: rule1.id, enabled: false } });
    expect(r.status === 200 && r.json.rule.enabled === false, 'samostatný toggle enabled projde bez validace tvaru');
    for (let i = 0; i < 49; i++) {
      await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: `výplň ${i}`, enabled: false, trigger: { type: 'node_created' }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] } });
    }
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, name: 'padesáté první', trigger: { type: 'node_created' }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] } });
    expect(r.status === 400 && /50/.test(r.json.error), `51. pravidlo odmítnuto limitem (${r.status})`);
    // úklid výplně, ať zbytek sady pracuje s přehledným stavem
    const vse = (await api('GET', `/api/kb/rules?map=${map.id}`, { token: V })).json.rules;
    for (const x of vse.filter((y) => y.name.startsWith('výplň'))) {
      await api('POST', '/api/kb/rules/delete', { token: V, body: { id: x.id } });
    }
    expect((await api('GET', `/api/kb/rules?map=${map.id}`, { token: V })).json.rules.length === 1, 'úklid: zbylo jen původní pravidlo');

    console.log('== v1 API přes klíč ==');
    r = await api('POST', '/api/flowmap/api-keys', { token: V, body: { label: 'ro', scope: 'read' } });
    const RO = r.json.token;
    r = await api('POST', '/api/flowmap/api-keys', { token: V, body: { label: 'rw', scope: 'read_write' } });
    const RW = r.json.token;
    r = await api('GET', `/api/kb/v1/maps/${map.id}/rules`, { token: `Bearer ${RO}` });
    expect(r.status === 200 && r.json.rules.length === 1, `v1 čtení read klíčem (${r.status})`);
    r = await api('POST', `/api/kb/v1/maps/${map.id}/rules`, { token: `Bearer ${RO}`, body: telo });
    expect(r.status === 403, `zápis read klíčem 403 (${r.status})`);
    r = await api('POST', `/api/kb/v1/maps/${map.id}/rules`, { token: `Bearer ${RW}`, body: {
      name: 'Z API: termín zítra → připomeň', trigger: { type: 'deadline_approaching', when: 'before', days: 1 },
      actions: [{ type: 'notify', to: 'node_owner', message: 'zítra je termín' }],
    } });
    expect(r.status === 200 && !!r.json.rule.id, `v1 create read_write klíčem (${r.status})`);
    const vRule = r.json.rule;
    r = await api('POST', `/api/kb/v1/maps/${map.id}/rules/${vRule.id}`, { token: `Bearer ${RW}`, body: { enabled: true } });
    expect(r.status === 200, `v1 toggle (${r.status})`);
    const cizMapa = (await api('POST', '/api/collections/goalmaps/records', { token: C, body: { title: 'Cizí', nodes: [node('root', { apexText: 'x', title: 'x', status: 'todo' }, 'apexNode')], edges: [] } })).json;
    r = await api('GET', `/api/kb/v1/maps/${cizMapa.id}/rules`, { token: `Bearer ${RO}` });
    expect(r.status === 404, `cizí mapa přes klíč = 404, existence se neprozrazuje (${r.status})`);

    console.log('== deadline_approaching: before/overdue, hotové uzly ne ==');
    r = await api('POST', `/api/kb/v1/maps/${map.id}/rules`, { token: `Bearer ${RW}`, body: {
      name: 'Propadlé → eskaluj', trigger: { type: 'deadline_approaching', when: 'overdue', days: 1 },
      actions: [{ type: 'notify', to: 'map_owner', message: 'PROPADLO' }],
    } });
    const ovRule = r.json.rule;
    r = await api('POST', '/api/kb/run-rule-schedule', { token: ST, body: {} });
    expect(r.status === 200, `superuser force běh (${r.status})`);
    const runs = async (ruleId) => (await api('GET', `/api/kb/rule-runs?map=${map.id}&rule=${ruleId}`, { token: V })).json.runs || [];
    let rr = await runs(vRule.id);
    expect(rr.length === 1 && rr[0].node_id === 'D1' && rr[0].status === 'ok', `before(1) chytil JEN uzel s termínem zítra, hotový D3 ne (${rr.length})`);
    rr = await runs(ovRule.id);
    expect(rr.length === 1 && rr[0].node_id === 'D2', `overdue(1) chytil včera propadlý uzel (${rr.length})`);
    const delNotif = (await api('GET', `/api/collections/notifications/records?filter=${encodeURIComponent('type="rule_notice"')}`, { token: W })).json.items || [];
    expect(delNotif.some((n) => n.text.includes('zítra je termín')), 'garant dostal rule_notice (deadline_notices souhrny tím nedotčeny)');

    console.log('== dedup: druhý force běh týž den NEfiruje ==');
    r = await api('POST', '/api/kb/run-rule-schedule', { token: ST, body: {} });
    expect(r.status === 200 && r.json.fired === 0, `druhé spuštění: fired=0 (${r.json.fired})`);
    expect((await runs(vRule.id)).length === 1, 'žádný druhý běh před-termínového pravidla');

    console.log('== overdue = ASPOŇ N dní: dohnání starých termínů (klik-test 15. 8.) ==');
    // uzel propadlý před 5 dny + pravidlo „po termínu 1 den" založené AŽ TEĎ —
    // s přesnou shodou dne (v0.29) by se minuly NAVŽDY
    let f5 = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: V })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: V, body: {
      nodes: f5.nodes.concat([node('D9', { title: 'Dávno propadlý', status: 'todo', owner: 'delnik@example.com', deadline: plusDny(-5) })]),
      edges: f5.edges.concat([{ id: 'e-d9', source: 'root', target: 'D9' }]), base_updated: f5.updated,
    } });
    r = await api('POST', `/api/kb/v1/maps/${map.id}/rules`, { token: `Bearer ${RW}`, body: {
      name: 'Dohnat propadlé', trigger: { type: 'deadline_approaching', when: 'overdue', days: 1 },
      actions: [{ type: 'notify', to: 'map_owner', message: 'DOHNÁNO' }],
    } });
    const dohnat = r.json.rule;
    await api('POST', '/api/kb/run-rule-schedule', { token: ST, body: {} });
    let rrD = await runs(dohnat.id);
    expect(rrD.some((x) => x.node_id === 'D9'), `pravidlo založené PO propadnutí uzel dohnalo (${rrD.length})`);
    expect(rrD.some((x) => x.node_id === 'D2'), 'a chytlo i včera propadlý (aspoň N dní, ne přesný den)');
    await api('POST', '/api/kb/run-rule-schedule', { token: ST, body: {} });
    expect((await runs(dohnat.id)).length === rrD.length, 'na TENTÝŽ termín vystřelí jen jednou (dedup nese termín)');
    // změna termínu = nová dohoda → smí vystřelit znovu
    f5 = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: V })).json;
    await api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: V, body: {
      nodes: f5.nodes.map((n) => (n.id === 'D9' ? Object.assign({}, n, { data: Object.assign({}, n.data, { deadline: plusDny(-3) }) }) : n)),
      edges: f5.edges, base_updated: f5.updated,
    } });
    await api('POST', '/api/kb/run-rule-schedule', { token: ST, body: {} });
    expect((await runs(dohnat.id)).filter((x) => x.node_id === 'D9').length === 2, 'změněný termín vystřelil znovu (nová dohoda)');
    await api('POST', `/api/kb/v1/maps/${map.id}/rules/${dohnat.id}`, { token: `Bearer ${RW}`, body: { enabled: false } });

    console.log('== schedule daily + weekly okno ==');
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, id: rule1.id, enabled: true } });
    r = await api('POST', '/api/kb/rules/save', { token: V, body: {
      map: map.id, name: 'Týdně jindy', trigger: { type: 'schedule', freq: 'weekly', weekday: (kontDow % 7) + 1, hour: 0 },
      actions: [{ type: 'notify', to: 'map_owner', message: 'týdenní' }],
    } });
    const weeklyRule = r.json.rule;
    r = await api('POST', '/api/kb/run-rule-schedule', { token: ST, body: {} });
    expect(r.json.fired === 1, `daily firelo, weekly v jiný den ne (fired=${r.json.fired})`);
    let rw = await runs(rule1.id);
    expect(rw.length === 1 && rw[0].trigger_type === 'schedule' && rw[0].actor === 'schedule', 'denní pravidlo má běh s aktérem schedule');
    expect((await runs(weeklyRule.id)).length === 0, 'weekly mimo svůj den nefiruje');
    r = await api('GET', `/api/kb/rules?map=${map.id}`, { token: V });
    const zaznam = r.json.rules.find((x) => x.id === rule1.id);
    expect(!!zaznam.last_fired, 'last_fired se po běhu zapsal (info pro UI)');

    console.log('== šablony pravidel: knihovna instance ==');
    r = await api('POST', '/api/kb/rule-templates/save', { token: V, body: {
      name: 'Šablona: propadlé eskaluj', trigger: { type: 'deadline_approaching', when: 'overdue', days: 1 },
      actions: [{ type: 'notify', to: 'map_owner', message: 'PROPADLO' }],
    } });
    expect(r.status === 200 && !!r.json.template.id, `šablonu uloží kterýkoli přihlášený (${r.status})`);
    const tplId = r.json.template.id;
    r = await api('POST', '/api/kb/rule-templates/save', { token: V, body: { name: 'Šablona: propadlé eskaluj', trigger: { type: 'node_created' }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] } });
    expect(r.status === 400 && /existuje/.test(r.json.error), 'duplicitní název šablony → 400');
    r = await api('POST', '/api/kb/rule-templates/save', { token: V, body: { name: 'Se scope', node_id: 'S', trigger: { type: 'node_created' }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] } });
    expect(r.status === 400 && /scoped/.test(r.json.error), 'šablona se scope uzlem → 400 (šablony jsou bez mapy)');
    r = await api('GET', '/api/kb/rule-templates', { token: W });
    expect(r.status === 200 && r.json.templates.length === 1, `knihovnu čte i work uživatel (${r.json.templates && r.json.templates.length})`);
    r = await api('POST', '/api/kb/rule-templates/delete', { token: E, body: { id: tplId } });
    expect(r.status === 403, `smazat smí jen autor nebo admin (${r.status})`);
    r = await api('POST', '/api/kb/rule-templates/delete', { token: V, body: { id: tplId } });
    expect(r.status === 200, `autor šablonu smaže (${r.status})`);
    // v1 API zrcadlo (API-first)
    r = await api('POST', '/api/kb/v1/rule-templates', { token: `Bearer ${RW}`, body: {
      name: 'V1 šablona', trigger: { type: 'node_created' }, actions: [{ type: 'set_deadline', relative_days: 3 }],
    } });
    expect(r.status === 200 && !!r.json.template.id, `v1 create šablony (${r.status})`);
    r = await api('GET', '/api/kb/v1/rule-templates', { token: `Bearer ${RO}` });
    expect(r.status === 200 && r.json.templates.some((x) => x.name === 'V1 šablona'), 'v1 list šablon read klíčem');
    r = await api('POST', `/api/kb/v1/rule-templates/${r.json.templates[0].id}/delete`, { token: `Bearer ${RW}` });
    expect(r.status === 200, `v1 delete šablony (${r.status})`);

    console.log('== oprava panelu: pravidlo se řídí právy AUTORA, ne vlastnickými ==');
    // SEC1: sdílený editor (ne vlastník, ne zadavatel termínu) NESMÍ přes pravidlo
    // přepsat cizí termín. D1 má termín od vlastníka V → editor E ho měnit nesmí.
    r = await api('POST', '/api/kb/rules/save', { token: E, body: {
      map: map.id, name: 'Editor chce měnit termín', node_id: 'D1',
      trigger: { type: 'node_status_changed' }, actions: [{ type: 'set_deadline', relative_days: 30 }],
    } });
    expect(r.status === 200, `editor pravidlo se set_deadline založí (${r.status})`);
    const sec1Rule = r.json.rule.id;
    const beforeDl = plusDny(1);
    // delnik (owner D1, work) cyklne stav D1 → pravidlo firne
    await api('POST', '/api/kb/node-status', { token: W, body: { mapId: map.id, nodeId: 'D1', status: 'in_progress' } });
    await sleep(300);
    const mapPo = (await api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: V })).json;
    const d1 = mapPo.nodes.find((n) => n.id === 'D1');
    expect(d1.data.deadline === beforeDl, `cizí termín ZŮSTAL nezměněn (${d1.data.deadline}) — editor ho pravidlem nepřepsal`);
    const sec1Runs = (await api(`GET`, `/api/kb/rule-runs?map=${map.id}&rule=${sec1Rule}`, { token: V })).json.runs || [];
    expect(sec1Runs.some((x) => x.status === 'failed'), 'běh pravidla je failed (zámek termínů platí i pro pravidla)');
    await api('POST', '/api/kb/rules/delete', { token: V, body: { id: sec1Rule } });

    console.log('== oprava: toggle s tvarem NESMÍ tiše zahodit akce ==');
    // FIX6: {enabled, actions} bez name/trigger → dřív 200 a akce ztraceny; teď 400
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, id: rule1.id, enabled: true, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] } });
    expect(r.status === 400, `update s actions ale bez name/trigger → 400, ne tiché zahození (${r.status})`);
    r = await api('POST', '/api/kb/rules/save', { token: V, body: { map: map.id, id: rule1.id, enabled: false } });
    expect(r.status === 200, 'čistý toggle {enabled} dál projde');

    console.log('== oprava: smazání pravidla ZACHOVÁ jeho log běhů ==');
    // FIX5: rule_runs.rule už nemá cascadeDelete. rule1 má běh z force cronu výš.
    const preDel = (await api(`GET`, `/api/kb/rule-runs?map=${map.id}&rule=${rule1.id}`, { token: V })).json.runs || [];
    expect(preDel.length > 0, `rule1 má nějaké běhy v logu (${preDel.length})`);
    await api('POST', '/api/kb/rules/delete', { token: V, body: { id: rule1.id } });
    const postDel = (await api('GET', `/api/collections/rule_runs/records?filter=${encodeURIComponent(`rule_name="Denní ohláška"`)}`, { token: ST })).json.items || [];
    expect(postDel.length > 0, `audit log po smazání pravidla ZŮSTAL (${postDel.length}) — snapshot rule_name čitelný`);

    console.log(`\nVýsledek: ${pass} ✅ / ${fail} ❌`);
    code = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error('NEOČEKÁVANÁ CHYBA SADY:', err);
    code = 1;
  } finally {
    // process.exit AŽ ZA úklidem (jinak by finally přeskočil a kontejner visel)
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  process.exit(code);
})();
