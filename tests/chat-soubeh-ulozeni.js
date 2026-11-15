// The assistant's conversation: one turn at a time, and a save that cannot fail on size
// (code analysis 4, findings S1-02, S1-01, S1-03 + the orphan image of the 3rd-round S1-02).
// API suite against a FAKE ollama — the mock answers by the CONTENT of the request, not
// from a queue, so concurrent requests cannot steal each other's answers. No real model.
//
// What is measured:
//   1) S1-02 /chat × /chat on one conversation, repeated: exactly one 200 and one 409
//      `chat_busy` per pair, every 200 has its message AND answer in the saved conversation,
//      the refused message is simply not there (the client keeps it) and can be sent again;
//   2) S1-02 /chat/potvrdit × /chat, both orders, repeated: the action is performed exactly
//      when its card says so — never "done but rejected", never done twice;
//   3) the lock is released after a failed turn; a foreign / unknown chat_id stays 404;
//   4) S1-03 one turn with 16 big reads: 200, the user's message is saved, the conversation
//      stays under the field cap, the newest results stay whole;
//   5) S1-01 a confirmation in a long conversation whose follow-up reads four big projects:
//      200, the card is "hotovo", the project exists once, the turn is in the usage log;
//      and when the follow-up FAILS, the card still says "hotovo" (saved before the model);
//   6) an image ordered in a turn that then fails does not stay as an orphan in `ceka`,
//      while the image of a successful turn stays.
//
// Run: KB_TEST_IMAGE=<image> node product/tests/chat-soubeh-ulozeni.js
const H = require('./_harness');
const { expect, sleep } = H;

let zdrzeniDopovedi = 0;   // ms: delay of the follow-up after a confirmed card
let dopovedCte = false;    // the follow-up reads four other big projects
let dopovedSelze = false;  // the follow-up answers HTTP 500
let velka = '';            // id of the big project
const velke = [];           // 16 more big projects (a repeated read of the same project in one turn is answered briefly)
const nastroj = (name, args) => ({ function: { name, arguments: args } });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  const b = JSON.parse(body);
  const msgs = b.messages || [];
  const iu = msgs.map((m) => m.role).lastIndexOf('user');
  const user = iu >= 0 ? String(msgs[iu].content || '') : '';
  const nastroju = msgs.slice(iu + 1).filter((m) => m.role === 'tool').length; // tool results of the current turn
  let zdrzeni = 0, status = 200;
  const message = { role: 'assistant', content: '' };
  const zn = (user.match(/\b(POMALU|RYCHLE|CTI16|CTI|PROJEKT|KRESLIOK|KRESLI|SELZE)-?([a-z0-9]*)/) || []);
  const co = zn[1] || '', kdo = zn[2] || '';
  if (co === 'POMALU') { zdrzeni = 1200; message.content = `Odpověď POMALU-${kdo}.`; }
  else if (co === 'RYCHLE') message.content = `Odpověď RYCHLE-${kdo}.`;
  else if (co === 'SELZE') status = 500;
  else if (co === 'CTI') { if (!nastroju) message.tool_calls = [nastroj('get_map', { map_id: velka })]; else message.content = `Přečteno CTI-${kdo}.`; }
  else if (co === 'CTI16') {
    if (nastroju < 16) message.tool_calls = [0, 1, 2, 3].map((k) => nastroj('get_map', { map_id: velke[nastroju + k] }));
    else message.content = 'Přečteno všech 16 projektů.';
  } else if (co === 'PROJEKT') {
    if (!nastroju) message.tool_calls = [nastroj('create_project', { title: `Projekt ${kdo}`, goal: `Cíl projektu ${kdo}`, outline: [{ title: 'První krok' }] })];
    else { // the follow-up after the confirmed (or rejected) card
      zdrzeni = zdrzeniDopovedi;
      if (dopovedSelze) status = 500;
      else if (dopovedCte && nastroju < 5) message.tool_calls = [0, 1, 2, 3].map((k) => nastroj('get_map', { map_id: velke[k] }));
      else message.content = `Dopověď PROJEKT-${kdo}.`;
    }
  } else if (co === 'KRESLI' || co === 'KRESLIOK') {
    if (!nastroju) message.tool_calls = [nastroj('generate_image', { prompt: 'a calm desk with a plant, flat illustration, no text', title: `Obrázek ${co}` })];
    else if (co === 'KRESLI') status = 500;
    else message.content = 'Kreslím.';
  } else message.content = 'ok';
  const odpoved = () => {
    if (status !== 200) { res.statusCode = status; res.end(JSON.stringify({ error: 'PODVRZENY-PAD-MODELU' })); return; }
    res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
  };
  if (zdrzeni) setTimeout(odpoved, zdrzeni); else odpoved();
};

// ~250 nodes with Czech descriptions: one read is far over the 12 000 characters kept per result
const POPIS = 'Připravit podklady pro výrobu, ověřit rozměry u zákazníka, objednat materiál a dohodnout termín montáže s partou. ';
function velkaMapa() {
  const nodes = [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Velký projekt', title: 'Velký projekt', status: 'todo' } }];
  const edges = [];
  for (let a = 0; a < 10; a++) {
    const ia = `a${a}`; nodes.push({ id: ia, type: 'goalNode', position: { x: a * 300, y: 200 }, data: { title: `Etapa ${a + 1} stavby`, description: POPIS.repeat(2).slice(0, 160), status: 'todo' } });
    edges.push({ id: `e-${ia}`, source: 'root', target: ia });
    for (let c = 0; c < 24; c++) {
      const ic = `${ia}c${c}`; nodes.push({ id: ic, type: 'goalNode', position: { x: a * 300 + c * 20, y: 400 + c * 60 }, data: { title: `Úkol ${a + 1}.${c + 1} dílny`, description: POPIS.repeat(2).slice(0, 160), status: 'todo' } });
      edges.push({ id: `e-${ic}`, source: ia, target: ic });
    }
  }
  return { nodes, edges };
}
const bajtu = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const brana = await H.httpMock((req, res) => { res.statusCode = 503; res.end('{}'); }); // the image gateway is never called here
  const inst = await H.startInstance({ slug: 'chat-soubeh', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 5000,
    KB_IMAGE_URL: brana.base + '/v1/advisor', KB_IMAGE_TOKEN: 'img_tok',
  } });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const ST = await inst.superuser();
  const m = velkaMapa();
  velka = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Velký projekt', nodes: m.nodes, edges: m.edges } })).json.id;
  for (let i = 0; i < 16; i++) velke.push((await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: `Velký projekt ${i + 1}`, nodes: m.nodes, edges: m.edges } })).json.id);
  expect(!!velka && velke.length === 16 && velke.every(Boolean), 'velké projekty založeny (1 + 16)');
  const chat = (body) => inst.api('POST', '/api/kb/chat', { token: A, body });
  const potvrd = (body) => inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body });
  const ulozeno = async (id) => (await inst.api('GET', `/api/collections/ai_chats/records/${id}`, { token: ST })).json;
  const projektu = async (title) => ((await inst.api('GET', `/api/collections/goalmaps/records?perPage=50&filter=${encodeURIComponent(`title="${title}"`)}`, { token: ST })).json.items || []).length;
  const logRadku = async () => (await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=1', { token: ST })).json.totalItems || 0;
  const obsahy = (rec, role) => (rec.messages || []).filter((x) => x.role === role).map((x) => String(x.content || ''));
  const kartaAkce = (rec) => (rec.messages || []).flatMap((x) => x.karty || []).filter((k) => k.type === 'akce').pop();
  const novy = async () => { const r = await chat({ message: 'RYCHLE-start' }); if (r.status !== 200) throw new Error(`nový rozhovor: ${r.status} ${JSON.stringify(r.json)}`); return r.json.chat.id; };

  console.log('== 1) dva souběžné tahy v jednom rozhovoru (S1-02) ==');
  const KOL = 12;
  let obe200 = 0, jedna409 = 0, ztraceno = 0, bezKodu = 0, nepravem = 0;
  const id1 = await novy();
  const odmitnute = [];
  for (let i = 0; i < KOL; i++) {
    const odstup = i % 2 ? 150 : 0; // odd rounds: the second request arrives while the first one waits for the model
    const p1 = chat({ chat_id: id1, message: `POMALU-a${i}` });
    if (odstup) await sleep(odstup);
    const p2 = chat({ chat_id: id1, message: `RYCHLE-b${i}` });
    const [r1, r2] = await Promise.all([p1, p2]);
    const st = [r1.status, r2.status].sort().join(',');
    if (st === '200,200') obe200++;
    if (st === '200,409') jedna409++;
    const rec = await ulozeno(id1);
    const u = obsahy(rec, 'user'), a = obsahy(rec, 'assistant');
    for (const [r, zn] of [[r1, `POMALU-a${i}`], [r2, `RYCHLE-b${i}`]]) {
      const uloz = u.includes(zn) && a.includes(`Odpověď ${zn}.`);
      if (r.status === 200 && !uloz) ztraceno++;
      if (r.status === 409) { if ((r.json || {}).code !== 'chat_busy' || !/Rozhovor právě odpovídá/.test((r.json || {}).error || '')) bezKodu++; if (u.includes(zn)) nepravem++; odmitnute.push(zn); }
    }
  }
  console.log(`     ${KOL} dvojic: obě 200 = ${obe200}, 200+409 = ${jedna409}, tah s odpovědí 200 chybí v rozhovoru = ${ztraceno}`);
  expect(ztraceno === 0, `žádný tah, který dostal 200, v uloženém rozhovoru nechybí (ztraceno ${ztraceno} z ${KOL} dvojic)`);
  expect(jedna409 === KOL && obe200 === 0, `v každé dvojici právě jeden 200 a jeden 409 (${jedna409}/${KOL}; obě 200: ${obe200})`);
  expect(bezKodu === 0 && nepravem === 0 && odmitnute.length === KOL, `odmítnutý dostal kód chat_busy a srozumitelnou větu; jeho zpráva v rozhovoru není (${bezKodu}, ${nepravem})`);
  let r = await chat({ chat_id: id1, message: odmitnute[0] });
  let rec = await ulozeno(id1);
  expect(r.status === 200 && obsahy(rec, 'user').includes(odmitnute[0]), `odmítnutou zprávu jde hned poslat znovu (${r.status})`);
  expect(obsahy(rec, 'user').length === 1 + KOL + 1, `v rozhovoru je přesně ${KOL + 2} zpráv uživatele (${obsahy(rec, 'user').length})`);
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: id1, message: 'RYCHLE-en' }, headers: { 'Accept-Language': 'en' } });
  expect(r.status === 200, `po sérii souběhů rozhovor běží dál (${r.status})`);

  console.log('== 2) potvrzení karty × nová zpráva (S1-02), obě pořadí ==');
  let spatne = 0, podruhe = 0, kol2 = 0;
  for (let i = 0; i < 6; i++) {
    // a) the confirmation is running (slow follow-up), a message arrives
    const id = await novy();
    r = await chat({ chat_id: id, message: `PROJEKT-p${i}` });
    const karta = kartaAkce(r.json.chat);
    if (!karta || karta.stav !== 'ceka') { spatne++; continue; }
    zdrzeniDopovedi = 1200;
    const pp = potvrd({ chat_id: id, action_id: karta.id, ok: true });
    await sleep(i % 2 ? 150 : 0);
    const pz = chat({ chat_id: id, message: `RYCHLE-z${i}` });
    const [rp, rz] = await Promise.all([pp, pz]);
    zdrzeniDopovedi = 0;
    rec = await ulozeno(id);
    const k = kartaAkce(rec);
    const n = await projektu(`Projekt p${i}`);
    // whichever request won, the card and the project must agree
    const shoda = (k.stav === 'hotovo' && n === 1) || (k.stav === 'zamitnuto' && n === 0);
    const jeden = [rp.status, rz.status].sort().join(',') === '200,409' || (rp.status === 404 && rz.status === 200);
    if (!shoda || !jeden) { spatne++; console.log(`     a${i}: potvrdit ${rp.status}, zpráva ${rz.status}, karta ${k.stav}, projektů ${n}`); }
    if (n > 1) podruhe++;
    kol2++;
    // b) a turn is running, the confirmation arrives → refused, the card keeps waiting until the turn rejects it
    const idb = await novy();
    r = await chat({ chat_id: idb, message: `PROJEKT-q${i}` });
    const kb = kartaAkce(r.json.chat);
    const pm = chat({ chat_id: idb, message: `POMALU-m${i}` });
    await sleep(150);
    const rpb = await potvrd({ chat_id: idb, action_id: kb.id, ok: true });
    const rm = await pm;
    rec = await ulozeno(idb);
    const nb = await projektu(`Projekt q${i}`);
    if (!(rpb.status === 409 && (rpb.json || {}).code === 'chat_busy' && rm.status === 200 && nb === 0 && kartaAkce(rec).stav === 'zamitnuto' && obsahy(rec, 'assistant').includes(`Odpověď POMALU-m${i}.`))) {
      spatne++; console.log(`     b${i}: potvrdit ${rpb.status}, zpráva ${rm.status}, karta ${kartaAkce(rec).stav}, projektů ${nb}`);
    }
    kol2++;
  }
  expect(spatne === 0, `ve všech ${kol2} kolech souhlasí karta se skutečností (provedeno ⇔ „hotovo", neprovedeno ⇔ „zamítnuto") a druhý požadavek dostal 409 (neshod ${spatne})`);
  expect(podruhe === 0, `žádná akce se neprovedla dvakrát (${podruhe})`);

  console.log('== 3) zámek se uvolní i po chybě; cizí rozhovor zůstává 404 ==');
  const id3 = await novy();
  r = await chat({ chat_id: id3, message: 'SELZE-x' });
  expect(r.status === 502, `tah s pádem modelu → 502 (${r.status})`);
  r = await chat({ chat_id: id3, message: 'RYCHLE-po' });
  expect(r.status === 200, `další tah po pádu projde — zámek nezůstal viset (${r.status} ${(r.json || {}).error || ''})`);
  r = await inst.api('POST', '/api/kb/chat', { token: B, body: { chat_id: id3, message: 'RYCHLE-cizi' } });
  expect(r.status === 404, `cizí chat_id → 404 (${r.status})`);
  const pc = chat({ chat_id: id3, message: 'POMALU-drzi' });
  await sleep(200);
  r = await inst.api('POST', '/api/kb/chat', { token: B, body: { chat_id: id3, message: 'RYCHLE-cizi2' } });
  expect(r.status === 404, `cizí chat_id je 404 i ve chvíli, kdy rozhovor odpovídá — zámek nic neprozradí (${r.status})`);
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { chat_id: id3, message: 'RYCHLE-en2' }, headers: { 'Accept-Language': 'en' } });
  expect(r.status === 409, `vlastník během tahu dostane 409 (${r.status})`);
  await pc;
  r = await inst.api('POST', '/api/kb/chat/vratit', { token: A, body: { chat_id: id3, karta_id: 'neexistuje' } });
  expect(r.status === 404, `po tahu je rozhovor volný i pro ostatní routy (${r.status})`);

  console.log('== 4) jeden tah se 16 velkými čteními (S1-03) ==');
  let pred = await logRadku();
  r = await chat({ message: 'CTI16-vse projdi všechny projekty' });
  expect(r.status === 200, `tah se 16 čteními → 200 (${r.status} ${(r.json || {}).error || ''})`);
  const id4 = r.status === 200 ? r.json.chat.id : '';
  if (id4) {
    rec = await ulozeno(id4);
    const tools = (rec.messages || []).filter((x) => x.role === 'tool').map((x) => String(x.content || '').length);
    expect(obsahy(rec, 'user').some((x) => /CTI16-vse/.test(x)) && obsahy(rec, 'assistant').includes('Přečteno všech 16 projektů.'), 'zpráva uživatele i odpověď jsou uložené');
    expect(tools.length === 16 && bajtu(rec.messages) < 200000, `16 výsledků čtení, rozhovor ${bajtu(rec.messages)} B < 200 kB`);
    expect(tools[15] === 12000 && tools[0] === 600 && tools.every((n) => n === 600 || n === 12000), `nejnovější čtení zůstala celá, nejstarší se zkrátila (${tools.join(',')})`);
    expect(await logRadku() === pred + 1, 'tah má řádek v ai_chat_log');
    r = await chat({ chat_id: id4, message: 'RYCHLE-po16' });
    expect(r.status === 200, `rozhovor po velkém tahu pokračuje (${r.status})`);
  } else expect(false, 'rozhovor nevznikl — zpráva uživatele je ztracená');

  console.log('== 5) potvrzení karty v dlouhém rozhovoru (S1-01) ==');
  let id5 = '';
  for (let i = 0; i < 12; i++) {
    r = await chat(Object.assign({ message: `CTI-${i} co je v projektu?` }, id5 ? { chat_id: id5 } : {}));
    if (r.status !== 200) throw new Error(`čtecí tah ${i}: ${r.status} ${JSON.stringify(r.json)}`);
    id5 = r.json.chat.id;
  }
  r = await chat({ chat_id: id5, message: 'PROJEKT-dlouhy založ projekt' });
  let karta5 = kartaAkce(r.json.chat);
  rec = await ulozeno(id5);
  expect(r.status === 200 && !!karta5 && karta5.stav === 'ceka' && bajtu(rec.messages) > 150000, `předpoklad: dlouhý rozhovor (${bajtu(rec.messages)} B) s čekající kartou`);
  dopovedCte = true;
  pred = await logRadku();
  r = await potvrd({ chat_id: id5, action_id: karta5.id, ok: true });
  dopovedCte = false;
  expect(r.status === 200, `potvrzení s dopovědí, která čte čtyři velké projekty → 200 (${r.status} ${(r.json || {}).error || ''})`);
  rec = await ulozeno(id5);
  expect(kartaAkce(rec).stav === 'hotovo' && (rec.pending || []).length === 0, `karta v uloženém rozhovoru je „hotovo" (${kartaAkce(rec).stav})`);
  expect(await projektu('Projekt dlouhy') === 1, 'projekt vznikl právě jednou');
  expect(obsahy(rec, 'assistant').includes('Dopověď PROJEKT-dlouhy.') && bajtu(rec.messages) < 200000, `dopověď modelu je uložená, rozhovor ${bajtu(rec.messages)} B < 200 kB`);
  const dop = (rec.messages || []).filter((x) => x.role === 'tool').slice(-4).map((x) => String(x.content || '').length);
  expect(dop.join() === '12000,12000,12000,12000', `čtení z dopovědi jsou uložená celá (${dop.join()})`);
  expect(await logRadku() === pred + 1, 'potvrzení má řádek v ai_chat_log');
  r = await potvrd({ chat_id: id5, action_id: karta5.id, ok: true });
  expect(r.status === 404 && await projektu('Projekt dlouhy') === 1, `druhý klik na hotovou kartu nic neprovede (${r.status})`);
  // the follow-up fails → the performed action is in the conversation anyway
  r = await chat({ chat_id: id5, message: 'PROJEKT-pad založ další' });
  karta5 = kartaAkce(r.json.chat);
  dopovedSelze = true;
  r = await potvrd({ chat_id: id5, action_id: karta5.id, ok: true });
  dopovedSelze = false;
  rec = await ulozeno(id5);
  expect(r.status === 502 && await projektu('Projekt pad') === 1 && kartaAkce(rec).stav === 'hotovo', `dopověď spadla (${r.status}), akce je provedená a karta to říká: „${kartaAkce(rec).stav}"`);
  r = await chat({ chat_id: id5, message: 'RYCHLE-popadu' });
  rec = await ulozeno(id5);
  expect(r.status === 200 && kartaAkce(rec).stav === 'hotovo', `další zpráva projde a karta zůstává „hotovo" (${r.status}, ${kartaAkce(rec).stav})`);

  console.log('== 6) obrázek zadaný v tahu, který pak spadl ==');
  const obrazky = async () => (await inst.api('GET', '/api/collections/ai_images/records?perPage=50', { token: ST })).json.items || [];
  r = await chat({ message: 'Nakresli mi obrázek KRESLIOK-a' });
  const kartaObr = r.status === 200 ? (r.json.chat.messages || []).flatMap((x) => x.karty || []).find((k) => k.type === 'obrazek') : null;
  let obr = await obrazky();
  expect(r.status === 200 && !!kartaObr && obr.length === 1 && obr[0].stav === 'ceka', `úspěšný tah: karta obrázku a záznam „ceka" zůstávají (${r.status}, ${obr.length})`);
  r = await chat({ message: 'Nakresli mi obrázek KRESLI-b' });
  obr = await obrazky();
  expect(r.status === 502, `tah po zadání obrázku spadl (${r.status})`);
  expect(obr.length === 1 && obr[0].title === 'Obrázek KRESLIOK', `po spadlém tahu nezůstal osiřelý obrázek ve stavu „ceka" (záznamů ${obr.length}: ${obr.map((o) => o.title + ':' + o.stav).join(', ')})`);
}, { nazev: 'CHAT-SOUBEH-ULOZENI' });
