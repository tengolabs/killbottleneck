// Stable prompt start (12. 11. 2026): with KB_CHAT2_STALY_ZACATEK=1 the map list in the system message is frozen for
// the conversation; a map created / deleted mid-conversation reaches the model as a note in the NEXT user message,
// and that note stays the same in later turns (history never changes after the fact). Hybrid models with a
// checkpoint-only cache (Strata) otherwise re-read the whole prompt after every new project (7–14 s per call).
// Checks: system byte-identical across turns, note with the new map in turn 2, note unchanged in turn 3, minus note
// after a delete, prewarm sends exactly what the next turn will send; control instance without the switch keeps the
// live list in the system message (proves the test can fail).
// Run: KB_TEST_IMAGE=<image> node product/tests/ai-staly-zacatek.js
const H = require('./_harness');
const { expect } = H;

function mock(volani) {
  return (req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-b' }] })); return; }
    if (!req.url.startsWith('/api/chat')) { res.statusCode = 404; res.end('{}'); return; }
    const b = JSON.parse(body); volani.push(b);
    const predehrati = b.options && b.options.num_predict === 1;
    res.end(JSON.stringify({ message: { role: 'assistant', content: predehrati ? '' : `Odpověď ${volani.length}` }, prompt_eval_count: 100, eval_count: predehrati ? 1 : 10, done: true }));
  };
}
const mapa = (title) => ({ title, nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'todo' } }], edges: [] });
const system = (b) => (b.messages.find((m) => m.role === 'system') || {}).content || '';
const uzivatel = (b) => b.messages.filter((m) => m.role === 'user').map((m) => m.content);
const ostre = (v) => v.filter((b) => !(b.options && b.options.num_predict === 1));

async function instance(slug, env) {
  const v = [];
  const B = await H.httpMock(mock(v));
  const inst = await H.startInstance({ slug, addHostGateway: true, env: Object.assign({
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: B.base, KB_CHAT_MODEL: 'm-b', KB_CHAT_TOKEN: 't', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_CHAT_ROZJEZD: '0', KB_CHAT2_PROVIDER: 'ollama', KB_CHAT2_URL: B.base, KB_CHAT2_MODEL: 'm-b', KB_CHAT2_TOKEN: 't', KB_CHAT2_TOOLS: 'skupiny' }, env) });
  await inst.register('admin@example.com', { name: 'Petr' });
  const T = await inst.login('admin@example.com');
  return { inst, T, v };
}

H.beh(async () => {
  // 1) stable start ON
  const { inst, T, v } = await instance('stalyzac', { KB_CHAT2_STALY_ZACATEK: '1' });
  const kuchyn = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: mapa('Kuchyň Dvořákovi') })).json;
  expect(!!kuchyn.id, 'mapa Kuchyň založena před rozhovorem');
  const ctx = { route: '/' };
  const r1 = await inst.api('POST', '/api/kb/chat', { token: T, body: { message: 'Co mám dnes na práci?', context: ctx } });
  expect(r1.status === 200, `tah 1 prošel (${r1.status})`);
  const chatId = r1.json.chat.id;
  const t1 = ostre(v).at(-1);
  expect(/Kuchyň Dvořákovi/.test(system(t1)), 'tah 1: seznam map v úvodu obsahuje Kuchyň');

  const dilna = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: mapa('Dílna Novák') })).json;
  expect(!!dilna.id, 'mapa Dílna založena uprostřed rozhovoru');

  const p = await inst.api('POST', '/api/kb/chat/predehrat', { token: T, body: { chat_id: chatId, context: ctx } });
  expect(p.status === 200 && p.json.stav === 'ok', `předehřátí proběhlo (${p.status} ${JSON.stringify(p.json).slice(0, 60)})`);
  const pr = v.at(-1);
  expect(pr.options && pr.options.num_predict === 1, 'předehřátí poslalo 1 token výstupu');

  const r2 = await inst.api('POST', '/api/kb/chat', { token: T, body: { chat_id: chatId, message: 'A co zítra?', context: ctx } });
  expect(r2.status === 200, `tah 2 prošel (${r2.status})`);
  const t2 = ostre(v).at(-1);
  expect(system(t2) === system(t1), 'tah 2: systémová zpráva bajtově stejná jako v tahu 1 (Dílna v ní NENÍ)');
  expect(!/Dílna Novák/.test(system(t2)), 'tah 2: nová mapa se do úvodu nepropsala');
  const u2 = uzivatel(t2);
  expect(u2.length === 2 && u2[0] === uzivatel(t1)[0], 'tah 2: první zpráva uživatele stejná jako v tahu 1 (začátek historie se nemění)');
  expect(/Seznam map se od začátku rozhovoru změnil/.test(u2[1]) && /Dílna Novák/.test(u2[1]) && /A co zítra\?/.test(u2[1]), `tah 2: zpráva nese poznámku s novou mapou („${u2[1].slice(0, 120).replace(/\n/g, ' / ')}…“)`);
  expect(!/Kuchyň Dvořákovi/.test(u2[1]), 'tah 2: poznámka obsahuje jen změnu, ne celý seznam');
  // prewarm = exactly what turn 2 sent, up to the (empty) last user message
  expect(system(pr) === system(t2), 'předehřátí mělo stejnou systémovou zprávu jako tah 2');
  const up = uzivatel(pr);
  expect(up.length === 2 && /Dílna Novák/.test(up[1]) && up[0] === u2[0], 'předehřátí neslo stejnou poznámku jako příští tah');

  const r3 = await inst.api('POST', '/api/kb/chat', { token: T, body: { chat_id: chatId, message: 'Díky.', context: ctx } });
  expect(r3.status === 200, `tah 3 prošel (${r3.status})`);
  const t3 = ostre(v).at(-1); const u3 = uzivatel(t3);
  expect(system(t3) === system(t1), 'tah 3: systémová zpráva pořád stejná');
  expect(u3.length === 3 && u3[0] === u2[0] && u3[1] === u2[1], 'tah 3: historie tahů 1–2 beze změny (poznámka se neopakuje ani nemění)');
  expect(!/Seznam map se/.test(u3[2]), 'tah 3: bez změny map žádná nová poznámka');

  const del = await inst.api('DELETE', `/api/collections/goalmaps/records/${kuchyn.id}`, { token: T });
  expect(del.status === 204, `mapa Kuchyň smazána (${del.status})`);
  const r4 = await inst.api('POST', '/api/kb/chat', { token: T, body: { chat_id: chatId, message: 'Co ještě?', context: ctx } });
  expect(r4.status === 200, `tah 4 prošel (${r4.status})`);
  const t4 = ostre(v).at(-1); const u4 = uzivatel(t4);
  expect(system(t4) === system(t1), 'tah 4: systémová zpráva pořád stejná i po smazání mapy');
  expect(/Už v seznamu nejsou/.test(u4[3]) && /Kuchyň Dvořákovi/.test(u4[3]), 'tah 4: poznámka hlásí smazanou mapu');
  const detail = (await inst.api('GET', `/api/kb/chat/detail/${chatId}`, { token: T })).json.chat;
  const vidi = (detail.messages || []).filter((m) => m.role === 'user').map((m) => m.content);
  expect(vidi.every((t) => !/Seznam map se/.test(t || '')), 'uživatel poznámku v rozhovoru nevidí (jen model)');
  inst.stop();

  // 2) control: same flow WITHOUT the switch → live list in the system message (old behaviour)
  const k = await instance('stalyzacvyp', {});
  await k.inst.api('POST', '/api/collections/goalmaps/records', { token: k.T, body: mapa('Kuchyň Dvořákovi') });
  const k1 = await k.inst.api('POST', '/api/kb/chat', { token: k.T, body: { message: 'Co mám dnes na práci?', context: ctx } });
  await k.inst.api('POST', '/api/collections/goalmaps/records', { token: k.T, body: mapa('Dílna Novák') });
  await k.inst.api('POST', '/api/kb/chat', { token: k.T, body: { chat_id: k1.json.chat.id, message: 'A co zítra?', context: ctx } });
  const kv = ostre(k.v);
  expect(kv.length >= 2 && /Dílna Novák/.test(system(kv.at(-1))) && system(kv.at(-1)) !== system(kv[0]), 'bez přepínače: nová mapa je v úvodu (postaru), úvod se změnil');
  expect(!/Seznam map se/.test(uzivatel(kv.at(-1)).join('\n')), 'bez přepínače: žádná poznámka');
  k.inst.stop();

  // 3) stable tool list (KB_CHAT2_STALE_NASTROJE=1): the API tool list stays as in turn 1; a group needed later arrives
  //    as a note in the user message, open_tools / the safety net as a stored tool result — all at the END of the prompt
  const vs = [];
  const BS = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/tags')) { res.end(JSON.stringify({ models: [{ name: 'm-b' }] })); return; }
    const b = JSON.parse(body); vs.push(b);
    const posl = b.messages[b.messages.length - 1] || {};
    const poslUser = [...b.messages].reverse().find((m) => m.role === 'user') || {};
    const msg = { role: 'assistant', content: '' };
    if (b.options && b.options.num_predict === 1) { /* prewarm */ }
    else if (posl.role === 'tool' && /otevřena skupina nástrojů udalosti/.test(posl.content || '')) msg.tool_calls = [{ function: { name: 'list_events', arguments: {} } }];
    else if (posl.role === 'tool') msg.content = `Hotovo po ${posl.name}.`;
    else if (/\(otevři\)/.test(poslUser.content || '')) msg.tool_calls = [{ function: { name: 'open_tools', arguments: { group: 'faktury' } } }];
    else if (/\(pojistka\)/.test(poslUser.content || '')) msg.tool_calls = [{ function: { name: 'list_events', arguments: {} } }];
    else msg.content = 'Odpověď.';
    res.end(JSON.stringify({ message: msg, prompt_eval_count: 100, eval_count: 10, done: true }));
  });
  const instS = await H.startInstance({ slug: 'stalenastr', addHostGateway: true, env: {
    KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: BS.base, KB_CHAT_MODEL: 'm-b', KB_CHAT_TOKEN: 't', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600,
    KB_CHAT_ROZJEZD: '0', KB_CHAT2_PROVIDER: 'ollama', KB_CHAT2_URL: BS.base, KB_CHAT2_MODEL: 'm-b', KB_CHAT2_TOKEN: 't', KB_CHAT2_TOOLS: 'skupiny',
    KB_CHAT2_STALY_ZACATEK: '1', KB_CHAT2_STALE_NASTROJE: '1' } });
  await instS.register('admin@example.com', { name: 'Petr' });
  const TS = await instS.login('admin@example.com');
  const jmena = (b) => (b.tools || []).map((t) => t.function.name).join(',');
  const ostreS = () => ostre(vs);
  const s1 = await instS.api('POST', '/api/kb/chat', { token: TS, body: { message: 'Co mám dnes na práci?', context: ctx } });
  expect(s1.status === 200, `B tah 1 prošel (${s1.status})`);
  const cid = s1.json.chat.id; const b1 = ostreS().at(-1);
  expect(!/list_rules/.test(jmena(b1)) && !/list_invoices/.test(jmena(b1)), 'B tah 1: pravidla ani faktury v seznamu nástrojů nejsou');
  const s2 = await instS.api('POST', '/api/kb/chat', { token: TS, body: { chat_id: cid, message: 'Jaká mám pravidla?', context: ctx } });
  expect(s2.status === 200, `B tah 2 prošel (${s2.status})`);
  const b2 = ostreS().at(-1);
  expect(JSON.stringify(b2.tools) === JSON.stringify(b1.tools), 'B tah 2: seznam nástrojů bajtově stejný jako v tahu 1');
  expect(system(b2) === system(b1), 'B tah 2: systémová zpráva stejná (pokyny skupiny pravidla v ní nejsou)');
  const u2s = uzivatel(b2);
  expect(/otevřena skupina nástrojů pravidla/.test(u2s[1]) && /"name":"list_rules"/.test(u2s[1]) && /Jaká mám pravidla\?/.test(u2s[1]), 'B tah 2: zpráva nese poznámku se schématy skupiny pravidla');
  // open_tools mid-turn → stored call + result with the schemas, tool list unchanged
  const s3 = await instS.api('POST', '/api/kb/chat', { token: TS, body: { chat_id: cid, message: 'Udělej to prosím (otevři)', context: ctx } });
  expect(s3.status === 200, `B tah 3 prošel (${s3.status})`);
  const po3 = ostreS().slice(-2);
  expect(po3.length === 2 && po3.every((b) => JSON.stringify(b.tools) === JSON.stringify(b1.tools)), 'B tah 3: po open_tools seznam nástrojů pořád stejný');
  const vysl = po3[1].messages.at(-1);
  expect(vysl.role === 'tool' && /otevřena skupina nástrojů faktury/.test(vysl.content) && /"name":"list_invoices"/.test(vysl.content), 'B tah 3: výsledek open_tools nese schémata faktur');
  const delka = vysl.content.length;
  // safety net: a tool from a group the model does not have → not executed, schemas + "call again", then it runs
  const s4 = await instS.api('POST', '/api/kb/chat', { token: TS, body: { chat_id: cid, message: 'Ukaž mi to (pojistka)', context: ctx } });
  expect(s4.status === 200, `B tah 4 prošel (${s4.status})`);
  const po4 = ostreS().slice(-3);
  expect(po4.every((b) => JSON.stringify(b.tools) === JSON.stringify(b1.tools)), 'B tah 4: pojistka nezměnila seznam nástrojů');
  const pj = po4[1].messages.at(-1);
  expect(pj.role === 'tool' && /otevřena skupina nástrojů udalosti/.test(pj.content) && /Zavolej list_events znovu/.test(pj.content), 'B tah 4: pojistka vrátila schémata a pokyn zavolat znovu');
  const vykonano = po4[2].messages.at(-1);
  expect(vykonano.role === 'tool' && /No events|Žádné události/.test(vykonano.content) && !/otevřena skupina|Already read/.test(vykonano.content), 'B tah 4: druhé volání list_events (nástroj jen ze zprávy) se vykonalo');
  // the open_tools result from turn 3 is still whole in turn 5 (old tool results are otherwise cut to 600 chars)
  await instS.api('POST', '/api/kb/chat', { token: TS, body: { chat_id: cid, message: 'Díky.', context: ctx } });
  const b5 = ostreS().at(-1);
  const stary = b5.messages.find((m) => m.role === 'tool' && /otevřena skupina nástrojů faktury/.test(m.content || ''));
  expect(stary && stary.content.length === delka && delka > 600, `B tah 5: výsledek open_tools z tahu 3 celý (${stary ? stary.content.length : 0} / ${delka} znaků)`);
  expect(JSON.stringify(b5.tools) === JSON.stringify(b1.tools) && system(b5) === system(b1), 'B tah 5: začátek zadání (systém + nástroje) pořád stejný');
  const u5 = uzivatel(b5);
  expect(u5[1] === u2s[1], 'B tah 5: poznámka u tahu 2 se nezměnila');
  instS.stop();
});
