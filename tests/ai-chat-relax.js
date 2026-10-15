// Relax (14. 10. 2026) — API sada nástroje start_relax proti PODVRŽENÉ ollamě: skupina `relax` se otevře slovy o
// únavě (model start_relax dostane), neutrální tah ho nedostane; prompt vede přes ask_user; nástroj vrátí kartu
// `relax` s minutami (strop 60) a scénou; nic se neukládá.
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: 20, done: true }));
};
const jmena = (v) => ((v && v.tools) || []).map((t) => t.function && t.function.name);
const system = (v) => (v.messages.find((m) => m.role === 'system') || {}).content || '';
const posledniA = (chat) => chat.messages.slice().reverse().find((m) => m.role === 'assistant');

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'ai-chat-relax', addHostGateway: true, env: { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0 } });
  await inst.register('admin@example.com', { name: 'Petr Novák' });
  const A = await inst.login('admin@example.com');

  console.log('== neutrální tah: skupina relax zavřená, start_relax model nedostane ==');
  fronta.push(text('Dnes nic.'));
  let r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  expect(r.status === 200, `chat odpověděl (${r.status})`);
  expect(!jmena(volani[0]).includes('start_relax'), 'bez slov o únavě start_relax v nabídce není');
  expect(!/Relax \(pauza/.test(system(volani[0])), 'ani řádek promptu o relaxu');

  console.log('== únava otevře skupinu: prompt + nástroj; model se ptá ask_user ==');
  fronta.push(nastroj('ask_user', { questions: [{ text: 'Dáme si pauzu?', options: ['5 minut', '15 minut', 'Teď ne'] }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Jsem úplně vyčerpaný, už nemůžu dál.', context: { route: '/' } } });
  expect(r.status === 200, `chat odpověděl (${r.status})`);
  const v1 = volani[volani.length - 1];
  expect(jmena(v1).includes('start_relax'), '„vyčerpaný“ → model dostal start_relax');
  expect(/Relax \(pauza s akváriem/.test(system(v1)) && /NIKDY ho nespouštěj bez souhlasu/.test(system(v1)) && /Bez odpočtu/.test(system(v1)), 'prompt: nabídnout přes ask_user (5 / 15 / bez odpočtu), nikdy bez souhlasu');
  let chat = r.json.chat;
  expect(posledniA(chat).karty.some((k) => k.type === 'otazky'), 'odpověď nese otázku s volbami 5 / 15 / Teď ne');

  console.log('== volba → start_relax → karta relax, nic se neukládá ==');
  fronta.push(nastroj('start_relax', { minutes: 15 }), text('Dobrou pauzu.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '1) 15 minut', context: { route: '/' } } });
  expect(r.status === 200, `chat odpověděl (${r.status})`);
  chat = r.json.chat;
  const karta = chat.messages.flatMap((m) => m.karty || []).find((k) => k.type === 'relax');
  expect(!!karta && karta.minutes === 15 && karta.scene === '', `karta relax {minutes:15, scene:''} (${JSON.stringify(karta)})`);
  const vysledek = chat.messages.find((m) => m.role === 'tool' && /Relax break started for 15 minutes/.test(m.content || ''));
  expect(!!vysledek, 'výsledek nástroje modelu: „Relax break started for 15 minutes“');
  expect(posledniA(chat).content === 'Dobrou pauzu.', 'model dopověděl textem');
  expect(!chat.pending || chat.pending.length === 0, 'žádná karta k potvrzení (direct nástroj)');

  console.log('== meze: minuty stropem 60, scéna jen aquarium|beehive ==');
  fronta.push(nastroj('start_relax', { minutes: 500, scene: 'beehive' }), text('Ok.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'ještě jednou, úl', context: { route: '/' } } });
  let k = posledniA(r.json.chat) && r.json.chat.messages.flatMap((m) => m.karty || []).filter((x) => x.type === 'relax').pop();
  expect(k && k.minutes === 60 && k.scene === 'beehive', `500 minut → 60, scene beehive (${JSON.stringify(k)})`);
  // argumenty mimo schéma (minutes "x", scene "sauna") odmítne validace vstupu ještě před nástrojem → žádná nová
  // karta, model dostane chybu a dopoví; platné malé číslo bez scény projde
  const karetPred = r.json.chat.messages.flatMap((m) => m.karty || []).filter((x) => x.type === 'relax').length;
  fronta.push(nastroj('start_relax', { minutes: 'x', scene: 'sauna' }), text('Ok.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'a znovu', context: { route: '/' } } });
  const karetPo = r.json.chat.messages.flatMap((m) => m.karty || []).filter((x) => x.type === 'relax').length;
  expect(r.status === 200 && karetPo === karetPred, `argumenty mimo schéma → bez nové karty (${karetPred} → ${karetPo})`);
  fronta.push(nastroj('start_relax', { minutes: 2 }), text('Ok.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'tak dvě minuty', context: { route: '/' } } });
  k = r.json.chat.messages.flatMap((m) => m.karty || []).filter((x) => x.type === 'relax').pop();
  expect(k && k.minutes === 2 && k.scene === '', `2 minuty bez scény → {minutes:2, scene:''} (${JSON.stringify(k)})`);
  fronta.push(nastroj('start_relax', { minutes: 5, scene: 'ants' }), text('Ok.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'mravence', context: { route: '/' } } });
  k = r.json.chat.messages.flatMap((m) => m.karty || []).filter((x) => x.type === 'relax').pop();
  expect(k && k.scene === 'ants', `scéna ants (mraveniště) projde (${JSON.stringify(k)})`);
  fronta.push(nastroj('start_relax', {}), text('Ok.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'bez odpočtu', context: { route: '/' } } });
  k = r.json.chat.messages.flatMap((m) => m.karty || []).filter((x) => x.type === 'relax').pop();
  expect(k && k.minutes === 0 && r.json.chat.messages.some((m) => m.role === 'tool' && /no countdown/.test(m.content || '')), `bez minut → {minutes:0} = bez odpočtu, model to ví (${JSON.stringify(k)})`);

  console.log('== falešné zásahy klíčů (/checkup): „break down“, „the rest of“, „vcelku“ skupinu NEotevřou ==');
  for (const m of ['Break down the project into steps', 'Show me the rest of the tasks', 'Vcelku dobré, co dál?']) {
    fronta.push(text('Ok.'));
    r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: m, context: { route: '/' } } });
    expect(r.status === 200 && !jmena(volani[volani.length - 1]).includes('start_relax'), `„${m}“ → bez start_relax`);
  }
  fronta.push(nastroj('ask_user', { questions: [{ text: 'Dáme si pauzu?', options: ['5 minut', 'Teď ne'] }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'I need a break, too much work on my plate', context: { route: '/' } } });
  expect(jmena(volani[volani.length - 1]).includes('start_relax'), '„need a break / too much work“ skupinu otevře');

  console.log('== přímá žádost o pauzu („pusť relax“) otevře skupinu i bez únavy ==');
  fronta.push(nastroj('start_relax', { minutes: 5 }), text('Jdeme na to.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Pusť mi relax na pět minut', context: { route: '/' } } });
  expect(jmena(volani[volani.length - 2]).includes('start_relax'), '„relax“ v textu otevřel skupinu');
  expect(r.json.chat.messages.flatMap((m) => m.karty || []).some((x) => x.type === 'relax' && x.minutes === 5), 'karta relax 5 min');
}, { nazev: 'AI-CHAT-RELAX' });
