// Dokumenty asistenta (30. 9. 2026) — API sada proti PODVRŽENÉ ollamě.
//
// Co hlídá: draft_text se sám uloží jako SOUKROMÝ dokument (+ doc_id v kartě), e-mail
// nese předmět a adresáta zvlášť, nástroje list_documents / get_document / update_document
// (předchozí verze → Vrátit), routy /chat/dokument* (vlastník, 404 pro cizí, stropy,
// přímé CRUD zavřené), nabídka zápisu na konci porady / nočního plánování a návrat
// dokumentů, když lehký model v hybridu tah předá hlavnímu.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-dokumenty.js
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const volani = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const nastroje = (...c) => ({ tool_calls: c.map(([name, args]) => ({ function: { name, arguments: args } })) });
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
const karty = (chat, typ) => chat.messages.flatMap((m) => m.karty || []).filter((k) => k.type === typ);

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'dokumenty', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
  } });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, 'mapa založena');

  console.log('== draft_text = dokument (soukromý, doc_id v kartě) ==');
  expect((await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.dokumenty.length === 0, 'na začátku žádné dokumenty');
  fronta.push(nastroj('draft_text', { kind: 'email', title: 'Poptávka spárovek', subject: 'Poptávka – spárovky dub', to: 'drevo@example.com', text: 'Dobrý den,\nposílám poptávku. DOK-EMAIL-1' }), text('Koncept je v dokumentech.'));
  let r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Napiš poptávku na spárovky' } });
  expect(r.status === 200, `POST /chat → 200 (${r.status})`);
  let chat = r.json.chat;
  const k1 = karty(chat, 'koncept')[0];
  expect(!!k1 && !!k1.doc_id && k1.subject === 'Poptávka – spárovky dub' && k1.to === 'drevo@example.com', `karta konceptu nese doc_id, předmět a adresáta (${JSON.stringify(k1 || {}).slice(0, 160)})`);
  expect(/saved to the user's Documents/.test(toolZ(posledniVolani()).pop().content), 'model ví, že text je uložený v Dokumentech');
  const sys = systemZ(posledniVolani());
  expect(/uloží se uživateli do Dokumentů/.test(sys) && /update_document/.test(sys) && /list_documents/.test(sys), 'systém: draft_text → Dokumenty, úprava přes update_document');
  expect(/nápady a úkoly \(věci k udělání\) do draft_text NIKDY nedávej/.test(sys) && /zásobníku nápadů \(add_idea \/ add_ideas\)/.test(sys), 'systém: hranice — nápady a úkoly do zásobníku, ne do dokumentů (Richard 1. 10. 2026)');
  expect(/NOT for ideas or tasks/.test(volani[0].tools.find((t) => t.function.name === 'draft_text').function.description), 'popis draft_text: ne pro nápady a úkoly');
  expect(volani[0].tools.some((t) => t.function.name === 'draft_text') && !volani[0].tools.some((t) => t.function.name === 'update_document'), 'draft_text jde vždy, nástroje dokumentů jen když o ně rozhovor stojí (úspora tokenů)');
  let d = (await inst.api('GET', `/api/kb/chat/dokument/${k1.doc_id}`, { token: A })).json.dokument;
  expect(d && d.kind === 'email' && d.title === 'Poptávka spárovek' && d.email_subject === 'Poptávka – spárovky dub' && d.email_to === 'drevo@example.com' && /DOK-EMAIL-1/.test(d.text), 'dokument uložen celý (druh, název, předmět, adresát, text)');
  expect(d.chat === chat.id, `dokument ví, ve kterém rozhovoru vznikl — i v NOVÉM rozhovoru (${d.chat} × ${chat.id})`);
  expect(d.ma_predchozi === false, 'nový dokument nemá předchozí verzi');

  console.log('== e-mail s „Předmět:“ v textu → předmět zvlášť ==');
  fronta.push(nastroj('draft_text', { kind: 'email', text: 'Předmět: Faktura za schody\n\nDobrý den, připomínám fakturu. DOK-EMAIL-2' }), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Připomeň Janě fakturu mailem' } });
  chat = r.json.chat;
  const k2 = karty(chat, 'koncept').pop();
  d = (await inst.api('GET', `/api/kb/chat/dokument/${k2.doc_id}`, { token: A })).json.dokument;
  expect(d.email_subject === 'Faktura za schody' && /^Dobrý den/.test(d.text) && !/Předmět:/.test(d.text), `předmět vytažen z prvního řádku, tělo bez něj (${d.email_subject} | ${d.text.slice(0, 30)})`);
  expect(d.title === 'Faktura za schody', 'bez názvu → název = předmět');

  console.log('== poznámka a sumář, s projektem ==');
  fronta.push(nastroj('draft_text', { kind: 'note', title: 'Rozměry kuchyně', text: 'Linka 3,2 m\nOstrůvek 1,8 m', map: 'Truhlářství' }), text('Zapsáno.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Zapiš si rozměry' } });
  const k3 = karty(r.json.chat, 'koncept').pop();
  expect(k3.kind === 'note' && k3.map_id === map.id && !!k3.doc_id, 'poznámka k projektu: dokument + projekt');
  const pam = (await inst.api('GET', '/api/kb/chat/pamet', { token: A })).json;
  expect(!(pam.projekty || []).some((p) => /Linka 3,2 m/.test(p.text)), 'koncept s projektem se do poznámek projektu NEpřipíše (Richard 1. 10. 2026 — je v Dokumentech)');
  expect(/doc.*links to the project|linked to the project/.test(toolZ(posledniVolani()).filter((m) => m.tool_name === 'draft_text').pop().content), 'model ví, že dokument odkazuje na projekt');
  d = (await inst.api('GET', `/api/kb/chat/dokument/${k3.doc_id}`, { token: A })).json.dokument;
  expect(d.map === map.id && d.map_title === 'Truhlářství', `dokument nese projekt i jeho název pro odkaz na mapu (${d.map_title})`);
  // projekt, který uživatel už nevidí (smazaný) → bez odkazu a bez názvu
  const docasna = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Dočasný projekt', nodes: [], edges: [] } })).json;
  fronta.push(nastroj('draft_text', { kind: 'summary', title: 'Sumář dočasného', text: 'DOCASNY-SUMAR', map: 'Dočasný projekt' }), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'sumář dočasného projektu' } });
  const kDoc = karty(r.json.chat, 'koncept').pop();
  expect((await inst.api('GET', `/api/kb/chat/dokument/${kDoc.doc_id}`, { token: A })).json.dokument.map_title === 'Dočasný projekt', 'sumář projektu ví, ke kterému projektu patří');
  await inst.api('DELETE', `/api/collections/goalmaps/records/${docasna.id}`, { token: A });
  d = (await inst.api('GET', `/api/kb/chat/dokument/${kDoc.doc_id}`, { token: A })).json.dokument;
  expect(d.map === '' && d.map_title === '' && /DOCASNY-SUMAR/.test(d.text), 'po smazání projektu dokument zůstal, odkaz na mapu zmizel');
  await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: A, body: { id: kDoc.doc_id } });
  fronta.push(nastroj('draft_text', { kind: 'summary', title: 'Souhrn týdne', text: 'Hotovo: 3 úkoly' }), text('Souhrn je v dokumentech.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Shrň mi týden' } });
  chat = r.json.chat;

  console.log('== zástupný text a dvojí koncept v jednom tahu (klik-test 1. 10. 2026: „placeholder“ + sumář) ==');
  const predZ = (await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.dokumenty.length;
  const poznamkyProjektu = async () => (((await inst.api('GET', '/api/kb/chat/pamet', { token: A })).json.projekty || []).find((p) => p.map_id === map.id) || {}).text || '';
  fronta.push(nastroj('draft_text', { kind: 'summary', map: 'Truhlářství', subject: 'Sumář projektu Truhlářství', title: 'Sumář projektu Truhlářství', text: 'placeholder' }),
    nastroj('draft_text', { kind: 'summary', map: 'Truhlářství', title: 'Sumář projektu Truhlářství', text: 'Stav: 1 otevřený krok. ZASTUPNY-PAK-CELY' }), text('Sumář je v dokumentech.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'udělej mi sumář projektu' } });
  expect(toolZ(posledniVolani()).some((m) => m.tool_name === 'draft_text' && /not a placeholder/.test(m.content)), '„placeholder“ → chyba pro model, ať pošle celý text');
  let po = (await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.dokumenty;
  expect(po.length === predZ + 1 && /ZASTUPNY-PAK-CELY/.test(po[0].nahled), `vznikl JEDEN dokument s celým textem (${po.length - predZ} nových)`);
  expect(!/placeholder/.test(await poznamkyProjektu()), 'zástupný text se nepřipojil ani do poznámek projektu');
  expect(karty(r.json.chat, 'koncept').filter((k) => /Sumář projektu/.test(k.title)).length === 1, 'v chatu jedna karta konceptu');
  fronta.push(nastroj('draft_text', { kind: 'note', title: 'Dvakrát v tahu', text: 'PRVNI-VERZE' }), nastroj('draft_text', { kind: 'note', title: 'Dvakrát v tahu', text: 'DRUHA-VERZE' }), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'zapiš poznámku' } });
  po = (await inst.api('GET', '/api/kb/chat/dokumenty?q=Dvakrát', { token: A })).json.dokumenty;
  expect(po.length === 1 && /DRUHA-VERZE/.test(po[0].nahled) && !po[0].ma_predchozi, `stejný název podruhé v tahu → přepíše první dokument, zahozená první verze se nenabízí k vrácení (${po.length})`);
  const kDv = karty(r.json.chat, 'koncept').filter((k) => k.title === 'Dvakrát v tahu');
  expect(kDv.length === 1 && /DRUHA-VERZE/.test(kDv[0].text), `v chatu zůstala jen karta s poslední verzí (${kDv.length})`);
  fronta.push(nastroj('draft_text', { kind: 'note', title: 'Dvakrát v tahu', text: 'TRETI-JINY-TAH' }), text('Další.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: r.json.chat.id, message: 'ještě jednou' } });
  expect((await inst.api('GET', '/api/kb/chat/dokumenty?q=Dvakrát', { token: A })).json.dokumenty.length === 2, 'v DALŠÍM tahu stejný název = nový dokument (přepis jen přes update_document)');
  for (const d0 of (await inst.api('GET', '/api/kb/chat/dokumenty?q=Dvakrát', { token: A })).json.dokumenty.concat((await inst.api('GET', '/api/kb/chat/dokumenty?q=ZASTUPNY', { token: A })).json.dokumenty)) await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: A, body: { id: d0.id } });

  console.log('== seznam, filtr, hledání ==');
  let seznam = (await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json;
  expect(seznam.dokumenty.length === 4 && seznam.dokumenty[0].title === 'Souhrn týdne', `4 dokumenty, nejnovější první (${seznam.dokumenty.map((x) => x.title).join(' | ')})`);
  expect(seznam.dokumenty.every((x) => x.text === undefined && typeof x.nahled === 'string'), 'seznam nese náhled, ne celý text');
  expect(seznam.dokumenty.find((x) => x.title === 'Rozměry kuchyně').map_title === 'Truhlářství' && seznam.dokumenty.find((x) => x.title === 'Souhrn týdne').map_title === '', 'seznam nese název projektu (jen u dokumentů k projektu)');
  expect((await inst.api('GET', '/api/kb/chat/dokumenty?skupina=emaily', { token: A })).json.dokumenty.length === 2, 'filtr E-maily = 2');
  expect((await inst.api('GET', '/api/kb/chat/dokumenty?skupina=sumare', { token: A })).json.dokumenty.map((x) => x.title).join() === 'Souhrn týdne', 'filtr Sumáře');
  expect((await inst.api('GET', '/api/kb/chat/dokumenty?skupina=poznamky', { token: A })).json.dokumenty.map((x) => x.title).join() === 'Rozměry kuchyně', 'filtr Poznámky');
  expect((await inst.api('GET', '/api/kb/chat/dokumenty?q=Ostrůvek', { token: A })).json.dokumenty.map((x) => x.title).join() === 'Rozměry kuchyně', 'hledání v textu');

  console.log('== list_documents / get_document / update_document ==');
  fronta.push(nastroj('list_documents', {}), nastroj('get_document', { document: 'Poptávka spárovek' }),
    nastroj('update_document', { document: 'Poptávka spárovek', text: 'Vážený pane,\ndovoluji si poptat. DOK-FORMALNI' }), text('Upraveno.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'Udělej tu poptávku formálnější' } });
  chat = r.json.chat;
  const tt = toolZ(posledniVolani());
  expect(posledniVolani().tools.some((t) => t.function.name === 'update_document'), 'v rozhovoru s konceptem dostane model nástroje dokumentů');
  expect(tt.some((m) => m.tool_name === 'list_documents' && /Poptávka spárovek \(e-mail/.test(m.content) && !new RegExp(k1.doc_id).test(m.content)), 'list_documents: názvy a druhy BEZ id (modely id přepisují)');
  expect(tt.some((m) => m.tool_name === 'get_document' && /Subject: Poptávka – spárovky dub/.test(m.content) && /DOK-EMAIL-1/.test(m.content) && /user DATA/.test(m.content)), 'get_document: celý text s hlavičkou a plotem dat');
  const kU = karty(chat, 'dokument').pop();
  expect(!!kU && kU.doc_id === k1.doc_id, 'update_document → karta „dokument“ s id');
  d = (await inst.api('GET', `/api/kb/chat/dokument/${k1.doc_id}`, { token: A })).json.dokument;
  expect(/DOK-FORMALNI/.test(d.text) && d.ma_predchozi === true && d.email_subject === 'Poptávka – spárovky dub', 'přepsáno, předmět zůstal, předchozí verze schovaná');
  expect(karty(chat, 'koncept').length === 4, 'update nezaložil nový dokument ani kartu konceptu');
  fronta.push(nastroj('update_document', { document: 'Neexistující věc', text: 'x' }), text('Nenašel jsem.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'uprav neexistující' } });
  expect(toolZ(posledniVolani()).some((m) => m.tool_name === 'update_document' && /not found/.test(m.content)), 'neznámý dokument → chyba pro model');

  console.log('== checkup 1. 10.: dvojí přepis v tahu, přesný cíl, dvojník podle adresáta, CR/LF, dlouhý předmět ==');
  // dvojí přepis v jednom tahu (vložený pokyn) → originál zůstane jako předchozí verze
  fronta.push(nastroj('update_document', { document: 'Poptávka spárovek', text: 'PREPIS-X' }), nastroj('update_document', { document: 'Poptávka spárovek', text: 'PREPIS-Y' }), text('Hotovo.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'přepiš poptávku dvakrát' } });
  r = await inst.api('POST', '/api/kb/chat/dokument/vratit', { token: A, body: { id: k1.doc_id } });
  expect(/DOK-FORMALNI/.test(r.json.dokument.text), `dvojí přepis v tahu: Vrátit vrátí verzi ze ZAČÁTKU tahu, ne mezistav (${r.json.dokument.text.slice(0, 20)})`);
  // přesný cíl: podřetězec názvu přepis NEtrefí
  fronta.push(nastroj('update_document', { document: 'Poptávka', text: 'PODRETEZEC' }), text('?'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: chat.id, message: 'uprav poptávku' } });
  expect(toolZ(posledniVolani()).some((m) => m.tool_name === 'update_document' && /not found/.test(m.content)) && !/PODRETEZEC/.test((await inst.api('GET', `/api/kb/chat/dokument/${k1.doc_id}`, { token: A })).json.dokument.text), 'přepis jen přesně určeného dokumentu — část názvu nestačí');
  // dva e-maily se stejným předmětem různým adresátům v jednom tahu = dva dokumenty
  fronta.push(nastroj('draft_text', { kind: 'email', subject: 'Poptávka desek', to: 'a@dodavatel.cz', text: 'Dobrý den A' }), nastroj('draft_text', { kind: 'email', subject: 'Poptávka desek', to: 'b@dodavatel.cz', text: 'Dobrý den B' }), text('Dva e-maily.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'napiš poptávku dvěma dodavatelům' } });
  const dva = (await inst.api('GET', '/api/kb/chat/dokumenty?q=Poptávka desek', { token: A })).json.dokumenty;
  expect(dva.length === 2 && karty(r.json.chat, 'koncept').length === 2, `stejný předmět, jiný adresát → dva dokumenty a dvě karty (${dva.length})`);
  expect(karty(r.json.chat, 'koncept').every((k) => /@dodavatel\.cz$/.test(k.to)), 'karta nese adresáta (vidět už v chatu)');
  for (const x of dva) await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: A, body: { id: x.id } });
  // zalomení řádků v adresátovi/předmětu/názvu pryč (mailto, hlavičky pošty)
  fronta.push(nastroj('draft_text', { kind: 'email', subject: 'CRLF test', text: 'CRLF' }), text('Ok.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'e-mail na zkoušku' } });
  const crlfId = karty(r.json.chat, 'koncept').pop().doc_id;
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: crlfId, email_subject: 'Řádek 1\r\nBcc: x@evil.cz', email_to: 'a@b.cz\nbcc=x@evil.cz', title: 'Název\nzalomený' } });
  expect(r.status === 200 && !/[\r\n]/.test(r.json.dokument.email_subject + r.json.dokument.email_to + r.json.dokument.title), 'CR/LF z adresáta, předmětu i názvu odstraněny');
  await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: A, body: { id: crlfId } });
  // předmět delší než strop názvu: dokument se uloží (název se zkrátí), model nedostane falešné „plno“
  fronta.push(nastroj('draft_text', { kind: 'email', subject: 'P'.repeat(260), text: 'DLOUHY-PREDMET' }), text('Ok.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'e-mail s dlouhým předmětem' } });
  const kDl = karty(r.json.chat, 'koncept').pop();
  expect(!!kDl.doc_id && !/NOT saved/.test(toolZ(posledniVolani()).pop().content), 'předmět 260 znaků: dokument uložen (dřív „plno“ a nic)');
  await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: A, body: { id: kDl.doc_id } });
  // export „Stáhnout všechna moje data“ nese dokumenty
  const ex = await inst.api('GET', '/api/kb/export', { token: A });
  expect(ex.status === 200 && Array.isArray(ex.json.documents) && ex.json.documents.some((x) => x.title === 'Poptávka spárovek') && ex.json.counts.documents === ex.json.documents.length, `export všech dat obsahuje dokumenty (${ex.status}, ${ex.json && ex.json.counts && ex.json.counts.documents})`);
  const exB = await inst.api('GET', '/api/kb/export', { token: B });
  expect(exB.status === 200 && (exB.json.documents || []).length === 0, 'export cizího uživatele moje dokumenty nenese');

  console.log('== ruční úprava a Vrátit (routy) ==');
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: k1.doc_id, text: 'RUCNE-UPRAVENO', email_to: 'jina@example.com' } });
  expect(r.status === 200 && r.json.dokument.text === 'RUCNE-UPRAVENO' && r.json.dokument.email_to === 'jina@example.com' && r.json.dokument.title === 'Poptávka spárovek', 'ruční úprava uložena, nezměněná pole zůstala');
  r = await inst.api('POST', '/api/kb/chat/dokument/vratit', { token: A, body: { id: k1.doc_id } });
  expect(r.status === 200 && /DOK-FORMALNI/.test(r.json.dokument.text) && r.json.dokument.email_to === 'drevo@example.com', 'Vrátit → verze asistenta i s původním adresátem');
  r = await inst.api('POST', '/api/kb/chat/dokument/vratit', { token: A, body: { id: k1.doc_id } });
  expect(r.json.dokument.text === 'RUCNE-UPRAVENO', 'druhé Vrátit vrátí zpět (prohození)');
  const predUlozenim = r.json.dokument;
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: k1.doc_id, text: 'RUCNE-UPRAVENO' } });
  r = await inst.api('POST', '/api/kb/chat/dokument/vratit', { token: A, body: { id: k1.doc_id } });
  expect(/DOK-FORMALNI/.test(r.json.dokument.text), 'uložení beze změny nepřepíše předchozí verzi sama sebou');
  void predUlozenim;
  // nové dokumenty zakládá JEN asistent (Richard 1. 10. 2026, varianta A — ruční poznámky by se tloukly se zásobníkem)
  const predRucni = (await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.dokumenty.length;
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A, body: { kind: 'note', title: 'Moje ruční poznámka', text: 'RUCNI-NOVA' } });
  expect(r.status === 404 && (await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.dokumenty.length === predRucni, `routa bez id dokument NEzaloží (${r.status})`);
  fronta.push(nastroj('draft_text', { kind: 'note', title: 'Poznámka bez historie', text: 'RUCNI-NOVA' }), text('Zapsáno.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'zapiš poznámku' } });
  const rucni = karty(r.json.chat, 'koncept').pop().doc_id;
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: rucni, title: 'Dlouhý', text: 'x'.repeat(20001) } });
  expect(r.status === 400 && /20000/.test(r.json.error), `text nad 20000 znaků → 400 s hláškou (${r.status} ${r.json.error})`);
  expect((await inst.api('POST', '/api/kb/chat/dokument/vratit', { token: A, body: { id: rucni } })).status === 400, 'Vrátit bez předchozí verze → 400');

  console.log('== soukromí: cizí uživatel nic nevidí ani nezmění ==');
  expect((await inst.api('GET', '/api/kb/chat/dokumenty', { token: B })).json.dokumenty.length === 0, 'seznam druhého uživatele je prázdný');
  expect((await inst.api('GET', `/api/kb/chat/dokument/${k1.doc_id}`, { token: B })).status === 404, 'cizí dokument → 404');
  expect((await inst.api('POST', '/api/kb/chat/dokument', { token: B, body: { id: k1.doc_id, text: 'HACK' } })).status === 404, 'úprava cizího → 404');
  expect((await inst.api('POST', '/api/kb/chat/dokument/vratit', { token: B, body: { id: k1.doc_id } })).status === 404, 'Vrátit cizí → 404');
  expect((await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: B, body: { id: k1.doc_id } })).status === 404, 'smazat cizí → 404');
  expect((await inst.api('GET', `/api/collections/ai_documents/records/${k1.doc_id}`, { token: B })).status === 404, 'PB CRUD: cizí záznam nevidí');
  expect(((await inst.api('GET', '/api/collections/ai_documents/records', { token: B })).json.items || []).length === 0, 'PB CRUD: seznam cizímu prázdný');
  expect((await inst.api('PATCH', `/api/collections/ai_documents/records/${k1.doc_id}`, { token: A, body: { text: 'PRIMO' } })).status >= 400, 'PB CRUD: ani vlastník nezapisuje mimo routy');
  expect((await inst.api('POST', '/api/collections/ai_documents/records', { token: A, body: { user: 'x', kind: 'note', text: 'x' } })).status >= 400, 'PB CRUD: create zavřený');
  fronta.push(nastroj('get_document', { document: 'Poptávka spárovek' }), nastroj('update_document', { document: 'Poptávka spárovek', text: 'HACK-B' }), text('?'));
  r = await inst.api('POST', '/api/kb/chat', { token: B, body: { message: 'Uprav poptávku spárovek' } });
  expect(toolZ(posledniVolani()).filter((m) => /not found/.test(m.content)).length === 2, 'nástroje cizího uživatele cizí dokument nenajdou');
  expect(!/HACK/.test((await inst.api('GET', `/api/kb/chat/dokument/${k1.doc_id}`, { token: A })).json.dokument.text), 'dokument vlastníka nezměněn');
  expect((await inst.api('GET', '/api/kb/chat/dokumenty')).status === 401, 'bez přihlášení → 401');

  console.log('== smazání ==');
  expect((await inst.api('POST', '/api/kb/chat/dokument/smazat', { token: A, body: { id: rucni } })).status === 200, 'smazat vlastní → 200');
  expect((await inst.api('GET', `/api/kb/chat/dokument/${rucni}`, { token: A })).status === 404, 'smazaný dokument už není');

  console.log('== porada a noční plánování nabídnou zápis ==');
  fronta.push(text('PORADA.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { mode: 'porada', message: '' } });
  let sysP = systemZ(posledniVolani());
  expect(/Uložit zápis z porady do dokumentů\?/.test(sysP) && /kind summary/.test(sysP) && /Ranní porada <dnešní datum>/.test(sysP), 'porada: na konci nabídka uložit zápis (sumář)');
  fronta.push(text('NOC.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { mode: 'nocni', message: '' } });
  sysP = systemZ(posledniVolani());
  expect(/Uložit zápis z nočního plánování do dokumentů\?/.test(sysP) && /Noční plánování <dnešní datum>/.test(sysP), 'noční plánování: nabídka uložit zápis');

  console.log('== tah s přepisem obrázku: update_document jen přes kartu ==');
  // PDF text může nést vložené pokyny → přepis dokumentu jen po potvrzení
  fronta.push(nastroj('update_document', { document: 'Souhrn týdne', text: 'Z PDF' }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Podívej se a uprav dokument', pdf_text: [{ page: 1, text: 'Faktura 100 Kč' }], pdf_name: 'f.pdf', pdf_pages: 1 } });
  const kA = karty(r.json.chat, 'akce').pop();
  expect(r.status === 200 && !!kA && /Přepsat dokument „Souhrn týdne“/.test(kA.popis), `v tahu s PDF je update_document karta k potvrzení (${r.status} ${kA && kA.popis})`);
  let souhrn = (await inst.api('GET', '/api/kb/chat/dokumenty?skupina=sumare', { token: A })).json.dokumenty[0];
  expect(!souhrn.ma_predchozi, 'před potvrzením se nic nezměnilo');
  fronta.push(text('Přepsáno.'));
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: r.json.chat.id, action_id: kA.id, ok: true } });
  souhrn = (await inst.api('GET', `/api/kb/chat/dokument/${souhrn.id}`, { token: A })).json.dokument;
  expect(r.status === 200 && souhrn.text === 'Z PDF' && souhrn.ma_predchozi, 'po potvrzení přepsáno');

  // dlouhý přepis v tahu s PDF by přetekl ai_chats.pending (20 kB) a app.save by zahodil celý tah
  fronta.push(nastroj('update_document', { document: 'Souhrn týdne', text: 'ž'.repeat(7000) }), text('Nejde to.'));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Podívej se a uprav dokument', pdf_text: [{ page: 1, text: 'Faktura 100 Kč' }], pdf_name: 'f.pdf', pdf_pages: 1 } });
  expect(r.status === 200 && !karty(r.json.chat, 'akce').length && toolZ(posledniVolani()).some((m) => m.tool_name === 'update_document' && /too long to confirm/.test(m.content)), `dlouhý přepis v tahu s PDF → chyba pro model, tah se neztratí (${r.status})`);

  console.log('== hybrid: lehký model tah předá → jeho dokument se vrátí ==');
  const instHy = await H.startInstance({ slug: 'dokumenty-hybrid', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0,
    KB_CHAT_LIGHT_PROVIDER: 'ollama', KB_CHAT_LIGHT_URL: mock.base, KB_CHAT_LIGHT_MODEL: 'm-light', KB_CHAT_HYBRID: 'klasifikator,predani',
  } });
  await instHy.register('hy@example.com', { name: 'Hy' }); const HY = await instHy.login('hy@example.com');
  const pred = volani.length;
  fronta.push(text('{"zapis": false}'),
    nastroje(['draft_text', { kind: 'note', title: 'LEHKY-KONCEPT', text: 'lehký' }], ['add_idea_to_map', { idea_id: 'x', map_id: 'y' }]),
    nastroj('draft_text', { kind: 'note', title: 'HLAVNI-KONCEPT', text: 'hlavní' }), text('Hotovo.'));
  r = await instHy.api('POST', '/api/kb/chat', { token: HY, body: { message: 'napiš poznámku a vlož nápad' } });
  expect(volani.slice(pred).map((v) => v.model).join(',') === 'm-light,m-light,m-a,m-a', `klasifikátor + lehký → předáno hlavnímu (${volani.slice(pred).map((v) => v.model).join(',')})`);
  const hyDok = (await instHy.api('GET', '/api/kb/chat/dokumenty', { token: HY })).json.dokumenty.map((x) => x.title);
  expect(hyDok.join() === 'HLAVNI-KONCEPT', `po předání zůstal jen dokument hlavního modelu (${hyDok.join(' | ')})`);
  // přepis lehkého modelu se při předání taky vrátí (checkup 1. 10.)
  const chatHy = r.json.chat;
  const predHy2 = volani.length;
  fronta.push(text('{"zapis": false}'),
    nastroje(['update_document', { document: 'HLAVNI-KONCEPT', text: 'LEHKY-PREPIS' }], ['add_idea_to_map', { idea_id: 'x', map_id: 'y' }]),
    text('Hotovo.'));
  r = await instHy.api('POST', '/api/kb/chat', { token: HY, body: { chat_id: chatHy.id, message: 'přepiš poznámku a vlož nápad' } });
  expect(volani.slice(predHy2).map((v) => v.model).join(',') === 'm-light,m-light,m-a', `přepis lehkým → předáno hlavnímu (${volani.slice(predHy2).map((v) => v.model).join(',')})`);
  const hyD = (await instHy.api('GET', '/api/kb/chat/dokumenty', { token: HY })).json.dokumenty[0];
  const hyDet = (await instHy.api('GET', `/api/kb/chat/dokument/${hyD.id}`, { token: HY })).json.dokument;
  expect(hyDet.text === 'hlavní' && !hyDet.ma_predchozi, `přepis lehkého modelu vrácen i s předchozí verzí (${hyDet.text}, předchozí: ${hyDet.ma_predchozi})`);

  console.log('== EN ==');
  await inst.register('en@example.com', { name: 'Ann', language: 'en' });
  const EN = await inst.login('en@example.com');
  r = await inst.api('POST', '/api/kb/chat/dokument', { token: EN, body: { kind: 'note', title: 'x', text: 'y' } });
  expect(r.status === 404 && /Document not found/.test(r.json.error), `EN hláška (${r.json.error})`);
  fronta.push(nastroj('draft_text', { kind: 'email', text: 'Subject: Invoice\n\nHello. EN-DOK' }), text('Done.'));
  r = await inst.api('POST', '/api/kb/chat', { token: EN, body: { message: 'Write an invoice reminder' } });
  const kEn = karty(r.json.chat, 'koncept').pop();
  expect(kEn && kEn.subject === 'Invoice' && /^Hello/.test(kEn.text), 'EN: „Subject:“ se vytáhne taky');
  expect(/saved to the user's Documents/.test(systemZ(posledniVolani())), 'EN systém: dokumenty');
  void mock;
}, { nazev: 'AI-DOKUMENTY' });
