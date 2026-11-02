// Kancelář v asistentovi (14. 10. 2026) — API sada proti PODVRŽENÉ ollamě.
//
// Co hlídá: draft_presentation → dokument druhu presentation (+ meta, karta `soubor` s PPTX/PDF), chybná osnova
// a stropy (20 snímků / 8 odrážek) = chyba PRO MODEL (nic se neuloží), draft_card → dokument card s šablonou,
// datem, místem, odkazem (jen http(s)), dvojník v témž tahu přepíše první dokument, skupina `kancelar` podle
// klíčových slov i open_tools (fragment promptu jen s otevřenou skupinou), režim kancelar = formulář od aplikace
// bez volání modelu, routy: meta v DTO, úprava meta z panelu (whitelist šablon, barva, odkaz), vrácení verze vrací
// i meta, filtr skupiny kancelar, cizí dokument 404, update_document osnovy drží meta.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-kancelar.js
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
const posledni = () => volani[volani.length - 1];
const systemZ = (v) => (v.messages.find((m) => m.role === 'system') || {}).content || '';
const toolZ = (v) => v.messages.filter((m) => m.role === 'tool');
const nastrojeZ = (v) => (v.tools || []).map((t) => t.function.name);
const karty = (chat, typ) => chat.messages.flatMap((m) => m.karty || []).filter((k) => k.type === typ);
const OSNOVA = '# Kuchyň Novákovi\nStav pro klienta\n## Cíl\n- Linka do 30. 11.\n- Dub masiv\n> Cena bez spotřebičů.\n## Kde jsme\n- Návrh hotový\n- Materiál objednán\n## Další kroky\n- 5. 11. montáž korpusů';

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'kancelar', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
  } });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Kuchyň Novákovi', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, 'mapa založena');

  console.log('== skupina kancelar podle klíčového slova + draft_presentation ==');
  fronta.push(nastroj('draft_presentation', { title: 'Kuchyň Novákovi', subtitle: 'Stav pro klienta', audience: 'klient', map: 'Kuchyň Novákovi', text: OSNOVA }), text('Prezentace je v dokumentech.'));
  let r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci projektu Kuchyň Novákovi pro klienta' } });
  expect(r.status === 200, `POST /chat → 200 (${r.status})`);
  let chat = r.json.chat;
  const v1 = volani[0];
  expect(nastrojeZ(v1).includes('draft_presentation') && nastrojeZ(v1).includes('draft_card'), `„prezentaci“ otevře skupinu kancelar (nástroje: ${nastrojeZ(v1).filter((n) => /draft/.test(n)).join(',')})`);
  expect(/draft_presentation — PowerPoint a PDF ke stažení/.test(systemZ(v1)) && /draft_card/.test(systemZ(v1)) && /create_page ze skupiny stranky/.test(systemZ(v1)), 'systém nese fragment skupiny kancelar (formát osnovy, přání, rozlišení soubor × Stránka)');
  expect(/NEJSOU draft_text/.test(systemZ(v1)) && /\(kancelar\)/.test(systemZ(v1)), 'základ promptu: prezentace/přání nejsou draft_text + katalog zná skupinu kancelar');
  const ks = karty(chat, 'soubor');
  expect(ks.length === 1 && ks[0].druh === 'presentation' && !!ks[0].doc_id && ks[0].pocet === 3 && JSON.stringify(ks[0].formaty) === '["pptx","pdf"]' && ks[0].map_id === map.id, `karta soubor: prezentace, 3 snímky, PPTX+PDF, doc_id, mapa (${JSON.stringify(ks[0] || {}).slice(0, 200)})`);
  expect(/saved to the user's Documents \(kind presentation, 3 slides\)/.test(toolZ(posledni()).pop().content), 'model ví: uloženo, 3 snímky, karta nabízí PPTX a PDF');
  let dok = (await inst.api('GET', `/api/kb/chat/dokument/${ks[0].doc_id}`, { token: A })).json.dokument;
  expect(dok.kind === 'presentation' && dok.text === OSNOVA && dok.map === map.id && dok.meta && dok.meta.subtitle === 'Stav pro klienta' && dok.meta.audience === 'klient' && dok.meta.lang === 'cs', `dokument: druh presentation, osnova 1:1, mapa, meta podtitul/publikum/jazyk (${JSON.stringify(dok.meta)})`);
  const prezId = ks[0].doc_id;

  console.log('== čip „Udělat z toho prezentaci“ po přečtení mapy přidá aplikace (model ho nenabízel) ==');
  fronta.push(nastroj('get_map', { map_id: map.id }), text('Projekt má jeden cíl, nic nehoří.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Shrň mi stav projektu Kuchyň Novákovi' } });
  const kartyTahu = (chat, typ) => chat.messages.slice(chat.messages.map((m) => m.role).lastIndexOf('user') + 1).flatMap((m) => m.karty || []).filter((k) => k.type === typ);
  expect(!/^Error/.test(toolZ(posledni()).pop().content), 'get_map v mocku prošel (správný argument map_id)');
  let navrhy = kartyTahu(r.json.chat, 'navrhy');
  expect(navrhy.length === 1 && navrhy[0].items.includes('Udělat z toho prezentaci') && navrhy[0].items.includes('Co dál?'), `po sumáři z get_map: čipy „Co dál?“ + „Udělat z toho prezentaci“ (${JSON.stringify((navrhy[0] || {}).items)})`);
  // /checkup 2. 11. 2026: čip jen JEDNOU za rozhovor — druhé čtení mapy ve stejném rozhovoru ho už nepřidá
  fronta.push(nastroj('get_map', { map_id: map.id }), text('Pořád stejné.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'A co termíny?', chat_id: r.json.chat.id } });
  expect(kartyTahu(r.json.chat, 'navrhy').every((k) => !k.items.includes('Udělat z toho prezentaci')), 've stejném rozhovoru se čip podruhé nenabízí');
  fronta.push(nastroj('get_map', { map_id: map.id }), nastroj('suggest_next', { suggestions: ['Napsat klientovi', 'Přidat termín'] }), text('Shrnuto.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Shrň mi stav projektu Kuchyň Novákovi' } }); // nový rozhovor
  navrhy = kartyTahu(r.json.chat, 'navrhy');
  expect(navrhy.length === 1 && navrhy[0].items.join('|') === 'Napsat klientovi|Přidat termín|Udělat z toho prezentaci', `k čipům modelu se prezentace připojí nakonec (${JSON.stringify((navrhy[0] || {}).items)})`);
  fronta.push(nastroj('get_map', { map_id: map.id }), nastroj('ask_user', { questions: [{ text: 'Pro koho?', options: ['Klient', 'Tým'] }] })); // po otázce se model už nevolá
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Shrň mi stav projektu Kuchyň Novákovi', chat_id: r.json.chat.id } });
  expect(kartyTahu(r.json.chat, 'navrhy').length === 0 && kartyTahu(r.json.chat, 'otazky').length === 1, 'po otázce modelu se čip nepřidává (klikat je na co)');
  // tah, který prezentaci rovnou vytvořil, čip znovu nenabízí (zápis = karta soubor)
  fronta.push(nastroj('get_map', { map_id: map.id }), nastroj('draft_presentation', { title: 'Kuchyň Novákovi – sumář pro klienta', text: OSNOVA }), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělat z toho prezentaci', chat_id: r.json.chat.id } });
  expect(kartyTahu(r.json.chat, 'soubor').length === 1 && kartyTahu(r.json.chat, 'navrhy').every((k) => !k.items.includes('Udělat z toho prezentaci')), 'tah, který prezentaci vytvořil, čip znovu nenabízí');
  expect(fronta.length === 0, `fronta podvrženého modelu je po sekci prázdná (${fronta.length})`);

  console.log('== open_tools na už otevřenou skupinu: poznámka modelu místo 8 kol naprázdno (místní model, 2. 11. 2026) ==');
  fronta.push(nastroj('open_tools', { group: 'kancelar' }), nastroj('open_tools', { group: 'kancelar' }), nastroj('draft_card', { kind: 'invitation', title: 'Den otevřených dveří', text: 'Přijďte.', date: '28. 11. 2026 10:00', place: 'Dílna' }), text('Pozvánka je hotová.'));
  const predOpen = volani.length;
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej pozvánku jako PDF. Akce: Den otevřených dveří. Kdy: 28. 11. 2026 10:00. Kde: Dílna.' } });
  const kolaOpen = volani.length - predOpen;
  const poznamka = (volani[predOpen + 1].messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
  expect(kolaOpen === 4 && /skupina „kancelar“ už je otevřená/.test(poznamka) && /draft_card/.test(poznamka) && /draft_presentation/.test(poznamka), `po open_tools na otevřenou skupinu dostane model poznámku se jmény nástrojů; tah = 4 volání (${kolaOpen}; ${JSON.stringify(poznamka.slice(-200))})`);
  const poznamky2 = (volani[predOpen + 2].messages || []).filter((m) => /už je otevřená/.test(m.content || '')).length;
  expect(poznamky2 === 1, `stejná poznámka se nepřidává dvakrát (${poznamky2})`);
  expect(karty(r.json.chat, 'soubor').some((k) => k.template === 'invitation' && /Den otevřených dveří/.test(k.title)), 'pozvánka přesto vznikla (karta soubor)');
  expect(!r.json.chat.messages.some((m) => /už je otevřená/.test(m.content || '')), 'poznámka se do historie rozhovoru nepíše');
  fronta.length = 0;

  console.log('== chybná osnova a stropy = chyba pro model, nic se neuloží ==');
  const pocet = async () => (await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.dokumenty.length;
  const pred = await pocet();
  fronta.push(nastroj('draft_presentation', { title: 'Bez snímků', text: 'Jen odstavec bez nadpisů.' }), text('Chyba.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci', chat_id: chat.id } });
  expect(/^Error: no slides found/.test(toolZ(posledni()).pop().content) && (await pocet()) === pred, 'osnova bez „##“ = chyba pro model, dokument nevznikl');
  const moc = '# X\n' + Array.from({ length: 21 }, (_, i) => `## S${i + 1}\n- a`).join('\n');
  fronta.push(nastroj('draft_presentation', { title: 'Moc', text: moc }), text('Chyba.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci', chat_id: chat.id } });
  expect(/21 slides is too many — keep at most 20/.test(toolZ(posledni()).pop().content) && (await pocet()) === pred, '21 snímků = chyba se stropem 20, nic se neuložilo');
  const hodne = '# X\n## S1\n' + Array.from({ length: 9 }, (_, i) => `- odrážka ${i + 1}`).join('\n');
  fronta.push(nastroj('draft_presentation', { title: 'Moc odrážek', text: hodne }), text('Chyba.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci', chat_id: chat.id } });
  expect(/slide "S1" has 9 bullets — keep at most 8/.test(toolZ(posledni()).pop().content) && (await pocet()) === pred, '9 odrážek na snímku = chyba se stropem 8');
  fronta.push(nastroj('draft_presentation', { title: 'Zástupný', text: 'placeholder' }), text('Chyba.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci', chat_id: chat.id } });
  expect(/must be the whole outline, not a placeholder/.test(toolZ(posledni()).pop().content), 'zástupný text = chyba (jako draft_text)');
  fronta.push(nastroj('draft_presentation', { title: 'Cizí mapa', text: OSNOVA, map: 'Neexistuje' }), text('Chyba.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci', chat_id: chat.id } });
  expect(/^Error: map "Neexistuje" not found/.test(toolZ(posledni()).pop().content), 'neznámá mapa = chyba pro model');

  console.log('== dvojník v témž tahu přepíše první prezentaci ==');
  const pred2 = await pocet();
  const OSNOVA2 = OSNOVA + '\n## Co potřebujeme\n- Potvrdit madla';
  fronta.push(nastroj('draft_presentation', { title: 'Verze A', text: OSNOVA }), nastroj('draft_presentation', { title: 'Verze A', text: OSNOVA2 }), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci znovu', chat_id: chat.id } });
  chat = r.json.chat;
  const posledniTah = chat.messages.slice(chat.messages.map((m) => m.role).lastIndexOf('user') + 1);
  const kTah = posledniTah.flatMap((m) => m.karty || []).filter((k) => k.type === 'soubor');
  expect((await pocet()) === pred2 + 1 && kTah.length === 1 && kTah[0].pocet === 4, `dva stejné názvy v tahu = jeden dokument (4 snímky), jedna karta (${kTah.length}, dokumentů +${(await pocet()) - pred2})`);

  console.log('== draft_card: pozvánka s datem, místem, odkazem (QR) ==');
  fronta.push(nastroj('draft_card', { kind: 'invitation', title: 'Vánoční večírek', text: 'Srdečně Vás zveme.', date: '12. 12. 2026 v 18:00', place: 'Dílna, Dlouhá 12', link: 'https://example.com/vecirek', signature: 'Jan Novák' }), text('Pozvánka je hotová.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Napiš pozvánku na vánoční večírek' } });
  chat = r.json.chat;
  const kk = karty(chat, 'soubor')[0];
  expect(!!kk && kk.druh === 'card' && kk.template === 'invitation' && JSON.stringify(kk.formaty) === '["pdf"]' && !!kk.doc_id, `karta přání: card/invitation, jen PDF (${JSON.stringify(kk || {}).slice(0, 160)})`);
  dok = (await inst.api('GET', `/api/kb/chat/dokument/${kk.doc_id}`, { token: A })).json.dokument;
  expect(dok.kind === 'card' && dok.meta.template === 'invitation' && dok.meta.date === '12. 12. 2026 v 18:00' && dok.meta.place === 'Dílna, Dlouhá 12' && dok.meta.link === 'https://example.com/vecirek' && dok.meta.signature === 'Jan Novák', `dokument card nese šablonu, kdy, kde, odkaz, podpis (${JSON.stringify(dok.meta)})`);
  expect(/kind card, template invitation/.test(toolZ(posledni()).pop().content), 'model ví o šabloně a že barvu/fotku doladí uživatel v Dokumentech');
  const kartaId = kk.doc_id;
  fronta.push(nastroj('draft_card', { kind: 'invitation', title: 'X', text: 'Y', link: 'javascript:alert(1)' }), text('Chyba.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Pozvánka', chat_id: chat.id } });
  expect(/^Error: link must be a full http\(s\) URL/.test(toolZ(posledni()).pop().content), 'odkaz mimo http(s) = chyba (nic do QR)');
  fronta.push(nastroj('draft_card', { kind: 'leaflet', title: 'X', text: 'Y' }), text('Chyba.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Pozvánka', chat_id: chat.id } });
  // enum hlídá už obecná validace argumentů v chat.js (dřív než modul) — znění je její, důležité je, že nic nevzniklo
  expect(/expected one of greeting, invitation, poster, certificate/.test(toolZ(posledni()).pop().content) && !karty(r.json.chat, 'soubor').some((k) => k.title === 'X'), `neznámá šablona = chyba, nic nevzniklo (${toolZ(posledni()).pop().content.slice(0, 100)})`);

  console.log('== open_tools kancelar bez klíčového slova; „pf“ a „narozeniny“ otevírají skupinu ==');
  volani.length = 0;
  fronta.push(nastroj('open_tools', { group: 'kancelar' }), nastroj('draft_card', { kind: 'greeting', title: 'Děkujeme', text: 'Za spolupráci.' }), text('Přání je hotové.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Napiš něco hezkého pro Karla' } });
  expect(!nastrojeZ(volani[0]).includes('draft_card') && nastrojeZ(volani[1]).includes('draft_card'), 'bez klíčového slova skupina zavřená; open_tools kancelar ji otevře v témže tahu');
  expect(karty(r.json.chat, 'soubor').some((k) => k.template === 'greeting'), 'přání greeting vzniklo');
  for (const [zprava, cekame] of [['Potřebuju PF 2027 pro klienty', true], ['Má narozeniny, co s tím?', true], ['Kolik mám dnes úkolů?', false]]) {
    volani.length = 0; fronta.push(text('Ok.'));
    await inst.api('POST', '/api/kb/chat', { token: A, body: { message: zprava } });
    expect(nastrojeZ(volani[0]).includes('draft_card') === cekame, `„${zprava}“ → skupina kancelar ${cekame ? 'otevřená' : 'zavřená'}`);
  }

  console.log('== režim kancelar: formulář od aplikace, bez modelu ==');
  volani.length = 0;
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { mode: 'kancelar', message: '', context: { route: '/' } } });
  expect(r.status === 200, `start režimu → 200 (${r.status})`);
  const uvod = r.json.chat.messages[r.json.chat.messages.length - 1];
  const kO = (uvod.karty || []).find((k) => k.type === 'otazky');
  expect(volani.length === 0 && !!kO && kO.questions.length === 3 && kO.questions[0].options.includes('Prezentaci projektu') && kO.questions[0].options.includes('Pozvánku na akci') && kO.questions[2].options.includes('Formální'), `formulář kanceláře skládá aplikace (0 volání modelu): co / pro koho / tón (${JSON.stringify((kO || {}).questions || []).slice(0, 160)})`);
  expect(/Dokumentech/.test(uvod.content) && r.json.chat.mode === 'kancelar' && /^Kancelář /.test(r.json.chat.title), `úvod vyká a mluví o Dokumentech; titulek „Kancelář {datum}“ (${r.json.chat.title})`);
  fronta.push(nastroj('ask_user', { questions: [{ text: 'Komu je přání určeno?', options: ['Klientům', 'Kolegům'] }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: '1) Přání (PF, narozeniny, poděkování)\n2) Pro klienty k Vánocům\n3) Přátelský', chat_id: r.json.chat.id } });
  const v = volani[0];
  expect(/REŽIM KANCELÁŘ/.test(systemZ(v)) && nastrojeZ(v).includes('draft_card') && nastrojeZ(v).includes('update_document'), 'tah po formuláři: prompt režimu kancelar, nástroje kancelar + dokumenty');
  const tOdp = toolZ(v).pop();
  expect(!!tOdp && /Přání \(PF, narozeniny, poděkování\)/.test(tOdp.content) && /Přátelský/.test(tOdp.content), 'odpovědi z formuláře dostal model jako výsledek ask_user');

  console.log('== routy: meta v DTO, úprava meta z panelu, vrácení verze, filtr, RLS ==');
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: kartaId, meta: { template: 'poster', color: '#AbCdEf', link: 'javascript:x', date: 'sobota', cizi: 'ne', signature: 'x'.repeat(500) } } });
  expect(r.status === 200 && r.json.dokument.meta.template === 'poster' && r.json.dokument.meta.color === '#AbCdEf' && !r.json.dokument.meta.link && r.json.dokument.meta.date === 'sobota' && !('cizi' in r.json.dokument.meta) && r.json.dokument.meta.signature.length === 120, `meta z panelu: šablona + barva prošly, javascript: odkaz a cizí klíč ne, podpis oříznut (${JSON.stringify(r.json.dokument.meta).slice(0, 160)})`);
  expect(!r.json.dokument.meta.place, 'meta se mění celá: nepředané „kde“ zmizelo');
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: kartaId, meta: { template: 'leták' } } });
  expect(r.status === 200 && !r.json.dokument.meta.template, 'šablona mimo whitelist se zahodí');
  r = await inst.api('POST', '/api/kb/chat/dokument/vratit', { token: A, body: { id: kartaId } });
  expect(r.status === 200 && r.json.dokument.meta.template === 'poster' && r.json.dokument.meta.color === '#AbCdEf', 'Vrátit předchozí verzi vrací i meta (poster + barva)');
  r = await inst.api('GET', '/api/kb/chat/dokumenty?skupina=kancelar', { token: A });
  expect(r.status === 200 && r.json.dokumenty.length >= 3 && r.json.dokumenty.every((d) => d.kind === 'presentation' || d.kind === 'card') && r.json.dokumenty.every((d) => d.meta && typeof d.meta === 'object'), `filtr „Kancelář“ = jen prezentace a přání s meta (${r.json.dokumenty.length})`);
  r = await inst.api('GET', '/api/kb/chat/dokumenty?skupina=poznamky', { token: A });
  expect(r.json.dokumenty.every((d) => d.kind !== 'presentation' && d.kind !== 'card'), 've filtru Poznámky prezentace nejsou');
  r = await inst.api('GET', `/api/kb/chat/dokument/${kartaId}`, { token: B });
  expect(r.status === 404, 'cizí dokument kanceláře = 404');
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: B, body: { id: kartaId, meta: { template: 'greeting' } } });
  expect(r.status === 404, 'cizí meta nejde přepsat (404)');
  r = await inst.api('GET', '/api/collections/ai_documents/records', { token: A });
  expect(r.status === 200 && r.json.items.every((d) => d.user === (r.json.items[0] || {}).user) && r.json.items.some((d) => d.kind === 'presentation' && d.meta && d.meta.subtitle), 'přímé čtení kolekce: jen vlastní záznamy, pole meta existuje');
  r = await inst.api('PATCH', `/api/collections/ai_documents/records/${kartaId}`, { token: A, body: { meta: { template: 'certificate' } } });
  expect(r.status === 403 || r.status === 404, `přímý zápis do ai_documents zavřený (${r.status})`);

  console.log('== update_document osnovy drží meta; list_documents ukazuje druh ==');
  fronta.push(nastroj('list_documents', {}), nastroj('update_document', { document: 'Kuchyň Novákovi', text: OSNOVA + '\n## Rizika\n- Zpoždění pily' }), text('Osnova upravena.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Uprav dokument prezentace: přidej snímek Rizika' } });
  expect(/Kuchyň Novákovi \(presentation outline/.test(toolZ(volani[volani.length - 2]).pop().content), 'list_documents hlásí druh „presentation outline“');
  dok = (await inst.api('GET', `/api/kb/chat/dokument/${prezId}`, { token: A })).json.dokument;
  expect(/## Rizika/.test(dok.text) && dok.kind === 'presentation' && dok.meta.subtitle === 'Stav pro klienta' && dok.ma_predchozi, 'update_document: nový text, druh i meta zůstaly, předchozí verze uložená');
  expect(karty(r.json.chat, 'dokument').length === 1, 'karta „upravil jsem dokument“');
}, { nazev: 'AI-KANCELAR' });
