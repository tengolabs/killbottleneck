// Asistent proti PŘÍSNÉMU mocku OpenAI (30. 9. 2026, fáze A plánu AI funkcí).
//
// Proč vlastní sada: ai-chat.js jede proti mocku, který spolkne cokoli — stejně jako ollama,
// llama-server nebo běžná brána. api.openai.com je přísnější a asistent proti němu nikdy neběžel:
//   · za zprávou s tool_calls musí přijít výsledek KAŽDÉHO volání dřív než cokoli jiného,
//     osiřelý výsledek nástroje je chyba (jinak HTTP 400 a rozhovor stojí),
//   · prázdné pole `tools` je chyba, `tool_choice` bez `tools` taky,
//   · uvažující modely (gpt-5*, Luna) odmítají max_tokens a teplotu ≠ 1 a přemýšlení jim ukrojí strop,
//   · neznámé pole v těle (think, options, num_predict…) je chyba.
// Mock tohle všechno vynucuje stejnými hláškami jako OpenAI; instance se nastaví tak, jak to dělá
// self-host uživatel: Administrace → AI → OpenAI (POST /api/kb/ai-settings), žádné KB_CHAT_*.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-chat-openai-strict.js
const H = require('./_harness');
const { expect } = H;

const fronta = [];      // odpovědi „modelu“ v pořadí: { content, tool_calls:[{name,args}], refusal }
const volani = [];      // přijatá těla /v1/chat/completions (i odmítnutá)
const odmitnuto = [];   // texty 400, které mock vrátil
let cisloVolani = 0;
let slepy = false;      // model „nevidí“ obrázky (odpoví, že tam nic není) — obrázky se pak nesmí zapnout
const volaniVize = [];  // požadavky s obrázkem (přepis)

const POVOLENE = new Set(['model', 'messages', 'stream', 'temperature', 'top_p', 'max_tokens', 'max_completion_tokens', 'tools', 'tool_choice',
  'parallel_tool_calls', 'response_format', 'reasoning_effort', 'stop', 'seed', 'n', 'user', 'metadata', 'store', 'frequency_penalty',
  'presence_penalty', 'logit_bias', 'logprobs', 'top_logprobs', 'service_tier']);
const uvazujici = (m) => /gpt-5|luna/i.test(String(m || ''));
// gpt-5.6-luna = pravděpodobné id Luny; luna-mock = uvažující model, jehož jméno to neprozradí; gpt-5-prisny effort nezná
const EFFORT = { 'gpt-5-mini': ['minimal', 'low', 'medium', 'high'], 'gpt-5.6-luna': ['none', 'low', 'medium', 'high'], 'luna-mock': ['none', 'low', 'medium', 'high'] };
const PREMYSLENI = { none: 0, minimal: 50, low: 400, medium: 1800, high: 5000 };
const CEKAJICI = (ids) => `An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. The following tool_call_ids did not have response messages: ${ids.join(', ')}`;

function over(b) {
  for (const k of Object.keys(b)) if (!POVOLENE.has(k)) return `Unrecognized request argument supplied: ${k}`;
  if ('tools' in b && (!Array.isArray(b.tools) || b.tools.length === 0)) return "Invalid 'tools': empty array. Expected an array with minimum length 1, but got an empty array instead.";
  if ('tool_choice' in b && !('tools' in b)) return "Invalid value for 'tool_choice': 'tool_choice' is only allowed when 'tools' are specified.";
  if (uvazujici(b.model)) {
    if ('max_tokens' in b) return "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.";
    if ('temperature' in b && b.temperature !== 1) return `Unsupported value: 'temperature' does not support ${b.temperature} with this model. Only the default (1) value is supported.`;
    if ('reasoning_effort' in b && !(EFFORT[b.model] || []).includes(b.reasoning_effort)) return `Unsupported value: 'reasoning_effort' does not support '${b.reasoning_effort}' with this model.`;
  } else if ('reasoning_effort' in b) return 'Unrecognized request argument supplied: reasoning_effort';
  let cekaji = [];
  for (const m of b.messages || []) {
    if (m.role === 'tool') {
      if (!cekaji.includes(m.tool_call_id)) return "Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.";
      cekaji = cekaji.filter((x) => x !== m.tool_call_id);
      continue;
    }
    if (cekaji.length) return CEKAJICI(cekaji);
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      if (m.tool_calls.some((c) => typeof (c.function || {}).arguments !== 'string')) return "Invalid type for 'messages.tool_calls.function.arguments': expected a string.";
      cekaji = m.tool_calls.map((c) => c.id);
    }
  }
  if (cekaji.length) return CEKAJICI(cekaji);
  return null;
}

const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.end(JSON.stringify({ object: 'list', data: ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5.6-luna', 'luna-mock', 'qwen-mock', 'gpt-oss-20b'].map((id) => ({ id, object: 'model' })) }));
    return;
  }
  if (!req.url.startsWith('/v1/chat/completions')) { res.statusCode = 404; res.end('{"error":{"message":"not found"}}'); return; }
  let b;
  try { b = JSON.parse(body); } catch { res.statusCode = 400; res.end('{"error":{"message":"We could not parse the JSON body of your request."}}'); return; }
  volani.push(b);
  const chyba = over(b);
  if (chyba) { odmitnuto.push(chyba); res.statusCode = 400; res.end(JSON.stringify({ error: { message: chyba, type: 'invalid_request_error' } })); return; }
  // požadavek s obrázkem = přepis (vision): nečerpá frontu chatu
  const obrazky = (b.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c && c.type === 'image_url');
  if (obrazky.length) {
    volaniVize.push(b);
    const text = slepy ? 'Na obrázku nevidím žádný text.' : 'KB 4729';
    res.end(JSON.stringify({ id: 'chatcmpl-vize', object: 'chat.completion', model: b.model, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 6 } }));
    return;
  }
  let premysleni = 0;
  if (uvazujici(b.model)) {
    premysleni = PREMYSLENI[b.reasoning_effort || 'medium'];
    const strop = b.max_completion_tokens || 100000;
    if (premysleni + 60 > strop) {
      res.end(JSON.stringify({ id: 'chatcmpl-strop', object: 'chat.completion', model: b.model, choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1000, completion_tokens: strop, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: strop } } }));
      return;
    }
  }
  const o = fronta.shift() || { content: '(fronta prázdná)' };
  const message = { role: 'assistant', content: o.content === undefined ? null : o.content, refusal: o.refusal || null };
  if (o.tool_calls) message.tool_calls = o.tool_calls.map((c) => ({ id: `call_${(++cisloVolani).toString(36)}x${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
  res.end(JSON.stringify({ id: 'chatcmpl-ok', object: 'chat.completion', model: b.model, choices: [{ index: 0, message, finish_reason: o.tool_calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 1200, completion_tokens: 80 + premysleni, total_tokens: 1280 + premysleni, prompt_tokens_details: { cached_tokens: 1024 }, completion_tokens_details: { reasoning_tokens: premysleni } } }));
};

const volani_ = (name, args) => ({ name, args });
const posledni = () => volani[volani.length - 1];
const systemZ = (v) => ((v && v.messages) || []).find((m) => m.role === 'system')?.content || '';

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'chat-openai-strict', addHostGateway: true, env: { KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600 } });
  await inst.register('admin@example.com', { name: 'Petr' });
  const A = await inst.login('admin@example.com');
  const nastav = async (model) => {
    const r = await inst.api('POST', '/api/kb/ai-settings', { token: A, body: { provider: 'openai', url: mock.base + '/v1', model, token: 'sk-test-mock-klic' } });
    if (r.status !== 200) throw new Error(`ai-settings ${model}: ${r.status} ${JSON.stringify(r.json)}`);
  };
  await nastav('gpt-4o-mini');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň Dvořákovi', title: 'Kuchyň Dvořákovi', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Poslat poptávku', status: 'todo' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'n1' }] } })).json;
  expect(!!map.id, 'mapa založena');

  console.log('== nastavení z Administrace (cesta self-hostu) ==');
  const cfg = (await inst.api('GET', '/api/kb/config')).json;
  expect((cfg.ai_modes || []).includes('chat_panel'), 'OpenAI z Administrace → /config hlásí chat_panel');
  expect(!(cfg.ai_modes || []).includes('chat_image'), 'bez modelu na obrázky /config NEhlásí chat_image (T11)');

  // T0: ranní porada, jak ji dělá GPT — otázka + čipy v JEDNÉ odpovědi. Úvod porady (výzva k podkladům)
  // skládá od 1. 10. 2026 aplikace sama, model přijde na řadu až s první odpovědí uživatele.
  console.log('== T0/T1: porada — ask_user + suggest_next v jedné odpovědi, pak odpověď uživatele ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  const predUvod = volani.length;
  let r = await inst.api('POST', '/api/kb/chat', { token: A, body: { mode: 'porada', message: '', context: { route: '/' } } });
  const posledniA = (c) => c.messages.filter((m) => m.role === 'assistant').at(-1) || {};
  const uvodP = posledniA(r.json.chat);
  const volbyUvodu = (((uvodP.karty || []).find((k) => k.type === 'otazky') || {}).questions || [{}])[0].options || [];
  expect(r.status === 200 && uvodP.uvod === true && volani.length === predUvod, `porada: úvod s kartou otázky složí aplikace bez modelu (${r.status}, volání ${volani.length - predUvod})`);
  expect(volbyUvodu[0] === 'Napíšu nápady' && !/fotku poznámek/.test(uvodP.content || ''), `porada bez obrázků nenabízí fotku (T11: ${JSON.stringify(volbyUvodu)})`);
  let chat = r.json.chat;
  fronta.push({ content: 'Co dnes jako první?', tool_calls: [volani_('ask_user', { questions: [{ text: 'Čím začnete?', options: ['Poptávkou', 'Fakturami'] }] }), volani_('suggest_next', { suggestions: ['Ukaž můj den'] })] });
  const pred0 = odmitnuto.length;
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '2) Nic nemám, pokračuj' } });
  expect(r.status === 200 && (posledniA(r.json.chat).karty || []).some((k) => k.type === 'otazky') && odmitnuto.length === pred0, `porada: odpověď na úvod jde modelu, ten vrátí kartu otázky (${r.status}; ${odmitnuto.slice(pred0).join(' | ').slice(0, 160)})`);
  expect((posledni().messages || []).some((m) => m.role === 'tool' && /Odpovědi uživatele: 2\) Nic nemám, pokračuj/.test(m.content)), 'T0: odpověď na úvod jde modelu jako výsledek ask_user');
  chat = r.json.chat;
  const pred1 = odmitnuto.length;
  fronta.push(volani_('get_my_day', {}), { content: 'Dnes začněte poptávkou.', tool_calls: [volani_('suggest_next', { suggestions: ['Napiš poptávku'] })] });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '1) Poptávkou' } });
  expect(r.status === 200 && /poptávkou/.test(r.json.chat.messages.filter((m) => m.role === 'assistant').at(-1).content || ''), `T1: odpověď na otázku z odpovědi s čipy projde (${r.status} ${JSON.stringify(r.json).slice(0, 160)})`);
  expect(odmitnuto.length === pred1, `T1: OpenAI nic neodmítl (${odmitnuto.slice(pred1).join(' | ').slice(0, 200)})`);
  const vT1 = volani[volani.length - 2];
  const tAsk = (vT1.messages || []).filter((m) => m.role === 'tool');
  expect(tAsk.some((m) => /Odpovědi uživatele: 1\) Poptávkou/.test(m.content)), 'T1: odpověď jde modelu jako výsledek ask_user');
  chat = r.json.chat;

  console.log('== T2: karta + čipy, uživatel místo potvrzení napíše něco jiného ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  fronta.push({ tool_calls: [volani_('add_nodes', { map_id: 'Truhlářství', parent_id: 'Poslat poptávku', items: [{ title: 'Zavolat dodavateli' }] }), volani_('suggest_next', { suggestions: ['Ukaž mapu'] })] });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Přidej krok zavolat dodavateli' } });
  expect(r.status === 200 && r.json.chat.pending.length === 1, `T2: karta čeká (${r.status})`);
  const pred2 = odmitnuto.length;
  fronta.push({ content: 'Dobře, nic nepřidávám.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Ne, radši jinak' } });
  expect(r.status === 200 && odmitnuto.length === pred2, `T2: napsaná zpráva místo potvrzení projde (${r.status}; ${odmitnuto.slice(pred2).join(' | ').slice(0, 160)})`);
  expect((posledni().messages || []).some((m) => m.role === 'tool' && /zamítl/.test(m.content)), 'T2: nepotvrzená karta jde modelu jako zamítnutá');
  chat = r.json.chat;

  console.log('== T3: stráž řešitele (chyba) + ask_user v jedné odpovědi ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  fronta.push({ tool_calls: [volani_('create_project', { title: 'Veletrh', goal: 'Vystavit', outline: [{ title: 'Objednat stánek', deadline: '2027-03-01' }] }), volani_('ask_user', { questions: [{ text: 'Kdy veletrh je?', options: ['V březnu', 'Nevím'] }] })] });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Založ projekt Veletrh' } });
  expect(r.status === 200 && r.json.chat.messages.some((m) => m.role === 'tool' && /has not been asked who handles/.test(m.content || '')), `T3: stráž řešitele vrátila modelu chybu (${r.status})`);
  const pred3 = odmitnuto.length;
  fronta.push({ content: 'Zeptám se na řešitele.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: '1) V březnu' } });
  expect(r.status === 200 && odmitnuto.length === pred3, `T3: odpověď po chybě stráže projde (${r.status}; ${odmitnuto.slice(pred3).join(' | ').slice(0, 160)})`);
  chat = r.json.chat;

  console.log('== T4: dvě karty, potvrdí jednu a pak napíše ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  fronta.push({ tool_calls: [volani_('add_nodes', { map_id: 'Truhlářství', parent_id: 'Poslat poptávku', items: [{ title: 'Krok A' }] }), volani_('add_nodes', { map_id: 'Truhlářství', parent_id: 'Poslat poptávku', items: [{ title: 'Krok B' }] })] });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Přidej kroky A a B' } });
  const karty4 = (r.json.chat.messages.at(-1).karty || []).filter((k) => k.type === 'akce');
  expect(karty4.length === 2, `T4: dvě karty (${karty4.length})`);
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: karty4[0].id, ok: true } });
  expect(r.status === 200 && r.json.chat.pending.length === 1, `T4: první potvrzena, druhá čeká (${r.status})`);
  const pred4 = odmitnuto.length;
  fronta.push({ content: 'Krok B nechávám.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'B nechci' } });
  expect(r.status === 200 && odmitnuto.length === pred4, `T4: zpráva po jedné ze dvou karet projde (${r.status}; ${odmitnuto.slice(pred4).join(' | ').slice(0, 160)})`);
  chat = r.json.chat;

  console.log('== T5: karta + otázka v jedné odpovědi, potvrzení karty → model pokračuje ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  fronta.push({ tool_calls: [volani_('add_nodes', { map_id: 'Truhlářství', parent_id: 'Poslat poptávku', items: [{ title: 'Krok C' }] }), volani_('ask_user', { questions: [{ text: 'Termín?', options: ['Zítra', 'Příští týden'] }] })] });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Přidej krok C a zeptej se na termín' } });
  const karta5 = (r.json.chat.messages.at(-1).karty || []).find((k) => k.type === 'akce');
  const pred5 = odmitnuto.length;
  fronta.push({ content: 'Krok C je v mapě.' });
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: karta5 && karta5.id, ok: true } });
  expect(r.status === 200 && odmitnuto.length === pred5 && /Krok C je v mapě/.test(r.json.chat.messages.at(-1).content || ''), `T5: potvrzení karty s visící otázkou projde (${r.status}; ${odmitnuto.slice(pred5).join(' | ').slice(0, 160)})`);
  expect((posledni().messages || []).some((m) => m.role === 'tool' && /zatím neodpověděl/.test(m.content)), 'T5: visící otázka má výsledek „zatím neodpověděl“');
  chat = r.json.chat;
  const pred5b = odmitnuto.length;
  fronta.push({ content: 'Pokračujeme.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'A co dál?' } });
  expect(r.status === 200 && odmitnuto.length === pred5b, `T5: DALŠÍ tah po pokračování s visící otázkou projde (${r.status}; ${odmitnuto.slice(pred5b).join(' | ').slice(0, 160)})`);
  const tNeodp = (posledni().messages || []).filter((m) => m.role === 'tool' && /zatím neodpověděl/.test(m.content));
  expect(tNeodp.length === 1, `T5: visící otázka má v historii stále stejný výsledek, jen jednou (${tNeodp.length})`);
  chat = r.json.chat;

  console.log('== T6: 3. pokus „dopověz textem“ a poslední kolo smyčky bez prázdného tools ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  const pred6 = odmitnuto.length; const predV6 = volani.length;
  fronta.push({ content: '' }, { content: '' }, { content: 'Odpovídám textem.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Shrň to' } });
  const v6 = volani.slice(predV6);
  expect(r.status === 200 && odmitnuto.length === pred6 && v6.length === 3 && !('tools' in v6[2]) && Array.isArray(v6[0].tools), `T6: 3. pokus jde bez pole tools, ne s prázdným (${r.status}, volání ${v6.length}, tools3=${JSON.stringify(v6[2] && v6[2].tools)})`);
  const predK = volani.length; const predK2 = odmitnuto.length;
  for (let i = 0; i < 8; i++) fronta.push({ tool_calls: [volani_('get_my_day', {})] });
  fronta.push({ content: 'Konec kola.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'Čti pořád dokola' } });
  const vK = volani.slice(predK);
  expect(r.status === 200 && odmitnuto.length === predK2 && vK.length === 9 && !('tools' in vK[8]), `T6: poslední kolo smyčky bez pole tools (${r.status}, volání ${vK.length})`);
  chat = r.json.chat;

  console.log('== T8: null u volitelných polí ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  fronta.push({ tool_calls: [volani_('update_node', { map_id: 'Truhlářství', node_id: 'Poslat poptávku', status: 'done', title: null, description: null, owner: null, planned_on: null, deadline: null, note: null })] });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Poptávka je hotová' } });
  const karta8 = (r.json.chat.messages.at(-1).karty || []).find((k) => k.type === 'akce');
  expect(r.status === 200 && !!karta8 && !r.json.chat.messages.slice(-2).some((m) => m.role === 'tool' && /^Error/.test(m.content || '')), `T8: null u volitelných polí → karta, ne chyba validace (${r.status} ${karta8 && karta8.popis})`);
  fronta.push({ content: 'Hotovo.' });
  await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: karta8 && karta8.id, ok: false } });

  console.log('== T9: nástroje — GPT všechny hned, ostatní po skupinách ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  let predV = volani.length;
  fronta.push({ content: 'Ahoj.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj' } });
  const jmena = (v) => ((v && v.tools) || []).map((t) => t.function.name);
  expect(jmena(volani[predV]).includes('create_rule') && jmena(volani[predV]).includes('pdf_replace_text') && jmena(volani[predV]).includes('create_project'), `T9: gpt-4o-mini dostal všechny nástroje i bez klíčových slov (${jmena(volani[predV]).length})`);
  for (const [model, popis] of [['qwen-mock', 'qwen'], ['gpt-oss-20b', 'gpt-oss (lehký model v cloudu)']]) {
    await nastav(model);
    predV = volani.length;
    fronta.push({ content: 'Ahoj.' });
    r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj' } });
    expect(r.status === 200 && !jmena(volani[predV]).includes('create_rule') && jmena(volani[predV]).includes('get_map'), `T9: ${popis} dál po skupinách (${jmena(volani[predV]).length} nástrojů)`);
  }

  console.log('== T10: markdown od GPT → prostý text panelu ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  await nastav('gpt-4o-mini');
  fronta.push({ content: '## Plán\n**Dnes** udělejte:\n* nabídku\n* fakturu' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Co dnes?' } });
  expect(r.json.chat.messages.at(-1).content === 'Plán:\nDnes udělejte:\n- nabídku\n- fakturu', `T10: markdown srovnán (${JSON.stringify(r.json.chat.messages.at(-1).content)})`);

  console.log('== T12: odmítnutí modelu (refusal) není prázdná odpověď ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  fronta.push({ content: null, refusal: 'S tímhle nepomohu.' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Něco nevhodného' } });
  expect(r.status === 200 && r.json.chat.messages.at(-1).content === 'S tímhle nepomohu.', `T12: refusal se ukáže jako odpověď (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);

  console.log('== T13: formulář Nového projektu (otázka od aplikace, ne od modelu) → odpověď → OpenAI bez 400 ==');
  let rf = await inst.api('POST', '/api/kb/chat', { token: A, body: { mode: 'novy_projekt', message: '' } });
  expect(rf.status === 200 && ((rf.json.chat.messages.at(-1) || {}).karty || []).some((k) => k.type === 'otazky'), 'formulář je v rozhovoru');
  fronta.push({ tool_calls: [volani_('ask_user', { questions: [{ text: 'Kdy?', options: ['Do měsíce', 'Později'] }, { text: 'Pro koho?', options: ['Tým', 'Zákazníci'] }, { text: 'Rozpočet?', options: ['Malý', 'Velký'] }] })] });
  rf = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: rf.json.chat.id, message: '1) Uspořádat firemní akci\n2) Stručná – 5–7 bodů' } });
  const otazkyF = ((rf.json.chat.messages.at(-1) || {}).karty || []).find((k) => k.type === 'otazky') || {};
  expect(rf.status === 200 && (otazkyF.questions || []).length === 3, `odpověď na formulář prošla přísným OpenAI (${rf.status})`);

  console.log('== T7: uvažující modely — holé tělo napoprvé, rezerva a effort ==');
  fronta.length = 0; // selhání předchozího kroku nesmí posunout odpovědi dalším (mutace M4 ukázala řetězení)
  for (const model of ['gpt-5-mini', 'gpt-5.6-luna']) {
    await nastav(model);
    predV = volani.length; const pred7 = odmitnuto.length;
    fronta.push({ content: 'Ahoj z ' + model });
    r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj' } });
    const v7 = volani.slice(predV);
    expect(r.status === 200 && v7.length === 1 && odmitnuto.length === pred7, `T7 ${model}: jedno volání, žádné 400 (${r.status}, volání ${v7.length}; ${odmitnuto.slice(pred7).join(' | ').slice(0, 120)})`);
    expect(v7[0] && !('max_tokens' in v7[0]) && !('temperature' in v7[0]) && v7[0].max_completion_tokens === 1500 + 4000 && v7[0].reasoning_effort === 'low', `T7 ${model}: max_completion_tokens s rezervou 4000, effort low (${JSON.stringify(v7[0] && { mct: v7[0].max_completion_tokens, re: v7[0].reasoning_effort })})`);
  }
  // uvažující model, jehož jméno to neprozradí: první tah 400 na max_tokens → rovnou s rezervou (ne „spotřeboval
  // limit na přemýšlení“), instance si ho zapamatuje → druhý tah jedním voláním
  await nastav('luna-mock');
  predV = volani.length;
  fronta.push({ content: 'Luna poprvé' }, { content: 'Luna podruhé' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj' } });
  const v7m = volani.slice(predV);
  expect(r.status === 200 && v7m.length === 2 && 'max_tokens' in v7m[0] && v7m[1].max_completion_tokens === 5500 && v7m[1].reasoning_effort === 'low' && /Luna poprvé/.test(r.json.chat.messages.at(-1).content || ''), `T7 neznámé jméno: po 400 rovnou s rezervou a effortem (${r.status}, volání ${v7m.length})`);
  predV = volani.length;
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'Ještě jednou' } });
  const v7n = volani.slice(predV);
  expect(r.status === 200 && v7n.length === 1 && !('max_tokens' in v7n[0]) && v7n[0].reasoning_effort === 'low', `T7 neznámé jméno: instance si model pamatuje → druhý tah jedním voláním (${r.status}, volání ${v7n.length})`);
  // model, který effort nezná → jednou bez něj (a pak odpověď, žádná chyba pro uživatele)
  await nastav('gpt-5-prisny');
  predV = volani.length;
  fronta.push({ content: 'Ahoj bez effortu' });
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj' } });
  const v7b = volani.slice(predV);
  expect(r.status === 200 && v7b.length === 2 && v7b[0].reasoning_effort === 'low' && !('reasoning_effort' in v7b[1]) && /bez effortu/.test(r.json.chat.messages.at(-1).content || ''), `T7: effort odmítnutý → druhý pokus bez něj (${r.status}, volání ${v7b.length})`);
  // starý Poradce (chatOpenAI) na uvažujícím modelu: taky bez dvojího volání
  await nastav('gpt-5-mini');
  predV = volani.length;
  fronta.push({ content: '{"questions":["Pro koho?","Kdy?","Za kolik?"]}' });
  r = await inst.api('POST', '/api/kb/advisor', { token: A, body: { mode: 'questions', goal: 'Otevřít kavárnu' } });
  const v7c = volani.slice(predV);
  expect(r.status === 200 && v7c.length === 1 && !('max_tokens' in v7c[0]) && v7c[0].reasoning_effort === 'low', `T7: Poradce na gpt-5 jedním voláním s effortem (${r.status}, volání ${v7c.length})`);

  console.log('== T11b: obrázky z Administrace — zapne je až test vestavěného obrázku ==');
  fronta.length = 0;
  let rv = await inst.api('POST', '/api/kb/ai-settings', { token: A, body: { provider: 'openai', url: mock.base + '/v1', model: 'gpt-4o-mini', vision_enabled: true, vision_model: '' } });
  expect(rv.status === 200 && rv.json.vision_ok === true && /Obrázek přečten/.test(rv.json.vision_message || ''), `uložení se zapnutými obrázky = test hned, prošel (${rv.status} ${JSON.stringify(rv.json)})`);
  const vz = volaniVize.at(-1) || {};
  const casti = ((vz.messages || []).find((m) => Array.isArray(m.content)) || {}).content || [];
  expect(vz.model === 'gpt-4o-mini' && !('tools' in vz) && casti.some((c) => c.type === 'image_url' && /^data:image\/png;base64,iVBOR/.test(c.image_url.url)), 'test poslal vestavěné PNG jako image_url modelu chatu (bez nástrojů)');
  expect(((await inst.api('GET', '/api/kb/config')).json.ai_modes || []).includes('chat_image'), 'po úspěšném testu /config hlásí chat_image');
  const gs = (await inst.api('GET', '/api/kb/ai-settings', { token: A })).json;
  expect(gs.vision_enabled === true && gs.vision_ok === true && gs.vision_env === false && gs.token_set === true, `GET /ai-settings vrací stav obrázků (${JSON.stringify({ e: gs.vision_enabled, ok: gs.vision_ok, env: gs.vision_env })})`);
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { mode: 'nocni', message: '', context: { route: '/' } } });
  const uvodN = r.json.chat ? posledniA(r.json.chat) : {};
  const volbyN = (((uvodN.karty || []).find((k) => k.type === 'otazky') || {}).questions || [{}])[0].options || [];
  expect(r.status === 200 && /^Vložte fotku poznámek z dneška/.test(uvodN.content || '') && volbyN[0] === 'Vložím fotku nebo nápady', `noční plánování s obrázky z Administrace = schválené znění s fotkou (${JSON.stringify(volbyN)})`);
  const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  fronta.push({ content: 'Z fotky mám KB 4729.' });
  const predVize = volaniVize.length;
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: '', image_base64: PNG1 } });
  // úvod nočního plánování je otázka od aplikace → fotka je odpověď na ni (výsledek ask_user, ne zpráva uživatele)
  const userMsg = (posledni().messages || []).filter((m) => m.role === 'user' || m.role === 'tool').at(-1) || {};
  expect(r.status === 200 && volaniVize.length === predVize + 1 && userMsg.role === 'tool' && /\[Přepis obrázku\]\nKB 4729/.test(userMsg.content || ''), `fotka v chatu: přepis modelem z Administrace → značka pro model (${r.status} ${userMsg.role})`);
  // oprava přepisu fotky (tužka v bublině): historie pro přísné OpenAI zůstane spárovaná, fotka se znovu nečte
  fronta.push({ content: 'Opravený kód je KB 4730.' });
  const predOpr = odmitnuto.length; const predVizeOpr = volaniVize.length;
  r = await inst.api('POST', '/api/kb/chat/oprav', { token: A, body: { chat_id: r.json.chat.id, text: 'KB 4730' } });
  const poOpr = (posledni().messages || []).filter((m) => m.role === 'user' || m.role === 'tool').at(-1) || {};
  expect(r.status === 200 && odmitnuto.length === predOpr && volaniVize.length === predVizeOpr && /\[Přepis obrázku\]\nKB 4730/.test(poOpr.content || '') && !/4729/.test(JSON.stringify(posledni().messages)), `oprava přepisu fotky: OpenAI nic neodmítl, model vidí jen opravu (${r.status}; ${odmitnuto.slice(predOpr).join(' | ').slice(0, 120)})`);
  // model, který obrázky nevidí → test neprojde → obrázky vypnuté
  slepy = true;
  rv = await inst.api('POST', '/api/kb/ai-test', { token: A, body: { mode: 'vision' } });
  expect(rv.status === 200 && rv.json.ok === false && rv.json.vision_ok === false && /nepřečetl/.test(rv.json.message || ''), `slepý model: test neprošel, srozumitelně (${JSON.stringify(rv.json).slice(0, 160)})`);
  expect(!((await inst.api('GET', '/api/kb/config')).json.ai_modes || []).includes('chat_image'), 'po neúspěšném testu /config chat_image NEhlásí');
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '', image_base64: PNG1 } });
  expect(r.status === 400 && r.json.code === 'ai_vision_off', `obrázek po neúspěšném testu → 400 ai_vision_off (${r.status})`);
  slepy = false;
  // změna modelu = test znovu (bez testu by nový model mohl obrázky nevidět)
  rv = await inst.api('POST', '/api/kb/ai-settings', { token: A, body: { provider: 'openai', url: mock.base + '/v1', model: 'gpt-4o-mini', vision_enabled: true, vision_model: 'gpt-4.1-mini' } });
  expect(rv.json.vision_ok === true && (volaniVize.at(-1) || {}).model === 'gpt-4.1-mini', 'změna modelu obrázků → nový test tím modelem');
  rv = await inst.api('POST', '/api/kb/ai-settings', { token: A, body: { provider: 'openai', url: mock.base + '/v1', model: 'gpt-4o-mini', vision_enabled: false, vision_model: 'gpt-4.1-mini' } });
  expect(rv.json.vision_ok === false && !((await inst.api('GET', '/api/kb/config')).json.ai_modes || []).includes('chat_image'), 'vypnutí obrázků → chat_image pryč');
  await inst.register('clen@example.com', { name: 'Člen' });
  const C = await inst.login('clen@example.com');
  expect((await inst.api('POST', '/api/kb/ai-test', { token: C, body: { mode: 'vision' } })).status === 403, 'test obrázku smí jen správce');

  console.log('== souhrn: přísný mock neodmítl nic mimo řízený případ effortu ==');
  const necekane = odmitnuto.filter((x) => !/reasoning_effort' does not support 'low'/.test(x) && !/Unsupported parameter: 'max_tokens'/.test(x));
  expect(odmitnuto.filter((x) => /Unsupported parameter: 'max_tokens'/.test(x)).length === 1, 'jediné odmítnuté max_tokens = první tah modelu s neznámým jménem');
  expect(necekane.length === 0, `žádné neočekávané 400 (${necekane.length}: ${necekane.join(' | ').slice(0, 300)})`);
  expect(mock.pozadavky.filter((q) => q.url.startsWith('/v1/chat')).every((q) => q.headers.authorization === 'Bearer sk-test-mock-klic'), 'klíč z Administrace jde v Authorization');
}, { nazev: 'AI-CHAT-OPENAI-STRICT' });
