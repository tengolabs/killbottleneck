// Měření tokenů asistenta (4. 10. 2026) — KOLIK DAT jde modelu v každém volání.
//
// Sada proti PODVRŽENÉ ollamě přehraje pevný scénář ~9 tahů (čtení mapy, přidání kroků
// s potvrzením, úprava kroku, koncept e-mailu, nastavení upozornění, dlouhý vložený text,
// pravidla, přehled týmu) a u KAŽDÉHO volání modelu změří: systémovou zprávu, schémata
// nástrojů, historii a výsledky nástrojů (znaky + tokeny), počet nástrojů a otevřené
// skupiny. Navíc hlídá CACHE PREFIXU: po sobě jdoucí volání v jednom rozhovoru musí mít
// předchozí prompt jako prefix (jinak dodavatel účtuje vstup plnou cenou).
//
// Souhrn se zapíše jako JSON (KB_TOKENY_OUT, výchozí /tmp/ai-tokeny.json) — slouží
// k porovnání PŘED/PO každé úsporné změně. Tokeny: tokenizér gpt-oss
// (KB_TOKENIZER_URL, výchozí http://127.0.0.1:8087/tokenize); bez něj odhad znaky/3,5.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-tokeny.js
const H = require('./_harness');
const { expect } = H;
const fs = require('fs');

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

// ---------- tokenizér ----------
const TOK_URL = process.env.KB_TOKENIZER_URL || 'http://127.0.0.1:8087/tokenize';
let tokenizerOk = null;
async function tokeny(s) {
  if (!s) return 0;
  if (tokenizerOk !== false) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(TOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: s }), signal: ctl.signal });
      clearTimeout(t);
      if (r.ok) { const j = await r.json(); if (Array.isArray(j.tokens)) { tokenizerOk = true; return j.tokens.length; } }
    } catch (e) { /* spadne na odhad */ }
    tokenizerOk = false;
  }
  return Math.ceil(s.length / 3.5);
}

// ---------- měření jednoho volání ----------
const SKUPINOVE = new Set(['open_tools', 'list_maps', 'get_map', 'get_my_day', 'list_ideas', 'ask_user', 'add_idea_to_map', 'delete_ideas', 'add_nodes', 'update_node', 'delete_node', 'move_node', 'update_idea', 'draft_text', 'suggest_next', 'add_idea', 'remember']); // základ (bez skupiny)
async function zmer(v, idx, tah) {
  const sys = (v.messages.find((m) => m.role === 'system') || {}).content || '';
  const hist = v.messages.filter((m) => m.role !== 'system');
  const toolsJson = JSON.stringify(v.tools || []);
  const vysledky = hist.filter((m) => m.role === 'tool').map((m) => m.content || '').join('\n');
  const uzivatel = hist.filter((m) => m.role === 'user').map((m) => m.content || '').join('\n');
  const asistent = hist.filter((m) => m.role === 'assistant').map((m) => (m.content || '') + JSON.stringify(m.tool_calls || '')).join('\n');
  const jmena = (v.tools || []).map((t) => t.function.name);
  const navic = jmena.filter((n) => !SKUPINOVE.has(n));
  return {
    idx, tah, nastroju: jmena.length, nastroju_mimo_zaklad: navic.length,
    sys_zn: sys.length, sys_tok: await tokeny(sys),
    tools_zn: toolsJson.length, tools_tok: await tokeny(toolsJson),
    hist_zpr: hist.length, hist_zn: hist.reduce((a, m) => a + (m.content || '').length + JSON.stringify(m.tool_calls || '').length, 0),
    hist_tok: await tokeny(uzivatel) + await tokeny(asistent) + await tokeny(vysledky),
    vysledky_zn: vysledky.length, uzivatel_zn: uzivatel.length,
    _sys: sys, _tools: toolsJson, _hist: hist,
  };
}

// Prefix cache: dodavatel účtuje levně tu část promptu, která je BAJTOVĚ stejná jako začátek předchozího požadavku.
// Pořadí v promptu ≈ systém → nástroje → historie; co se změní, od toho místa dál se platí plně. `ztrata` = odhad
// podílu promptu, který kvůli změně NENÍ z cache (0 = drží celý, 1 = nic). Změna systému = ztráta všeho; nová skupina
// nástrojů = ztráta nástrojů + historie; změna uprostřed historie = ztráta jen zbytku historie za tím místem.
function prefixDrzi(pred, akt) {
  if (!pred) return { drzi: true, ztrata: 0 };
  const celkem = akt._sys.length + akt._tools.length + JSON.stringify(akt._hist).length;
  if (pred._sys !== akt._sys) {
    // etapa 3: systém roste o skupinový fragment, když se otevře skupina → ztráta od místa vložení (jako u nástrojů), ne celý prompt
    let k = 0; while (k < pred._sys.length && pred._sys[k] === akt._sys[k]) k++;
    const ztrata = (celkem - k) / celkem;
    if (akt.nastroju > pred.nastroju && akt._sys.length > pred._sys.length) return { drzi: false, ztrata, proc: 'přibyla skupina nástrojů' };
    return { drzi: false, ztrata, proc: `systém se změnil @${k}: „${pred._sys.slice(Math.max(0, k - 40), k + 40)}“ → „${akt._sys.slice(Math.max(0, k - 40), k + 40)}“` };
  }
  if (pred._tools !== akt._tools) {
    const ztrata = (celkem - akt._sys.length) / celkem;
    if (akt.nastroju > pred.nastroju) return { drzi: false, ztrata, proc: 'přibyla skupina nástrojů' };
    let k = 0; while (k < pred._tools.length && pred._tools[k] === akt._tools[k]) k++;
    return { drzi: false, ztrata, proc: `nástroje se změnily @${k}: „${pred._tools.slice(Math.max(0, k - 60), k + 40)}“ → „${akt._tools.slice(Math.max(0, k - 60), k + 40)}“` };
  }
  const a = JSON.stringify(akt._hist); const p = JSON.stringify(pred._hist).slice(0, -1); // bez uzavírací ]
  if (!a.startsWith(p)) {
    let k = 0; while (k < p.length && p[k] === a[k]) k++;
    const ztrata = (a.length - k) / celkem;
    return { drzi: false, ztrata, hluboko: (a.length - k) / a.length, proc: `historie přepsaná @${k}/${a.length} (ztráta ${Math.round(100 * ztrata)} % promptu): „${p.slice(Math.max(0, k - 50), k + 30)}“ → „${a.slice(Math.max(0, k - 50), k + 30)}“` };
  }
  return { drzi: true, ztrata: 0 };
}

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'tokeny', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_CHAT_TOKEN: 't', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_CHAT_POTVRZENI: null, // produkční výchozí (app): jednoduchou kartu dopoví aplikace bez modelu
  } });
  await inst.register('admin@example.com', { name: 'Petr' });
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const meA = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'admin@example.com', password: H.PW } })).json.record;

  // podklady jako u skutečného uživatele: 4 mapy, jedna větší (14 uzlů), 5 nápadů, paměť
  const uzly = (n) => {
    const nodes = [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň Dvořákovi', title: 'Kuchyň Dvořákovi', status: 'todo' } }];
    const edges = [];
    for (let i = 1; i <= n; i++) {
      nodes.push({ id: `n${i}`, type: 'goalNode', position: { x: 0, y: 200 * i }, data: { title: `Krok ${i}: ${['Zaměření', 'Návrh', 'Cenová nabídka', 'Objednat dřevo', 'Nařezat díly', 'Montáž korpusů', 'Dvířka', 'Kování', 'Lakování', 'Doprava', 'Montáž u zákazníka', 'Fakturace', 'Reklamace', 'Fotky do portfolia'][i - 1] || 'Další krok'}`, status: i < 4 ? 'done' : 'todo', deadline: `2026-10-${String(10 + i).padStart(2, '0')}`, owner: 'admin@example.com', description: 'Poznámka ke kroku, jak to bývá v praxi: domluvit s dodavatelem, ověřit rozměry, zapsat do kalendáře.' } });
      edges.push({ id: `e${i}`, source: i <= 3 ? 'root' : `n${i - 1}`, target: `n${i}` });
    }
    return { nodes, edges };
  };
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: Object.assign({ title: 'Truhlářství' }, uzly(14)) })).json;
  expect(!!map.id, 'hlavní mapa (14 uzlů) založena');
  for (const t of ['Marketing 2026', 'Nový web dílny', 'Sklad a nákup']) {
    const m = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: Object.assign({ title: t }, uzly(3)) })).json;
    expect(!!m.id, `mapa ${t} založena`);
  }
  for (const t of ['Koupit novou pilu', 'Web pro dílnu', 'Logo dílny', 'Zavolat Novákovi', 'Nabídka na šatní skříně']) {
    await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: t, owner: meA.id } });
  }
  await inst.api('POST', '/api/kb/chat/pamet', { token: A, body: { text: 'Firma: truhlářství, 3 lidi. Dodavatel dřeva: Pila Novák. Zákazník Dvořák chce kuchyň do konce října. Preferuje stručné odpovědi.' } });

  const mereni = [];
  let chat = null; let tah = 0;
  const posli = async (message, context) => {
    tah += 1;
    const pred = volani.length;
    const r = await inst.api('POST', '/api/kb/chat', { token: A, body: Object.assign({ message }, chat ? { chat_id: chat.id } : {}, context ? { context } : {}) });
    expect(r.status === 200, `tah ${tah} „${message.slice(0, 40)}“ → 200 (${r.status} ${JSON.stringify(r.json).slice(0, 100)})`);
    chat = r.json.chat;
    for (let i = pred; i < volani.length; i++) mereni.push(await zmer(volani[i], i, tah));
    return r.json;
  };
  const potvrd = async () => {
    const am = chat.messages[chat.messages.length - 1];
    const karta = (am.karty || []).find((k) => k.type === 'akce' && k.stav === 'ceka');
    expect(!!karta, `tah ${tah}: karta akce čeká na potvrzení`);
    const pred = volani.length;
    const r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: chat.id, action_id: karta.id, ok: true } });
    expect(r.status === 200, `tah ${tah}: potvrzení → 200 (${r.status})`);
    chat = r.json.chat;
    for (let i = pred; i < volani.length; i++) mereni.push(await zmer(volani[i], i, tah + 0.5));
  };

  console.log('== scénář ==');
  // 1 čtení
  fronta.push(nastroj('get_map', { map_id: 'Truhlářství' }), nastroj('suggest_next', { items: ['Přidej krok Objednat kování', 'Napiš e-mail dodavateli'] }));
  await posli('Co mám v truhlářství?', { route: '/' });
  // 2 přidání kroků + potvrzení (pokračování modelem)
  fronta.push(nastroj('add_nodes', { map_id: 'Truhlářství', parent_id: 'Krok 4: Objednat dřevo', items: [{ title: 'Objednat kování' }, { title: 'Objednat lak' }] }));
  await posli('Přidej pod objednání dřeva kroky Objednat kování a Objednat lak', { route: `/map/${map.id}` });
  const predPotvrzenim = volani.length;
  await potvrd(); // add_nodes ve volném rozhovoru = jednoduchá akce → dopoví aplikace, model se NEVOLÁ
  expect(volani.length === predPotvrzenim, `po potvrzení add_nodes se model nevolal (${volani.length - predPotvrzenim} volání)`);
  const amApp = chat.messages[chat.messages.length - 1];
  expect(amApp.role === 'assistant' && amApp.content === 'Hotovo.' && amApp.app === true && (amApp.karty || []).some((k) => k.type === 'navrhy' && k.items.includes('Co dál?')), `aplikace dopověděla „Hotovo.“ + čipy Co dál? (${JSON.stringify(amApp).slice(0, 120)})`);
  expect(chat.messages.some((m) => (m.karty || []).some((k) => k.type === 'akce' && k.stav === 'hotovo' && /Objednat kování/.test(k.popis))), 'karta akce je hotová s lidským popisem');
  // 3 úprava kroku („uprav“ = klíčové slovo skupiny dokumenty) + potvrzení
  fronta.push(nastroj('update_node', { map_id: 'Truhlářství', node_id: 'Objednat kování', deadline: '2026-10-20' }));
  await posli('Uprav krok Objednat kování — termín 20. 10.', { route: `/map/${map.id}` });
  fronta.push(text('Termín nastaven.'));
  const predPotvrzenim3 = volani.length;
  await potvrd(); // update_node s termínem → dopovídá MODEL (může nabídnout připomínku)
  expect(volani.length === predPotvrzenim3 + 1, `po potvrzení termínu dopoví model (${volani.length - predPotvrzenim3} volání)`);
  // 4 koncept e-mailu
  const email = 'Dobrý den, pane Nováku,\n\n' + 'chtěl bych se zeptat, zda je možné posunout dodávku spárovek na příští týden, protože montáž u Dvořákových se posouvá kvůli elektrikáři a sklad máme plný. '.repeat(22) + 'Děkuji za potvrzení.\n\nS pozdravem\nPetr';
  fronta.push(nastroj('draft_text', { kind: 'email', title: 'Zpoždění dodávky', text: email }));
  await posli('Napiš e-mail dodavateli Novákovi, že potřebujeme dodávku o týden posunout');
  // 5 nastavení upozornění
  fronta.push(nastroj('set_notification', { type: 'deadline', email: true }), text('Upozornění na termíny e-mailem je zapnuté.'));
  await posli('Nastav mi upozornění na termíny e-mailem'); // přímý nástroj: bez karty, model dopoví
  // 6 dlouhý vložený text (jako přepis hlasovky / schůzky)
  const dlouhy = 'Poznámky ze schůzky s Dvořákovými: ' + Array.from({ length: 220 }, (_, i) => `bod ${i + 1}: ${['dvířka bílá mat', 'úchytky černé', 'dřez vlevo', 'lednice vestavná', 'osvětlení pod skříňky', 'termín montáže konec října', 'záloha 40 %', 'doprava zdarma'][i % 8]}`).join('; ') + '.';
  fronta.push(nastroj('add_nodes', { map_id: 'Truhlářství', parent_id: 'apex', items: [{ title: 'Zapracovat požadavky Dvořákových' }] }));
  await posli(dlouhy + ' Zapiš to do projektu jako krok.');
  await potvrd(); // add_nodes → aplikace
  // 7 pravidla
  fronta.push(nastroj('list_rules', { map_id: 'Truhlářství' }), text('V mapě zatím žádné pravidlo není.'));
  await posli('Jaká pravidla mám v truhlářství nastavená?');
  // 8 tým
  fronta.push(nastroj('get_portfolio', {}), text('Nejvíc práce máš ty.'));
  await posli('Kdo má nejvíc práce?');
  // 9 krátký dotaz
  fronta.push(nastroj('get_my_day', {}), text('Dnes nic nehoří.'), nastroj('suggest_next', { items: ['Naplánuj zítřek'] }));
  await posli('Co dnes?');

  // ---------- vyhodnocení ----------
  console.log('== vyhodnocení ==');
  expect(mereni.length >= 15, `změřeno ${mereni.length} volání modelu (${tah} tahů)`);
  const n = mereni.length;
  const avg = (k) => Math.round(mereni.reduce((a, m) => a + m[k], 0) / n);
  const souhrn = {
    datum: new Date().toISOString(), image: process.env.KB_TEST_IMAGE, tokenizer: tokenizerOk ? TOK_URL : 'odhad znaky/3,5',
    tahu: tah, volani: n, volani_na_tah: +(n / tah).toFixed(2),
    prumer: { sys_tok: avg('sys_tok'), tools_tok: avg('tools_tok'), hist_tok: avg('hist_tok'), celkem_tok: avg('sys_tok') + avg('tools_tok') + avg('hist_tok'), nastroju: avg('nastroju'), sys_zn: avg('sys_zn'), tools_zn: avg('tools_zn'), hist_zn: avg('hist_zn') },
    soucet_tok: mereni.reduce((a, m) => a + m.sys_tok + m.tools_tok + m.hist_tok, 0),
    prvni: { sys_tok: mereni[0].sys_tok, tools_tok: mereni[0].tools_tok, nastroju: mereni[0].nastroju },
    max_nastroju: Math.max(...mereni.map((m) => m.nastroju)),
    cache: [], volani_detail: [],
  };
  let pady = 0; let ztrataTok = 0; let celkemTok = 0;
  for (let i = 0; i < n; i++) {
    const m = mereni[i]; const p = i > 0 ? prefixDrzi(mereni[i - 1], m) : { drzi: true, ztrata: 1 }; // první volání: nic v cache
    const tok = m.sys_tok + m.tools_tok + m.hist_tok; celkemTok += tok; ztrataTok += tok * (p.ztrata || 0);
    if (!p.drzi) { pady += 1; souhrn.cache.push({ idx: m.idx, tah: m.tah, proc: p.proc, ztrata: +(p.ztrata || 0).toFixed(2), hluboko: p.hluboko ? +p.hluboko.toFixed(2) : undefined }); }
    souhrn.volani_detail.push({ tah: m.tah, nastroju: m.nastroju, sys_tok: m.sys_tok, tools_tok: m.tools_tok, hist_tok: m.hist_tok, hist_zpr: m.hist_zpr, cache: p.drzi ? 'drží' : p.proc.slice(0, 50), ztrata: +(p.ztrata || 0).toFixed(2) });
  }
  souhrn.cache_pady = pady; souhrn.cache_drzi_pct = Math.round(100 * (n - 1 - pady) / (n - 1));
  souhrn.placene_tok = Math.round(ztrataTok); // odhad tokenů mimo cache za scénář (vč. prvního volání)
  souhrn.cache_pokryti_pct = Math.round(100 * (1 - ztrataTok / celkemTok)); // odhad podílu tokenů z cache za celý scénář (vč. prvního volání)
  const out = process.env.KB_TOKENY_OUT || '/tmp/ai-tokeny.json';
  fs.writeFileSync(out, JSON.stringify(souhrn, null, 1));
  console.log(`   tokenizér: ${souhrn.tokenizer}`);
  console.log(`   ∅ volání: systém ${souhrn.prumer.sys_tok} tok · nástroje ${souhrn.prumer.tools_tok} tok (${souhrn.prumer.nastroju} nástrojů) · historie ${souhrn.prumer.hist_tok} tok · CELKEM ${souhrn.prumer.celkem_tok} tok; volání/tah ${souhrn.volani_na_tah}; součet za scénář ${souhrn.soucet_tok} tok`);
  console.log(`   cache prefixu: ODHAD POKRYTÍ ${souhrn.cache_pokryti_pct} % tokenů scénáře; drží ${souhrn.cache_drzi_pct} % přechodů, pádů ${pady}: ${souhrn.cache.map((c) => `tah ${c.tah} (${c.proc.slice(0, 70)}, ztráta ${Math.round(100 * c.ztrata)} %)`).join('; ') || '—'}`);
  console.log('   tah  nástr  sys  tools  hist  zpráv  cache');
  for (const d of souhrn.volani_detail) console.log(`   ${String(d.tah).padEnd(4)} ${String(d.nastroju).padStart(5)} ${String(d.sys_tok).padStart(5)} ${String(d.tools_tok).padStart(6)} ${String(d.hist_tok).padStart(5)} ${String(d.hist_zpr).padStart(6)}  ${d.cache}`);
  console.log(`   souhrn → ${out}`);

  // ořez starší historie (4. 10. 2026): v posledním volání je dlouhá zpráva z tahu 6 zkrácená, argumenty draft_text z tahu 4 zkrácené;
  // v tahu samotném (druhé volání tahu 4) jdou argumenty celé
  const posl = volani[volani.length - 1].messages;
  const uzivTah6 = posl.filter((m) => m.role === 'user').find((m) => /Poznámky ze schůzky/.test(m.content));
  expect(!!uzivTah6 && uzivTah6.content.length < 2200 && /…\[earlier message shortened\]$/.test(uzivTah6.content) && dlouhy.length > 5000, `starší dlouhá zpráva uživatele (>5000 zn.) zkrácená na ~2000 zn. (${uzivTah6 && uzivTah6.content.length} z ${dlouhy.length})`);
  const uzivTah2 = posl.filter((m) => m.role === 'user').find((m) => /Přidej pod objednání/.test(m.content));
  expect(!!uzivTah2 && !/shortened/.test(uzivTah2.content), 'krátká starší zpráva se nekrátí (žádný zbytečný pád cache)');
  const starDraft = posl.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls || []).find((c) => c.function.name === 'draft_text');
  expect(!!starDraft && starDraft.function.arguments.text.length < 450 && /…\[shortened\]$/.test(starDraft.function.arguments.text) && email.length > 3000, `starší argumenty draft_text (>3000 zn.) zkrácené (${starDraft && starDraft.function.arguments.text.length} z ${email.length})`);
  const starAdd = posl.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls || []).find((c) => c.function.name === 'add_nodes');
  expect(!!starAdd && JSON.stringify(starAdd.function.arguments).indexOf('shortened') < 0 && starAdd.function.arguments.items.length === 2, 'krátké starší argumenty (add_nodes) zůstávají celé');
  const vTah4 = mereni.filter((m) => m.tah === 4).pop()._hist;
  const aktDraft = vTah4.filter((m) => m.role === 'assistant').flatMap((m) => m.tool_calls || []).find((c) => c.function.name === 'draft_text');
  expect(!!aktDraft && aktDraft.function.arguments.text === email, 'v témže tahu jdou argumenty draft_text celé');
  const uzivTah6Akt = mereni.filter((m) => m.tah === 6).pop()._hist.filter((m) => m.role === 'user').pop();
  expect(uzivTah6Akt && uzivTah6Akt.content.length > 5000 && !/shortened/.test(uzivTah6Akt.content), 'v témže tahu jde dlouhá zpráva uživatele celá');

  // cache prefixu smí padnout JEN kvůli nové skupině nástrojů (systém se po zápisu nesmí měnit — řazení map podle čísla, 4. 10. 2026)
  // Historie se smí přepsat jen „mělce“ (ořez staršího výsledku nástroje z minulého tahu, ořez zprávy starší než 3 tahy):
  // ztráta nejvýš ~40 % promptu. Hluboký přepis (např. změna první zprávy) by znamenal chybu.
  const jine = souhrn.cache.filter((c) => c.proc !== 'přibyla skupina nástrojů');
  expect(jine.every((c) => /historie přepsaná/.test(c.proc) && c.ztrata <= 0.4), `mimo otevření skupiny se mění jen konec historie, ztráta ≤ 40 % promptu (${jine.map((c) => `tah ${c.tah}: ztráta ${Math.round(100 * c.ztrata)} %`).join('; ') || 'žádný pád'})`);
  // Práh 65 % (5. 10. 2026, etapa 3): po zkrácení základu promptu klesá PODÍL cache (cachovaná část je menší), i když placené tokeny
  // zůstávají (68,9k) a celkový prompt klesl o 10 % — rozhodující je absolutní počet placených tokenů (souhrn.placene_tok), ne podíl.
  expect(souhrn.cache_pokryti_pct >= 65, `odhad pokrytí cache za scénář ≥ 65 % (${souhrn.cache_pokryti_pct} %, placené tokeny ${souhrn.placene_tok})`);
  // v tahu 7 a 8 (stáří 1–2 tahy) je dlouhá zpráva z tahu 6 ještě celá — ověřené chování „v dalším tahu vidí model konec přepisu“
  const vTah8 = mereni.filter((m) => m.tah === 8)[0]._hist.filter((m) => m.role === 'user').find((m) => /Poznámky ze schůzky/.test(m.content));
  expect(!!vTah8 && vTah8.content.length > 5000 && !/shortened/.test(vTah8.content), 'o dva tahy později jde dlouhá zpráva ještě celá (krátí se až od 3 tahů)');

  // log spotřeby nese otevřené skupiny (podklad pro zúžení klíčových slov)
  const su = await inst.superuser();
  const log = (await inst.api('GET', `/api/collections/ai_chat_log/records?perPage=50&sort=created&filter=${encodeURIComponent(`chat='${chat.id}'`)}`, { token: su })).json.items || [];
  expect(log.length >= tah, `ai_chat_log má řádek na každý tah (${log.length} ≥ ${tah})`);
  expect(log.some((l) => /dokumenty/.test(l.skupiny)) && log.some((l) => /nastaveni/.test(l.skupiny)) && log.some((l) => /pravidla/.test(l.skupiny)), `log nese otevřené skupiny (${[...new Set(log.map((l) => l.skupiny))].join(' | ')})`);
  expect(!log.some((l) => /nastaveni/.test(l.skupiny) && l.created < log.find((x) => /nastaveni/.test(x.skupiny)).created), 'skupiny jsou v logu monotónní (jednou otevřená zůstává)');
  const appRadky = log.filter((l) => /#app/.test(l.model));
  expect(appRadky.length === 2 && appRadky.every((l) => l.calls === 0 && l.tokens_in === 0 && /add_nodes/.test(l.tools)), `potvrzení aplikací = řádky logu se značkou #app, 0 volání, 0 tokenů (${appRadky.length})`);

  // ---------- stropy výsledků nástrojů (4. 10. 2026) — mimo měřený scénář, nový rozhovor ----------
  console.log('== stropy výsledků nástrojů ==');
  for (let i = 0; i < 33; i++) await inst.register(`clen${i}@example.com`, { name: `Člen ${i}` });
  const mapyPro = [];
  for (let i = 0; i < 7; i++) {
    const m = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: Object.assign({ title: `Projekt paměti ${i}` }, uzly(1)) })).json;
    mapyPro.push(m.id);
    const rr = await inst.api('POST', '/api/collections/ai_memory/records', { token: su, body: { user: meA.id, map: m.id, text: `Poznámka k projektu ${i}: ` + 'x'.repeat(3000) } });
    expect(rr.status === 200, `paměť projektu ${i} založena (${rr.status})`);
  }
  chat = null;
  fronta.push(nastroj('get_settings', {}), text('Nastavení přečteno.'));
  await posli('Jaké mám nastavení upozornění?');
  const vSet = volani[volani.length - 1].messages.filter((m) => m.role === 'tool').pop().content;
  expect(/members \(35\):/.test(vSet) && (vSet.match(/^  · .*@example\.com/gm) || []).length === 30 && /and 5 more \(list_people/.test(vSet), `get_settings vypíše 30 členů z 35 + „and 5 more“ (${(vSet.match(/members \(\d+\)/) || [])[0]}, řádků ${(vSet.match(/^  · .*@example\.com/gm) || []).length})`);
  fronta.push(nastroj('get_memory', {}), text('Pamatuji si toto.'));
  await posli('Co si o mně pamatuješ?');
  const vMem = volani[volani.length - 1].messages.filter((m) => m.role === 'tool').pop().content;
  expect((vMem.match(/^## Projekt paměti/gm) || []).length === 5 && vMem.length < 5 * 1700 + 500, `get_memory: 5 projektových pamětí po ≤1 500 zn. (${(vMem.match(/^## /gm) || []).length} projektů, ${vMem.length} zn.)`);
  fronta.push(nastroj('list_people', {}), text('Lidé.'));
  await posli('Kdo všechno je v týmu?');
  const vLidi = volani[volani.length - 1].messages.filter((m) => m.role === 'tool').pop().content;
  expect((vLidi.match(/^• /gm) || []).length === 35 && !/more members/.test(vLidi), `list_people pod stropem 150 vypíše všech 35 (${(vLidi.match(/^• /gm) || []).length})`);

  // pevné pojistky (ne měření): systém nese datum i mapy, základ nástrojů nikdy nechybí
  expect(mereni.every((m) => m.nastroju >= 16), 'každé volání nese aspoň základních 16 nástrojů');
  expect(mereni.every((m) => /Truhlářství/.test(m._sys)), 'systém v každém volání nese seznam map');
  // systém se v rámci jednoho tahu nemění (jinak cache padá i uvnitř tahu)
  const poTahu = {};
  for (const m of mereni) { (poTahu[m.tah] = poTahu[m.tah] || new Set()).add(m._sys); }
  expect(Object.values(poTahu).every((s) => s.size === 1), 'systémová zpráva je uvnitř jednoho tahu bajtově stejná');
});
