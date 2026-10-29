// PROSÁKLÉ XML VOLÁNÍ NÁSTROJE (25. 10. 2026): lokální model z rodiny Qwen v ~1 z 5 tahů napsala volání napůl ve
// svém XML tvaru a serverový parser ho vložil do jednoho řetězce — goal: "…</goal>\n<parameter name=\"kind\">process"
// → karta „nový projekt“ místo procesu, v cíli technický text. llm.js opravXmlArgumenty řetězec utne a parametry
// za značkou doplní podle schématu nástroje. Sada: jednotkové případy (oba tvary značek, typy, enum, neznámý
// parametr, nic nepřepíše, HTML a běžný text nechá být) + tah asistenta proti podvrženému OpenAI rozhraní
// (karta bez technického textu, osnova doplněná z prosáklého parametru).
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/llm-xml-argumenty.js
const path = require('path');
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const mockHandler = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (!req.url.startsWith('/v1/chat/completions')) { res.statusCode = 404; res.end('{}'); return; }
  const o = fronta.shift() || { content: '(fronta prázdná)' };
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool) message.tool_calls = [{ id: 'call_' + Math.random().toString(36).slice(2, 10), type: 'function', function: { name: o.tool, arguments: o.args } }];
  res.end(JSON.stringify({ choices: [{ index: 0, message, finish_reason: o.tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
};

H.beh(async () => {
  console.log('== jednotkově: opravXmlArgumenty ==');
  const { opravXmlArgumenty: oprav } = require(path.join(__dirname, '..', 'server', 'pb_hooks', 'llm.js'));
  const sch = { properties: { title: { type: 'string' }, goal: { type: 'string' }, kind: { type: 'string', enum: ['project', 'process'] }, outline: { type: 'array' }, every: { type: 'integer' }, enabled: { type: 'boolean' }, content: { type: 'string' } } };
  const pripad = (args, popis, ocek, pocet) => {
    const n = oprav(args, sch);
    expect(JSON.stringify(args) === JSON.stringify(ocek) && n === pocet, `${popis} (${n}: ${JSON.stringify(args)})`);
  };
  pripad({ title: 'Úklid', goal: 'Dílna je vždy čistá</goal>\n<parameter name="kind">process' }, 'nalezený tvar 25. 10.: cíl utnut, kind doplněn', { title: 'Úklid', goal: 'Dílna je vždy čistá', kind: 'process' }, 1);
  pripad({ title: 'Úklid', goal: 'Cíl\n<parameter=kind>\nprocess\n</parameter>\n<parameter=outline>\n[{"title":"A"}]\n</parameter>\n</function>' }, 'tvar Qwen <parameter=…>: kind i osnova (JSON pole)', { title: 'Úklid', goal: 'Cíl', kind: 'process', outline: [{ title: 'A' }] }, 1);
  pripad({ title: 'X', goal: 'g</goal><parameter name="kind">nesmysl</parameter><parameter name="every">3</parameter><parameter name="enabled">true</parameter><parameter name="neznamy">x</parameter>' }, 'typy ze schématu; hodnota mimo enum a neznámý parametr zahozeny', { title: 'X', goal: 'g', every: 3, enabled: true }, 1);
  pripad({ title: 'X', kind: 'project', goal: 'g<parameter name="kind">process</parameter>' }, 'vyplněný parametr se nepřepisuje', { title: 'X', kind: 'project', goal: 'g' }, 1);
  pripad({ title: 'X', goal: 'g</goal><parameter name="every">tři</parameter>' }, 'nečíslo do integer se nedoplní', { title: 'X', goal: 'g' }, 1);
  pripad({ content: '<div><p>Ahoj</p></div>' }, 'HTML obsah beze změny (</div> na konci není značka volání)', { content: '<div><p>Ahoj</p></div>' }, 0);
  pripad({ goal: 'text</goal>' }, 'osiřelá koncová značka téhož pole uklizena', { goal: 'text' }, 1);
  pripad({ goal: 'Napiš <parameter> v textu' }, 'značka bez jména = běžný text, beze změny', { goal: 'Napiš <parameter> v textu' }, 0);
  pripad({ goal: 'g', outline: [{ title: 'a</title>' }] }, 'vnořené hodnoty se nemění', { goal: 'g', outline: [{ title: 'a</title>' }] }, 0);
  // klíč od modelu do regexu: „c++“ / „a(“ nesmí shodit tah, „.*“ nesmí uříznout obsah (/checkup 29. 10.)
  let chyba = '';
  const divne = { 'c++': 'x', 'title(': 'a</title(>', '.*': 'obsah</div>', goal: 'g</goal>' };
  try { oprav(divne, sch); } catch (err) { chyba = err.message; }
  expect(!chyba && divne['c++'] === 'x' && divne['title('] === 'a</title(>' && divne['.*'] === 'obsah</div>' && divne.goal === 'g', `divné klíče: bez výjimky, obsah nechán (${chyba || JSON.stringify(divne)})`);
  const bez = { goal: 'g</goal><parameter name="kind">process' };
  expect(oprav(bez, null) === 1 && JSON.stringify(bez) === '{"goal":"g"}', 'bez schématu: jen utnout, nic nedomýšlet');

  console.log('== tah asistenta: prosáklá osnova v create_project ==');
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'llm-xml', addHostGateway: true, env: { KB_CHAT_PROVIDER: 'openai', KB_CHAT_URL: mock.base + '/v1', KB_CHAT_MODEL: 'qwen-mock', KB_CHAT_TOKEN: 't', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_AI_MAX_PER_HOUR: 600 } });
  await inst.register('a@example.com', { name: 'Petr' });
  const A = await inst.login('a@example.com');
  fronta.push({ tool: 'create_project', args: JSON.stringify({ title: 'Úklid dílny', icon: '🧹', goal: 'Dílna je vždy čistá</goal>\n<parameter name="outline">[{"title":"Zamést piliny","icon":"🧹"},{"title":"Vynést koše","icon":"🗑️"}]</parameter>' }) });
  let r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Založ projekt Úklid dílny', context: { route: '/' } } });
  const chat = r.json && r.json.chat;
  const karty = chat ? chat.messages.flatMap((m) => m.karty || []) : [];
  const k = karty.find((x) => x.type === 'akce' && x.name === 'create_project');
  expect(!!k, `karta create_project (${r.status} ${JSON.stringify(karty).slice(0, 160)})`);
  expect(!!k && !/<parameter|<\/goal>/.test(JSON.stringify(k)), `karta bez technického textu (${k && k.popis})`);
  expect(!!k && /cíl: Dílna je vždy čistá s 2 prvními kroky/.test(k.popis) && (k.strom || []).map((x) => x.t).join() === 'Zamést piliny,Vynést koše', `cíl utnutý, osnova doplněná z prosáklého parametru (${k && k.popis})`);
  fronta.push({ content: 'Hotovo.' });
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: k.id, ok: true } });
  const mapy = (await inst.api('GET', '/api/collections/goalmaps/records?perPage=10', { token: A })).json.items || [];
  const m = mapy.find((x) => x.title === 'Úklid dílny');
  const vrchol = m && m.nodes.find((n) => n.type === 'apexNode');
  expect(!!m && (vrchol.data.apexText || vrchol.data.title) === 'Dílna je vždy čistá' && m.nodes.filter((n) => n.type === 'goalNode').length === 2, `mapa: vrchol bez značek, 2 kroky (${vrchol && (vrchol.data.apexText || vrchol.data.title)})`);
  await mock.close();
});
