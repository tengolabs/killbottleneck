// Code analysis 4, wave 4 (review) — the assistant and the sub-step checklists of rules (S2-03):
// the tool schema offers "me" / "none" as the assignee of a sub-step also in create_rule, update_rule
// and save_rule_template; "me" must become the user's e-mail BEFORE the confirmation card and the
// save, "none" an empty assignee; an unknown assignee is told to the model before any card.
// Against a FAKE ollama (a queue of answers as in proces-asistent.js) — no real model.
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-asistent-pravidla.js
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  volani.push(JSON.parse(body));
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
};
const toolZ = (v) => v.messages.filter((m) => m.role === 'tool');
const posledniKarta = (chat, typ) => { const i = chat.messages.map((m) => m.role).lastIndexOf('user'); return chat.messages.slice(i + 1).flatMap((m) => m.karty || []).reverse().find((k) => k.type === typ); };
const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const ENV = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_AI_MAX_PER_HOUR: 600, KB_AI_KVOTA_TYDEN: 500 };
  const inst = await H.startInstance({ slug: 'chyby4-asistent-pravidla', addHostGateway: true, env: ENV });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const chatuj = async (body) => inst.api('POST', '/api/kb/chat', { token: A, body });
  const potvrd = async (chat_id, id) => inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id, action_id: id, ok: true } });
  const pravidla = async (mid) => (await inst.api('GET', `/api/kb/rules?map=${mid}`, { token: A })).json.rules || [];
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Reklamace',
    nodes: [node('root', { apexText: 'Reklamace', title: 'Reklamace', status: 'todo' }, 'apexNode'), node('a', { title: 'Krok A', status: 'todo' })],
    edges: [{ id: 'e1', source: 'root', target: 'a' }] } })).json;
  expect(!!map.id, 'projekt Reklamace založen');
  const AKCE = (items) => [{ type: 'create_subnodes', parent: 'trigger_node', items }];
  const TRIG = { type: 'node_status_changed', status: 'done' };

  console.log('== create_rule: „me“ → e-mail uživatele, „none“ → bez řešitele ==');
  fronta.push(nastroj('create_rule', { map_id: 'Reklamace', node_id: 'Krok A', name: 'Po A založ kroky', trigger: TRIG,
    actions: AKCE([{ title: 'Pro mě', owner: 'me', children: [{ title: 'Vnořený pro mě', owner: 'me' }] }, { title: 'Pro nikoho', owner: 'none' }, { title: 'Pro Janu', owner: 'clen@example.com' }]) }));
  let r = await chatuj({ message: 'Vytvoř pravidlo: až bude Krok A hotový, založ podkroky pro mě a pro Janu', context: { route: `/map/${map.id}`, map_id: map.id } });
  let chat = r.json && r.json.chat; let k = chat ? posledniKarta(chat, 'akce') : null;
  expect(r.status === 200 && !!k, `asistent ukázal kartu k potvrzení (${r.status}; ${chat ? JSON.stringify(toolZ(volani[volani.length - 1]).map((m) => m.content)).slice(0, 200) : 'bez chatu'})`);
  expect((await pravidla(map.id)).length === 0, 'před potvrzením žádné pravidlo');
  if (k) {
    fronta.push(text('Hotovo.'));
    r = await potvrd(chat.id, k.id);
    const pr = await pravidla(map.id);
    const items = ((pr[0] || {}).actions || [{}])[0].items || [];
    expect(r.status === 200 && pr.length === 1, `po potvrzení je pravidlo uložené (${r.status}, pravidel ${pr.length}; ${JSON.stringify((r.json && r.json.chat ? r.json.chat.messages.slice(-1)[0] : r.json) || {}).slice(0, 200)})`);
    expect(items.length === 3 && items[0].owner === 'admin@example.com' && ((items[0].children || [])[0] || {}).owner === 'admin@example.com', `„me“ (i vnořené) = e-mail uživatele (${JSON.stringify(items.map((x) => x.owner))})`);
    expect(items.length === 3 && !items[1].owner, `„none“ = bez řešitele (${JSON.stringify((items[1] || {}).owner)})`);
    expect(items.length === 3 && items[2].owner === 'clen@example.com', 'e-mail člena beze změny');
    // the rule runs: the sub-steps get real people, no node for the string "me"
    const f = (await inst.api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    const p = await inst.api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: { base_updated: f.updated, edges: f.edges, nodes: f.nodes.map((n) => (n.id === 'a' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)) } });
    await H.sleep(800);
    const po = (await inst.api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).json;
    const vl = (t) => ((po.nodes.find((n) => n.data.title === t) || { data: {} }).data.owner);
    expect(p.status === 200 && vl('Pro mě') === 'admin@example.com' && !vl('Pro nikoho') && vl('Pro Janu') === 'clen@example.com', `běh pravidla: podkroky mají skutečné řešitele (${JSON.stringify([vl('Pro mě'), vl('Pro nikoho'), vl('Pro Janu')])})`);
  }

  console.log('== update_rule a šablona pravidla: totéž ==');
  fronta.push(nastroj('update_rule', { map_id: 'Reklamace', rule_id: 'Po A založ kroky', node_id: 'Krok A', name: 'Po A založ kroky', trigger: TRIG, actions: AKCE([{ title: 'Jen pro mě', owner: 'me' }, { title: 'Nikdo', owner: 'none' }]) }));
  r = await chatuj({ message: 'Uprav pravidlo Po A založ kroky: jen jeden podkrok pro mě', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat; k = chat ? posledniKarta(chat, 'akce') : null;
  expect(!!k, `update_rule: karta k potvrzení (${chat ? JSON.stringify(toolZ(volani[volani.length - 1]).map((m) => m.content)).slice(0, 200) : 'bez chatu'})`);
  if (k) {
    fronta.push(text('Hotovo.'));
    await potvrd(chat.id, k.id);
    const items = (((await pravidla(map.id))[0] || {}).actions || [{}])[0].items || [];
    expect(items.length === 2 && items[0].owner === 'admin@example.com' && !items[1].owner, `update_rule: „me“ = e-mail, „none“ = prázdno (${JSON.stringify(items.map((x) => x.owner))})`);
  }
  fronta.push(nastroj('save_rule_template', { name: 'Kroky po dokončení', trigger: TRIG, actions: AKCE([{ title: 'Pro mě', owner: 'me' }, { title: 'Nikdo', owner: 'none' }]) }));
  r = await chatuj({ message: 'Ulož to pravidlo jako šablonu pravidla Kroky po dokončení', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat; k = chat ? posledniKarta(chat, 'akce') : null;
  expect(!!k, `save_rule_template: karta k potvrzení (${chat ? JSON.stringify(toolZ(volani[volani.length - 1]).map((m) => m.content)).slice(0, 200) : 'bez chatu'})`);
  if (k) {
    fronta.push(text('Hotovo.'));
    await potvrd(chat.id, k.id);
    const tpl = ((await inst.api('GET', '/api/kb/rule-templates', { token: A })).json || {}).templates || [];
    const items = (((tpl.find((x) => x.name === 'Kroky po dokončení') || {}).actions) || [{}])[0].items || [];
    expect(items.length === 2 && items[0].owner === 'admin@example.com' && !items[1].owner, `šablona pravidla: „me“ = e-mail, „none“ = prázdno (${JSON.stringify(items.map((x) => x.owner))})`);
  }

  console.log('== neznámý řešitel: chyba modelu PŘED kartou ==');
  const pred = (await pravidla(map.id)).length;
  fronta.push(nastroj('create_rule', { map_id: 'Reklamace', node_id: 'Krok A', name: 'S duchem', trigger: TRIG, actions: AKCE([{ title: 'Pro ducha', owner: 'duch@nikde.example' }]) }), text('Koho tím myslíte?'));
  r = await chatuj({ message: 'Vytvoř pravidlo s podkrokem pro ducha', context: { route: `/map/${map.id}`, map_id: map.id } });
  chat = r.json && r.json.chat;
  const tm = toolZ(volani[volani.length - 1]).map((m) => m.content).join('\n');
  expect(!!chat && !posledniKarta(chat, 'akce') && /duch@nikde\.example/.test(tm) && /^Error/m.test(tm), `žádná karta; model dostal chybu s adresou (${tm.slice(0, 160).replace(/\n/g, ' ')})`);
  expect((await pravidla(map.id)).length === pred, 'pravidlo nevzniklo');
}, { nazev: 'CHYBY4 ASISTENT PRAVIDLA' });
