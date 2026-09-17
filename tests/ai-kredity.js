// AI kredity organizace (API) — spotřeba chatu asistenta po lidech a skupinách,
// týdenní kvóta dělená správci × ostatní, brzda 429 ai_kvota, validace nastavení,
// popis karty add_nodes s celkovým počtem uzlů (vč. vnořených). Podvržená ollama
// (111 vstup / 22 výstup tokenů na volání ≈ 0,047 kreditu).
const H = require('./_harness');
const { expect } = H;

const fronta = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  JSON.parse(body);
  const o = fronta.shift() || text('ODPOVED.');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 111, eval_count: 22, done: true }));
};
const KREDIT_NA_VOLANI = (111 * 0.35 + 22 * 2.20) * 20.74 * 2 / 1e6 / ((2410 * 0.35 + 454 * 2.20) * 20.74 * 2 / 1e6);

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
  expect(Math.abs(r.json.kredit_kc - 0.0764) < 0.001, `1 kredit ≈ 0,0764 Kč (${r.json.kredit_kc})`);
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

  console.log('== nastavení kvóty ==');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: B, body: { kvota_tyden: 10, podil_admin: 30 } });
  expect(r.status === 403, 'člen kvótu nenastaví');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 10, podil_admin: 150 } });
  expect(r.status === 400, 'podíl 150 % odmítnut (400)');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 1.5, podil_admin: 30 } });
  expect(r.status === 400, 'kvóta 1,5 odmítnuta (celé číslo)');
  r = await inst.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A, body: { kvota_tyden: 1, podil_admin: 30 } });
  expect(r.status === 200 && r.json.kvota === 1 && r.json.zdroj === 'nastaveni' && Math.abs(r.json.admin.kvota - 0.3) < 0.001 && Math.abs(r.json.ostatni.kvota - 0.7) < 0.001, `kvóta 1 kredit: správci 0,3 · ostatní 0,7 (${r.json.admin.kvota}/${r.json.ostatni.kvota})`);

  console.log('== brzda: správci vyčerpají svůj podíl, ostatní jedou dál ==');
  let blok = null, tahu = 0;
  for (let i = 0; i < 12 && !blok; i++) {
    r = await inst.api('POST', '/api/kb/chat', { token: A, body: { message: 'Dál ' + i, context: { route: '/' } } });
    if (r.status === 429) blok = r.json; else tahu++;
  }
  expect(!!blok && blok.code === 'ai_kvota', `správce po ${tahu} tazích narazil na 429 ai_kvota`);
  expect(!!blok && /správce/i.test(blok.error) && /0,3|0\.3/.test(blok.error), `hláška říká komu a kolik (${blok && blok.error})`);
  expect(!!blok && blok.pouzito >= blok.kvota, 'pouzito ≥ kvota skupiny');
  r = await inst.api('GET', '/api/kb/ai-kredity', { token: A });
  expect(r.json.admin.kredity >= 0.3 && r.json.ostatni.kredity < 0.7, 'přehled: správci nad podílem, ostatní pod ním');
  r = await inst.api('POST', '/api/kb/chat', { token: B, body: { message: 'Jedu dál', context: { route: '/' } } });
  expect(r.status === 200, 'člen (skupina ostatní) může dál');
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
  expect(r.status === 200 && r.json.kvota === 200 && r.json.zdroj === 'env' && Math.abs(r.json.admin.kvota - 60) < 0.001, `env KB_AI_KVOTA_TYDEN=200 → správci 60 (${r.json.kvota}/${r.json.zdroj}/${r.json.admin.kvota})`);
  r = await inst2.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A2, body: { kvota_tyden: 5000, podil_admin: 30 } });
  expect(r.status === 200 && r.json.kvota === 200 && r.json.zdroj === 'env' && r.json.strop_env === 200 && r.json.vlastni === 5000, `env je TVRDÝ STROP: vlastní 5000 → platí 200 (${r.json.kvota}/${r.json.zdroj})`);
  r = await inst2.api('POST', '/api/kb/ai-kredity/nastaveni', { token: A2, body: { kvota_tyden: 50, podil_admin: 0 } });
  expect(r.status === 200 && r.json.kvota === 50 && r.json.zdroj === 'nastaveni' && r.json.podil_admin === 0 && r.json.admin.kvota === 0, 'vlastní hodnota env jen SNÍŽÍ (50 < 200); podíl 0 % zůstane 0 (ne výchozích 30)');
  r = await inst2.api('POST', '/api/kb/chat', { token: A2, body: { message: 'Ahoj', context: { route: '/' } } });
  expect(r.status === 429 && r.json.code === 'ai_kvota', 'podíl správců 0 % = správce nemá kredity (429)');

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
