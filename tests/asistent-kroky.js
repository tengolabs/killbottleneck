// The assistant finishes a request in several dependent steps (16. 11. 2026). A real conversation: "make the project
// a stage board — Lead, Building the website, Offer sent, Talks, Deal, Postponed — and when I mark a client done it
// jumps to the next one" took three attempts: rules needed node ids the model is never shown, the columns only got
// ids after a confirmation, and the app ended the confirmation with "Done." (0 tokens) after the first step.
//  A) a move and rules may point at step TITLES, also at steps proposed with add_nodes in the same reply →
//     the whole request is one set of cards, "Do all" runs them in order;
//  B) a card may carry `then` (the model's next step) → after the confirmation the model continues, the card
//     shows "Then: …"; without `then` the cheap app ending stays;
//  C) the rule tools are offered for plain words ("when I tick it off it jumps on"), not only for "rule".
// Against a FAKE ollama (a queue of answers) — no real model.
// Run: KB_TEST_IMAGE=<image> node product/tests/asistent-kroky.js
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const volani = [];
const volej = (...calls) => ({ tool_calls: calls.map(([name, args]) => ({ function: { name, arguments: args } })) });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  volani.push(JSON.parse(body));
  const o = fronta.shift() || text('(empty queue)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
};
const toolZ = (v) => (v ? v.messages.filter((m) => m.role === 'tool').map((m) => m.content) : []);
const kartyTahu = (chat, typ) => { const i = chat.messages.map((m) => m.role).lastIndexOf('user'); return chat.messages.slice(i + 1).flatMap((m) => m.karty || []).filter((k) => k.type === typ); };
const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });
const nabidnuto = (v, jmeno) => !!v && (v.tools || []).some((t) => t.function && t.function.name === jmeno);

const SLOUPCE = ['Potenciální', 'Programujeme web', 'Zaslání nabídky', 'Jednání', 'Zakázka', 'Odloženo'];
const KLIENTI = ['Auto Jarnov', 'ŠášaBurger', 'Scanusscrew'];
const DONE = { type: 'node_status_changed', status: 'done' };
const pravidloFaze = (z, na, mapa) => ['create_rule', { map_id: mapa || 'Weby', name: `Hotovo v ${z} → ${na}`, trigger: DONE,
  conditions: [{ field: 'parent', op: 'eq', value: z }], actions: [{ type: 'set_status', status: 'todo' }, { type: 'move_node', to: na }] }];

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  // KB_CHAT_POTVRZENI null = the production default (the app ends a confirmation itself) — B is about exactly that
  const ENV = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_AI_MAX_PER_HOUR: 600, KB_AI_KVOTA_TYDEN: 500, KB_CHAT_POTVRZENI: null };
  const inst = await H.startInstance({ slug: 'asistent-kroky', addHostGateway: true, env: ENV });
  await inst.register('admin@example.com', { name: 'Petr' });
  const A = await inst.login('admin@example.com');
  const chatuj = async (body) => inst.api('POST', '/api/kb/chat', { token: A, body });
  const potvrd = async (chat_id, ids) => inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: Array.isArray(ids) ? { chat_id, action_ids: ids, ok: true } : { chat_id, action_id: ids, ok: true } });
  const pravidla = async (mid) => (await inst.api('GET', `/api/kb/rules?map=${mid}`, { token: A })).json.rules || [];
  const nactiMapu = async (mid) => (await inst.api('GET', `/api/collections/goalmaps/records/${mid}`, { token: A })).json;
  const novaMapa = async (title) => (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title,
    nodes: [node('root', { apexText: title, title, status: 'todo' }, 'apexNode')].concat(KLIENTI.map((k, i) => node(`k${i}`, { title: k, status: i === 2 ? 'done' : 'in_progress' }))),
    edges: KLIENTI.map((k, i) => ({ id: `e${i}`, source: 'root', target: `k${i}` })) } })).json;
  const rodic = (m, titulek) => {
    const n = m.nodes.find((x) => (x.data || {}).title === titulek);
    const e = n && m.edges.find((x) => x.target === n.id);
    const p = e && m.nodes.find((x) => x.id === e.source);
    return p ? (p.data || {}).title : '';
  };
  const idPodleNazvu = (m, titulek) => (m.nodes.find((x) => (x.data || {}).title === titulek) || {}).id;

  console.log('== C: plain words offer the rule tools (no "rule", no "kanban") ==');
  let map = await novaMapa('Weby');
  expect(!!map.id, 'project Weby created');
  fronta.push(text('Rozumím.'));
  await chatuj({ message: 'Až dám u klienta hotovo, ať to skočí do další fáze', context: { route: `/map/${map.id}`, map_id: map.id } });
  expect(nabidnuto(volani[volani.length - 1], 'create_rule'), 'plain "when I mark it done it jumps on" → create_rule offered');
  fronta.push(text('Rozumím.'));
  await chatuj({ message: 'pomocí pravidel chci dát hotovo a skočí to na další', context: { route: `/map/${map.id}`, map_id: map.id } });
  expect(nabidnuto(volani[volani.length - 1], 'create_rule'), '"pravidel" (genitive plural) → create_rule offered (used to miss)');
  fronta.push(text('Máte dnes tři úkoly.'));
  await chatuj({ message: 'Co mám dnes dělat?', context: { route: '/' } });
  expect(!nabidnuto(volani[volani.length - 1], 'create_rule'), 'an ordinary question does not get the rule tools');

  console.log('== A: columns + moves + rules in ONE reply, by titles, confirmed at once ==');
  const odpoved = volej(
    ['add_nodes', { map_id: 'Weby', parent_id: 'apex', items: SLOUPCE.map((t) => ({ title: t, icon: '📌' })) }],
    ...KLIENTI.map((k) => ['move_node', { map_id: 'Weby', node_id: k, parent_id: 'Potenciální' }]),
    ...SLOUPCE.slice(0, 4).map((z, i) => pravidloFaze(z, SLOUPCE[i + 1]))
  );
  fronta.push(odpoved);
  let r = await chatuj({ message: 'Předělej projekt na fáze Potenciální, Programujeme web, Zaslání nabídky, Jednání, Zakázka, Odloženo; klienty dej do Potenciální; až dám hotovo, ať skočí do další (Zakázka je konec)', context: { route: `/map/${map.id}`, map_id: map.id } });
  let chat = r.json && r.json.chat;
  const karty = chat ? kartyTahu(chat, 'akce') : [];
  const chybyModelu = toolZ(volani[volani.length - 1]).concat(chat ? chat.messages.filter((m) => m.role === 'tool').map((m) => m.content) : []).filter((t) => /^Error/.test(t));
  expect(karty.length === 8, `8 cards in one reply: 1 columns + 3 moves + 4 rules (${karty.length}; errors: ${chybyModelu.join(' | ').slice(0, 300)})`);
  const presun = karty.find((k) => k.name === 'move_node');
  expect(!!presun && !!presun.cesta && JSON.stringify(presun.cesta.rodice || []).includes('Potenciální'), `move card shows the new (proposed) parent (${JSON.stringify(presun && presun.cesta)})`);
  expect((await pravidla(map.id)).length === 0, 'nothing written before the confirmation');
  fronta.push(text('Hotovo — fáze a pravidla jsou nastavené.')); // rules are not app-ended (the model explains them)
  r = await potvrd(chat.id, karty.map((k) => k.id));
  chat = r.json && r.json.chat;
  const stavy = chat ? chat.messages.flatMap((m) => m.karty || []).filter((k) => k.type === 'akce').map((k) => `${k.name}:${k.stav}${k.stav === 'chyba' ? '(' + k.vysledek + ')' : ''}`) : [];
  expect(r.status === 200 && stavy.length === 8 && stavy.every((x) => /:hotovo$/.test(x)), `"Do all": every card done (${r.status}; ${stavy.join(', ').slice(0, 400)})`);
  map = await nactiMapu(map.id);
  expect(KLIENTI.every((k) => rodic(map, k) === 'Potenciální'), `clients are under Potenciální (${KLIENTI.map((k) => rodic(map, k)).join(', ')})`);
  // moved steps are laid out under their new parent, not left where they stood (Richard 16. 11. 2026)
  const poz = (t) => (map.nodes.find((x) => x.data && x.data.title === t) || {}).position || {};
  const yFazi = new Set(SLOUPCE.map((t) => poz(t).y)), yKlientu = new Set(KLIENTI.map((t) => poz(t).y));
  const xKlientu = KLIENTI.map((t) => poz(t).x).sort((a, b) => a - b);
  expect(yFazi.size === 1 && yKlientu.size === 1 && [...yKlientu][0] > [...yFazi][0] && xKlientu[0] < poz('Potenciální').x + 1 && xKlientu[2] > poz('Potenciální').x - 1,
    `tidy board: stages in one row, clients in one row under Potenciální (${JSON.stringify(SLOUPCE.concat(KLIENTI).map((t) => [t.slice(0, 10), poz(t).x, poz(t).y]))})`);
  const pr = await pravidla(map.id);
  const ok = SLOUPCE.slice(0, 4).every((z, i) => pr.some((p) => (p.conditions || []).some((c) => c.field === 'parent' && c.value === idPodleNazvu(map, z))
    && (p.actions || []).some((a) => a.type === 'move_node' && a.to === idPodleNazvu(map, SLOUPCE[i + 1]))));
  expect(pr.length === 4 && ok, `4 rules stored with the column ids (${pr.length}; ${JSON.stringify(pr.map((p) => [p.conditions, p.actions.map((a) => a.to).filter(Boolean)])).slice(0, 300)})`);

  console.log('== the rules work: done → next column, back to To do ==');
  const k0 = idPodleNazvu(map, 'Auto Jarnov');
  let p = await inst.api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: { base_updated: map.updated, edges: map.edges, nodes: map.nodes.map((n) => (n.id === k0 ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)) } });
  await H.sleep(1000);
  map = await nactiMapu(map.id);
  const k0n = map.nodes.find((n) => n.id === k0);
  expect(p.status === 200 && rodic(map, 'Auto Jarnov') === 'Programujeme web' && k0n.data.status === 'todo', `Auto Jarnov done → Programujeme web, status todo (${rodic(map, 'Auto Jarnov')}, ${k0n.data.status})`);

  console.log('== A: unknown title is still told to the model before any card ==');
  fronta.push(volej(pravidloFaze('Neexistuje', 'Jednání')), text('Ten sloupec v projektu není.'));
  r = await chatuj({ message: 'až dám hotovo ve sloupci Neexistuje, ať to skočí do Jednání', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat;
  const tm = toolZ(volani[volani.length - 1]).join('\n');
  expect(!!chat && kartyTahu(chat, 'akce').length === 0 && /^Error/m.test(tm), `no card, the model hears the error (${tm.slice(0, 160).replace(/\n/g, ' ')})`);

  console.log('== A: ids keep working (older conversations, MCP habits) ==');
  fronta.push(volej(['create_rule', { map_id: 'Weby', name: 'Podle id', trigger: DONE, conditions: [{ field: 'parent', op: 'eq', value: idPodleNazvu(map, 'Zakázka') }], actions: [{ type: 'set_status', status: 'todo' }] }]));
  r = await chatuj({ message: 'pravidlo: hotovo v Zakázce vrať na začátek', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat;
  let k = chat ? kartyTahu(chat, 'akce')[0] : null;
  expect(!!k, `rule by id → card (${toolZ(volani[volani.length - 1]).join(' | ').slice(0, 200)})`);
  if (k) { await potvrd(chat.id, k.id); expect((await pravidla(map.id)).some((x) => x.name === 'Podle id'), 'rule by id stored'); }

  console.log('== the rule card says what the rule does in plain words ==');
  const kartaPravidla = karty.find((x) => x.name === 'create_rule');
  expect(!!kartaPravidla && kartaPravidla.popis.includes('Když u kroku pod „Potenciální“ dáte Hotovo, přesune se pod „Programujeme web“ a vrátí se na Založeno.')
    && !/node_status_changed|move_node|set_status/.test(kartaPravidla.popis), `plain sentence, no tool words (${kartaPravidla && kartaPravidla.popis})`);

  console.log('== a rule the map already has is not offered again ==');
  fronta.push(volej(pravidloFaze('Potenciální', 'Programujeme web')), text('To pravidlo už v mapě je a funguje.'));
  r = await chatuj({ message: 'chtěl bych aby když dám hotovo v Potenciální, skočilo to do Programujeme web', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat;
  const tdup = toolZ(volani[volani.length - 1]).join('\n');
  expect(!!chat && kartyTahu(chat, 'akce').length === 0 && /already exists in the map as "Hotovo v Potenciální → Programujeme web" and is switched on/.test(tdup), `no duplicate card, the model hears the rule exists (${tdup.slice(0, 200).replace(/\n/g, ' ')})`);
  expect((await pravidla(map.id)).filter((x) => /Potenciální/.test(x.name)).length === 1, 'still one rule for Potenciální');
  fronta.push(volej(['create_rule', { map_id: 'Weby', name: 'Jiné', trigger: DONE, conditions: [{ field: 'parent', op: 'eq', value: 'Potenciální' }], actions: [{ type: 'move_node', to: 'Jednání' }, { type: 'set_status', status: 'todo' }] }]));
  r = await chatuj({ message: 'pravidlo: hotovo v Potenciální → rovnou do Jednání', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat;
  expect(!!chat && kartyTahu(chat, 'akce').length === 1, 'a different target is not a duplicate → card');

  console.log('== a leading emoji in a step title goes to its icon (no double emoji) ==');
  fronta.push(volej(['add_nodes', { map_id: 'Weby', parent_id: 'apex', items: [{ title: '🆕 Noví klienti' }, { title: '✉️ Nabídka', icon: '📨' }] }]));
  r = await chatuj({ message: 'přidej fáze Noví klienti a Nabídka', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat;
  const kEm = chat ? kartyTahu(chat, 'akce').find((x) => x.name === 'add_nodes') : null;
  const strom = (kEm && kEm.strom) || [];
  expect(strom.length === 2 && strom[0].t === 'Noví klienti' && strom[0].i === '🆕' && strom[1].t === 'Nabídka' && strom[1].i === '📨', `titles without emoji, icon kept or taken from the title (${JSON.stringify(strom)})`);
  // checkup 17. 11. 2026: a new project carries its steps in `outline`, not `items`; a plain arrow is not an emoji
  fronta.push(volej(['create_project', { title: 'Nový web', icon: '🌐', outline: [{ title: '🎯 Cíl webu' }, { title: '→ Další fáze' }] }]));
  r = await chatuj({ message: 'založ projekt Nový web s kroky Cíl webu a Další fáze', context: { route: '/' } });
  chat = r.json && r.json.chat;
  const kProj = chat ? kartyTahu(chat, 'akce').find((x) => x.name === 'create_project') : null;
  const pendProj = chat ? (chat.pending || []).find((x) => x.name === 'create_project') : null;
  const osnova = (pendProj && pendProj.args && pendProj.args.outline) || [];
  expect(!!kProj && osnova.length === 2 && osnova[0].title === 'Cíl webu' && osnova[0].icon === '🎯' && osnova[1].title === '→ Další fáze',
    `create_project outline: emoji → icon, an arrow stays in the title (${JSON.stringify(osnova)})`);

  console.log('== a move and a rule may point at a proposed step WITH its emoji (the step itself is stored without it) ==');
  const mE = await novaMapa('Emoji');
  fronta.push(volej(
    ['add_nodes', { map_id: 'Emoji', parent_id: 'apex', items: [{ title: '🗂️ Rozpracované' }, { title: '🏁 Dokončené' }] }],
    ['move_node', { map_id: 'Emoji', node_id: 'Auto Jarnov', parent_id: '🗂️ Rozpracované' }],
    pravidloFaze('🗂️ Rozpracované', '🏁 Dokončené', 'Emoji')
  ));
  r = await chatuj({ message: 'udělej fáze Rozpracované a Dokončené, Auto Jarnov dej do první a když dám hotovo, ať skočí do druhé', context: { route: `/map/${mE.id}`, map_id: mE.id } });
  chat = r.json && r.json.chat;
  const kartyE = chat ? kartyTahu(chat, 'akce') : [];
  const chybyE = toolZ(volani[volani.length - 1]).concat(chat ? chat.messages.filter((m) => m.role === 'tool').map((m) => m.content) : []).filter((t) => /^Error/.test(t));
  expect(kartyE.length === 3, `3 cards, the emoji references match the proposed steps (${kartyE.length}; ${chybyE.join(' | ').slice(0, 300)})`);
  if (kartyE.length === 3) {
    fronta.push(text('Hotovo.'));
    r = await potvrd(chat.id, kartyE.map((x) => x.id));
    const mPo = await nactiMapu(mE.id);
    const prE = await pravidla(mE.id);
    expect(rodic(mPo, 'Auto Jarnov') === 'Rozpracované' && prE.length === 1 && (prE[0].actions || []).some((a) => a.type === 'move_node' && a.to === idPodleNazvu(mPo, 'Dokončené')),
      `after "Do all": Auto Jarnov under Rozpracované, the rule points at Dokončené (${rodic(mPo, 'Auto Jarnov')}; ${JSON.stringify(prE.map((p) => p.actions))})`);
  }

  fronta.length = 0; // an answer the app did not need (cheap ending) must not leak into the next part
  console.log('== the same rule twice in one reply → the second is refused ==');
  const mD = await novaMapa('Dvakrat');
  fronta.push(volej(
    ['add_nodes', { map_id: 'Dvakrat', parent_id: 'apex', items: [{ title: 'Nové' }, { title: 'Hotové' }] }],
    // identical calls are dropped earlier; the twin under another name is what the duplicate check is for
    pravidloFaze('Nové', 'Hotové', 'Dvakrat'), ['create_rule', Object.assign({}, pravidloFaze('Nové', 'Hotové', 'Dvakrat')[1], { name: 'Posun z Nové' })]
  ), text('Navrhla jsem fáze a jedno pravidlo.'));
  r = await chatuj({ message: 'fáze Nové a Hotové, když dám hotovo v Nové, ať to skočí do Hotové', context: { route: `/map/${mD.id}`, map_id: mD.id } });
  chat = r.json && r.json.chat;
  // with cards waiting the turn ends there — the refusal is stored in the conversation for the model's next turn
  const tD = chat ? chat.messages.filter((m) => m.role === 'tool').map((m) => String(m.content || '')).join('\n') : '';
  expect(!!chat && kartyTahu(chat, 'akce').filter((x) => x.name === 'create_rule').length === 1 && /already proposed on a card above/.test(tD), `one rule card, the twin is refused (${tD.slice(-200).replace(/\n/g, ' ')}; cards ${chat ? kartyTahu(chat, 'akce').map((x) => x.name).join(',') : r.status}; calls ${volani.length})`);

  fronta.length = 0; // an answer the app did not need (cheap ending) must not leak into the next part
  console.log('== a reader of a shared map does not learn about its rules ==');
  await inst.register('ctenar@example.com', { name: 'Čtenář' });
  const C = await inst.login('ctenar@example.com');
  const sd = await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'share', mapId: map.id, email: 'ctenar@example.com', permission: 'view' } });
  expect(sd.status === 200, `map shared read-only (${sd.status} ${JSON.stringify(sd.json).slice(0, 120)})`);
  fronta.push(volej(pravidloFaze('Potenciální', 'Programujeme web')), text('Tohle nemůžete měnit.'));
  r = await inst.api('POST', '/api/kb/chat', { token: C, body: { message: 'až dám hotovo v Potenciální, ať to skočí do Programujeme web', context: { route: `/map/${map.id}`, map_id: map.id } } });
  const tC = toolZ(volani[volani.length - 1]).join('\n');
  expect(/only "read" access|only an editor/.test(tC) && !/Hotovo v Potenciální|already exists|switched (on|off)/.test(tC), `the reader hears "read access only", not the rule's name or state (${tC.slice(0, 200).replace(/\n/g, ' ')})`);

  fronta.length = 0; // an answer the app did not need (cheap ending) must not leak into the next part
  console.log('== B: without "then" the cheap app ending stays ==');
  const m2 = await novaMapa('Weby2');
  fronta.push(volej(['add_nodes', { map_id: 'Weby2', parent_id: 'apex', items: [{ title: 'Archiv', icon: '🗄️' }] }]));
  r = await chatuj({ message: 'Přidej sloupec Archiv', context: { route: `/map/${m2.id}`, map_id: m2.id } });
  chat = r.json && r.json.chat;
  k = chat ? kartyTahu(chat, 'akce')[0] : null;
  if (k) {
    const pred = volani.length;
    r = await potvrd(chat.id, k.id);
    const konec = r.json && r.json.chat ? r.json.chat.messages.slice(-1)[0] : {};
    expect(volani.length === pred && konec.app === true, `no model call, the app answers (${volani.length - pred} calls; ${JSON.stringify(konec.content)})`);
  } else expect(false, 'add_nodes card for Archiv');
  // a one-off move of a finished step is not an ask for a rule (checkup 17. 11. 2026: "hotov… přesuň" used to keep
  // the model running after the confirmation, and it could offer a rule nobody asked for)
  fronta.push(volej(['move_node', { map_id: 'Weby2', node_id: 'Scanusscrew', parent_id: 'Archiv' }]));
  r = await chatuj({ message: 'Scanusscrew je hotový, přesuň ho pod Archiv', context: { route: `/map/${m2.id}`, map_id: m2.id } });
  chat = r.json && r.json.chat;
  k = chat ? kartyTahu(chat, 'akce')[0] : null;
  if (k) {
    const pred = volani.length;
    r = await potvrd(chat.id, k.id);
    expect(volani.length === pred, `one-off "done → move" ends cheaply, no model call (${volani.length - pred} calls)`);
  } else expect(false, 'move_node card for Scanusscrew');

  console.log('== B: a card with "then" — the model continues after the confirmation ==');
  expect(nabidnuto(volani[volani.length - 1], 'add_nodes') && /"then"/.test(JSON.stringify((volani[volani.length - 1].tools || []).find((t) => t.function.name === 'add_nodes'))), 'add_nodes offers the optional "then"');
  fronta.push(volej(['add_nodes', { map_id: 'Weby2', parent_id: 'apex', items: [{ title: 'Potenciální', icon: '🎯' }, { title: 'Jednání', icon: '🤝' }], then: 'přesunu klienty do Potenciální' }]));
  r = await chatuj({ message: 'Udělej sloupce Potenciální a Jednání a klienty dej do prvního', context: { route: `/map/${m2.id}`, map_id: m2.id } });
  chat = r.json && r.json.chat;
  k = chat ? kartyTahu(chat, 'akce')[0] : null;
  expect(!!k && k.dal === 'přesunu klienty do Potenciální', `the card carries the announced next step (${k && k.dal})`);
  const pend = chat ? (chat.pending || []) : [];
  expect(pend.length === 1 && !('then' in (pend[0].args || {})), '"then" is not part of the action arguments');
  if (k) {
    fronta.push(volej(...KLIENTI.map((kl) => ['move_node', { map_id: 'Weby2', node_id: kl, parent_id: 'Potenciální' }])));
    const pred = volani.length;
    r = await potvrd(chat.id, k.id);
    chat = r.json && r.json.chat;
    const posledni = volani[volani.length - 1];
    expect(volani.length === pred + 1, `after the confirmation the model is called again (${volani.length - pred} calls)`);
    expect(/Next step you announced: přesunu klienty/.test(toolZ(posledni).join('\n')), 'the model hears its announced step with the result');
    const dalsi = chat ? kartyTahu(chat, 'akce').filter((x) => x.stav === 'ceka') : [];
    const zadneHotovo = chat ? !chat.messages.some((m) => m.role === 'assistant' && m.app && /^Hotovo\.?$/.test(String(m.content || '').trim()) && chat.messages.indexOf(m) > chat.messages.findIndex((x) => (x.karty || []).some((y) => y.id === k.id))) : false;
    expect(dalsi.filter((x) => x.name === 'move_node').length === 3 && zadneHotovo, `the next cards (3 moves) follow, no app "Hotovo." (${dalsi.map((x) => x.name).join(',')})`);
  }

  console.log('== B2: the request wants it "by itself", no rule yet → the model continues even without "then" ==');
  const m3 = await novaMapa('Zakaznici');
  fronta.push(volej(['add_nodes', { map_id: 'Zakaznici', parent_id: 'apex', items: [{ title: 'Noví', icon: '🆕' }, { title: 'Jednáme', icon: '🤝' }] }],
    ...KLIENTI.map((kl) => ['move_node', { map_id: 'Zakaznici', node_id: kl, parent_id: 'Noví' }])));
  r = await chatuj({ message: 'Chci zákazníky podle toho, jak daleko jsme: noví a jednáme. Klienty dej mezi nové. A až u někoho dám hotovo, ať se sám posune o krok dál.', context: { route: `/map/${m3.id}`, map_id: m3.id } });
  chat = r.json && r.json.chat;
  let ids = chat ? (chat.pending || []).map((x) => x.id) : [];
  expect(ids.length === 4, `columns + 3 moves proposed (${ids.length})`);
  fronta.push(volej(pravidloFaze('Noví', 'Jednáme', 'Zakaznici')));
  let pred = volani.length;
  r = await potvrd(chat.id, ids);
  chat = r.json && r.json.chat;
  expect(volani.length === pred + 1 && !!chat && (chat.pending || []).some((x) => x.name === 'create_rule'), `after "Do all" the model continues and proposes the rule (${volani.length - pred} calls; ${chat ? (chat.pending || []).map((x) => x.name).join(',') : r.status})`);
  if (chat && (chat.pending || []).length) {
    pred = volani.length;
    fronta.push(text('Hotovo, posun funguje.'));
    r = await potvrd(chat.id, chat.pending.map((x) => x.id));
    fronta.push(volej(['add_nodes', { map_id: 'Zakaznici', parent_id: 'apex', items: [{ title: 'Archiv', icon: '🗄️' }] }]));
    chat = r.json && r.json.chat;
    expect((await pravidla(m3.id)).length === 1, 'the rule is stored');
    r = await chatuj({ chat_id: chat.id, message: 'Ještě přidej sloupec Archiv', context: { route: `/map/${m3.id}`, map_id: m3.id } });
    chat = r.json && r.json.chat;
    const kA = chat ? (chat.pending || [])[0] : null;
    if (kA) {
      pred = volani.length;
      r = await potvrd(chat.id, kA.id);
      expect(volani.length === pred, `a later plain request in the same chat ends cheaply again (${volani.length - pred} calls)`);
    } else expect(false, 'Archiv card');
  }

  console.log('== B2: the same through answers to the model\'s questions (as on tengo 16. 11.) ==');
  const m4 = await novaMapa('Faze');
  fronta.push(volej(['ask_user', { questions: [{ text: 'Kam dát stávající klienty?', options: ['Do první fáze', 'Nechat'] }] }]));
  r = await chatuj({ message: 'chtěl bych projekt na fáze Nový a Hotový, pomocí pravidel chci dát hotovo a skočí to na další', context: { route: `/map/${m4.id}`, map_id: m4.id } });
  chat = r.json && r.json.chat;
  fronta.push(volej(['add_nodes', { map_id: 'Faze', parent_id: 'apex', items: [{ title: 'Nový', icon: '🆕' }, { title: 'Hotový', icon: '✅' }] }]));
  r = await chatuj({ chat_id: chat && chat.id, message: '1) Do první fáze', context: { route: `/map/${m4.id}`, map_id: m4.id } });
  chat = r.json && r.json.chat;
  ids = chat ? (chat.pending || []).map((x) => x.id) : [];
  fronta.push(volej(pravidloFaze('Nový', 'Hotový', 'Faze')));
  pred = volani.length;
  if (ids.length) r = await potvrd(chat.id, ids);
  chat = r.json && r.json.chat;
  expect(ids.length === 1 && volani.length === pred + 1, `the answer carried no rule word, the request did → the model continues (${ids.length} cards, ${volani.length - pred} calls)`);
}, { nazev: 'ASISTENT KROKY' });
