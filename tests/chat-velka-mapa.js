// Asistent čte velkou mapu několikrát v jednom rozhovoru (S1-01, 3. kolo analýzy, 4. 11. 2026).
//
// Do 4. 11. 2026 šel do `ai_chats.messages` CELÝ výsledek nástroje (mapa s 250 kroky ≈ 75 kB),
// zatímco model dostal nejvýš 12 000 znaků. Ořez historie (orezNahledy) sahal jen na náhledy
// obrázků a PDF, takže po třech čteních přetekl strop pole (200 kB): čtvrtý tah vrátil 502
// „maximum allowed JSON size“, app.save ve finally shodil i zapisLog (tah bez řádku v ai_chat_log,
// model přitom zavolán) a odpověď lhala `ulozeno: true`.
//
// Sada: mapa ~250 uzlů přes API, podvržená ollama vrací 5× tool_call get_map → všech 5 čtecích
// tahů projde, uložený rozhovor zůstane pod 200 kB a každý tah má řádek v ai_chat_log.
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/chat-velka-mapa.js
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  JSON.parse(body);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
};

// mapa jako v reprodukci skeptika: 250 uzlů ve 3 úrovních, český popis 160 znaků
const POPIS = 'Připravit podklady pro výrobu, ověřit rozměry u zákazníka, objednat materiál a dohodnout termín montáže s partou. ';
function velkaMapa() {
  const nodes = [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Velký projekt', title: 'Velký projekt', status: 'todo' } }];
  const edges = [];
  let n = 0;
  for (let a = 0; a < 10; a++) {
    const ia = `a${a}`; nodes.push({ id: ia, type: 'goalNode', position: { x: a * 300, y: 200 }, data: { title: `Etapa ${a + 1} stavby`, description: POPIS.repeat(2).slice(0, 160), status: 'todo' } });
    edges.push({ id: `e-${ia}`, source: 'root', target: ia }); n++;
    for (let b = 0; b < 5; b++) {
      const ib = `${ia}b${b}`; nodes.push({ id: ib, type: 'goalNode', position: { x: a * 300, y: 400 + b * 100 }, data: { title: `Krok ${a + 1}.${b + 1} přípravy`, description: POPIS.repeat(2).slice(0, 160), status: b % 2 ? 'done' : 'todo' } });
      edges.push({ id: `e-${ib}`, source: ia, target: ib }); n++;
      for (let c = 0; c < 4; c++) {
        const ic = `${ib}c${c}`; nodes.push({ id: ic, type: 'goalNode', position: { x: a * 300 + c * 50, y: 1000 + b * 300 + c * 60 }, data: { title: `Úkol ${a + 1}.${b + 1}.${c + 1} dílny`, description: POPIS.repeat(2).slice(0, 160), status: 'todo', deadline: '2026-12-20' } });
        edges.push({ id: `e-${ic}`, source: ib, target: ic }); n++;
      }
    }
  }
  return { nodes, edges, pocet: n + 1 };
}

const bajtu = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'chat-velka-mapa', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
  } });
  await inst.register('admin@example.com', { name: 'Petr' });
  const A = await inst.login('admin@example.com');
  const ST = await inst.superuser();
  const m = velkaMapa();
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Velký projekt', nodes: m.nodes, edges: m.edges } })).json;
  expect(!!map.id && m.pocet >= 250, `mapa s ${m.pocet} uzly založena`);
  const logRadky = async () => (await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=50', { token: ST })).json.totalItems || 0;
  const ulozeno = async (id) => (await inst.api('GET', `/api/collections/ai_chats/records/${id}`, { token: ST })).json;

  console.log('== 5 čtecích tahů nad velkou mapou v jednom rozhovoru ==');
  let chatId = null;
  for (let tah = 1; tah <= 5; tah++) {
    fronta.length = 0;
    fronta.push(nastroj('get_map', { map_id: map.id }), text(`Tah ${tah}: v projektu je spousta kroků.`));
    const r = await inst.api('POST', '/api/kb/chat', { token: A, body: Object.assign({ message: `Co mám v projektu? (${tah})`, context: { route: '/' } }, chatId ? { chat_id: chatId } : {}) });
    expect(r.status === 200, `tah ${tah}: HTTP 200 (${r.status} ${r.json && r.json.error ? String(r.json.error).slice(0, 90) : ''})`);
    if (r.status === 200 && r.json.chat) chatId = r.json.chat.id;
    if (!chatId) { expect(false, 'odpověď nenese chat.id — sada nemůže pokračovat'); break; }
    const rec = await ulozeno(chatId);
    const b = bajtu(rec.messages || []);
    expect(b < 200000, `tah ${tah}: uložený rozhovor ${b} B < 200 kB`);
    const posledniTool = (rec.messages || []).filter((x) => x.role === 'tool').pop();
    expect(!!posledniTool && String(posledniTool.content || '').length <= 12000, `tah ${tah}: výsledek nástroje uložený ořezaný na ≤ 12 000 zn. (${posledniTool ? String(posledniTool.content || '').length : 'chybí'})`);
    expect(await logRadky() === tah, `tah ${tah}: má řádek v ai_chat_log (${await logRadky()} řádků)`);
  }
  if (chatId) {
    const rec = await ulozeno(chatId);
    expect((rec.messages || []).filter((x) => x.role === 'user').length === 5, `všech 5 zpráv uživatele zůstalo v rozhovoru (${(rec.messages || []).filter((x) => x.role === 'user').length})`);
    console.log('== další tah bez čtení v témže rozhovoru ==');
    fronta.length = 0; fronta.push(text('Ahoj, co potřebujete?'));
    const r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chatId, message: 'Ahoj' } });
    expect(r.status === 200, `textový tah po pěti čteních prošel (${r.status})`);
    expect(await logRadky() === 6, `šest tahů = šest řádků v ai_chat_log (${await logRadky()})`);

    console.log('== 12 dalších čtení: historie přeteče strop i s ořezem na 12 000 → starší výsledky se zkrátí, nejstarší tahy odpadnou ==');
    // 17 čtení × ~14 kB = ~235 kB > STROP_MSGS (180 kB): ořez historie musí sáhnout i na výsledky nástrojů
    let vse200 = true;
    for (let tah = 7; tah <= 18; tah++) {
      fronta.length = 0; fronta.push(nastroj('get_map', { map_id: map.id }), text(`Tah ${tah}.`));
      const r2 = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chatId, message: `Znovu (${tah})` } });
      if (r2.status !== 200) { vse200 = false; console.log(`     tah ${tah}: ${r2.status} ${r2.json && r2.json.error}`); }
    }
    expect(vse200, 'všech 12 dalších čtecích tahů prošlo (200)');
    const rec2 = await ulozeno(chatId);
    const b2 = bajtu(rec2.messages || []);
    expect(b2 < 180000, `uložený rozhovor po 17 čteních ${b2} B < 180 kB (strop ořezu)`);
    const posledniUser = (rec2.messages || []).map((x) => x.role).lastIndexOf('user');
    const posledniTool = (rec2.messages || []).filter((x) => x.role === 'tool').pop();
    expect(!!posledniTool && String(posledniTool.content || '').length === 12000, `poslední čtení zůstalo celé pro model (${posledniTool ? String(posledniTool.content || '').length : 'chybí'} zn.)`);
    // ořez sahá na starší výsledky až když historie přeteče strop — ty před posledním přetečením mají 600 zn.
    // (totéž, co z nich dostává model), novější do stropu zůstávají celé
    const starsi = (rec2.messages || []).slice(0, posledniUser).filter((x) => x.role === 'tool').map((x) => String(x.content || '').length);
    expect(starsi.filter((n) => n === 600).length >= 8 && starsi.every((n) => n === 600 || n === 12000), `starší výsledky nástrojů zkrácené na 600 zn. (${starsi.join(',')})`);
    expect((rec2.messages || []).filter((x) => x.role === 'user').length >= 8 && (rec2.messages || [])[0].role === 'user', `rozhovor začíná zprávou uživatele a drží posledních ${(rec2.messages || []).filter((x) => x.role === 'user').length} tahů`);
    expect(await logRadky() === 18, `18 tahů = 18 řádků v ai_chat_log (${await logRadky()})`);
  }
}, { nazev: 'CHAT VELKÁ MAPA' });
