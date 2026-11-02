// Upgrade: data z vydání BEZ Kanceláře (KB_STARY_IMAGE, např. kb-app:20261102 = v0.95-beta) → nový image nad TÝMŽ
// volume (/checkup 2. 11. 2026). Migrace 1792001345_ai_documents_kancelar má STARŠÍ razítko než už nasazené
// 1792621271 / 1792928875 / 1793096888 — PocketBase ji musí doběhnout i tak (přidá druhy presentation/card + pole meta).
//  • start bez chyb migrací; starý dokument (draft_text) zůstane čitelný, meta prázdné {}
//  • po upgradu draft_presentation uloží presentation s meta, filtr skupiny kancelar ho najde, úprava meta z panelu projde
// Bez KB_STARY_IMAGE se sada přeskočí (v plné regresi) — spouštět cíleně:
//   KB_STARY_IMAGE=kb-app:20261102 KB_TEST_IMAGE=<nový> node product/tests/upgrade-kancelar.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

const fronta = [];
const nastroj = (name, args) => ({ tool_calls: [{ function: { name, arguments: args } }] });
const text = (s) => ({ content: s });
const mockHandler = (req, res, body) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-a' }] })); return; }
  if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
  const o = fronta.shift() || text('(fronta prázdná)');
  const message = { role: 'assistant', content: o.content || '' };
  if (o.tool_calls) message.tool_calls = o.tool_calls;
  res.end(JSON.stringify({ message, prompt_eval_count: 11, eval_count: 2, done: true }));
};
const OSNOVA = '# Kuchyň Novákovi\n## Cíl\n- Linka do 30. 11.\n## Kde jsme\n- Návrh hotový';

H.beh(async () => {
  if (!STARY) {
    expect(true, 'upgrade test PŘESKOČEN — KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const mock = await H.httpMock(mockHandler);
  const env = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, KB_AI_MAX_PER_HOUR: 600, TZ: 'Europe/Prague' };
  const VOL = 'kb-upg-kancelar-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);

  console.log(`== stará verze (${STARY}): účet, mapa, poznámka od asistenta ==`);
  const stara = await H.startInstance({ slug: 'upg-kanc-stara', image: STARY, volume: VOL, env, addHostGateway: true });
  const staraVerze = (await stara.api('GET', '/api/kb/config')).json.version;
  await stara.register('a@example.com', { name: 'Anna' });
  let A = await stara.login('a@example.com');
  const map = (await stara.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Kuchyň Novákovi', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } }], edges: [] } })).json;
  expect(!!map.id, `mapa založena na staré verzi (${staraVerze})`);
  fronta.push(nastroj('draft_text', { kind: 'note', title: 'Stará poznámka', text: 'Napsáno před Kanceláří.' }), text('Hotovo.'));
  let r = await stara.api('POST', '/api/kb/chat', { token: A, body: { message: 'Zapiš poznámku: napsáno před Kanceláří' } });
  let seznam = (await stara.api('GET', '/api/kb/chat/dokumenty', { token: A })).json;
  const staryDok = ((seznam && seznam.dokumenty) || [])[0];
  expect(r.status === 200 && !!staryDok && staryDok.kind === 'note', `stará verze uložila poznámku (${r.status}, ${JSON.stringify(seznam).slice(0, 120)})`);
  const stareSloupce = (await stara.api('GET', `/api/kb/chat/dokument/${staryDok.id}`, { token: A })).json.dokument;
  expect(!('meta' in stareSloupce) || !stareSloupce.meta, 'stará verze meta nezná');
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' }); // ne stop() — ten by smazal i volume

  console.log('== upgrade: nový image nad týmž volume ==');
  const nova = await H.startInstance({ slug: 'upg-kanc-nova', volume: VOL, env, addHostGateway: true });
  const novaVerze = (await nova.api('GET', '/api/kb/config')).json.version;
  expect(novaVerze !== staraVerze, `verze se změnila (${staraVerze} → ${novaVerze})`);
  const logy = execSync(`docker logs ${nova.name} 2>&1 | tail -80`).toString();
  expect(!/migrat\w* (failed|error)|Error applying migration|panic/i.test(logy), `start bez chyb migrací (${(logy.match(/.*(migrat|Error|panic).*/gi) || []).slice(0, 3).join(' | ') || 'log čistý'})`);
  A = await nova.login('a@example.com');
  const poUpg = (await nova.api('GET', `/api/kb/chat/dokument/${staryDok.id}`, { token: A })).json.dokument;
  expect(!!poUpg && poUpg.kind === 'note' && poUpg.text === 'Napsáno před Kanceláří.' && JSON.stringify(poUpg.meta || {}) === '{}', `starý dokument čitelný, meta prázdné (${JSON.stringify(poUpg && poUpg.meta)})`);

  console.log('== po upgradu: prezentace s meta, filtr kancelar, úprava meta ==');
  fronta.push(nastroj('draft_presentation', { title: 'Kuchyň Novákovi', subtitle: 'Stav', audience: 'klient', map: 'Kuchyň Novákovi', text: OSNOVA }), text('Prezentace je v dokumentech.'));
  r = await nova.api('POST', '/api/kb/chat', { token: A, body: { message: 'Udělej prezentaci projektu Kuchyň Novákovi pro klienta' } });
  const karta = (r.json.chat ? r.json.chat.messages.flatMap((m) => m.karty || []) : []).find((k) => k.type === 'soubor');
  expect(r.status === 200 && !!karta && karta.druh === 'presentation', `draft_presentation po upgradu → karta soubor (${r.status})`);
  const prez = karta ? (await nova.api('GET', `/api/kb/chat/dokument/${karta.doc_id}`, { token: A })).json.dokument : null;
  expect(!!prez && prez.kind === 'presentation' && prez.meta && prez.meta.subtitle === 'Stav' && prez.meta.audience === 'klient', `dokument presentation s meta (${JSON.stringify(prez && prez.meta)})`);
  seznam = (await nova.api('GET', '/api/kb/chat/dokumenty?skupina=kancelar', { token: A })).json;
  expect(((seznam && seznam.dokumenty) || []).some((d) => d.id === (karta || {}).doc_id) && !((seznam && seznam.dokumenty) || []).some((d) => d.id === staryDok.id), 'filtr kancelar vrátí prezentaci, ne starou poznámku');
  r = await nova.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: karta.doc_id, meta: { subtitle: 'Stav pro klienta', audience: 'klient', cizi: 'ne' } } });
  const poMeta = (await nova.api('GET', `/api/kb/chat/dokument/${karta.doc_id}`, { token: A })).json.dokument;
  expect(r.status === 200 && poMeta.meta.subtitle === 'Stav pro klienta' && !('cizi' in poMeta.meta), `úprava meta z panelu po upgradu (${r.status}, ${JSON.stringify(poMeta.meta)})`);
  r = await nova.api('POST', '/api/kb/chat/dokument', { token: A, body: { id: karta.doc_id, meta: [] } });
  const poPoli = (await nova.api('GET', `/api/kb/chat/dokument/${karta.doc_id}`, { token: A })).json.dokument;
  expect(poPoli.meta.subtitle === 'Stav pro klienta', 'pole místo objektu meta nesmaže (/checkup 2. 11. 2026)');
  await nova.stop();
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
});
