// STYL PROCES V ASISTENTOVI (25. 10. 2026, Richard: „napoj asistenta, jinak je klik-test poloviční“) — proti
// PODVRŽENÉ ollamě (fronta odpovědí jako v ai-chat-funkce.js). Ostrý tah se Stratou ukázal dvě mezery: rytmus kroku
// model skládal z obecného create_rule špatně (schedule → set_deadline denně místo „každý všední den“) a styl mapy
// přepnout neuměl (vymyslel si cestu v menu). Měří: set_step_rhythm (stejné pravidlo a první termín jako přepínač
// v okně kroku — parita s lib/recurrenceRule.js a lib/rhythm.js), změna a zrušení rytmu, chyby PŘED kartou (vrchol,
// ručně upravené pravidlo, bez práva), set_map_style oběma směry (do procesu doplní obnovu podkroků), jen vlastník,
// get_map s kind a zdravím běhu, nabídka nástrojů podle klíčových slov a pokyn v promptu.
// Data VŽDY z kontejneru (past UTC×hostitel).
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/proces-asistent.js
const path = require('path');
const { pathToFileURL } = require('url');
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
const posledniKarta = (chat, typ) => { const i = chat.messages.map((m) => m.role).lastIndexOf('user'); return chat.messages.slice(i + 1).flatMap((m) => m.karty || []).reverse().find((k) => k.type === typ); };
const kartaPodleId = (chat, id) => chat.messages.flatMap((m) => m.karty || []).find((k) => k.type === 'akce' && k.id === id);
// JSON se seřazenými klíči — pořadí klíčů v uloženém pravidle není součást tvaru
const kanon = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((kk) => [kk, v[kk]])) : v));
const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });

H.beh(async () => {
  const R = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'rhythm.js')).href);
  const RR = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'recurrenceRule.js')).href);
  const mock = await H.httpMock(mockHandler);
  const ENV = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_AI_MAX_PER_HOUR: 600, KB_AI_KVOTA_TYDEN: 500 };
  const inst = await H.startInstance({ slug: 'proces-asistent', addHostGateway: true, env: ENV });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const dnes = inst.exec('date +%F').trim(); // server počítá „dnes" v pásmu kontejneru (TZ; v testu UTC)
  const chatuj = async (token, body) => inst.api('POST', '/api/kb/chat', { token, body });
  const potvrd = async (token, chat_id, id) => inst.api('POST', '/api/kb/chat/potvrdit', { token, body: { chat_id, action_id: id, ok: true } });
  const mapaZ = async (id) => (await inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: A })).json;
  const uzel = async (mid, id) => (await mapaZ(mid)).nodes.find((n) => n.id === id);
  const pravidla = async (mid) => (await inst.api('GET', `/api/kb/rules?map=${mid}`, { token: A })).json.rules || [];
  const datumCz = (s) => `${Number(s.slice(8, 10))}. ${Number(s.slice(5, 7))}.`;

  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Úklid dílny', kind: 'process', nodes: [
      node('root', { apexText: 'Úklid dílny', title: 'Úklid dílny', status: 'todo' }, 'apexNode'),
      node('s1', { title: 'Denní úklid stolů', status: 'todo' }),
      node('s2', { title: 'Vysát podlahu', status: 'todo' }),
      node('s2a', { title: 'Vysypat vysavač', status: 'todo' }),
      node('s3', { title: 'Objednat čisticí prostředky', status: 'todo' }),
    ], edges: [{ id: 'e1', source: 'root', target: 's1' }, { id: 'e2', source: 'root', target: 's2' }, { id: 'e3', source: 's2', target: 's2a' }, { id: 'e4', source: 'root', target: 's3' }] } })).json;
  expect(!!map.id && map.kind === 'process', 'proces Úklid dílny založen');
  // Jana = editorka (může měnit kroky, ne styl mapy)
  expect((await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'share', mapId: map.id, email: 'clen@example.com', permission: 'edit' } })).status === 200, 'mapa nasdílena Janě (edit)');

  console.log('== nabídka nástrojů a pokyn v promptu ==');
  fronta.push(text('x'));
  let r = await chatuj(A, { message: 'Ať se denní úklid opakuje každý všední den', context: { route: `/map/${map.id}`, map_id: map.id } });
  let jm = jmenaNastroju(posledniVolani());
  expect(jm.includes('set_step_rhythm'), '„opakuje každý všední den“ → nabídnut set_step_rhythm');
  expect(/set_step_rhythm — nikdy create_rule/.test(systemZ(posledniVolani())), 'prompt: opakovaný krok JEN přes set_step_rhythm, nikdy create_rule');
  fronta.push(text('x'));
  r = await chatuj(A, { message: 'Změň Úklid dílny na projekt', context: { route: '/' } });
  expect(jmenaNastroju(posledniVolani()).includes('set_map_style'), '„změň na projekt“ → nabídnut set_map_style');
  fronta.push(text('x'));
  r = await chatuj(A, { message: 'Make the cleaning step repeat every Monday', context: { route: '/' } });
  expect(jmenaNastroju(posledniVolani()).includes('set_step_rhythm'), 'EN „repeat every Monday“ → nabídnut set_step_rhythm');

  console.log('== get_map: styl a zdraví běhu ==');
  fronta.push(nastroj('get_map', { map_id: 'Úklid dílny' }), text('x'));
  r = await chatuj(A, { message: 'Jak běží proces Úklid dílny?', context: { route: '/' } });
  const gm = toolZ(posledniVolani()).map((m) => m.content).join('\n');
  expect(/kind: process/.test(gm) && /Process \(keeps running, no % done\): no recurring steps yet/.test(gm), `get_map nese kind i zdraví běhu (${gm.slice(0, 160).replace(/\n/g, ' ')})`);

  console.log('== set_step_rhythm: každý všední den, krok bez termínu ==');
  fronta.push(nastroj('set_step_rhythm', { map_id: 'Úklid dílny', node_id: 'Denní úklid stolů', freq: 'weekly', days: [5, 1, 2, 3, 4] }));
  r = await chatuj(A, { message: 'Ať se Denní úklid stolů opakuje každý všední den', context: { route: '/' } });
  let chat = r.json.chat; let k = posledniKarta(chat, 'akce');
  const vsedni = { freq: 'weekly', every: 1, days: [1, 2, 3, 4, 5] };
  const prvni = R.firstOccurrence(dnes, vsedni);
  expect(!!k && k.popis === `Opakovat „Denní úklid stolů“ každý všední den (projekt „Úklid dílny“) · první termín ${datumCz(prvni)}`, `karta: rytmus slovy jako v aplikaci + první termín (${k && k.popis})`);
  expect((await pravidla(map.id)).length === 0 && !(await uzel(map.id, 's1')).data.deadline, 'před potvrzením se nic nezměnilo');
  fronta.push(text('Hotovo.'));
  r = await potvrd(A, chat.id, k.id); chat = r.json.chat;
  let pr = await pravidla(map.id);
  const ocek = RR.buildRecurrenceRule('s1', vsedni, 'Opakování (týdně): Denní úklid stolů', { reset: true });
  const tvar = (p) => kanon({ name: p.name, node_id: p.node_id, trigger: p.trigger, conditions: p.conditions || [], actions: p.actions });
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && pr.length === 1 && tvar(pr[0]) === tvar(ocek), `pravidlo = buildRecurrenceRule z okna kroku (${pr[0] && tvar(pr[0])})`);
  expect((await uzel(map.id, 's1')).data.deadline === prvni, `krok bez termínu dostal první výskyt jako ve FE firstOccurrence (${prvni})`);
  const rc = RR.recurrenceOf(pr, 's1');
  expect(!!rc && !rc.custom && rc.reset === true && rc.days.join() === '1,2,3,4,5', 'přepínač v okně kroku pravidlo pozná jako čisté (ne „vlastní“)');
  const vysl = toolZ(posledniVolani()).map((m) => m.content).join('\n');
  expect(/now repeats každý všední den/.test(vysl) && /status "Založeno"/.test(vysl), `výsledek nástroje mluví slovy aplikace v jazyce uživatele (${vysl.slice(0, 200)})`);

  console.log('== změna rytmu: měsíčně 5. → totéž pravidlo, termín na nejbližší 5. ==');
  fronta.push(nastroj('set_step_rhythm', { map_id: 'Úklid dílny', node_id: 'Denní úklid stolů', freq: 'monthly', month_day: 5 }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Ne, ať je to jednou měsíčně pátého' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  let paty = dnes; while (Number(paty.slice(8, 10)) !== 5) paty = R.addDays(paty, 1);
  expect(!!k && k.popis === `Opakovat „Denní úklid stolů“ každý měsíc 5. (projekt „Úklid dílny“) · první termín ${datumCz(paty)}`, `karta změny rytmu (${k && k.popis})`);
  fronta.push(text('Hotovo.'));
  r = await potvrd(A, chat.id, k.id); chat = r.json.chat;
  const pr2 = await pravidla(map.id);
  expect(pr2.length === 1 && pr2[0].id === pr[0].id && pr2[0].name === 'Opakování (měsíčně): Denní úklid stolů' && kanon(pr2[0].actions[1]) === kanon({ type: 'set_deadline', advance: 'monthly', month_day: 5 }), `změna = úprava téhož pravidla, žádné druhé (${JSON.stringify(pr2.map((p) => p.actions))})`);
  expect((await uzel(map.id, 's1')).data.deadline === paty, `termín posunut na nejbližší 5. (${paty})`);

  console.log('== každý 2. týden v pátek u kroku s podkrokem ==');
  fronta.push(nastroj('set_step_rhythm', { map_id: 'Úklid dílny', node_id: 'Vysát podlahu', freq: 'weekly', every: 2, days: [5] }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Vysát podlahu každý druhý pátek' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && /^Opakovat „Vysát podlahu“ každý 2\. týden: Pá \(projekt „Úklid dílny“\) · první termín /.test(k.popis), `každý N-tý slovy (${k && k.popis})`);
  fronta.push(text('Hotovo.'));
  r = await potvrd(A, chat.id, k.id); chat = r.json.chat;
  const s2 = (await pravidla(map.id)).find((p) => p.node_id === 's2');
  expect(!!s2 && kanon(s2.actions) === kanon([{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'weekly', every: 2, days: [5] }, { type: 'reset_subtree' }]), `every 2 + days [5] + obnova podkroků v procesu (${s2 && JSON.stringify(s2.actions)})`);
  const d2 = (await uzel(map.id, 's2')).data.deadline;
  expect(d2 === R.firstOccurrence(dnes, { freq: 'weekly', every: 2, days: [5] }), `první termín = nejbližší pátek (${d2})`);

  console.log('== zrušení rytmu: pravidlo pryč, termín zůstane ==');
  fronta.push(nastroj('set_step_rhythm', { map_id: 'Úklid dílny', node_id: 'Vysát podlahu', freq: 'none' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Přestaň opakovat Vysát podlahu' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Přestat opakovat „Vysát podlahu“ v projektu „Úklid dílny“ (termín zůstane)', `karta zrušení (${k && k.popis})`);
  fronta.push(text('Hotovo.'));
  r = await potvrd(A, chat.id, k.id); chat = r.json.chat;
  expect(!(await pravidla(map.id)).some((p) => p.node_id === 's2') && (await uzel(map.id, 's2')).data.deadline === d2, 'pravidlo smazáno, termín beze změny');

  console.log('== chyby PŘED kartou ==');
  const chybaBezKarty = async (token, args, re, popis) => {
    fronta.push(nastroj('set_step_rhythm', args), text('x'));
    const rr = await chatuj(token, { message: 'Nastav opakování', context: { route: '/' } });
    const t = toolZ(posledniVolani()).map((m) => m.content).join('\n');
    expect((rr.json.chat.pending || []).length === 0 && re.test(t), `${popis} (${t.slice(0, 140)})`);
  };
  await chybaBezKarty(A, { map_id: 'Úklid dílny', node_id: 'Úklid dílny', freq: 'daily' }, /apex of the map cannot repeat/, 'vrchol → chyba, žádná karta');
  await chybaBezKarty(A, { map_id: 'Úklid dílny', node_id: 'Vysát podlahu', freq: 'none' }, /does not repeat — nothing to stop/, 'zrušení u kroku bez rytmu → chyba');
  await chybaBezKarty(A, { map_id: 'Úklid dílny', node_id: 'Vysát podlahu', freq: 'weekly', days: [8] }, /weekdays 1 = Monday/, 'den 8 → chyba');
  await chybaBezKarty(A, { map_id: 'Úklid dílny', node_id: 'Vysát podlahu', freq: 'daily', every: 9 }, /every must be a whole number 1-4/, 'every 9 → chyba');
  await chybaBezKarty(A, { map_id: 'Úklid dílny', node_id: 'Vysát podlahu', freq: 'daily', month_day: 3 }, /month_day works only with freq monthly/, 'month_day u denního → chyba');
  // ručně upravené pravidlo (podmínka navíc) — přepínač i nástroj na něj nesahají
  await inst.api('POST', '/api/kb/rules/save', { token: A, body: { map: map.id, name: 'Vlastní opakování', node_id: 's3', trigger: { type: 'node_status_changed', status: 'in_progress' }, conditions: [], actions: [{ type: 'set_deadline', advance: 'weekly' }] } });
  await chybaBezKarty(A, { map_id: 'Úklid dílny', node_id: 'Objednat čisticí prostředky', freq: 'daily' }, /manually edited rule "Vlastní opakování"/, 'ručně upravené pravidlo → chyba s radou update_rule');
  await inst.register('cizi@example.com');
  const C = await inst.login('cizi@example.com');
  await chybaBezKarty(C, { map_id: map.id, node_id: 's2', freq: 'daily' }, /not found or not accessible|only editors/, 'cizí uživatel mapu nevidí → chyba');

  console.log('== set_map_style ==');
  fronta.push(nastroj('set_map_style', { map_id: 'Úklid dílny', style: 'project' }), text('x'));
  r = await chatuj(B, { message: 'Změň Úklid dílny na projekt', context: { route: '/' } });
  expect((r.json.chat.pending || []).length === 0 && toolZ(posledniVolani()).some((m) => /only the owner of "Úklid dílny" can switch its style/.test(m.content)), 'editorka (ne vlastník) → chyba před kartou');
  fronta.push(nastroj('set_map_style', { map_id: 'Úklid dílny', style: 'process' }), text('x'));
  r = await chatuj(A, { message: 'Udělej z Úklidu dílny proces', context: { route: '/' } });
  expect(toolZ(posledniVolani()).some((m) => /already is a process; nothing to change/.test(m.content)), 'už je proces → chyba, nic k změně');
  fronta.push(nastroj('set_map_style', { map_id: 'Úklid dílny', style: 'project' }));
  r = await chatuj(A, { message: 'Změň Úklid dílny na projekt', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Změnit „Úklid dílny“ na projekt — vrátí se „% hotovo“ a po splnění všeho nabídka archivace. Kroky ani termíny se nemění, opakované kroky se opakují dál (už bez obnovy podkroků).', `karta přepnutí na projekt slovy okna editoru (${k && k.popis})`);
  r = await potvrd(A, chat.id, k.id); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await mapaZ(map.id)).kind === '', 'mapa je projekt');
  // v projektu nový rytmus bez obnovy podkroků (jako přepínač mimo proces), po přepnutí do procesu se obnova doplní
  fronta.push(nastroj('set_step_rhythm', { map_id: 'Úklid dílny', node_id: 'Vysát podlahu', freq: 'daily' }));
  r = await chatuj(A, { message: 'Vysát podlahu každý den', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  fronta.push(text('Hotovo.'));
  r = await potvrd(A, chat.id, k.id);
  let s2b = (await pravidla(map.id)).find((p) => p.node_id === 's2');
  expect(!!s2b && s2b.actions.length === 2, `v projektu rytmus bez reset_subtree (${s2b && JSON.stringify(s2b.actions)})`);
  fronta.push(nastroj('set_map_style', { map_id: 'Úklid dílny', style: 'process' }));
  r = await chatuj(A, { message: 'A teď zase proces', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && /^Změnit „Úklid dílny“ na proces — zmizí „% hotovo“/.test(k.popis), `karta přepnutí na proces (${k && k.popis})`);
  r = await potvrd(A, chat.id, k.id); chat = r.json.chat;
  s2b = (await pravidla(map.id)).find((p) => p.node_id === 's2');
  const s1b = (await pravidla(map.id)).find((p) => p.node_id === 's1');
  expect((await mapaZ(map.id)).kind === 'process' && s2b.actions.length === 3 && s2b.actions[2].type === 'reset_subtree' && s1b.actions.length === 3, `do procesu: čistá pravidla dostala obnovu podkroků, ostatní beze změny (${JSON.stringify(s2b.actions)})`);
  const vlastni = (await pravidla(map.id)).find((p) => p.name === 'Vlastní opakování');
  expect(!!vlastni && vlastni.actions.length === 1, 'ručně upravené pravidlo přepnutí stylu nezměnilo');

  mock.close();
});
