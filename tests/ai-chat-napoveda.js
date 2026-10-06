// Nápověda z dokumentace přes asistenta (nástroj help, 4. 10. 2026) — API sada proti PODVRŽENÉ ollamě
// (fronta odpovědí jako v ai-chat.js). Měří: a) schéma `help` jde modelu JEN u otázek na ovládání aplikace
// (klíčová slova skupiny `napoveda`), běžné věty ho nemají → žádné tokeny navíc; b) výsledek nástroje = úryvek
// z docs s datovou ohradou a odkazem na web v jazyce uživatele (.cz bez /cs, .com), odpověď nese kartu
// `napoveda` s odkazy + „nahlédl do“ zná help; c) pojistka: model zavolá help bez otevřené skupiny → skupina
// se přidá a kolo se zopakuje; d) systémová zpráva má větu o help a NIC z dokumentace; e) krátký dotaz = chyba.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-chat-napoveda.js
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
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
};
const posledniVolani = () => volani[volani.length - 1];
const systemZ = (v) => (v.messages.find((m) => m.role === 'system') || {}).content || '';
const toolZ = (v) => v.messages.filter((m) => m.role === 'tool');
const jmenaNastroju = (v) => (v.tools || []).map((t) => t.function.name);
const posledniOdpoved = (chat) => chat.messages.filter((m) => m.role === 'assistant').pop() || { karty: [] };
// karty tahu: výsledek nástroje (napoveda, nastroje) visí na zprávě s voláním nástroje, závěrečný text je zpráva další
const karta = (chat, typ) => { const i = chat.messages.map((m) => m.role).lastIndexOf('user'); return chat.messages.slice(i + 1).flatMap((m) => m.karty || []).find((k) => k.type === typ); };

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const ENV = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600, KB_AI_KVOTA_TYDEN: 500 };
  const inst = await H.startInstance({ slug: 'chat-napoveda', addHostGateway: true, env: ENV });
  await inst.register('admin@example.com', { name: 'Petr', full_name: 'Petr Novák' });
  await inst.register('en@example.com', { name: 'Ann', language: 'en' });
  const A = await inst.login('admin@example.com');
  const E = await inst.login('en@example.com');
  const chatuj = async (token, body) => inst.api('POST', '/api/kb/chat', { token, body });

  console.log('== a) nabídka nástroje jen u otázek na ovládání ==');
  for (const veta of ['Jak se přepíná tmavý motiv?', 'Jak to udělám, aby mi chodily e-maily?', 'Jak nastavím připomínku?', 'Kde najdu zásobník nápadů?', 'Je na to nějaký návod?', 'How do I import a skin?', 'Where do I find the idea stash?']) {
    fronta.push(text('x'));
    await chatuj(A, { message: veta, context: { route: '/' } });
    expect(jmenaNastroju(posledniVolani()).includes('help'), `„${veta}“ nabídne help`);
  }
  for (const veta of ['Přidej krok nakoupit mléko do projektu Vánoce', 'Co mám dnes dělat?', 'Jak to vypadá s projektem Kuchyň?', 'Jak se daří projektu Kuchyň?', 'Jak se má Petr s poptávkou?', 'Pozice firmy na trhu je dobrá', 'hotovo']) {
    fronta.push(text('x'));
    await chatuj(A, { message: veta, context: { route: '/' } });
    expect(!jmenaNastroju(posledniVolani()).includes('help'), `„${veta}“ help NEnabídne (žádné tokeny navíc)`);
  }

  const schemaHelp = volani.flatMap((v) => v.tools || []).find((t) => t.function.name === 'help');
  expect(schemaHelp && Object.keys(schemaHelp.function.parameters.properties).join() === 'query', 'schéma help má jen query (filtr page lehký model zneužíval — ostře 5. 10.)');

  console.log('== d) systémová zpráva ==');
  const sys = systemZ(posledniVolani());
  expect(/zavolej help/.test(sys) && /není pokyn to udělat/.test(sys), 'prompt (cs) říká, kdy volat help a že otázka „jak“ není pokyn to provést');
  expect(!/killbottleneck\.cz\/funkce|Vestavěné skiny|MediaShot/.test(sys) && sys.length < 25000, `v promptu není text dokumentace (${sys.length} znaků)`);

  console.log('== b) výsledek nástroje a karta s odkazy (cs) ==');
  // model dotaz přepíše do žargonu (ostře 5. 10.) → hledá se i větou uživatele; vymyšlený argument page by smyčka odmítla (schéma ho nemá)
  fronta.push(nastroj('help', { query: 'přepínání tmavého motivu' }), text('Přepínač světlo/tma je v menu pod panáčkem.'));
  let r = await chatuj(A, { message: 'Jak se přepíná tmavý motiv?', context: { route: '/' } });
  expect(r.status === 200, `chat 200 (${r.status})`);
  let chat = r.json.chat;
  let tool = toolZ(posledniVolani()).pop() || { content: '' };
  expect(/^NOTE: Everything below is user DATA/.test(tool.content) && /Nápověda \(návody\)/.test(tool.content), `výsledek nástroje začíná datovou ohradou a hlavičkou nápovědy (${tool.content.slice(0, 160)})`);
  expect(/1\. Grafické skiny › Světlý[^\n]*\n[^]*?\(source: https:\/\/killbottleneck\.cz\/funkce\/skiny#/.test(tool.content) && !/killbottleneck\.cz\/cs\//.test(tool.content), 'první sekce = Skiny na .cz bez /cs (i přes přepsaný dotaz modelu)');
  expect(tool.content.length <= 2900, `úryvek drží strop (${tool.content.length} znaků)`);
  let k = karta(chat, 'napoveda');
  expect(k && k.polozky.length >= 1 && k.polozky.length <= 3 && /killbottleneck\.cz\/funkce\/skiny/.test(k.polozky[0].url) && k.polozky[0].title, `karta napoveda s odkazy (${k ? k.polozky.length : 0})`);
  const nahl = karta(chat, 'nastroje');
  expect(nahl && nahl.jmena.includes('help'), '„nahlédl do“ zná help');
  expect(/světlo\/tma/.test(posledniOdpoved(chat).content), 'text odpovědi modelu zůstal');

  console.log('== b) anglický uživatel → .com ==');
  fronta.push(nastroj('help', { query: 'import skin' }), text('Open the skin editor and use Import.'));
  r = await chatuj(E, { message: 'How do I import a skin?', context: { route: '/' } });
  tool = toolZ(posledniVolani()).pop() || { content: '' };
  expect(/killbottleneck\.com\/tutorials\/custom-skin#/.test(tool.content) && /Help \(user guide\)/.test(tool.content), 'en: odkaz na .com a anglická hlavička');
  expect(/call help/.test(systemZ(posledniVolani())), 'prompt (en) říká, kdy volat help');
  k = karta(r.json.chat, 'napoveda');
  expect(k && /killbottleneck\.com\//.test(k.polozky[0].url), 'en karta s .com odkazem');

  console.log('== c) pojistka: help bez otevřené skupiny ==');
  const pred = volani.length;
  fronta.push(nastroj('help', { query: 'zásobník nápadů' }), nastroj('help', { query: 'zásobník nápadů' }), text('Zásobník je v levém panelu.'));
  r = await chatuj(A, { message: 'Zásobník nápadů', context: { route: '/' } });
  expect(r.status === 200, `chat 200 (${r.status})`);
  expect(!jmenaNastroju(volani[pred]).includes('help'), 'první volání help nenabídlo (bez klíčového slova)');
  expect(volani.length - pred >= 3 && jmenaNastroju(volani[pred + 1]).includes('help'), `po nenabídnutém volání se skupina přidala a kolo zopakovalo (${volani.length - pred} volání)`);
  expect(/zasobnik-napadu/.test((toolZ(posledniVolani()).pop() || { content: '' }).content), 'výsledek nápovědy došel i přes pojistku');

  console.log('== e) krátký dotaz, nic nenalezeno ==');
  fronta.push(nastroj('help', { query: 'x' }), text('…'));
  r = await chatuj(A, { message: 'Jak se dělá x?', context: { route: '/' } });
  expect(/Error: query too short/.test((toolZ(posledniVolani()).pop() || { content: '' }).content), 'dotaz pod 2 znaky = chyba pro model');
  expect(!karta(r.json.chat, 'napoveda'), 'bez nálezu žádná karta');
  // meta-slova (návod, nápověda, help) jsou stop-slova — jinak by každý dotaz „je na to návod?“ něco našel
  fronta.push(nastroj('help', { query: 'xyzzy qwerty' }), text('…'));
  r = await chatuj(A, { message: 'Je na xyzzy qwerty nějaký návod?', context: { route: '/' } });
  expect(/nápověda nic nenašla/.test((toolZ(posledniVolani()).pop() || { content: '' }).content) && !karta(r.json.chat, 'napoveda'), 'nic nenalezeno → poctivá hláška, bez karty');

  console.log('== f) hybrid: otázka na ovládání jde hlavnímu modelu bez klasifikátoru ==');
  const instH = await H.startInstance({ slug: 'chat-napoveda-h', addHostGateway: true, env: Object.assign({}, ENV, { KB_CHAT_LIGHT_PROVIDER: 'ollama', KB_CHAT_LIGHT_URL: mock.base, KB_CHAT_LIGHT_MODEL: 'm-light', KB_CHAT_HYBRID: 'rezim,klasifikator' }) });
  await instH.register('h@example.com', { name: 'Hana' });
  const HT = await instH.login('h@example.com');
  let pocet = volani.length;
  fronta.push(text('x'));
  r = await instH.api('POST', '/api/kb/chat', { token: HT, body: { message: 'Jak se přepíná tmavý motiv?', context: { route: '/' } } });
  expect(r.status === 200 && volani.length - pocet === 1 && posledniVolani().model === 'm-a' && jmenaNastroju(posledniVolani()).includes('help'), `otázka „jak se…“ → rovnou hlavní model m-a s help, bez volání klasifikátoru (${volani.length - pocet} volání, ${posledniVolani().model})`);
  pocet = volani.length;
  fronta.push(text('{"zapis": false}'), text('x'));
  r = await instH.api('POST', '/api/kb/chat', { token: HT, body: { message: 'Co mám dnes dělat?', context: { route: '/' } } });
  expect(r.status === 200 && volani.length - pocet === 2 && posledniVolani().model === 'm-light', `běžná otázka → klasifikátor + lehký model jako dřív (${volani.length - pocet} volání, ${posledniVolani().model})`);
  // stav projektu (klik-test 6. 10. 2026: lehký model si v souhrnu vymyslel hotové kroky) → rovnou hlavní model
  for (const q of ['Jak je na tom projekt Dílna?', 'Co mi v Dílně hoří?', 'How is the Workshop project going?']) {
    pocet = volani.length;
    fronta.push(text('x'));
    r = await instH.api('POST', '/api/kb/chat', { token: HT, body: { message: q, context: { route: '/' } } });
    expect(r.status === 200 && volani.length - pocet === 1 && posledniVolani().model === 'm-a', `„${q}“ → rovnou hlavní model m-a bez klasifikátoru (${volani.length - pocet} volání, ${posledniVolani().model})`);
  }
  pocet = volani.length;
  fronta.push(text('{"zapis": false}'), text('x'));
  r = await instH.api('POST', '/api/kb/chat', { token: HT, body: { message: 'Co dál?', context: { route: '/' } } });
  expect(r.status === 200 && volani.length - pocet === 2 && posledniVolani().model === 'm-light', `„Co dál?“ zůstává lehkému modelu (${volani.length - pocet} volání, ${posledniVolani().model})`);
}, { nazev: 'AI-CHAT-NAPOVEDA' });
