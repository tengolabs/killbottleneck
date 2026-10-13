// Rozjezd (10. 10. 2026): první tahy rozhovoru dělá první hlavní model (rychlý cloud), od KB_CHAT_ROZJEZD-tého tahu druhý
// (KB_CHAT2_*, lokální). Dva podvržené servery: A = první model, B = druhý. Ověřuje: tah 1 → A, tah 2 → B, log má #druhy,
// /chat/predehrat pošle B stejnou historii s 1 tokenem výstupu a nic nezapíše; bez KB_CHAT_ROZJEZD jde vše na A (mutace).
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-rozjezd.js
const H = require('./_harness');
const { expect } = H;

function mock(jmeno, volani) {
  return (req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: jmeno }] })); return; }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
    const b = JSON.parse(body); volani.push(b);
    const predehrati = b.options && b.options.num_predict === 1;
    const posl = b.messages[b.messages.length - 1] || {}; const poslUser = [...b.messages].reverse().find((m) => m.role === 'user') || {};
    const message = { role: 'assistant', content: predehrati ? '' : `Odpověď modelu ${jmeno} (${b.messages.filter((m) => m.role === 'user').length}. zpráva)` };
    // stín: „(nástroj)“ → nejdřív čtení get_my_day, „(zápis)“ → add_nodes; po výsledku nástroje text
    if (!predehrati && posl.role !== 'tool' && /\(nástroj\)/.test(poslUser.content || '')) message.tool_calls = [{ function: { name: 'get_my_day', arguments: {} } }];
    if (!predehrati && posl.role !== 'tool' && /\(zápis\)/.test(poslUser.content || '')) message.tool_calls = [{ function: { name: 'add_nodes', arguments: { map_id: 'x', items: [{ title: 'Stínový krok' }] } } }];
    if (posl.role === 'tool') message.content = `Odpověď ${jmeno} po nástroji ${posl.name || ''}: ${String(posl.content || '').slice(0, 40)}`;
    res.end(JSON.stringify({ message, prompt_eval_count: 100, eval_count: predehrati ? 1 : 20, done: true }));
  };
}

H.beh(async () => {
  const vA = [], vB = [];
  const A = await H.httpMock(mock('m-a', vA));
  const B = await H.httpMock(mock('m-b', vB));
  const spolecne = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: A.base, KB_CHAT_MODEL: 'm-a', KB_CHAT_TOKEN: 't', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_CHAT2_PROVIDER: 'ollama', KB_CHAT2_URL: B.base, KB_CHAT2_MODEL: 'm-b', KB_CHAT2_TOKEN: 't' };

  // 1) rozjezd po 1 tahu
  const inst = await H.startInstance({ slug: 'rozjezd', addHostGateway: true, env: Object.assign({ KB_CHAT_ROZJEZD: '1' }, spolecne) });
  await inst.register('admin@example.com', { name: 'Petr' });
  const T = await inst.login('admin@example.com');
  const r1 = await inst.api('POST', '/api/kb/chat', { token: T, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  expect(r1.status === 200, `tah 1 prošel (${r1.status})`);
  const chatId = r1.json.chat.id;
  expect(vA.length >= 1 && vB.length === 0, `tah 1 odpověděl první model A (A ${vA.length}×, B ${vB.length}×)`);
  // předehřátí: po 1. tahu už příští půjde B → B dostane historii s num_predict 1, nic se do rozhovoru nezapíše
  const pocetZprav = r1.json.chat.messages.length;
  const p = await inst.api('POST', '/api/kb/chat/predehrat', { token: T, body: { chat_id: chatId, context: { route: '/' } } });
  expect(p.status === 200 && p.json.stav === 'ok', `předehřátí proběhlo (${p.status} ${JSON.stringify(p.json).slice(0, 80)})`);
  expect(vB.length === 1 && vB[0].options && vB[0].options.num_predict === 1, 'předehřátí šlo na B s 1 tokenem výstupu');
  const uz = vB[0].messages.filter((m) => m.role === 'user');
  expect(vB[0].messages.some((m) => m.role === 'system') && uz.length === 2 && /Co mám dnes/.test(uz[0].content) && !/Co mám dnes/.test(uz[1].content), `předehřátí poslalo systém + historii + prázdnou zprávu příštího tahu (${uz.length} zpráv uživatele)`);
  const detail = (await inst.api('GET', `/api/kb/chat/detail/${chatId}`, { token: T })).json.chat;
  expect(detail.messages.length === pocetZprav, 'předehřátí do rozhovoru nic nezapsalo');
  const r2 = await inst.api('POST', '/api/kb/chat', { token: T, body: { chat_id: chatId, message: 'A co zítra?', context: { route: '/' } } });
  expect(r2.status === 200, `tah 2 prošel (${r2.status})`);
  expect(vB.length === 2 && vA.length === 1, `tah 2 odpověděl druhý model B (A ${vA.length}×, B ${vB.length}×)`);
  const posl = r2.json.chat.messages.filter((m) => m.role === 'assistant').pop();
  expect(/m-b/.test(posl.content), `odpověď je od B: „${posl.content}“`);
  const su = await inst.superuser();
  const log = (await inst.api('GET', `/api/collections/ai_chat_log/records?perPage=10&sort=created&filter=${encodeURIComponent(`chat='${chatId}'`)}`, { token: su })).json.items || [];
  expect(log.length === 2 && /#brzy/.test(log[0].model) && /m-b.*#druhy/.test(log[1].model), `log značí tahy (${log.map((l) => l.model).join(' | ')})`);
  // slot obsazený / server nedostupný → tah zůstane u A (bezpečná strana)
  const inst2 = await H.startInstance({ slug: 'rozjezdplno', addHostGateway: true, env: Object.assign({ KB_CHAT_ROZJEZD: '0', KB_CHAT2_SLOTS_URL: B.base + '/slots-neexistuje' }, spolecne) });
  await inst2.register('admin@example.com', { name: 'Petr' });
  const T2 = await inst2.login('admin@example.com');
  const a0 = vA.length;
  const r3 = await inst2.api('POST', '/api/kb/chat', { token: T2, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  expect(r3.status === 200 && vA.length === a0 + 1 && vB.length === 2, 'bez volného slotu (nedostupné /slots) zůstává tah u A');
  const log2 = (await inst2.api('GET', `/api/collections/ai_chat_log/records?perPage=10&sort=created`, { token: await inst2.superuser() })).json.items || [];
  expect(log2.length === 1 && /#plno/.test(log2[0].model), `log značí #plno (${log2.map((l) => l.model).join(' | ')})`);

  // 1b) jen čtení + jeden rozhovor + stín + pád druhého modelu
  const inst4 = await H.startInstance({ slug: 'rozjezdcteni', addHostGateway: true, env: Object.assign({ KB_CHAT_ROZJEZD: '0', KB_CHAT_ROZJEZD_CO: 'cteni', KB_CHAT2_JEDEN: '1', KB_CHAT2_STIN: '1' }, spolecne) });
  await inst4.register('admin@example.com', { name: 'Petr' });
  const T4 = await inst4.login('admin@example.com');
  const a2 = vA.length, b2 = vB.length;
  const c1 = await inst4.api('POST', '/api/kb/chat', { token: T4, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  expect(c1.status === 200 && vB.length === b2 + 1 && vA.length === a2, 'jen čtení: otázka jde druhému modelu B');
  const c2 = await inst4.api('POST', '/api/kb/chat', { token: T4, body: { chat_id: c1.json.chat.id, message: 'Hotovo, zavolal jsem Novákovi.', context: { route: '/' } } });
  expect(c2.status === 200 && vA.length === a2 + 1 && vB.length === b2 + 1, 'jen čtení: zápis („Hotovo, zavolal jsem“) zůstává prvnímu modelu A');
  await inst4.register('druhy@example.com', { name: 'Jana' });
  const T4b = await inst4.login('druhy@example.com');
  const c3 = await inst4.api('POST', '/api/kb/chat', { token: T4b, body: { message: 'Jak jsme na tom?', context: { route: '/' } } }); // DRUHÝ člověk, zatímco první drží zápůjčku
  expect(c3.status === 200 && vA.length === a2 + 2 && vB.length === b2 + 1, 'jeden člověk: druhý uživatel jde prvnímu modelu (zápůjčku drží první)');
  const c4 = await inst4.api('POST', '/api/kb/chat', { token: T4, body: { message: 'Jak jsme na tom?', context: { route: '/' } } }); // první člověk, nový rozhovor → zápůjčka je jeho
  expect(c4.status === 200 && vB.length === b2 + 2, 'jeden člověk: držitel zápůjčky dostane druhý model i v novém rozhovoru');
  const log4 = (await inst4.api('GET', `/api/collections/ai_chat_log/records?perPage=10&sort=created`, { token: await inst4.superuser() })).json.items || [];
  expect(log4.map((l) => l.model).join(' | ') === 'm-b#druhy | m-a#zapis | m-a#obsazeno | m-b#druhy', `log značí druhy / zapis / obsazeno / druhy (${log4.map((l) => l.model).join(' | ')})`);
  const st = await inst4.api('POST', '/api/kb/chat/predehrat', { token: T4, body: { chat_id: c1.json.chat.id, context: { route: '/' } } });
  expect(st.status === 200 && st.json.stav === 'ok' && st.json.stin && /m-b/.test(st.json.stin.text || ''), `stín vrátil odpověď druhého modelu (${JSON.stringify(st.json.stin || {}).slice(0, 100)})`);
  const d4 = (await inst4.api('GET', `/api/kb/chat/detail/${c1.json.chat.id}`, { token: T4 })).json.chat;
  expect(d4.messages.length === c2.json.chat.messages.length, 'stín do rozhovoru nic nezapsal');
  // stín vykoná čtení (get_my_day → skutečný výsledek), zápis ne (add_nodes → žádná karta, mapa beze změny)
  const c5 = await inst4.api('POST', '/api/kb/chat', { token: T4, body: { chat_id: c1.json.chat.id, message: 'Hotovo, ještě něco (nástroj)', context: { route: '/' } } }); // zápis → A
  const s5 = await inst4.api('POST', '/api/kb/chat/predehrat', { token: T4, body: { chat_id: c1.json.chat.id, context: { route: '/' } } });
  expect(s5.json.stin && (s5.json.stin.nastroje || [])[0] === 'get_my_day' && /po nástroji/.test(s5.json.stin.text || '') && /No open work|dnes/.test(s5.json.stin.text || '') && s5.json.stin.volani === 2, `stín vykonal čtení get_my_day a dopověděl (${JSON.stringify(s5.json.stin || {}).slice(0, 140)})`);
  const c6 = await inst4.api('POST', '/api/kb/chat', { token: T4, body: { chat_id: c1.json.chat.id, message: 'Hotovo, přidej krok (zápis)', context: { route: '/' } } });
  const s6 = await inst4.api('POST', '/api/kb/chat/predehrat', { token: T4, body: { chat_id: c1.json.chat.id, context: { route: '/' } } });
  const d6 = (await inst4.api('GET', `/api/kb/chat/detail/${c1.json.chat.id}`, { token: T4 })).json.chat;
  expect(s6.json.stin && (s6.json.stin.nastroje || [])[0] === 'add_nodes' && /Not executed|po nástroji add_nodes/.test(s6.json.stin.text || '') && (d6.pending || []).length === (c6.json.chat.pending || []).length && d6.messages.length === c6.json.chat.messages.length, `stín zápis nevykonal: žádná karta navíc, rozhovor beze změny (${JSON.stringify(s6.json.stin || {}).slice(0, 120)})`);
  // pád druhého modelu → tah dokončí první (B míří na mrtvý port)
  const inst5 = await H.startInstance({ slug: 'rozjezdpad', addHostGateway: true, env: Object.assign({ KB_CHAT_ROZJEZD: '0' }, spolecne, { KB_CHAT2_URL: 'http://127.0.0.1:9' }) });
  await inst5.register('admin@example.com', { name: 'Petr' });
  const T5 = await inst5.login('admin@example.com');
  const a3 = vA.length;
  const p5 = await inst5.api('POST', '/api/kb/chat', { token: T5, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  expect(p5.status === 200 && vA.length === a3 + 1 && /m-a/.test((p5.json.chat.messages.filter((m) => m.role === 'assistant').pop() || {}).content || ''), 'pád druhého modelu: tah dokončil první model, uživatel chybu nevidí');
  const log5 = (await inst5.api('GET', `/api/collections/ai_chat_log/records?perPage=10&sort=created`, { token: await inst5.superuser() })).json.items || [];
  expect(log5.length === 1 && /#pad/.test(log5[0].model), `log značí #pad (${log5.map((l) => l.model).join(' | ')})`);

  // 1b2) koncepty textů píše vždy první model (čeština — Richard 10. 10.)
  const a8 = vA.length, b8 = vB.length;
  const k8 = await inst4.api('POST', '/api/kb/chat', { token: T4, body: { chat_id: c1.json.chat.id, message: 'Napiš mi e-mail dodavatelům s poptávkou na dubové spárovky.', context: { route: '/' } } });
  expect(k8.status === 200 && vA.length === a8 + 1 && vB.length === b8, 'koncept (e-mail) zůstává prvnímu modelu A');
  const log8 = (await inst4.api('GET', `/api/collections/ai_chat_log/records?perPage=20&sort=-created`, { token: await inst4.superuser() })).json.items || [];
  expect(/#koncept/.test((log8[0] || {}).model || ''), `log značí #koncept (${(log8[0] || {}).model})`);

  // 1c) nástroje „historie“: předehřátí a příští tah pošlou druhému modelu STEJNÝ seznam nástrojů (prompt = prefix → cache), i když nová zpráva otevírá skupinu
  const inst6 = await H.startInstance({ slug: 'rozjezdhist', addHostGateway: true, env: Object.assign({ KB_CHAT_ROZJEZD: '0', KB_CHAT2_TOOLS: 'historie' }, spolecne) });
  await inst6.register('admin@example.com', { name: 'Petr' });
  const T6 = await inst6.login('admin@example.com');
  const h1 = await inst6.api('POST', '/api/kb/chat', { token: T6, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  const b6 = vB.length;
  const h2 = await inst6.api('POST', '/api/kb/chat/predehrat', { token: T6, body: { chat_id: h1.json.chat.id, context: { route: '/' } } });
  const h3 = await inst6.api('POST', '/api/kb/chat', { token: T6, body: { chat_id: h1.json.chat.id, message: 'Když bude hotový krok Objednat dřevo, dej mi vědět pravidlem.', context: { route: '/' } } });
  const nPred = (vB[b6] && vB[b6].tools || []).length, nTah = (vB[b6 + 1] && vB[b6 + 1].tools || []).length;
  expect(h2.json.stav === 'ok' && h3.status === 200 && nPred > 0 && nPred === nTah, `historie: předehřátí i tah mají stejný seznam nástrojů (${nPred} vs ${nTah}), nová zpráva o pravidle ho nemění`);
  expect(JSON.stringify(vB[b6].messages.find((m) => m.role === 'system')) === JSON.stringify(vB[b6 + 1].messages.find((m) => m.role === 'system')), 'historie: systémová zpráva předehřátí a tahu je shodná');
  const inst7 = await H.startInstance({ slug: 'rozjezdskup', addHostGateway: true, env: Object.assign({ KB_CHAT_ROZJEZD: '0', KB_CHAT2_TOOLS: 'skupiny' }, spolecne) });
  await inst7.register('admin@example.com', { name: 'Petr' });
  const T7 = await inst7.login('admin@example.com');
  const k1 = await inst7.api('POST', '/api/kb/chat', { token: T7, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  const b7 = vB.length;
  await inst7.api('POST', '/api/kb/chat/predehrat', { token: T7, body: { chat_id: k1.json.chat.id, context: { route: '/' } } });
  await inst7.api('POST', '/api/kb/chat', { token: T7, body: { chat_id: k1.json.chat.id, message: 'Když bude hotový krok Objednat dřevo, dej mi vědět pravidlem.', context: { route: '/' } } });
  expect((vB[b7].tools || []).length < (vB[b7 + 1].tools || []).length, `skupiny (mutace): nová zpráva o pravidle seznam nástrojů rozšíří (${(vB[b7].tools || []).length} → ${(vB[b7 + 1].tools || []).length})`);

  // 2) mutace: bez KB_CHAT_ROZJEZD jde vše na A a předehřátí hlásí vypnuto
  const inst3 = await H.startInstance({ slug: 'bezrozjezdu', addHostGateway: true, env: spolecne });
  await inst3.register('admin@example.com', { name: 'Petr' });
  const T3 = await inst3.login('admin@example.com');
  const a1 = vA.length, b1 = vB.length;
  const m1 = await inst3.api('POST', '/api/kb/chat', { token: T3, body: { message: 'Co mám dnes na práci?', context: { route: '/' } } });
  const m2 = await inst3.api('POST', '/api/kb/chat', { token: T3, body: { chat_id: m1.json.chat.id, message: 'A co zítra?', context: { route: '/' } } });
  expect(m1.status === 200 && m2.status === 200 && vA.length === a1 + 2 && vB.length === b1, 'bez KB_CHAT_ROZJEZD oba tahy na A, B nic');
  const p3 = await inst3.api('POST', '/api/kb/chat/predehrat', { token: T3, body: { chat_id: m1.json.chat.id, context: {} } });
  expect(p3.status === 200 && p3.json.stav === 'vypnuto', `předehřátí bez rozjezdu: vypnuto (${JSON.stringify(p3.json)})`);
});
