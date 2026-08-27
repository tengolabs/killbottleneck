// Interní automatizační motor „když X → udělej Y" (automation_rules) — e2e jádra:
//  - diffové triggery (stav změněn / uzel odblokován / uzel založen / příloha)
//  - AND podmínky, akce (set_owner/set_status/set_deadline/create_subnodes/notify/run_agent)
//  - pojistky: smyčka (MAX_RULE_DEPTH), lavina (MAX_RULE_FIRINGS_PER_SAVE),
//    vypnuté pravidlo, celoinstanční brzda KB_RULES_DISABLED
//  - rozbité pravidlo → vlastníkovi mapy mail JEDNOU (error_notified)
//  - RLS: rule_runs čte jen kdo vidí mapu; automation_rules je zamčená
//
// Pravidla se v této sadě zakládají SUPERUSEREM přímo do kolekce (routy CRUD
// jsou samostatná vrstva testovaná v rules-schedule.js / v1-api). Motor sám
// o routách nic neví — přesně to se tu testuje.
const H = require('./_harness');
const { expect, sleep, PW } = H;
let api, reg, login;

const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });
const freshMap = async (token, id) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token })).json;
const patchMap = async (token, map, nodes, edges) => {
  const f = await freshMap(token, map.id);
  return api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token, body: { nodes, edges, base_updated: f.updated } });
};
const findNode = (m, id) => (m.nodes || []).find((n) => n.id === id);

H.beh(async () => {
    const inst = await H.startInstance({ slug: 'rules' });
    api = inst.api;
    reg = (email) => inst.register(email);
    login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
    const ST = await inst.superuser();
    await reg('a@example.com'); // první registrace = admin, vlastník mapy
    await reg('b@example.com');
    await reg('c@example.com'); // cizí — mapu nevidí
    const A = await login('a@example.com');
    const C = await login('c@example.com');

    // „dnes" v LOKÁLNÍM čase KONTEJNERU — hostitel může mít jinou TZ
    const dnes = inst.exec('date +%F').trim();
    const plusDny = (n) => {
      const [y, m, d] = dnes.split('-').map(Number);
      const x = new Date(y, m - 1, d); x.setDate(x.getDate() + n);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    };

    const NODES = [
      node('root', { apexText: 'Proces', title: 'Proces', status: 'todo' }, 'apexNode'),
      node('X', { title: 'Dokončit návrh', status: 'todo', owner: 'a@example.com' }),
      node('Y', { title: 'Uzel bez podmínky', status: 'todo', owner: 'c@example.com' }),
      node('Z', { title: 'Uzel s podmínkou', status: 'todo', owner: 'b@example.com' }),
      node('W', { title: 'Čekající rodič', status: 'todo', owner: 'b@example.com', waitForChildren: true }),
      node('K', { title: 'Dítě', status: 'todo', owner: 'a@example.com' }),
      node('L', { title: 'Smyčkový uzel', status: 'todo', owner: 'a@example.com' }),
      node('F', { title: 'Uzel s přílohou', status: 'todo', owner: 'b@example.com' }),
      node('G', { title: 'Uzel pro agenta', status: 'todo', owner: 'a@example.com' }),
      node('H', { title: 'Uzel rozbitého pravidla', status: 'todo', owner: 'a@example.com' }),
    ];
    const EDGES = [
      { id: 'e1', source: 'root', target: 'X' }, { id: 'e2', source: 'root', target: 'Y' },
      { id: 'e3', source: 'root', target: 'Z' }, { id: 'e4', source: 'root', target: 'W' },
      { id: 'e5', source: 'W', target: 'K' }, { id: 'e6', source: 'root', target: 'L' },
      { id: 'e7', source: 'root', target: 'F' }, { id: 'e8', source: 'root', target: 'G' },
      { id: 'e9', source: 'root', target: 'H' },
    ];
    const map = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Mapa s pravidly', nodes: NODES, edges: EDGES } })).json;

    const mkRule = async (body) => (await api('POST', '/api/collections/automation_rules/records', { token: ST, body: Object.assign({ map: map.id, enabled: true }, body) })).json;
    const runs = async (filter) => (await api('GET', `/api/collections/rule_runs/records?perPage=200&filter=${encodeURIComponent(filter)}`, { token: ST })).json.items || [];
    const notifs = async (token, type) => ((await api('GET', `/api/collections/notifications/records?perPage=200&filter=${encodeURIComponent(`type="${type}"`)}`, { token })).json.items || []);

    console.log('== trigger „stav změněn" + akce set_owner + notify ==');
    const r1 = await mkRule({
      name: 'Hotovo → předat', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'b@example.com' }, { type: 'notify', to: 'map_owner', message: 'uzel dokončen' }],
    });
    expect(!!r1.id, 'pravidlo založeno superuserem');
    let nodes = NODES.map((n) => (n.id === 'X' ? node('X', Object.assign({}, n.data, { status: 'done' })) : n));
    let r = await patchMap(A, map, nodes, EDGES);
    expect(r.status === 200, `uložení mapy s pravidlem prošlo (${r.status})`);
    let m = await freshMap(A, map.id);
    expect(findNode(m, 'X').data.owner === 'b@example.com', 'akce set_owner přepsala garanta uzlu');
    let rr = await runs(`rule = "${r1.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok', `běh zapsán do rule_runs jako ok (${rr.length})`);
    expect(rr[0].trigger_type === 'node_status_changed' && rr[0].node_id === 'X', 'log nese trigger i uzel');
    let na = await notifs(A, 'rule_notice');
    expect(na.length === 1 && na[0].text.includes('uzel dokončen'), 'akce notify doručila map_owner notifikaci s textem');

    console.log('== vypnuté pravidlo nefiruje; AND podmínka filtruje ==');
    await api('PATCH', `/api/collections/automation_rules/records/${r1.id}`, { token: ST, body: { enabled: false } });
    const r2 = await mkRule({
      name: 'Jen pro b', trigger: { type: 'node_status_changed', status: 'done' },
      conditions: [{ field: 'owner', op: 'eq', value: 'b@example.com' }],
      actions: [{ type: 'notify', to: 'node_owner', message: 'tvůj uzel je hotový' }],
    });
    nodes = nodes.map((n) => (n.id === 'Y' ? node('Y', Object.assign({}, n.data, { status: 'done' })) : n)); // owner c ≠ b
    await patchMap(A, map, nodes, EDGES);
    nodes = nodes.map((n) => (n.id === 'Z' ? node('Z', Object.assign({}, n.data, { status: 'done' })) : n)); // owner b
    await patchMap(A, map, nodes, EDGES);
    rr = await runs(`rule = "${r2.id}"`);
    expect(rr.length === 1 && rr[0].node_id === 'Z', `podmínka owner=b pustila jen uzel Z (${rr.length})`);
    expect((await runs(`rule = "${r1.id}"`)).length === 1, 'vypnuté pravidlo nový běh nepřidalo');
    await api('PATCH', `/api/collections/automation_rules/records/${r2.id}`, { token: ST, body: { enabled: false } });

    console.log('== trigger „uzel odblokován" + set_status ==');
    const r4 = await mkRule({
      name: 'Odblokováno → rozjet', node_id: 'W', trigger: { type: 'node_unblocked' },
      actions: [{ type: 'set_status', status: 'in_progress' }, { type: 'notify', to: 'node_owner', message: 'můžeš začít' }],
    });
    nodes = nodes.map((n) => (n.id === 'K' ? node('K', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nodes, EDGES);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'W').data.status === 'in_progress', 'odblokovaný čekající uzel pravidlo přepnulo na „pracuje se"');
    const B = await login('b@example.com');
    expect((await notifs(B, 'rule_notice')).some((n) => n.text.includes('můžeš začít')), 'garant uzlu dostal notifikaci pravidla');
    await api('PATCH', `/api/collections/automation_rules/records/${r4.id}`, { token: ST, body: { enabled: false } });
    nodes = (await freshMap(A, map.id)).nodes; // stav po zásahu pravidla

    console.log('== trigger „uzel založen" + set_deadline(+N) + strop laviny ==');
    const r3 = await mkRule({
      name: 'Nový uzel → termín +3', trigger: { type: 'node_created' },
      actions: [{ type: 'set_deadline', relative_days: 3 }],
    });
    const dvanact = Array.from({ length: 12 }, (_, i) => node(`n-${i}`, { title: `Nový ${i}`, status: 'todo' }));
    const dvanactEdges = dvanact.map((n, i) => ({ id: `en-${i}`, source: 'root', target: n.id }));
    r = await patchMap(A, map, nodes.concat(dvanact), EDGES.concat(dvanactEdges));
    expect(r.status === 200, `hromadné vložení 12 uzlů prošlo (${r.status})`);
    rr = await runs(`rule = "${r3.id}"`);
    const ok3 = rr.filter((x) => x.status === 'ok').length;
    const skip3 = rr.filter((x) => x.status === 'skipped').length;
    expect(ok3 === 10 && skip3 === 2, `strop 10 spuštění na uložení: 10 ok + 2 PŘIZNANĚ skipped (${ok3}/${skip3})`);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'n-0').data.deadline === plusDny(3), `relativní termín +3 dny sedí (${findNode(m, 'n-0').data.deadline})`);
    expect((m.nodes || []).filter((n) => n.id.startsWith('n-') && n.data.deadline).length === 10, 'termín dostalo přesně 10 uzlů (2 nad strop ne)');
    await api('PATCH', `/api/collections/automation_rules/records/${r3.id}`, { token: ST, body: { enabled: false } });
    nodes = m.nodes;

    console.log('== opakování (v0.35): done → todo + advance drží rytmus ==');
    // Rytmus od PŮVODNÍHO termínu (Richard: „každé pondělí je každé pondělí"):
    // včerejší weekly termín → další výskyt za 6 dní (stejný den v týdnu),
    // NE dnes+7. Data VŽDY z kontejneru (past UTC×hostitel, vzor výše).
    m = await freshMap(A, map.id);
    r = await patchMap(A, map, m.nodes.concat([
      node('R', { title: 'Týdenní report', status: 'todo', deadline: plusDny(-1) }),
      node('RD', { title: 'Denní úklid', status: 'todo', deadline: dnes }),
    ]), m.edges.concat([{ id: 'eR', source: 'root', target: 'R' }, { id: 'eRD', source: 'root', target: 'RD' }]));
    expect(r.status === 200, `uzly R a RD založeny (${r.status})`);
    // validace přes OSTROU routu /rules/save (tudy jde přepínač v UI)
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Opakování (týdně): Týdenní report', node_id: 'R',
      trigger: { type: 'node_status_changed', status: 'done' }, conditions: [],
      actions: [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'weekly' }],
    } });
    expect(r.status === 200 && r.json.rule && r.json.rule.id, `rules/save přijal advance: weekly (${r.status})`);
    const rOpak = r.json.rule;
    r = await api('POST', '/api/kb/rules/save', { token: A, body: {
      map: map.id, name: 'Vadné opakování', node_id: 'R',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_deadline', advance: 'yearly' }],
    } });
    expect(r.status === 400, `advance mimo daily|weekly|monthly server odmítne (${r.status})`);
    // pravidlo běží právy AUTORA (created_by) — bez něj termínová stráž
    // („termín mění jen zadavatel/vlastník") advance právem zablokuje
    const rDen = await mkRule({
      name: 'Opakování (denně): Denní úklid', node_id: 'RD', created_by: 'a@example.com',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'daily' }],
    });
    m = await freshMap(A, map.id);
    let nn = m.nodes.map((n) => (n.id === 'R' ? node('R', Object.assign({}, n.data, { status: 'done' })) : n));
    nn = nn.map((n) => (n.id === 'RD' ? node('RD', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nn, m.edges);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'R').data.status === 'todo', 'dokončený opakovaný cíl se vrátil na todo');
    expect(findNode(m, 'R').data.deadline === plusDny(6),
      `weekly rytmus drží: včerejšek + 7 = za 6 dní, NE dnes+7 (${findNode(m, 'R').data.deadline} vs ${plusDny(6)})`);
    expect(findNode(m, 'RD').data.status === 'todo' && findNode(m, 'RD').data.deadline === plusDny(1),
      `denní s termínem DNES → zítra; přesně tvar, který padá jen o půlnoci (${findNode(m, 'RD').data.deadline})`);
    rr = await runs(`rule = "${rOpak.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok', `návrat na todo NEspustil pravidlo znovu — žádná smyčka (${rr.length})`);
    // druhé kolo: dokončit znovu → termín zase +7 od NOVÉHO termínu
    m = await freshMap(A, map.id);
    await patchMap(A, map, m.nodes.map((n) => (n.id === 'R' ? node('R', Object.assign({}, n.data, { status: 'done' })) : n)), m.edges);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'R').data.deadline === plusDny(13),
      `druhé dokončení posunulo o další týden (${findNode(m, 'R').data.deadline} vs ${plusDny(13)})`);
    // měsíční clamp: 31. 1. příštího roku → 28./29. 2. (kotva dne drží, únor clampuje)
    const rokPristi = Number(dnes.slice(0, 4)) + 1;
    const unorPosledni = new Date(Date.UTC(rokPristi, 2, 0)).getUTCDate();
    m = await freshMap(A, map.id);
    r = await patchMap(A, map, m.nodes.concat([node('RM', { title: 'Měsíční uzávěrka', status: 'todo', deadline: `${rokPristi}-01-31` })]),
      m.edges.concat([{ id: 'eRM', source: 'root', target: 'RM' }]));
    const rMes = await mkRule({
      name: 'Opakování (měsíčně): Uzávěrka', node_id: 'RM', created_by: 'a@example.com',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'monthly' }],
    });
    m = await freshMap(A, map.id);
    await patchMap(A, map, m.nodes.map((n) => (n.id === 'RM' ? node('RM', Object.assign({}, n.data, { status: 'done' })) : n)), m.edges);
    m = await freshMap(A, map.id);
    expect(findNode(m, 'RM').data.deadline === `${rokPristi}-02-${String(unorPosledni).padStart(2, '0')}`,
      `měsíčně 31.1.→konec února, clamp bez přetečení (${findNode(m, 'RM').data.deadline})`);
    for (const rid of [rOpak.id, rDen.id, rMes.id]) {
      await api('PATCH', `/api/collections/automation_rules/records/${rid}`, { token: ST, body: { enabled: false } });
    }
    nodes = m.nodes;

    console.log('== uzel narozený rovnou Hotovo JE změna stavu (cloud nález 17. 8.) ==');
    // Rychlé ruce + latence cloudu: „přidat podcíl → hned Hotovo" se slije do
    // JEDNOHO autosave. Uzel je pak v diffu nový a dřív se počítal jen jako
    // node_created → kanban mlčel bez záznamu. Zrození s todo změna NENÍ.
    const rBorn = await mkRule({
      name: 'Narozen hotový', created_by: 'a@example.com',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'notify', to: 'map_owner', message: 'narozen hotový' }],
    });
    m = await freshMap(A, map.id);
    r = await patchMap(A, map, m.nodes.concat([
      node('BD', { title: 'Bleskový úkol', status: 'done' }),
      node('BT', { title: 'Obyčejný nový', status: 'todo' }),
    ]), m.edges.concat([
      { id: 'eBD', source: 'root', target: 'BD' },
      { id: 'eBT', source: 'root', target: 'BT' },
    ]));
    expect(r.status === 200, `jeden PATCH s uzlem narozeným done prošel (${r.status})`);
    rr = await runs(`rule = "${rBorn.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok' && rr[0].node_id === 'BD',
      `pravidlo vystřelilo PRÁVĚ pro narozeného hotového, ne pro todo (${rr.length}: ${rr.map((x) => x.node_id).join(',')})`);
    await api('PATCH', `/api/collections/automation_rules/records/${rBorn.id}`, { token: ST, body: { enabled: false } });
    nodes = (await freshMap(A, map.id)).nodes;

    console.log('== salva narozených hotových: strop 10/uložení drží (Richard: nechat) ==');
    // Rozhodnutí 17. 8.: vložená/duplikovaná větev hotových uzlů pravidla
    // SPOUŠTÍ (konzistentní s „narozen hotový"), lavinu drží strop 10 na
    // uložení a zbytek je PŘIZNANĚ skipped — nic nemlčí.
    const rSalva = await mkRule({
      name: 'Salva hotových', created_by: 'a@example.com',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'notify', to: 'map_owner', message: 'hotový v salvě' }],
    });
    m = await freshMap(A, map.id);
    const salva = Array.from({ length: 12 }, (_, i) => node(`S${i}`, { title: `Salva ${i}`, status: 'done' }));
    const salvaEdges = salva.map((n, i) => ({ id: `eS${i}`, source: 'root', target: n.id }));
    r = await patchMap(A, map, m.nodes.concat(salva), m.edges.concat(salvaEdges));
    expect(r.status === 200, `12 hotových uzlů v jednom PATCHi prošlo (${r.status})`);
    rr = await runs(`rule = "${rSalva.id}"`);
    const okS = rr.filter((x) => x.status === 'ok').length;
    const skipS = rr.filter((x) => x.status === 'skipped').length;
    expect(okS === 10 && skipS === 2, `strop: 10 ok + 2 přiznaně skipped (${okS}/${skipS})`);
    await api('PATCH', `/api/collections/automation_rules/records/${rSalva.id}`, { token: ST, body: { enabled: false } });
    nodes = (await freshMap(A, map.id)).nodes;

    console.log('== create_subnodes: totéž pravidlo vystřelí i PODRUHÉ ==');
    // Regrese: id podstromu se skládala jen z rule.id + pořadí akce, takže druhá
    // karta (druhá reklamace, druhý kus) narazila na "Duplicitní id uzlu",
    // pravidlo se označilo za rozbité a akce fungovala právě jednou za život.
    m = await freshMap(A, map.id);
    r = await patchMap(A, map, m.nodes.concat([node('P', { title: 'Kontejner', status: 'todo' })]),
      m.edges.concat([{ id: 'eP', source: 'root', target: 'P' }]));
    expect(r.status === 200, `kontejner P založen (${r.status})`);
    const rs = await mkRule({
      name: 'Nová karta → rozbal kroky', trigger: { type: 'node_created' },
      conditions: [{ field: 'parent', op: 'eq', value: 'P' }],
      actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [{ title: 'Krok 1' }, { title: 'Krok 2' }] }],
    });
    for (const karta of ['c1', 'c2', 'c3']) {
      m = await freshMap(A, map.id);
      await patchMap(A, map, m.nodes.concat([node(karta, { title: `Karta ${karta}`, status: 'todo' })]),
        m.edges.concat([{ id: `e-${karta}`, source: 'P', target: karta }]));
    }
    m = await freshMap(A, map.id);
    const kroku = (id) => (m.edges || []).filter((e) => e.source === id).length;
    expect(kroku('c1') === 2 && kroku('c2') === 2 && kroku('c3') === 2,
      `kroky dostaly VŠECHNY tři karty, ne jen první (${kroku('c1')}/${kroku('c2')}/${kroku('c3')})`);
    rr = await runs(`rule = "${rs.id}"`);
    expect(rr.length === 3 && rr.every((x) => x.status === 'ok'),
      `všechny tři běhy ok, žádné "Duplicitní id uzlu" (${rr.map((x) => x.status).join(',') || 'nic'})`);
    const vsechnaId = (m.nodes || []).map((n) => n.id);
    expect(new Set(vsechnaId).size === vsechnaId.length, 'v mapě nejsou duplicitní id uzlů');
    expect(kroku('c1') === 2 && (m.edges || []).filter((e) => e.source === (m.edges.find((x) => x.source === 'c1') || {}).target).length === 0,
      'pravidlo nespustilo samo sebe nad kroky, které právě založilo');
    await api('PATCH', `/api/collections/automation_rules/records/${rs.id}`, { token: ST, body: { enabled: false } });
    nodes = m.nodes;

    console.log('== smyčka dvou pravidel → pojistka hloubky, server nezamrzne ==');
    const la = await mkRule({
      name: 'Smyčka A', node_id: 'L', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'set_status', status: 'done' }],
    });
    const lb = await mkRule({
      name: 'Smyčka B', node_id: 'L', trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_status', status: 'in_progress' }],
    });
    nodes = nodes.map((n) => (n.id === 'L' ? node('L', Object.assign({}, n.data, { status: 'in_progress' })) : n));
    r = await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    expect(r.status === 200, `uložení se smyčkou pravidel doběhlo (${r.status})`);
    rr = await runs(`(rule = "${la.id}" || rule = "${lb.id}")`);
    const skipped = rr.filter((x) => x.status === 'skipped');
    expect(rr.filter((x) => x.status === 'ok').length === 3, `řetěz A→B→A proběhl přesně do hloubky 3 (${rr.filter((x) => x.status === 'ok').length})`);
    expect(skipped.length >= 1 && skipped.some((x) => x.detail.includes('pojistce') || x.detail.includes('pojistka')), 'utnutí smyčky je PŘIZNANÉ řádkem skipped');
    await api('PATCH', `/api/collections/automation_rules/records/${la.id}`, { token: ST, body: { enabled: false } });
    await api('PATCH', `/api/collections/automation_rules/records/${lb.id}`, { token: ST, body: { enabled: false } });
    nodes = (await freshMap(A, map.id)).nodes;

    console.log('== trigger „příloha nahrána" (jen skutečný soubor) ==');
    const r5 = await mkRule({
      name: 'Příloha → ohlásit', node_id: 'F', trigger: { type: 'file_uploaded' },
      actions: [{ type: 'notify', to: 'b@example.com', message: 'přišla příloha' }],
    });
    const form = new FormData();
    form.append('map', map.id); form.append('node_id', 'F'); form.append('name', 'podklady.txt');
    form.append('size', '5'); form.append('file', new Blob(['ahoj!'], { type: 'text/plain' }), 'podklady.txt');
    let up = await fetch(`${inst.base}/api/collections/node_files/records`, { method: 'POST', headers: { Authorization: A }, body: form });
    expect(up.status === 200, `nahrání přílohy prošlo (${up.status})`);
    rr = await runs(`rule = "${r5.id}"`);
    expect(rr.length === 1 && rr[0].trigger_type === 'file_uploaded', 'nahraný soubor pravidlo spustil');
    await api('POST', '/api/collections/node_files/records', { token: A, body: { map: map.id, node_id: 'F', name: 'odkaz', url: 'https://example.com/x' } });
    rr = await runs(`rule = "${r5.id}"`);
    expect(rr.length === 1, 'přidání ODKAZU pravidlo nespouští (odkaz je poznámka)');
    await api('PATCH', `/api/collections/automation_rules/records/${r5.id}`, { token: ST, body: { enabled: false } });

    console.log('== akce run_agent: jen zařadí do fronty agent_runs ==');
    r = await api('POST', '/api/flowmap/ai-agents/save', { token: A, body: { name: 'testovaci', enabled: true, secret: 'x'.repeat(20), webhook_url: 'http://host.docker.internal:1/nikam' } });
    expect(r.status === 200, `admin založil agenta v registru (${r.status})`);
    const r6 = await mkRule({
      name: 'Rozjeto → agent', node_id: 'G', trigger: { type: 'node_status_changed', status: 'in_progress' },
      actions: [{ type: 'run_agent', agent_name: 'testovaci' }],
    });
    nodes = nodes.map((n) => (n.id === 'G' ? node('G', Object.assign({}, n.data, { status: 'in_progress' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    rr = await runs(`rule = "${r6.id}"`);
    expect(rr.length === 1 && rr[0].status === 'ok' && !!rr[0].agent_run, 'běh pravidla drží vazbu na založený agent_run');
    const ar = (await api('GET', `/api/collections/agent_runs/records?filter=${encodeURIComponent(`map = "${map.id}" && node_id = "G"`)}`, { token: ST })).json.items || [];
    expect(ar.length === 1 && ar[0].agent_name === 'testovaci', `agent_run založen na LIDSKÉM uzlu přes opts.agentName (${ar.length})`);
    await api('PATCH', `/api/collections/automation_rules/records/${r6.id}`, { token: ST, body: { enabled: false } });

    console.log('== SEC: allowed_emails se vyhodnocuje podle AUTORA pravidla ==');
    // Nález panelu: řetěz set_owner→run_agent obcházel allowed_emails podle
    // přepsaného ownera. Teď rozhoduje created_by pravidla. Agent povolí jen a@.
    await api('POST', '/api/flowmap/ai-agents/save', { token: A, body: { name: 'hlidany', enabled: true, secret: 'y'.repeat(20), webhook_url: 'http://host.docker.internal:1/nikam', allowed_emails: ['a@example.com'] } });
    // uzel Y (owner c@, bez existujícího agent_runu → guard nefalšuje) na todo
    nodes = (await freshMap(A, map.id)).nodes;
    nodes = nodes.map((n) => (n.id === 'Y' ? node('Y', Object.assign({}, n.data, { status: 'todo', owner: 'c@example.com' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    // pravidlo s autorem c@ (mimo allowed) + set_owner na a@ (v allowed) → dřív by prošlo
    const secRule = await mkRule({
      name: 'Obchvat allowed', node_id: 'Y', created_by: 'c@example.com',
      trigger: { type: 'node_status_changed', status: 'done' },
      actions: [{ type: 'set_owner', owner: 'a@example.com' }, { type: 'run_agent', agent_name: 'hlidany' }],
    });
    nodes = (await freshMap(A, map.id)).nodes;
    nodes = nodes.map((n) => (n.id === 'Y' ? node('Y', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    await sleep(200);
    const secAr = (await api('GET', `/api/collections/agent_runs/records?filter=${encodeURIComponent(`agent_name = "hlidany"`)}`, { token: ST })).json.items || [];
    expect(secAr.length === 0, `agent NEspuštěn — autor pravidla (c@) není v allowed_emails, přestože set_owner přepsal ownera na a@ (${secAr.length})`);
    await api('PATCH', `/api/collections/automation_rules/records/${secRule.id}`, { token: ST, body: { enabled: false } });

    console.log('== rozbité pravidlo: failed + mail vlastníkovi JEDNOU ==');
    const r7 = await mkRule({
      name: 'Rozbité', node_id: 'H', trigger: { type: 'node_status_changed' },
      actions: [{ type: 'create_subnodes', parent: 'neexistujici-uzel', items: [{ title: 'x' }] }],
    });
    nodes = (await freshMap(A, map.id)).nodes;
    nodes = nodes.map((n) => (n.id === 'H' ? node('H', Object.assign({}, n.data, { status: 'done' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    nodes = nodes.map((n) => (n.id === 'H' ? node('H', Object.assign({}, n.data, { status: 'todo' })) : n));
    await patchMap(A, map, nodes, EDGES.concat(dvanactEdges));
    rr = await runs(`rule = "${r7.id}"`);
    expect(rr.length === 2 && rr.every((x) => x.status === 'failed'), `oba běhy rozbitého pravidla jsou failed (${rr.length})`);
    expect((await notifs(A, 'rule_broken')).length === 1, 'vlastník dostal „pravidlo selhalo" PRÁVĚ JEDNOU, ne spam');
    const r7rec = (await api('GET', `/api/collections/automation_rules/records/${r7.id}`, { token: ST })).json;
    expect(!!r7rec.last_error && r7rec.error_notified === true, 'pravidlo nese last_error + error_notified');
    await api('PATCH', `/api/collections/automation_rules/records/${r7.id}`, { token: ST, body: { enabled: false } });

    console.log('== RLS: log vidí jen kdo vidí mapu; kolekce pravidel zamčená ==');
    r = await api('GET', '/api/collections/rule_runs/records', { token: C });
    expect(r.status === 200 && r.json.totalItems === 0, `cizí uživatel nevidí žádný běh (${r.json && r.json.totalItems})`);
    r = await api('GET', '/api/collections/automation_rules/records', { token: A });
    expect(r.status === 403, `automation_rules je zamčená i pro admina — jen server (${r.status})`);
    r = await api('POST', '/api/collections/automation_rules/records', { token: A, body: { map: map.id, name: 'podvrh', trigger: { type: 'schedule' }, actions: [] } });
    expect(r.status === 403 || r.status === 400, `pravidlo nejde založit přímým zápisem do kolekce (${r.status})`);

    console.log('== celoinstanční brzda KB_RULES_DISABLED=1 ==');
    const off = await H.startInstance({ slug: 'rules-off', env: { KB_RULES_DISABLED: 1 } });
    const api2 = off.api;
    const ST2 = await off.superuser();
    await api2('POST', '/api/collections/users/records', { body: { email: 'a@example.com', password: PW, passwordConfirm: PW } });
    const A2 = (await api2('POST', '/api/collections/users/auth-with-password', { body: { identity: 'a@example.com', password: PW } })).json.token;
    const map2 = (await api2('POST', '/api/collections/goalmaps/records', { token: A2, body: { title: 'Brzda', nodes: [node('root', { apexText: 'x', title: 'x', status: 'todo' }, 'apexNode'), node('Q', { title: 'q', status: 'todo' })], edges: [{ id: 'e', source: 'root', target: 'Q' }] } })).json;
    await api2('POST', '/api/collections/automation_rules/records', { token: ST2, body: { map: map2.id, enabled: true, name: 'nesmí běžet', trigger: { type: 'node_status_changed' }, actions: [{ type: 'set_owner', owner: 'a@example.com' }] } });
    const f2 = (await api2('GET', `/api/collections/goalmaps/records/${map2.id}`, { token: A2 })).json;
    await api2('PATCH', `/api/collections/goalmaps/records/${map2.id}`, { token: A2, body: { nodes: f2.nodes.map((n) => (n.id === 'Q' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)), edges: f2.edges, base_updated: f2.updated } });
    r = await api2('GET', '/api/collections/rule_runs/records', { token: ST2 });
    expect(r.json.totalItems === 0, 'brzda KB_RULES_DISABLED=1 motor úplně vypnula');

}, { nazev: 'RULES ENGINE' });
