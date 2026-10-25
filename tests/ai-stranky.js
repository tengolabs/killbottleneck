// Stránky asistenta (14. 10. 2026) — API sada proti PODVRŽENÉ ollamě.
//
// Co hlídá: create_page jen ZADÁ (karta `stranka` jen s id, záznam „ceka“, model nedostane HTML), page writer
// (/chat/stranka/napsat) = jedno volání BEZ nástrojů s velkým num_predict → HTML z ```html bloku → „hotovo“,
// řádek ai_chat_log `page_writer` s tokeny; update_page → přepis s předchozí verzí → vratit; writer bez HTML →
// „chyba“ + Zkusit znovu; nástroje jen ve skupině `stranky` (klíčová slova / karta v historii); share_page /
// delete_page / revert_page přes kartu; limity KB_PAGE_KB / KB_PAGES_MAX / KB_PAGES=0; hybrid: lehký model předá
// → jeho stránka se vrátí; odpojený klient → stránka se dopíše; EN.
//
// 15. 10. 2026 (po klik-testu Richarda): writer píše PO ČÁSTECH (osnova JSON → kostra se značkami → části) a po každém
// kroku ukládá `prubeh` + `rozepsano` (panel ukazuje, co dělá); když model místo osnovy napíše rovnou celou stránku,
// bere se tak (záloha + staré chování). Přepis se značkami = jen změněné části. Jmenovité sdílení (shared_with):
// /chat/stranka/lide, share_page user_on/user_off, seznam „sdílené se mnou“.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-stranky.js
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const volani = [];
let zdrzeniWriteru = 0; // ms; writer = volání bez `tools`
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const nastroje = (...c) => ({ tool_calls: c.map(([name, args]) => ({ function: { name, arguments: args } })) });
const text = (s) => ({ content: s });
const HTML = (zn) => `<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>${zn}</title><style>body{font:16px system-ui}</style></head><body><h1>${zn}</h1><p>Obsah stránky ${zn}.</p><script>console.log('${zn}')</script></body></html>`;
const blok = (zn, pred) => text(`${pred || 'Here is the page:'}\n\`\`\`html\n${HTML(zn)}\n\`\`\`\n`);

const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  const b = JSON.parse(body);
  volani.push(b);
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  const odpoved = () => res.end(JSON.stringify({ message, prompt_eval_count: 1111, eval_count: 222, done: true }));
  if (!b.tools && zdrzeniWriteru) setTimeout(odpoved, zdrzeniWriteru); else odpoved();
};
const posledniVolani = () => volani[volani.length - 1];
const systemZ = (v) => (v.messages.find((m) => m.role === 'system') || {}).content || '';
const toolZ = (v) => v.messages.filter((m) => m.role === 'tool');
const karty = (chat, typ) => chat.messages.flatMap((m) => m.karty || []).filter((k) => k.type === typ);
const jmena = (v) => (v.tools || []).map((t) => t.function.name);

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const ENV = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600 };
  const inst = await H.startInstance({ slug: 'ai-stranky', addHostGateway: true, env: ENV });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const su = await inst.superuser();
  const stranky = async (tok, q) => (await inst.api('GET', '/api/kb/chat/stranky' + (q || ''), { token: tok })).json.stranky;
  const detail = async (tok, id) => (await inst.api('GET', `/api/kb/chat/stranka/${id}`, { token: tok })).json.stranka;
  const logy = async () => ((await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=100&sort=created', { token: su })).json.items || []);

  console.log('== skupina stranky: nástroje jen s klíčovým slovem ==');
  fronta.push(text('Ahoj.'));
  let r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Co mám dnes dělat?' } });
  expect(r.status === 200 && !jmena(posledniVolani()).includes('create_page'), 'bez klíčového slova create_page v nabídce není (úspora tokenů)');
  expect(/webovou stránku či prezentaci k nasdílení \(stranky\)/.test(systemZ(posledniVolani())), 'základ: katalog „Umíš i víc“ zná skupinu stranky');
  fronta.push(text('Hned.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej mi prezentaci pro zákazníka' } });
  let jm = jmena(posledniVolani());
  expect(['create_page', 'update_page', 'list_pages', 'get_page', 'share_page', 'delete_page', 'revert_page'].every((n) => jm.includes(n)), `„prezentaci“ otevře všech 7 nástrojů stránek (${jm.filter((n) => /page/.test(n)).join(',')})`);
  expect(/HTML sám nepiš/.test(systemZ(posledniVolani())) && /writer nevidí mapy ani rozhovor/.test(systemZ(posledniVolani())), 'fragment skupiny: HTML nepsat, fakta do content');
  const defC = posledniVolani().tools.find((t) => t.function.name === 'create_page').function;
  expect(/You do NOT write the HTML yourself/.test(defC.description) && defC.parameters.required.join() === 'title,brief', 'popis create_page: model HTML nepíše; povinné title + brief');

  console.log('== create_page = zadání (ceka) + karta jen s id; model nedostane HTML ==');
  fronta.push(nastroj('create_page', { title: 'Prezentace Q4', brief: 'Tři slajdy pro vedení: shrnutí, čísla, další kroky. Tmavý styl.', content: 'Tržby 12,4 mil. Kč (+8 %). Marže 31 %. Nový sklad od ledna.' }), text('Stránku píšu, za chvíli bude v panelu.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej mi prezentaci výsledků Q4 pro vedení' } });
  expect(r.status === 200, `POST /chat → 200 (${r.status})`);
  let chat = r.json.chat;
  const k1 = karty(chat, 'stranka')[0];
  expect(!!k1 && !!k1.page_id && k1.title === 'Prezentace Q4' && k1.stav === 'ceka' && k1.akce === 'nova' && !('html' in k1) && !('zadani' in k1), `karta stranka nese jen id, název, stav (${JSON.stringify(k1 || {})})`);
  expect(/queued; the app writes it now/.test(toolZ(posledniVolani()).pop().content) && /do not call create_page again/.test(toolZ(posledniVolani()).pop().content), 'model ví: stránka ve frontě, nevolat znovu');
  const id1 = k1.page_id;
  let s1 = await detail(A, id1);
  expect(s1.stav === 'ceka' && s1.html === '' && s1.chat === chat.id && s1.size_kb === 0, `záznam čeká na writer, bez HTML, zná rozhovor (${s1.stav}, chat ${s1.chat === chat.id})`);
  expect(volani.every((v) => !/<html/i.test(JSON.stringify(v.messages))), 'model nikdy nedostal HTML');
  const volaniPred = volani.length;

  console.log('== page writer: 1. volání = osnova (bez nástrojů); model napsal rovnou celou stránku → bere se, hotovo ==');
  fronta.push(blok('STR-Q4'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id1 } });
  expect(r.status === 200 && r.json.stranka && r.json.stranka.stav === 'hotovo' && /STR-Q4/.test(r.json.stranka.html), `napsat → 200 hotovo s HTML (${r.status} ${r.json.stranka && r.json.stranka.stav})`);
  expect(volani.length === volaniPred + 1, `celá stránka v odpovědi na osnovu = jediné volání modelu (${volani.length - volaniPred})`);
  const w = posledniVolani();
  expect(!w.tools && w.options && w.options.num_predict === 2000 && w.model === 'm-a', `osnova: bez nástrojů, num_predict 2000, hlavní model (${w.options && w.options.num_predict}, ${w.model})`);
  expect(/You plan a single-page HTML document/.test(systemZ(w)) && /Reply ONLY with one JSON object/.test(systemZ(w)), 'systém osnovy: JSON se seznamem částí');
  // grafika (25. 10. 2026): osnova přiděluje vizuál a ikonu, společná pravidla chtějí grafy inline SVG/CSS
  expect(/"visual": "stat-cards \| bars \| gantt/.test(systemZ(w)) && /Visuals are mandatory/.test(systemZ(w)), 'systém osnovy: pole visual + icon, grafika povinná');
  const u = w.messages.filter((m) => m.role === 'user').pop().content;
  expect(/Title: Prezentace Q4/.test(u) && /Tři slajdy pro vedení/.test(u) && /Tržby 12,4 mil/.test(u) && /Language of the page: Czech/.test(u), 'osnova dostala název, brief, fakta a jazyk');
  expect(w.messages.length === 2, 'writer nevidí rozhovor (jen systém + zadání)');
  s1 = await detail(A, id1);
  expect(s1.stav === 'hotovo' && /STR-Q4/.test(s1.html) && !s1.ma_predchozi && s1.chyba === '', 'detail: hotovo, bez předchozí verze');
  let log = await logy();
  const lw = log.filter((l) => l.tools === 'page_writer');
  expect(lw.length === 1 && lw[0].tokens_in === 1111 && lw[0].tokens_out === 222 && lw[0].calls === 1 && lw[0].chat === chat.id && lw[0].kredity > 0 && lw[0].stav === 'ok', `ai_chat_log: řádek page_writer s tokeny a kredity, k rozhovoru (${JSON.stringify(lw[0] && { in: lw[0].tokens_in, out: lw[0].tokens_out, kredity: lw[0].kredity, chat: lw[0].chat === chat.id })})`);
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id1 } });
  expect(r.status === 200 && volani.length === volaniPred + 1, 'napsat na hotové stránce = nic (žádné další volání modelu)');

  console.log('== karta v historii drží skupinu; update_page → přepis s předchozí verzí ==');
  fronta.push(nastroj('update_page', { page: 'Prezentace Q4', instructions: 'Přidej slajd s riziky: kapacita skladu.' }), text('Přepisuji.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Přidej tam ještě rizika' } });
  expect(jmena(volani[volani.length - 2]).includes('update_page'), '„přidej tam“ bez klíčového slova: skupinu drží karta stránky v historii');
  chat = r.json.chat;
  const k2 = karty(chat, 'stranka').pop();
  expect(k2 && k2.page_id === id1 && k2.akce === 'prepis' && k2.stav === 'ceka', `karta přepisu (${JSON.stringify(k2)})`);
  s1 = await detail(A, id1);
  expect(s1.stav === 'ceka' && /STR-Q4/.test(s1.html), 'přepis čeká, staré HTML zůstává jako náhled');
  // /checkup 25. 10. 2026: veřejný odkaz během přepisu NEZHASNE — platí poslední hotová verze (jako mapa při úpravě)
  r = await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id: id1, akce: 'zapnout' } });
  const tokP = r.json.stranka.share_token;
  const vp = await fetch(`${inst.base}/p/${tokP}`);
  expect(vp.status === 200 && /STR-Q4/.test(await vp.text()), `veřejný odkaz během přepisu (stav ceka) dál vrací poslední hotovou verzi (${vp.status})`);
  r = await inst.api('POST', '/api/kb/chat/stranka/vratit', { token: A, body: { id: id1 } });
  expect(r.status === 409, `Vrátit během psaní/čekání → 409 (${r.status})`);
  await inst.api('POST', '/api/kb/chat/stranka/sdilet', { token: A, body: { id: id1, akce: 'vypnout' } });
  fronta.push(blok('STR-Q4-V2'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id1 } });
  const uw = posledniVolani().messages.filter((m) => m.role === 'user').pop().content;
  expect(/Current page \(HTML\):/.test(uw) && /STR-Q4<\/title>/.test(uw) && /Requested changes:\s*\nPřidej slajd s riziky/.test(uw) && /return the WHOLE updated document/.test(uw), 'writer při přepisu dostal současné HTML + pokyny');
  s1 = await detail(A, id1);
  expect(s1.stav === 'hotovo' && /STR-Q4-V2/.test(s1.html) && s1.ma_predchozi, 'přepsáno, předchozí verze k dispozici');
  r = await inst.api('POST', '/api/kb/chat/stranka/vratit', { token: A, body: { id: id1 } });
  expect(/STR-Q4<\/title>/.test(r.json.stranka.html) && !/V2/.test(r.json.stranka.html), 'vrátit → původní verze');
  await inst.api('POST', '/api/kb/chat/stranka/vratit', { token: A, body: { id: id1 } });

  console.log('== list_pages / get_page: text bez tagů, nikdy HTML ==');
  fronta.push(nastroj('list_pages', {}), nastroj('get_page', { page: 'Prezentace Q4' }), text('Máš jednu stránku.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Jaké mám stránky?' } });
  const tl = toolZ(volani[volani.length - 2]).pop().content, tg = toolZ(posledniVolani()).pop().content;
  expect(/• Prezentace Q4 \(ready, not shared/.test(tl), `list_pages (${tl.split('\n').pop()})`);
  expect(/Status: ready/.test(tg) && /Obsah stránky STR-Q4-V2/.test(tg) && !/<h1>|<html|<script/.test(tg), 'get_page: text bez tagů, HTML ani skript ne');

  console.log('== share_page / revert_page / delete_page přes kartu ==');
  fronta.push(nastroj('share_page', { page: 'Prezentace Q4', action: 'link_on' }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Nasdílej ji odkazem' } });
  chat = r.json.chat;
  let kA = karty(chat, 'akce').pop();
  expect(kA && kA.name === 'share_page' && /Zapnout veřejný odkaz na stránku „Prezentace Q4“/.test(kA.popis), `karta: ${kA && kA.popis}`);
  expect((await detail(A, id1)).shared === false, 'před potvrzením nesdíleno');
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: kA.id, ok: true } });
  expect(r.status === 200, `potvrdit → 200 (${r.status})`);
  let d = await detail(A, id1);
  expect(d.shared === true && /^[a-z0-9]{32}$/.test(d.share_token), 'po potvrzení veřejný odkaz zapnutý');
  const vys = karty(r.json.chat, 'akce').find((k) => k.id === kA.id);
  expect(vys && vys.stav === 'hotovo' && vys.odkaz && vys.odkaz.odkaz && vys.odkaz.odkaz.type === 'stranka' && vys.odkaz.odkaz.page_id === id1, `karta akce po potvrzení nese odkaz na stránku (${JSON.stringify(vys && vys.odkaz)})`);
  expect(!volani.slice(-3).some((v) => JSON.stringify(v.messages).includes(d.share_token)), 'token se do modelu nedostal');
  fronta.push(nastroj('share_page', { page: 'Prezentace Q4', action: 'link_on' }), text('Už je zapnutý.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Zapni odkaz' } });
  expect(/already on/.test(toolZ(posledniVolani()).pop().content) && !karty(r.json.chat, 'akce').slice(-1).some((k) => k.name === 'share_page' && k.stav === 'ceka'), 'link_on podruhé = chyba modelu před kartou');
  fronta.push(nastroj('share_page', { page: 'Prezentace Q4', action: 'team_on' }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Ať to vidí tým' } });
  kA = karty(r.json.chat, 'akce').pop();
  expect(/Zviditelnit stránku „Prezentace Q4“ pro celý tým/.test(kA.popis), 'karta team_on');
  await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: kA.id, ok: true } });
  expect((await stranky(B, '?skupina=tym')).some((s) => s.id === id1 && s.owner_name === 'Petr'), 'člen vidí stránku v týmu');
  fronta.push(nastroj('revert_page', { page: 'Prezentace Q4' }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Vrať předchozí verzi' } });
  kA = karty(r.json.chat, 'akce').pop();
  expect(/Vrátit předchozí verzi stránky/.test(kA.popis), 'karta revert_page');
  await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: kA.id, ok: true } });
  expect(/STR-Q4<\/title>/.test((await detail(A, id1)).html), 'revert_page vrátil verzi');
  fronta.push(nastroj('delete_page', { page: 'Prezentace Q4' }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Smaž tu stránku' } });
  kA = karty(r.json.chat, 'akce').pop();
  expect(/Smazat stránku „Prezentace Q4“ — nejde vrátit/.test(kA.popis), 'karta delete_page');
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: kA.id, ok: true } });
  expect(r.status === 200 && (await stranky(A)).length === 0, 'smazáno po potvrzení');
  expect(r.json.chat.messages.slice(-1)[0].content && !fronta.length, 'potvrzení dopověděla aplikace (POTVRZENI_APLIKACE), ne model');

  console.log('== writer bez HTML → chyba; Zkusit znovu ==');
  fronta.push(nastroj('create_page', { title: 'Ceník', brief: 'Tabulka cen.' }), text('Píšu.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej stránku s ceníkem' } });
  const id2 = karty(r.json.chat, 'stranka').pop().page_id;
  fronta.push(text('Omlouvám se, ale neumím psát HTML.'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id2 } });
  expect(r.status === 502 && /použitelnou HTML/.test(r.json.error) && r.json.stranka.stav === 'chyba', `bez html bloku → 502 + stav chyba (${r.status} ${r.json.error})`);
  d = await detail(A, id2);
  expect(d.stav === 'chyba' && /použitelnou HTML/.test(d.chyba) && d.html === '', 'záznam: chyba s hláškou, bez HTML');
  log = await logy();
  expect(log.some((l) => l.tools === 'page_writer' && l.stav === 'chyba' && l.kredity === 0), 'chybný tah writeru v logu bez kreditů');
  fronta.push(blok('STR-CENIK', 'Sure:'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id2 } });
  expect(r.status === 200 && r.json.stranka.stav === 'hotovo', 'Zkusit znovu → hotovo');
  fronta.push(nastroj('create_page', { title: 'Holé', brief: 'x' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'ještě jednu stránku' } });
  const id3 = karty(r.json.chat, 'stranka').pop().page_id;
  fronta.push(text('<html><body>bez bloku a bez doctype</body></html>'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id3 } });
  expect(r.status === 200 && /bez bloku a bez doctype/.test(r.json.stranka.html), 'HTML bez fenced bloku se taky vezme (od <html po </html>)');
  fronta.push(nastroj('update_page', { page: 'Neexistuje', instructions: 'x' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'uprav stránku Neexistuje' } });
  expect(/not found \(use list_pages/.test(toolZ(posledniVolani()).pop().content), 'update_page neznámé stránky = chyba modelu');

  console.log('== dvojník v tahu, prázdné brief, cizí stránka ==');
  fronta.push(nastroje(['create_page', { title: 'Dvojník', brief: 'první' }], ['create_page', { title: 'Dvojník', brief: 'druhý, lepší' }]), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'stránka dvojník' } });
  const dv = (await stranky(A)).filter((s) => s.title === 'Dvojník');
  expect(dv.length === 1, `stejný název dvakrát v tahu = jedna stránka (${dv.length})`);
  fronta.push(nastroj('create_page', { title: 'Bez zadání', brief: '' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'stránka bez zadání' } });
  expect(/Error: brief is required/.test(toolZ(posledniVolani()).pop().content), 'prázdné brief = chyba modelu');
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: B, body: { id: id2 } });
  expect(r.status === 404, `člen nemůže psát cizí stránku (404, ${r.status})`);

  console.log('== odpojený klient: writer doběhne a stránka se dopíše ==');
  fronta.push(nastroj('create_page', { title: 'Dlouhá', brief: 'dlouhé psaní' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'stránka dlouhá' } });
  const id4 = karty(r.json.chat, 'stranka').pop().page_id;
  zdrzeniWriteru = 2500;
  fronta.push(blok('STR-DLOUHA'));
  const ac = new AbortController();
  const odpojeny = fetch(`${inst.base}/api/kb/chat/stranka/napsat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: A }, body: JSON.stringify({ id: id4 }), signal: ac.signal }).catch(() => 'abort');
  await H.sleep(400); ac.abort();
  expect((await odpojeny) === 'abort', 'klient odpojil po 0,4 s');
  d = await detail(A, id4);
  expect(d.stav === 'pise', `mezitím stav „pise“ (${d.stav})`);
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id4 } });
  expect(r.status === 409, `druhé napsat během psaní → 409 (${r.status})`);
  d = await H.waitFor(async () => { const x = await detail(A, id4); return x.stav === 'hotovo' ? x : null; }, { timeout: 8000, popis: 'dopsání' });
  expect(/STR-DLOUHA/.test(d.html), 'stránka se dopsala i bez klienta (realtime ji doručí panelu)');
  zdrzeniWriteru = 0;

  console.log('== psaní PO ČÁSTECH: osnova JSON → kostra se značkami → části; prubeh + rozepsano během psaní ==');
  fronta.push(nastroj('create_page', { title: 'Po částech', brief: 'Přehled pro tým.', content: 'Dílna: 5 kroků. Rozpočet 1,2 mil.' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'stránka po částech' } });
  const id5 = karty(r.json.chat, 'stranka').pop().page_id;
  const KOSTRA = '<!doctype html>\n<html lang="cs"><head><meta charset="utf-8"><title>Po částech</title><style>body{font:16px system-ui}.karta{border:1px solid #ccc}</style></head><body><header><h1>Po částech</h1></header><main>\n<section id="sec-uvod"><!--SEKCE:uvod--></section>\n<section id="sec-cisla"><!--SEKCE:cisla--></section>\n</main><footer>KB</footer></body></html>';
  fronta.push(text('{"style": "světlý, karty", "sections": [{"id": "uvod", "heading": "Úvod", "icon": "🏭", "visual": "stat-cards", "content": "Dílna: 5 kroků"}, {"id": "cisla", "heading": "Čísla", "visual": "nesmysl", "content": "Rozpočet 1,2 mil."}]}'),
    text('```html\n' + KOSTRA + '\n```'),
    text('```html\n<h2>Úvod</h2><p class="karta">CAST-UVOD: 5 kroků</p>\n```'),
    text('Here:\n```html\n<section><h2>Čísla</h2><p>CAST-CISLA: 1,2 mil.</p></section>\n```'));
  zdrzeniWriteru = 500;
  const predC = volani.length;
  const bezici = fetch(`${inst.base}/api/kb/chat/stranka/napsat`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: A }, body: JSON.stringify({ id: id5 }) }).then((x) => x.json());
  const stavy = [];
  for (let i = 0; i < 40; i++) { await H.sleep(120); const x = await detail(A, id5); stavy.push(x); if (x.stav === 'hotovo' || x.stav === 'chyba') break; }
  const rv = await bezici;
  zdrzeniWriteru = 0;
  expect(rv.stranka && rv.stranka.stav === 'hotovo', `po částech → hotovo (${rv.stranka && rv.stranka.stav} ${rv.error || ''})`);
  expect(volani.length - predC === 4, `4 volání modelu: osnova, kostra, 2 části (${volani.length - predC})`);
  const vol = volani.slice(predC);
  expect(/visual toolkit/.test(systemZ(vol[1])) && /VISUAL FIRST/.test(systemZ(vol[1])) && /- uvod — Úvod — stat-cards\n- cisla — Čísla\n/.test(vol[1].messages[vol[1].messages.length - 1].content), 'kostra: sada CSS pro grafy, plánovaný vizuál u části (neznámý typ se zahodí)');
  expect(/THIS STEP: write the page SKELETON only/.test(systemZ(vol[1])) && /<!--SEKCE:<id>-->/.test(systemZ(vol[1])) && /- uvod — Úvod/.test(vol[1].messages.pop().content), 'kostra: systém kostry + seznam částí');
  const uS = vol[2].messages.pop().content;
  expect(/DRAW the planned visual/.test(systemZ(vol[2])) && /Icon for the heading: 🏭/.test(uS) && /Planned visual: stat-cards/.test(uS), 'část: dostane ikonu a plánovaný vizuál, systém chce graf inline SVG/CSS');
  expect(/You write ONE section/.test(systemZ(vol[2])) && /Section to write: id "uvod", heading "Úvod"/.test(uS) && /<!--SEKCE:uvod-->/.test(uS) && /Rozpočet 1,2 mil/.test(uS), 'část: dostane kostru se značkami, zadání části a všechna fakta');
  const uS2 = vol[3].messages.pop().content;
  expect(/<!--SEKCE:uvod-->/.test(uS2) && !/CAST-UVOD/.test(uS2) && /Other sections of the page[^\n]*Úvod/.test(uS2), 'druhá část: kostra BEZ už napsané části (stejný prefix), jen nadpisy ostatních');
  const h5 = (await detail(A, id5)).html;
  expect(/<!--sekce:uvod-->\s*<h2>Úvod<\/h2><p class="karta">CAST-UVOD/.test(h5) && /<!--\/sekce:uvod-->/.test(h5) && /<!--sekce:cisla-->\s*<h2>Čísla<\/h2>/.test(h5) && !/<!--SEKCE:/.test(h5) && !/<section><h2>Čísla/.test(h5), 'složeno: části mezi značkami, obal <section> z odpovědi pryč, žádná prázdná značka');
  const behem = stavy.filter((x) => x.stav === 'pise');
  expect(behem.length >= 2 && behem.some((x) => x.prubeh && x.prubeh.kroky && x.prubeh.kroky.some((k) => k.s === 'bezi')), `během psaní detail nese prubeh.kroky s běžícím krokem (${behem.length} snímků)`);
  const sKostrou = behem.find((x) => x.rozepsano && /<!--SEKCE:cisla-->/.test(x.rozepsano));
  expect(!!sKostrou && sKostrou.prubeh.kroky.map((k) => `${k.k}:${k.s}`).join(',').startsWith('osnova:hotovo,kostra:hotovo,sekce:'), `rozepsané HTML po kostře nese značky a kroky osnova→kostra→části (${sKostrou && sKostrou.prubeh.kroky.map((k) => `${k.k}:${k.s}`).join(',')})`);
  expect(behem.some((x) => x.prubeh && x.prubeh.kroky.length === 4 && x.prubeh.kroky[2].k === 'sekce' && x.prubeh.kroky[2].t === 'Úvod' && x.prubeh.kroky[3].t === 'Čísla' && x.prubeh.kroky[0].info === 2), 'kroky dopředu po osnově: osnova (2 části), kostra, Úvod, Čísla');
  const hot5 = await detail(A, id5);
  expect(hot5.rozepsano === undefined && hot5.prubeh === undefined, 'po dopsání detail prubeh/rozepsano nenese (jen během psaní)');
  log = await logy();
  const lw5 = log.filter((l) => l.tools === 'page_writer').pop();
  expect(lw5.calls === 4 && lw5.tokens_in === 4444 && lw5.tokens_out === 888, `log: 4 volání, tokeny sečtené (${lw5.calls}, ${lw5.tokens_in}/${lw5.tokens_out})`);


  console.log('== strop souběžných writerů na uživatele (2) + restart uprostřed psaní → chyba s radou (/checkup 25. 10. 2026) ==');
  const rPredSoubehem = r; // další sekce čte r.json.chat.id z tahu stránky „Po částech“
  const idsS = [];
  for (const n of [1, 2, 3, 4]) {
    fronta.push(nastroj('create_page', { title: `Souběh ${n}`, brief: 'test', content: 'x' }), text('ok'));
    r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: `Udělej mi stránku Souběh ${n}` } });
    idsS.push(karty(r.json.chat, 'stranka').pop().page_id);
  }
  zdrzeniWriteru = 2500;
  fronta.push(blok('SOUBEH-1'), blok('SOUBEH-2'), blok('SOUBEH-3'));
  const rs = await Promise.all(idsS.slice(0, 3).map((id) => inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id } })));
  const stavyS = rs.map((x) => x.status).sort();
  expect(stavyS.join(",") === "200,200,429" && /2 vašich stránek/.test(rs.find((x) => x.status === 429).json.error), `3 writery naráz → 2× 200 + 1× 429 s hláškou (${stavyS.join(",")})`);
  const idTreti = idsS[rs.findIndex((x) => x.status === 429)];
  expect((await detail(A, idTreti)).stav === 'ceka', 'odmítnutá stránka zůstala ve frontě (ceka)');
  zdrzeniWriteru = 0;
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: idTreti } });
  expect(r.status === 200 && r.json.stranka.stav === 'hotovo', 'po doběhnutí ostatních se napíše (čítač se uvolnil)');
  // restart PocketBase uprostřed psaní: zámek ve store zmizí, záznam by zůstal „pise“ → po startu chyba + Zkusit znovu
  zdrzeniWriteru = 5000;
  fronta.push(blok('RESTART-1'));
  const slib = inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: idsS[3] } }).catch(() => ({ status: 0 }));
  await H.sleep(900);
  expect((await detail(A, idsS[3])).stav === 'pise', 'před restartem se stránka píše');
  await inst.restart();
  await slib;
  zdrzeniWriteru = 0;
  const poR = await detail(A, idsS[3]);
  expect(poR.stav === 'chyba' && /restart/i.test(poR.chyba || ''), `po restartu: chyba „přerušil restart“, ne věčné „pise“ (${poR.stav}: ${poR.chyba})`);
  fronta.push(blok('RESTART-2'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: idsS[3] } });
  expect(r.status === 200 && /RESTART-2/.test(r.json.stranka.html), 'Zkusit znovu po restartu projde');
  r = rPredSoubehem;

  console.log('== přepis stránky se značkami: osnova přepisu → jen změněné části (keep / rewrite / new / delete) ==');
  fronta.push(nastroj('update_page', { page: 'Po částech', instructions: 'Přidej rizika a přepiš čísla.' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'přidej rizika' } });
  const chatP = r.json.chat.id; // karta stránky v historii drží skupinu stranky i bez klíčového slova
  const predU = volani.length;
  fronta.push(text('{"skeleton": "keep", "sections": [{"id": "uvod", "action": "keep", "heading": "Úvod"}, {"id": "cisla", "action": "rewrite", "heading": "Čísla", "content": "Rozpočet 1,2 mil., čerpáno 0,4"}, {"id": "rizika", "action": "new", "heading": "Rizika", "content": "kapacita"}]}'),
    text('```html\n<h2>Čísla</h2><p>CAST-CISLA-V2</p>\n```'), text('```html\n<h2>Rizika</h2><p>CAST-RIZIKA</p>\n```'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id5 } });
  expect(r.status === 200 && volani.length - predU === 3, `přepis: osnova + 2 části = 3 volání (${volani.length - predU})`);
  const uP = volani[predU].messages.pop().content;
  // /checkup 25. 10. 2026: modelu nejde celé HTML, jen kostra (části jako značky) + textové výtahy částí
  expect(/You plan CHANGES to an existing/.test(systemZ(volani[predU])) && /Current page SKELETON/.test(uP) && /<!--SEKCE:uvod-->/.test(uP) && /<!--SEKCE:cisla-->/.test(uP) && /- cisla — [^\n]*CAST-CISLA/.test(uP) && !/<p>CAST-CISLA/.test(uP) && /Requested changes:\s*\nPřidej rizika/.test(uP), 'osnova přepisu dostala kostru se značkami a výtahy částí (ne celé HTML) + pokyny');
  const uR = volani[predU + 1].messages.pop().content;
  expect(/Current content of this section \(rewrite it/.test(uR) && /CAST-CISLA: 1,2/.test(uR) && /Requested changes:\s*\nPřidej rizika/.test(uR), 'přepisovaná část dostane svůj starý obsah + pokyny');
  const h5b = r.json.stranka.html;
  expect(/CAST-UVOD: 5 kroků/.test(h5b) && /CAST-CISLA-V2/.test(h5b) && !/CAST-CISLA: 1,2/.test(h5b) && /<section id="sec-rizika"><!--sekce:rizika-->\s*<h2>Rizika<\/h2><p>CAST-RIZIKA/.test(h5b) && h5b.indexOf('sec-rizika') < h5b.indexOf('</main>'), 'ponechaná část beze změny, přepsaná nová, nová část přidaná do <main>');
  expect(r.json.stranka.ma_predchozi && /CAST-CISLA: 1,2/.test((await inst.api('POST', '/api/kb/chat/stranka/vratit', { token: A, body: { id: id5 } })).json.stranka.html), 'předchozí verze k dispozici (vrátit)');
  await inst.api('POST', '/api/kb/chat/stranka/vratit', { token: A, body: { id: id5 } });
  fronta.push(nastroj('update_page', { page: 'Po částech', instructions: 'Smaž rizika.' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chatP, message: 'smaž rizika' } });
  expect(karty(r.json.chat, 'stranka').pop().akce === 'prepis', 'update_page bez klíčového slova prošel (skupinu drží karta v historii)');
  fronta.push(text('{"skeleton": "keep", "sections": [{"id": "uvod", "action": "keep"}, {"id": "cisla", "action": "keep"}, {"id": "rizika", "action": "delete"}]}'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id5 } });
  expect(r.status === 200 && !/CAST-RIZIKA/.test(r.json.stranka.html) && !/sec-rizika/.test(r.json.stranka.html) && /CAST-UVOD/.test(r.json.stranka.html), 'delete: celá <section> pryč, ostatní zůstaly, bez dalšího volání modelu');
  fronta.push(nastroj('update_page', { page: 'Po částech', instructions: 'Udělej to tmavé.' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chatP, message: 'ztmav stránku po částech' } });
  fronta.push(text('{"skeleton": "rewrite", "sections": [{"id": "uvod", "action": "keep"}, {"id": "cisla", "action": "keep"}]}'),
    text('```html\n<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Tmavá</title><style>body{background:#111}</style></head><body><main><section id="sec-uvod"><!--SEKCE:uvod--></section></main></body></html>\n```'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: A, body: { id: id5 } });
  const h5c = r.json.stranka.html;
  expect(r.status === 200 && /background:#111/.test(h5c) && /<!--sekce:uvod-->\s*<h2>Úvod/.test(h5c) && /<section id="sec-cisla"><!--sekce:cisla-->\s*<h2>Čísla/.test(h5c), 'skeleton rewrite: nová kostra, zachované části vložené zpět (chybějící značku kostry doplní aplikace)');

  console.log('== jmenovité sdílení (shared_with): /chat/stranka/lide, seznam „sdílené se mnou“, share_page user_on/off ==');
  const idB = (await inst.api('GET', '/api/collections/users/records?filter=email%3D%27clen%40example.com%27', { token: su })).json.items[0].id;
  r = await inst.api('POST', '/api/kb/chat/stranka/lide', { token: A, body: { id: id5, akce: 'pridat', user: idB } });
  expect(r.status === 200 && r.json.stranka.lide === 1 && r.json.stranka.shared_with.length === 1 && r.json.stranka.shared_with[0].email === 'clen@example.com' && r.json.stranka.shared_with[0].name === 'Jana', `pridat podle id → shared_with se jménem (${JSON.stringify(r.json.stranka.shared_with)})`);
  r = await inst.api('POST', '/api/kb/chat/stranka/lide', { token: A, body: { id: id5, akce: 'pridat', user: 'CLEN@example.com' } });
  expect(r.status === 200 && r.json.stranka.shared_with.length === 1, 'pridat podle e-mailu (velká písmena) = stejný člověk, bez duplicity');
  let sdil = (await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: B })).json.stranky;
  expect(sdil.length === 1 && sdil[0].id === id5 && sdil[0].owner_name === 'Petr' && !('share_token' in sdil[0]) && sdil[0].lide === 0, 'člen vidí jmenovitě nasdílenou stránku v „sdílené se mnou“ (bez tokenu, bez počtu lidí)');
  r = await inst.api('GET', `/api/kb/chat/stranka/${id5}`, { token: B });
  expect(r.status === 200 && /CAST-UVOD/.test(r.json.stranka.html) && !('shared_with' in r.json.stranka), 'člen stránku otevře; seznam lidí vidí jen vlastník');
  const C2 = await (async () => { await inst.register('treti@example.com', { name: 'Třetí' }); return inst.login('treti@example.com'); })();
  expect((await inst.api('GET', `/api/kb/chat/stranka/${id5}`, { token: C2 })).status === 404, 'jiný člen (nevybraný) stránku nevidí (404)');
  r = await inst.api('POST', '/api/kb/chat/stranka/lide', { token: A, body: { id: id5, akce: 'pridat', user: 'nikdo@example.com' } });
  expect(r.status === 400 && /Takový člen tu není/.test(r.json.error), `neznámý e-mail → 400 s hláškou (${r.json.error})`);
  r = await inst.api('POST', '/api/kb/chat/stranka/lide', { token: A, body: { id: id5, akce: 'pridat', user: 'admin@example.com' } });
  expect(r.status === 400 && /Sami sobě/.test(r.json.error), 'sobě sdílet nejde');
  expect((await inst.api('POST', '/api/kb/chat/stranka/lide', { token: B, body: { id: id5, akce: 'pridat', user: 'treti@example.com' } })).status === 404, 'člen nemůže sdílet cizí stránku dál (404)');
  const ex = (await inst.api('GET', '/api/kb/export', { token: A })).json;
  const exP = (ex.pages || []).find((p) => p.title === 'Po částech');
  expect(!!exP && !('shared_with' in exP) && !('share_token' in exP), 'export: stránka ano, seznam lidí ani token ne');
  fronta.push(nastroj('share_page', { page: 'Po částech', action: 'user_on', email: 'treti@example.com' }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'nasdílej stránku po částech Třetímu' } });
  kA = karty(r.json.chat, 'akce').pop();
  expect(kA && kA.name === 'share_page' && /Nasdílet stránku „Po částech“ členovi treti@example.com/.test(kA.popis), `share_page user_on = karta k potvrzení (${kA && kA.popis})`);
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: r.json.chat.id, action_id: kA.id, ok: true } });
  expect(r.status === 200 && (await inst.api('GET', `/api/kb/chat/stranka/${id5}`, { token: C2 })).status === 200, 'po potvrzení třetí člen stránku vidí');
  const vysU = karty(r.json.chat, 'akce').find((k) => k.id === kA.id);
  expect(vysU && vysU.stav === 'hotovo' && vysU.odkaz && vysU.odkaz.odkaz && vysU.odkaz.odkaz.page_id === id5, 'karta po potvrzení nese odkaz na stránku');
  fronta.push(nastroj('share_page', { page: 'Po částech', action: 'user_on', email: 'treti@example.com' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'ještě jednou' } });
  expect(/already shared with treti@example.com/.test(toolZ(posledniVolani()).pop().content), 'user_on podruhé = chyba modelu, bez karty');
  fronta.push(nastroj('share_page', { page: 'Po částech', action: 'user_on', email: 'cizi@example.com' }), text('.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'nasdílej cizímu' } });
  expect(/no member with e-mail "cizi@example.com"/.test(toolZ(posledniVolani()).pop().content), 'user_on neznámý e-mail = chyba modelu (list_people)');
  fronta.push(nastroj('share_page', { page: 'Po částech', action: 'user_off', email: 'clen@example.com' }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'odeber Janě' } });
  kA = karty(r.json.chat, 'akce').pop();
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: r.json.chat.id, action_id: kA.id, ok: true } });
  expect((await inst.api('GET', `/api/kb/chat/stranka/${id5}`, { token: B })).status === 404, 'user_off → člen už stránku nevidí');
  r = await inst.api('POST', '/api/kb/chat/stranka/lide', { token: A, body: { id: id5, akce: 'odebrat', user: 'treti@example.com' } });
  expect(r.status === 200 && r.json.stranka.shared_with.length === 0 && (await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: C2 })).json.stranky.length === 0, 'odebrat → nikdo, seznam prázdný');

  console.log('== limity: KB_PAGE_KB=1 → writer přinese moc → chyba; KB_PAGES_MAX=1 → model dostane plno; KB_PAGES=0 ==');
  const instL = await H.startInstance({ slug: 'ai-stranky-limity', addHostGateway: true, env: Object.assign({}, ENV, { KB_PAGE_KB: 1, KB_PAGES_MAX: 1, KB_PAGE_NUM_PREDICT: 777 }) });
  await instL.register('l@example.com', { name: 'L' }); const LT = await instL.login('l@example.com');
  fronta.push(nastroj('create_page', { title: 'Velká', brief: 'velká' }), text('.'));
  r = await instL.api('POST', '/api/kb/chat', { token: LT, body: { message: 'stránka velká' } });
  const idL = karty(r.json.chat, 'stranka').pop().page_id;
  fronta.push(text('```html\n' + HTML('VELKA') + '<!--' + 'x'.repeat(1200) + '-->\n```'));
  r = await instL.api('POST', '/api/kb/chat/stranka/napsat', { token: LT, body: { id: idL } });
  expect(r.status === 502 && /max 1 kB/.test(r.json.error) && posledniVolani().options.num_predict === 777, `HTML nad limit → chyba s limitem, num_predict z env (${r.status} ${r.json.error})`);
  fronta.push(nastroj('create_page', { title: 'Druhá', brief: 'x' }), text('.'));
  r = await instL.api('POST', '/api/kb/chat', { token: LT, body: { message: 'ještě stránka' } });
  expect(/page limit \(1\) is full — tell the user to delete old pages/.test(toolZ(posledniVolani()).pop().content), 'strop počtu: model dostane pravý důvod');
  const instO = await H.startInstance({ slug: 'ai-stranky-off', addHostGateway: true, env: Object.assign({}, ENV, { KB_PAGES: 0 }) });
  await instO.register('o@example.com', { name: 'O' }); const OT = await instO.login('o@example.com');
  fronta.push(text('.'));
  r = await instO.api('POST', '/api/kb/chat', { token: OT, body: { message: 'Udělej mi prezentaci' } });
  expect(!jmena(posledniVolani()).some((n) => /page/.test(n)), 'KB_PAGES=0: nástroje stránek se nenabízejí ani s klíčovým slovem');

  console.log('== hybrid: lehký model tah předá → jeho stránka se vrátí ==');
  const instHy = await H.startInstance({ slug: 'ai-stranky-hybrid', addHostGateway: true, env: Object.assign({}, ENV, {
    KB_CHAT_LIGHT_PROVIDER: 'ollama', KB_CHAT_LIGHT_URL: mock.base, KB_CHAT_LIGHT_MODEL: 'm-light', KB_CHAT_HYBRID: 'klasifikator,predani',
  }) });
  await instHy.register('hy@example.com', { name: 'Hy' }); const HY = await instHy.login('hy@example.com');
  const pred = volani.length;
  fronta.push(text('{"zapis": false}'),
    nastroje(['create_page', { title: 'LEHKA-STRANKA', brief: 'lehký' }], ['add_idea_to_map', { idea_id: 'x', map_id: 'y' }]),
    nastroj('create_page', { title: 'HLAVNI-STRANKA', brief: 'hlavní' }), text('Hotovo.'));
  r = await instHy.api('POST', '/api/kb/chat', { token: HY, body: { message: 'udělej stránku a vlož nápad' } });
  expect(volani.slice(pred).map((v) => v.model).join(',') === 'm-light,m-light,m-a,m-a', `klasifikátor + lehký → předáno hlavnímu (${volani.slice(pred).map((v) => v.model).join(',')})`);
  const hyS = (await instHy.api('GET', '/api/kb/chat/stranky', { token: HY })).json.stranky.map((x) => x.title);
  expect(hyS.join() === 'HLAVNI-STRANKA', `po předání zůstala jen stránka hlavního modelu (${hyS.join(' | ')})`);

  console.log('== EN ==');
  await inst.register('en@example.com', { name: 'Ann', language: 'en' });
  const EN = await inst.login('en@example.com');
  fronta.push(nastroj('create_page', { title: 'Landing', brief: 'One-pager.' }), text('Writing it.'));
  r = await inst.api('POST', '/api/kb/chat', { token: EN, body: { message: 'Make me a landing page' } });
  expect(/Never write the HTML yourself/.test(systemZ(volani[volani.length - 2])), 'EN fragment skupiny');
  const idE = karty(r.json.chat, 'stranka').pop().page_id;
  fronta.push(text('No block here.'));
  r = await inst.api('POST', '/api/kb/chat/stranka/napsat', { token: EN, body: { id: idE } });
  expect(/Language of the page: English/.test(posledniVolani().messages.pop().content) && /did not return a usable HTML page/.test(r.json.error), `EN writer + EN hláška (${r.json.error})`);
  void mock;
}, { nazev: 'AI-STRANKY' });
