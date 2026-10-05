// AI kredity organizace (API) — spotřeba chatu asistenta po lidech a skupinách,
// týdenní kvóta dělená správci × ostatní, brzda 429 ai_kvota, validace nastavení,
// popis karty add_nodes s celkovým počtem uzlů (vč. vnořených). Podvržená ollama
// (111 vstup / 22 výstup tokenů na volání ≈ 0,047 kreditu).
const H = require('./_harness');
const { expect } = H;

const fronta = [];
let selhani = 0;   // kolikrát má mock vrátit HTTP 500
let l0;
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  JSON.parse(body);
  if (selhani > 0) { selhani--; res.statusCode = 500; res.end('{"error":"boom"}'); return; }
  const o = fronta.shift() || text('ODPOVED.');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
};
// ceny a referenční tah z JEDINÉHO zdroje (kredity-ceny.json): mock hlásí 111 vstupních / 22 výstupních tokenů bez cache, model m-a není lokální
const CENY = require('../server/pb_hooks/kredity-ceny.json');
const KC = (i, c, o) => ((i - c) * CENY.aki.in + c * CENY.aki.cache + o * CENY.aki.out) / 1e6 * CENY.eur_kc;
const KREDIT_KC = KC(CENY.referencni_tah.in, CENY.referencni_tah.cached, CENY.referencni_tah.out);
const KREDIT_NA_VOLANI = KC(111, 0, 22) / KREDIT_KC;

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const inst = await H.startInstance({ slug: 'kredity', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 500,
  } });
  await inst.register('admin@example.com', { name: 'Petr' });   // první = admin
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');

  console.log('== přístup a výchozí stav ==');
  let r = await inst.api('GET', '/api/kb/ai-kredity', { token: B });
  expect(r.status === 403, 'člen přehled kreditů nevidí (403)');
  r = await inst.api('GET', '/api/kb/ai-kredity', { token: A });
  expect(r.status === 200 && r.json.kvota === 0 && r.json.zdroj === 'none' && r.json.podil_admin === 30, `výchozí: bez stropu, podíl správců 30 % (${JSON.stringify({ kvota: r.json.kvota, zdroj: r.json.zdroj, podil: r.json.podil_admin })})`);
  expect(r.json.lide.length === 2 && r.json.celkem.kredity === 0 && r.json.admin.lidi === 1 && r.json.ostatni.lidi === 1, 'dva lidé, nula spotřeby, skupiny 1 + 1');
  expect(Math.abs(r.json.kredit_kc - KREDIT_KC) < 0.0005 && Math.abs(KREDIT_KC - 0.0722) < 0.001, `1 kredit = 1 referenční tah ≈ 0,072 Kč podle kredity-ceny.json (${r.json.kredit_kc})`);
  expect(r.json.tydny.length === 4 && /T00:00:00/.test(r.json.tyden_od) && new Date(r.json.tyden_od).getUTCDay() === 1, 'týden začíná pondělím 00:00 UTC, 4 týdny historie');

  console.log('== spotřeba po lidech ==');
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ahoj', context: { route: '/' } } });
  expect(r.status === 200, 'správce si popovídal');
  r = await inst.api('POST', '/api/kb/chat', { token: B, body: { message: 'Ahoj', context: { route: '/' } } });
  r = await inst.api('POST', '/api/kb/chat', { token: B, body: { message: 'Ještě', context: { route: '/' } } });
  expect(r.status === 200, 'člen si popovídal dvakrát');
  r = await inst.api('GET', '/api/kb/ai-kredity', { token: A });
  const petr = r.json.lide.find((u) => u.email === 'admin@example.com'), jana = r.json.lide.find((u) => u.email === 'clen@example.com');
  expect(petr.n === 1 && jana.n === 2 && jana.kredity > petr.kredity && petr.kredity > 0, `po lidech: Petr 1 tah (${petr.kredity} kr), Jana 2 tahy (${jana.kredity} kr)`);
  expect(Math.abs(petr.kredity - Math.round(KREDIT_NA_VOLANI * 100) / 100) < 0.011, `kredity z tokenů podle vzorce (${petr.kredity} ≈ ${KREDIT_NA_VOLANI.toFixed(3)})`);
  expect(r.json.lide[0].email === 'clen@example.com', 'seřazeno podle spotřeby (Jana první)');
  expect(Math.abs(r.json.celkem.kredity - (petr.kredity + jana.kredity)) < 0.02 && r.json.celkem.n === 3, 'celek organizace = součet lidí');
  expect(Math.abs(r.json.admin.kredity - petr.kredity) < 0.011 && Math.abs(r.json.ostatni.kredity - jana.kredity) < 0.011, 'skupiny správci × ostatní sedí');
  expect(r.json.tydny[0].n === 3 && !!jana.posledni, 'tento týden v historii 3 tahy, „naposledy“ vyplněno');

  console.log('== lokální model se účtuje jako koupený (Richard 5. 10. 2026), chybový tah = 0, kredity uložené u řádku ==');
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Lokálně', model: 'm-local', context: { route: '/' } } });
  expect(r.status === 200, `správce zvolil model m-local (lokální podle kredity-ceny.json) (${r.status})`);
  selhani = 3; // mock vrátí 500 → tah skončí chybou
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Spadni', context: { route: '/' } } });
  expect(r.status >= 500, `chybový tah (${r.status})`);
  const su = await inst.superuser();
  const log = (await inst.api('GET', '/api/collections/ai_chat_log/records?perPage=50&sort=created', { token: su })).json.items || [];
  const lok = log.find((l) => /m-local/.test(l.model)), chyb = log.find((l) => l.stav === 'chyba');
  expect(!!lok && Math.abs(lok.kredity - KREDIT_NA_VOLANI) < 0.0002 && lok.tokens_in > 0, `řádek lokálního modelu: kredity jako u AKI, „vše jako koupeno“ (${lok && lok.kredity})`);
  expect(!!chyb && chyb.kredity === 0, `chybový řádek: kredity 0 (${chyb && chyb.kredity})`);
  const okRadky = log.filter((l) => l.stav === 'ok' && !/m-local/.test(l.model));
  expect(okRadky.length === 3 && okRadky.every((l) => Math.abs(l.kredity - KREDIT_NA_VOLANI) < 0.0002) && Array.isArray(l0 = okRadky[0].volani) && l0.length === 1 && l0[0].in === 111, `každý řádek nese kredity (${okRadky.map((l) => l.kredity).join(', ')}) a rozpad po voláních`);
  r = await inst.api('GET', '/api/kb/ai-kredity', { token: A });
  expect(Math.abs(r.json.celkem.kredity - 4 * KREDIT_NA_VOLANI) < 0.02 && r.json.celkem.n === 5, `celek = součet kreditů řádků vč. lokálního (${r.json.celkem.kredity}), zpráv 5 vč. chybové`);

  console.log('== nastavení kvóty ==');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: B, body: { kvota_tyden: 10, podil_admin: 30 } });
  expect(r.status === 403, 'člen kvótu nenastaví');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 10, podil_admin: 150 } });
  expect(r.status === 400, 'podíl 150 % odmítnut (400)');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 1.5, podil_admin: 30 } });
  expect(r.status === 400, 'kvóta 1,5 odmítnuta (celé číslo)');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 1, podil_admin: 30 } });
  expect(r.status === 200 && r.json.kvota === 1 && r.json.zdroj === 'nastaveni' && r.json.admin.kvota === 1 && Math.abs(r.json.ostatni.kvota - 0.7) < 0.001 && Math.abs(r.json.rezerva_admin - 0.3) < 0.001,
    `kvóta 1 kredit, rezerva 30 %: správci mohou až 1 (rezerva 0,3) · ostatní nejvýš 0,7 (${r.json.admin.kvota}/${r.json.ostatni.kvota}/${r.json.rezerva_admin})`);

  console.log('== brzda: podíl = REZERVA správců (Richard 4. 10. 2026) — ostatní narazí na 0,7, správce jede dál až do celé kvóty ==');
  let blok = null, tahu = 0;
  // Jana má 2 volání; strop ostatních 0,7 kreditu → zbývá ≈ 0,7/KREDIT_NA_VOLANI − 2 volání (kredit = průměrný skutečný tah, mock je levný)
  const cekaneJana = Math.floor(0.7 / KREDIT_NA_VOLANI) - 2;
  for (let i = 0; i < cekaneJana + 10 && !blok; i++) {
    r = await inst.api('POST', '/api/kb/chat', { token: B, body: { message: 'Dál ' + i, context: { route: '/' } } });
    if (r.status === 429) blok = r.json; else tahu++;
  }
  expect(!!blok && blok.code === 'ai_kvota' && tahu >= cekaneJana - 3 && tahu <= cekaneJana + 4, `člen po ${tahu} tazích narazil na 429 ai_kvota (strop ostatních; čekáno ≈ ${cekaneJana})`);
  expect(!!blok && /členy týmu/i.test(blok.error) && /rezerva/i.test(blok.error) && /0,7|0\.7/.test(blok.error), `hláška říká komu, kolik a proč (${blok && blok.error})`);
  expect(!!blok && blok.pouzito >= blok.kvota, 'pouzito ≥ strop ostatních');
  r = await inst.api('GET', '/api/kb/ai-kredity', { token: A });
  expect(r.json.ostatni.kredity >= 0.7 && r.json.admin.kredity < 0.3, 'přehled: ostatní na stropu, správci hluboko pod kvótou');
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Správce jede dál', context: { route: '/' } } });
  expect(r.status === 200, 'správce může dál (rezerva 0,3 mu zůstala, čerpá až do celé kvóty)');
  blok = null; let tahuA = 0;
  // celkem je ≈ 0,7 + 2 volání správce → do celé kvóty 1 zbývá ≈ 0,3/KREDIT_NA_VOLANI − 2 volání
  const cekanePetr = Math.floor(0.3 / KREDIT_NA_VOLANI) - 2;
  for (let i = 0; i < cekanePetr + 10 && !blok; i++) {
    r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Ještě ' + i, context: { route: '/' } } });
    if (r.status === 429) blok = r.json; else tahuA++;
  }
  expect(!!blok && blok.code === 'ai_kvota' && tahuA >= cekanePetr - 4 && tahuA <= cekanePetr + 4, `správce narazil až na CELOU kvótu organizace po ${tahuA} dalších tazích (čekáno ≈ ${cekanePetr})`);
  expect(!!blok && /organizace/i.test(blok.error) && /z 1\b|of 1\b/.test(blok.error), `hláška správci: kvóta organizace vyčerpána (${blok && blok.error})`);
  r = await inst.api('POST', '/api/kb/chat/potvrdit', { token: A, body: { chat_id: 'x', action_id: 'y', ok: true } });
  expect(r.status === 429 && r.json.code === 'ai_kvota', 'brzda platí i pro potvrzení akce');

  console.log('== kvóta 0 = bez stropu; env kvóta jako výchozí ==');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 0, podil_admin: 30 } });
  expect(r.status === 200 && r.json.kvota === 0 && r.json.zdroj === 'none', 'kvóta 0 uložena = bez stropu');
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Zase můžu', context: { route: '/' } } });
  expect(r.status === 200, 'správce po zrušení stropu zase může');

  const inst2 = await H.startInstance({ slug: 'kredity-env', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_KVOTA_TYDEN: 200,
  } });
  await inst2.register('a2@example.com', { name: 'Eva' });
  const A2 = await inst2.login('a2@example.com');
  r = await inst2.api('GET', '/api/kb/ai-kredity', { token: A2 });
  expect(r.status === 200 && r.json.kvota === 200 && r.json.zdroj === 'env' && r.json.admin.kvota === 200 && Math.abs(r.json.rezerva_admin - 60) < 0.001 && r.json.ostatni.kvota === 140, `env KB_AI_KVOTA_TYDEN=200 → správci až 200 (rezerva 60), ostatní 140 (${r.json.kvota}/${r.json.zdroj}/${r.json.admin.kvota}/${r.json.rezerva_admin})`);
  r = await inst2.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A2, body: { kvota_tyden: 5000, podil_admin: 30 } });
  expect(r.status === 200 && r.json.kvota === 200 && r.json.zdroj === 'env' && r.json.strop_env === 200 && r.json.vlastni === 5000, `env je TVRDÝ STROP: vlastní 5000 → platí 200 (${r.json.kvota}/${r.json.zdroj})`);
  r = await inst2.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A2, body: { kvota_tyden: 50, podil_admin: 0 } });
  expect(r.status === 200 && r.json.kvota === 50 && r.json.zdroj === 'nastaveni' && r.json.podil_admin === 0 && r.json.rezerva_admin === 0 && r.json.admin.kvota === 50 && r.json.ostatni.kvota === 50, 'vlastní hodnota env jen SNÍŽÍ (50 < 200); rezerva 0 % zůstane 0 (ne výchozích 30) = společný balík');
  r = await inst2.api('POST', '/api/kb/chat', { token: A2, body: { message: 'Ahoj', context: { route: '/' } } });
  expect(r.status === 200, 'rezerva 0 % správce NEblokuje (čerpá ze společného balíku)');
  r = await inst2.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A2, body: { kvota_tyden: 50, podil_admin: 100 } });
  expect(r.status === 200 && r.json.admin.kvota === 50 && r.json.ostatni.kvota === 0, 'rezerva 100 % = ostatní nemají nic, správci celá kvóta');

  console.log('== zkušebka (KB_TRIAL_UNTIL): správce může celou kvótu 20, rezerva 6, ostatní 14 ==');
  // 4. 10. 2026: správce hostované zkušebky narazil po 3 zprávách, protože podíl 30 % byl strop (6 z 20)
  const inst3 = await H.startInstance({ slug: 'kredity-trial', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_KVOTA_TYDEN: 20, KB_TRIAL_UNTIL: '2099-01-01',
  } });
  await inst3.register('a3@example.com', { name: 'Olga' });
  const A3 = await inst3.login('a3@example.com');
  r = await inst3.api('GET', '/api/kb/ai-kredity', { token: A3 });
  expect(r.status === 200 && r.json.podil_admin === 30 && r.json.admin.kvota === 20 && r.json.rezerva_admin === 6 && r.json.ostatni.kvota === 14,
    `zkušebka: správce až 20 (rezerva 6), ostatní 14 (${JSON.stringify({ podil: r.json.podil_admin, a: r.json.admin.kvota, rez: r.json.rezerva_admin, o: r.json.ostatni.kvota })})`);
  await inst3.stop();

  console.log('== karta add_nodes: celkový počet uzlů včetně vnořených ==');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Startup', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Startup', title: 'Startup', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, 'mapa založena');
  fronta.push(nastroj('add_nodes', { map_id: 'Startup', parent_id: 'apex', items: [
    { title: 'Návrh průchodu', children: [{ title: 'Wireframe' }] }, { title: 'MVP scope' }, { title: 'Stack' }, { title: 'Repozitář' }, { title: 'Hello world' }, { title: 'Testování' }, { title: 'Iterace' },
  ] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Rozepiš prototyp', context: { route: '/' } } });
  const am = r.json.chat.messages[r.json.chat.messages.length - 1];
  const karta = (am.karty || []).find((k) => k.type === 'akce');
  expect(!!karta && /Návrh průchodu, MVP scope, Stack, Repozitář/.test(karta.popis) && /celkem 8 uzlů/.test(karta.popis), `karta: 4 názvy + „celkem 8 uzlů“ (${karta && karta.popis})`);
  fronta.push(nastroj('add_nodes', { map_id: 'Startup', parent_id: 'apex', items: [{ title: 'A' }, { title: 'B' }] }));
  r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Dva', context: { route: '/' } } });
  const k2 = (r.json.chat.messages[r.json.chat.messages.length - 1].karty || []).find((k) => k.type === 'akce');
  expect(!!k2 && /uzly: A, B$/.test(k2.popis), `do 4 uzlů bez dovětku (${k2 && k2.popis})`);
}, { nazev: 'AI-KREDITY' });
