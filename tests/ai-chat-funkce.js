// Zbývající funkce aplikace přes asistenta (4. 10. 2026, Richard: „asistent musí umět VŠECHNY funkce“) — API sada proti
// PODVRŽENÉ ollamě (fronta odpovědí jako v ai-chat.js). Měří: smazání kroku i s podkroky, archivace/obnova/přejmenování/
// smazání projektu (práva vlastník × editor × člen), veřejný odkaz, úprava a smazání pravidla, šablony pravidel,
// výpis a zrušení připomínky ke kroku, žádost o jiný termín (cizí práce) + stažení + zamítnutí, všechna upozornění
// přečtená, hlášení chyby (bez SMTP = poctivá chyba před kartou), nabídku nástrojů podle klíčových slov a prompt.
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/ai-chat-funkce.js
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
const posledniVolani = () => volani[volani.length - 1];
const systemZ = (v) => (v.messages.find((m) => m.role === 'system') || {}).content || '';
const toolZ = (v) => v.messages.filter((m) => m.role === 'tool');
const jmenaNastroju = (v) => (v.tools || []).map((t) => t.function.name);
const posledniKarta = (chat, typ) => { const i = chat.messages.map((m) => m.role).lastIndexOf('user'); return chat.messages.slice(i + 1).flatMap((m) => m.karty || []).reverse().find((k) => k.type === typ); };
const kartaPodleId = (chat, id) => chat.messages.flatMap((m) => m.karty || []).find((k) => k.type === 'akce' && k.id === id);
const den = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

H.beh(async () => {
  const mock = await H.httpMock(mockHandler);
  const ENV = { KB_CHAT_PROVIDER: 'ollama', KB_CHAT_URL: mock.base, KB_CHAT_MODEL: 'm-a', KB_UVODNI_MAPA: 0, KB_AI_MAX_PER_HOUR: 600, KB_AI_KVOTA_TYDEN: 500 };
  const inst = await H.startInstance({ slug: 'chat-funkce', addHostGateway: true, env: ENV });
  await inst.register('admin@example.com', { name: 'Petr', full_name: 'Petr Novák' });   // první = admin
  await inst.register('clen@example.com', { name: 'Jana' });
  const A = await inst.login('admin@example.com');
  const B = await inst.login('clen@example.com');
  const chatuj = async (token, body) => inst.api('POST', '/api/kb/chat', { token, body });
  const potvrd = async (token, chat_id, id, ok) => inst.api('POST', '/api/kb/chat/potvrdit', { token, body: { chat_id, action_id: id, ok } });
  const mapaZ = async (id, token) => (await inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: token || A })).json;
  const uzly = (m) => (m.nodes || []).filter((n) => n.type !== 'note');
  const map = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: {
    title: 'Truhlářství', nodes: [
      { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň Dvořákovi', title: 'Kuchyň Dvořákovi', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Poslat poptávku na spárovky', status: 'todo', deadline: den(6), owner: 'clen@example.com', assignedBy: 'admin@example.com' } },
      { id: 'n2', type: 'goalNode', position: { x: 0, y: 400 }, data: { title: 'Vybrat dodavatele', status: 'todo' } },
      { id: 'n3', type: 'goalNode', position: { x: 200, y: 400 }, data: { title: 'Objednat kování', status: 'todo', deadline: den(9), owner: 'admin@example.com' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'n1' }, { id: 'e2', source: 'n1', target: 'n2' }, { id: 'e3', source: 'root', target: 'n3' }] } })).json;
  expect(!!map.id, 'mapa admina založena (4 uzly)');
  // Jana = spolupracovnice (work): vidí mapu, má na n1 svou práci; sdílení jí zároveň pošle upozornění
  expect((await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'share', mapId: map.id, email: 'clen@example.com', permission: 'work' } })).status === 200, 'mapa nasdílena Janě (work)');

  console.log('== prompt a nabídka nástrojů ==');
  fronta.push(text('x'));
  let r = await chatuj(A, { message: 'Archivuj projekt Truhlářství', context: { route: '/' } });
  let jm = jmenaNastroju(posledniVolani());
  expect(jm.includes('archive_project') && jm.includes('delete_project') && jm.includes('rename_project') && jm.includes('delete_node'), `„archivuj“ nabídne nástroje projektu (+ delete_node je stálý) (${jm.filter((n) => /project|node/.test(n)).join(', ')})`);
  // etapa 3 (5. 10. 2026): archive_project je ve fragmentu skupiny projekt (otevřená „archivuj“), report_problem ve fragmentu nastaveni (zavřená) → základ o něm ví jen katalogem „hlášení chyby (nastaveni)“
  expect(/delete_node/.test(systemZ(posledniVolani())) && /archive_project/.test(systemZ(posledniVolani())) && /hlášení chyby \(nastaveni\)/.test(systemZ(posledniVolani())) && !/report_problem/.test(systemZ(posledniVolani())), 'prompt zná další úpravy (smazání kroku v základu, archivace ve fragmentu projekt, hlášení chyby jen katalogem)');
  fronta.push(text('x'));
  r = await chatuj(A, { message: 'Smaž šablonu pravidla Hotovo', context: { route: '/' } });
  jm = jmenaNastroju(posledniVolani());
  expect(jm.includes('delete_rule_template') && jm.includes('update_rule') && jm.includes('save_rule_template') && jm.includes('delete_rule'), '„šablona“ nabídne nástroje pravidel včetně úprav a šablon');
  fronta.push(text('x'));
  r = await chatuj(A, { message: 'Co mám dnes dělat?', context: { route: '/archive' } });
  expect(jmenaNastroju(posledniVolani()).includes('archive_project'), 'na stránce Archiv jsou nástroje projektu i bez klíčového slova');
  fronta.push(text('x'));
  r = await chatuj(B, { message: 'Označ všechna upozornění jako přečtená', context: { route: '/' } });
  jm = jmenaNastroju(posledniVolani());
  expect(jm.includes('mark_notifications_read') && jm.includes('report_problem') && jm.includes('set_map_public'), '„přečtená“ nabídne nástroje skupiny nastavení (přečteno, hlášení, veřejný odkaz)');

  // zúžení klíčových slov (panel 4. 10.): běžné věty NEotevírají 24 schémat nastavení
  for (const veta of ['Přidej krok nakoupit mléko do projektu Vánoce', 'Objednej díly u dodavatele', 'Pozice firmy na trhu je dobrá', 'Přejmenuj krok Nákup na Nákup dřeva']) {
    fronta.push(text('x'));
    r = await chatuj(A, { message: veta, context: { route: '/' } });
    expect(!jmenaNastroju(posledniVolani()).includes('share_map') && !jmenaNastroju(posledniVolani()).includes('order_membership'), `„${veta}“ neotevře nástroje nastavení`);
  }
  fronta.push(text('x'));
  r = await chatuj(A, { message: 'Dej celému týmu projekt Truhlářství ke čtení', context: { route: '/' } });
  expect(jmenaNastroju(posledniVolani()).includes('set_team_access') && jmenaNastroju(posledniVolani()).includes('share_map'), '„celému týmu … ke čtení“ otevře nástroje sdílení (ostrý běh na produkční sestavě 4. 10.)');
  fronta.push(text('x'));
  r = await chatuj(A, { message: 'Požádej o posun termínu kroku Objednat kování', context: { route: '/' } });
  expect(jmenaNastroju(posledniVolani()).includes('request_deadline_change') && jmenaNastroju(posledniVolani()).includes('decline_deadline_request'), '„posun termínu“ otevře skupinu terminy');
  fronta.push(text('x'));
  r = await chatuj(A, { message: 'Co mám dnes dělat?', context: { route: '/' } });
  expect(!jmenaNastroju(posledniVolani()).includes('request_deadline_change') && !jmenaNastroju(posledniVolani()).includes('add_comment'), 'žádosti o termín a komentáře nejsou v základní sadě každého tahu');

  console.log('== smazání kroku i s podkroky; vrchol nejde ==');
  fronta.push(nastroj('delete_node', { map_id: 'Truhlářství', node_id: 'apex' }), text('x'));
  r = await chatuj(A, { message: 'Smaž apex', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /apex .* cannot be deleted/.test(m.content)), 'doslovné „apex“ → stejná chyba s radou (dřív mrtvá větev)');
  fronta.push(nastroj('delete_node', { map_id: 'Truhlářství', node_id: 'Kuchyň Dvořákovi' }), text('x'));
  r = await chatuj(A, { message: 'Smaž vrchol Kuchyň Dvořákovi', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /apex .* cannot be deleted/.test(m.content)), 'vrchol mapy smazat nejde → chyba před kartou s radou delete_project');
  fronta.push(nastroj('delete_node', { map_id: 'Truhlářství', node_id: 'Poslat poptávku na spárovky' }));
  r = await chatuj(A, { message: 'Smaž krok Poslat poptávku na spárovky', context: { route: '/' } });
  let chat = r.json.chat; let k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Smazat krok „Poslat poptávku na spárovky“ i s podkroky z projektu „Truhlářství“ — nejde vrátit', `karta smazání kroku (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  let m = await mapaZ(map.id);
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && /Deleted 2 node/.test(kartaPodleId(chat, k.id).vysledek) && uzly(m).length === 2 && !uzly(m).some((n) => n.id === 'n1' || n.id === 'n2'), `krok i podkrok smazány (${uzly(m).map((n) => n.id).join(',')})`);
  fronta.push(nastroj('delete_node', { map_id: 'Truhlářství', node_id: 'Objednat kování' }), text('x'));
  r = await chatuj(B, { message: 'Smaž krok Objednat kování', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /only "work" access/.test(m.content)), 'spolupracovnice krok nesmaže → chyba práv před kartou');

  console.log('== veřejný odkaz (vlastník), žádost o jiný termín, zamítnutí ==');
  fronta.push(nastroj('set_map_public', { map_id: 'Truhlářství', public: true }));
  r = await chatuj(A, { message: 'Zapni veřejný odkaz na Truhlářství', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && /^Zapnout veřejný odkaz na projekt „Truhlářství“/.test(k.popis), `karta veřejného odkazu (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await mapaZ(map.id)).is_public === true, 'veřejný odkaz zapnut');
  fronta.push(nastroj('set_map_public', { map_id: 'Truhlářství', public: true }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Zapni veřejný odkaz' });
  expect(toolZ(posledniVolani()).some((m) => /already on/.test(m.content)), 'znovu zapnout → „už je“, bez karty (routa jen přepíná — bez kontroly by ho vypnula)');
  fronta.push(nastroj('set_map_public', { map_id: 'Truhlářství', public: false }), text('x'));
  r = await chatuj(B, { message: 'Vypni veřejný odkaz na Truhlářství', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /not found among the projects the user may share|only by its owner/.test(m.content)) && (await mapaZ(map.id)).is_public === true, 'spolupracovnice veřejný odkaz nemění (v DB zůstal zapnutý)');
  // žádost o termín: Jana na své práci (n3 už není její — n1 smazán; dej jí n3)
  m = await mapaZ(map.id);
  m.nodes = m.nodes.map((n) => (n.id === 'n3' ? Object.assign({}, n, { data: Object.assign({}, n.data, { owner: 'clen@example.com', assignedBy: 'admin@example.com' }) }) : n));
  expect((await inst.api('PATCH', `/api/collections/goalmaps/records/${map.id}`, { token: A, body: { nodes: m.nodes } })).status === 200, 'Objednat kování přiřazeno Janě');
  fronta.push(nastroj('request_deadline_change', { map_id: 'Truhlářství', node_id: 'Objednat kování', date: den(14), note: 'čekám na kování' }));
  r = await chatuj(B, { message: 'Požádej o posun termínu Objednat kování', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && /^Požádat o jiný termín u kroku „Objednat kování“: .*\(„čekám na kování“\) — termín se změní, až zadavatel souhlasí$/.test(k.popis), `karta žádosti o termín (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(B, chat.id, k.id, true); chat = r.json.chat;
  m = await mapaZ(map.id);
  let n3 = uzly(m).find((n) => n.id === 'n3');
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && n3.data.deadlineChangeWanted === den(14) && n3.data.deadline === den(9) && n3.data.deadlineChangeNote === 'čekám na kování', `žádost zapsána, termín zůstal (${JSON.stringify({ w: n3.data.deadlineChangeWanted, d: n3.data.deadline })})`);
  fronta.push(nastroj('request_deadline_change', { map_id: 'Truhlářství', node_id: 'Objednat kování', date: den(20) }), text('x'));
  r = await chatuj(A, { message: 'Posuň termín Objednat kování', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /own project — change the deadline directly with update_node/.test(m.content)), 'vlastník nežádá — rada použít update_node');
  fronta.push(nastroj('decline_deadline_request', { map_id: 'Truhlářství', node_id: 'Objednat kování' }));
  r = await chatuj(A, { message: 'Zamítni Janě žádost o termín', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && /^Zamítnout žádost o jiný termín u kroku „Objednat kování“ \(clen@example.com chce .*\)$/.test(k.popis), `karta zamítnutí (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  n3 = uzly(await mapaZ(map.id)).find((n) => n.id === 'n3');
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && !n3.data.deadlineChangeWanted && n3.data.deadline === den(9), 'žádost zamítnuta, termín zůstal');
  fronta.push(nastroj('decline_deadline_request', { map_id: 'Truhlářství', node_id: 'Objednat kování' }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Zamítni to znovu' });
  expect(toolZ(posledniVolani()).some((m) => /no pending deadline request/.test(m.content)), 'bez žádosti → chyba, bez karty');
  expect((await inst.api('GET', '/api/collections/notifications/records?filter=' + encodeURIComponent('type="deadline_request_resolved"'), { token: B })).json.items.length === 1, 'Jana dostala upozornění o zamítnutí (jako z UI)');

  console.log('== připomínky ke kroku: založit, vypsat, zrušit ==');
  fronta.push(nastroj('create_reminder', { map_id: 'Truhlářství', node_id: 'Objednat kování', offset_days: 1, time: '16:00' }));
  r = await chatuj(A, { message: 'Připomeň mi kování den před termínem v 16', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo', 'připomínka založena');
  fronta.push(nastroj('list_reminders', {}), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Jaké mám připomínky?' });
  const vyp = (toolZ(posledniVolani()).slice(-1)[0] || {}).content || '';
  expect(/16:00 — "Objednat kování" in "Truhlářství" \(id: [a-z0-9]+\)/.test(vyp), `list_reminders vypíše čas, krok, projekt a id (${vyp.slice(0, 120)})`);
  fronta.push(nastroj('delete_reminder', { map_id: 'Truhlářství', node_id: 'Objednat kování' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Zruš tu připomínku' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && /^Zrušit připomínku ke kroku „Objednat kování“ \(.* 16:00\) — termín zůstává$/.test(k.popis), `karta zrušení připomínky bez id (jediná) (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await inst.api('GET', `/api/kb/node-reminders?map=${map.id}`, { token: A })).json.reminders.length === 0 && uzly(await mapaZ(map.id)).find((n) => n.id === 'n3').data.deadline === den(9), 'připomínka pryč, termín zůstal');
  fronta.push(nastroj('delete_reminder', { map_id: 'Truhlářství', node_id: 'Objednat kování' }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Zruš připomínku' });
  expect(toolZ(posledniVolani()).some((m) => /has no timed reminder/.test(m.content)), 'bez připomínky → chyba, bez karty');

  console.log('== pravidla: upravit, smazat; šablony ==');
  fronta.push(nastroj('create_rule', { map_id: 'Truhlářství', name: 'Hotovo → oznámit', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'Krok hotov' }] }));
  r = await chatuj(A, { message: 'Když bude krok hotový, dej mi vědět', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  let pravidla = (await inst.api('GET', `/api/kb/rules?map=${map.id}`, { token: A })).json.rules || [];
  expect(pravidla.length === 1 && pravidla[0].name === 'Hotovo → oznámit', 'pravidlo založeno');
  fronta.push(nastroj('update_rule', { map_id: 'Truhlářství', rule_id: 'Hotovo → oznámit', name: 'Hotovo → oznámit vlastníkovi', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'Krok je hotový' }] }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Přejmenuj to pravidlo na Hotovo → oznámit vlastníkovi' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Změnit pravidlo „Hotovo → oznámit vlastníkovi“ v projektu „Truhlářství“ (node_status_changed → notify)', `karta úpravy pravidla podle názvu (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  pravidla = (await inst.api('GET', `/api/kb/rules?map=${map.id}`, { token: A })).json.rules || [];
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && pravidla.length === 1 && pravidla[0].name === 'Hotovo → oznámit vlastníkovi' && pravidla[0].actions[0].message === 'Krok je hotový', `pravidlo změněno (${JSON.stringify(pravidla.map((p) => p.name))})`);
  // vypnout pravidlo (panel 4. 10.: set_rule_enabled nikde netestován; podle názvu dřív neprošel a karta neřekla které)
  fronta.push(nastroj('set_rule_enabled', { map_id: 'Truhlářství', rule_id: 'neexistuje', enabled: false }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Vypni pravidlo neexistuje' });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /rule "neexistuje" not found/.test(m.content)), 'neznámé pravidlo → chyba před kartou, žádná karta');
  fronta.push(nastroj('set_rule_enabled', { map_id: 'Truhlářství', rule_id: 'Hotovo → oznámit vlastníkovi', enabled: false }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Vypni pravidlo Hotovo → oznámit vlastníkovi' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.stav === 'ceka' && k.popis === 'Vypnout pravidlo „Hotovo → oznámit vlastníkovi“ v projektu „Truhlářství“', `karta vypnutí pravidla s názvem pravidla (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  pravidla = (await inst.api('GET', `/api/kb/rules?map=${map.id}`, { token: A })).json.rules || [];
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && pravidla.length === 1 && pravidla[0].enabled === false && toolZ(posledniVolani()).some((m) => /^Rule disabled/.test(m.content)), `pravidlo vypnuto (${JSON.stringify(pravidla.map((p) => [p.name, p.enabled]))})`);
  fronta.push(nastroj('update_rule', { map_id: 'Truhlářství', rule_id: 'neexistuje', name: 'x', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Změň pravidlo neexistuje' });
  expect(toolZ(posledniVolani()).some((m) => /rule "neexistuje" not found/.test(m.content)), 'neznámé pravidlo → chyba, bez karty');
  fronta.push(nastroj('update_rule', { map_id: 'Truhlářství', rule_id: pravidla[0].id, name: 'x', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'nikdo', message: 'x' }] }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Změň pravidlo' });
  expect(toolZ(posledniVolani()).some((m) => /invalid rule/.test(m.content) && /call update_rule again/.test(m.content)), 'neplatný tvar → chyba před kartou s radou volat update_rule');
  fronta.push(nastroj('save_rule_template', { name: 'Hotovo → oznámit (šablona)', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'Krok hotov' }] }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Ulož to jako šablonu' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Uložit šablonu pravidla „Hotovo → oznámit (šablona)“ (node_status_changed → notify)', `karta šablony (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  let sablony = (await inst.api('GET', '/api/kb/rule-templates', { token: A })).json.templates || [];
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && sablony.length === 1 && sablony[0].name === 'Hotovo → oznámit (šablona)', 'šablona uložena');
  fronta.push(nastroj('list_rule_templates', {}), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Jaké mám šablony pravidel?' });
  expect(toolZ(posledniVolani()).some((m) => /Hotovo → oznámit \(šablona\)/.test(m.content)), 'list_rule_templates vypíše uloženou šablonu (čtení, bez karty)');
  fronta.push(nastroj('save_rule_template', { name: 'Hotovo → oznámit (šablona)', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'x' }] }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Ulož šablonu znovu' });
  expect(toolZ(posledniVolani()).some((m) => /already exists — pass its template_id/.test(m.content)), 'stejný název → chyba s radou template_id');
  fronta.push(nastroj('save_rule_template', { template_id: 'Hotovo → oznámit (šablona)', name: 'Hotovo → oznámit (šablona v2)', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'Krok hotov' }] }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Přejmenuj šablonu' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  sablony = (await inst.api('GET', '/api/kb/rule-templates', { token: A })).json.templates || [];
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && sablony.length === 1 && sablony[0].name === 'Hotovo → oznámit (šablona v2)', 'šablona změněna podle názvu (template_id = název)');
  fronta.push(nastroj('delete_rule_template', { template_id: 'Hotovo → oznámit (šablona v2)' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Smaž tu šablonu' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Smazat šablonu pravidla „Hotovo → oznámit (šablona v2)“ z knihovny', `karta smazání šablony (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && ((await inst.api('GET', '/api/kb/rule-templates', { token: A })).json.templates || []).length === 0, 'šablona smazána');
  fronta.push(nastroj('delete_rule', { map_id: 'Truhlářství', rule_id: 'Hotovo → oznámit vlastníkovi' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Smaž to pravidlo' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Smazat pravidlo „Hotovo → oznámit vlastníkovi“ z projektu „Truhlářství“ — nejde vrátit', `karta smazání pravidla (${k && k.popis})`);
  // Ne u destruktivní karty: stav zamitnuto, pravidlo zůstává, model dostal „zamítl“ (panel 4. 10.: odmítnutí u nových funkcí netestované)
  fronta.push(text('Nechám ho.'));
  r = await potvrd(A, chat.id, k.id, false); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'zamitnuto' && ((await inst.api('GET', `/api/kb/rules?map=${map.id}`, { token: A })).json.rules || []).length === 1 && toolZ(posledniVolani()).some((m) => /zamítl/.test(m.content)), 'Ne → pravidlo zůstalo, model dostal „uživatel zamítl“');
  fronta.push(nastroj('delete_rule', { map_id: 'Truhlářství', rule_id: 'Hotovo → oznámit vlastníkovi' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Ne, fakt ho smaž' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.stav === 'ceka', 'nová karta smazání pravidla');
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && ((await inst.api('GET', `/api/kb/rules?map=${map.id}`, { token: A })).json.rules || []).length === 0, 'pravidlo smazáno');

  console.log('== upozornění přečtená; hlášení chyby bez SMTP ==');
  const neprectene = async (tok) => ((await inst.api('GET', '/api/collections/notifications/records?filter=' + encodeURIComponent('read=false'), { token: tok })).json.items || []).length;
  expect((await neprectene(B)) >= 1, `Jana má nepřečtená upozornění (${await neprectene(B)})`);
  fronta.push(nastroj('mark_notifications_read', {}));
  r = await chatuj(B, { message: 'Označ všechna upozornění jako přečtená', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Označit všechna upozornění jako přečtená', `karta přečtení (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(B, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await neprectene(B)) === 0, 'všechna upozornění Jany přečtená');
  fronta.push(nastroj('mark_notifications_read', {}), text('x'));
  r = await chatuj(B, { chat_id: chat.id, message: 'Ještě jednou' });
  expect(toolZ(posledniVolani()).some((m) => /no unread notifications/.test(m.content)), 'bez nepřečtených → chyba, bez karty');
  fronta.push(nastroj('report_problem', { kind: 'chyba', text: 'Tlačítko Sdílet na telefonu nejde stisknout.' }), text('x'));
  r = await chatuj(B, { chat_id: chat.id, message: 'Nahlas chybu: tlačítko Sdílet na telefonu nejde stisknout' });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /needs e-mail configured/.test(m.content)), 'bez SMTP hlášení nejde → poctivá chyba před kartou (jako formulář v UI)');
  fronta.push(nastroj('report_problem', { kind: 'napad', text: 'ok' }), text('x'));
  r = await chatuj(B, { chat_id: chat.id, message: 'Nápad: ok' });
  expect(toolZ(posledniVolani()).some((m) => /too short/.test(m.content)), 'krátký text → chyba');

  console.log('== komentář, přesun kroku, úprava nápadu, stopky, dokumenty (inventura 2, panel 4. 10.) ==');
  fronta.push(nastroj('add_comment', { map_id: 'Truhlářství', node_id: 'Objednat kování', text: 'Kování dorazí v pondělí.' }));
  r = await chatuj(A, { message: 'Napiš ke kování komentář, že dorazí v pondělí', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(jmenaNastroju(posledniVolani()).includes('add_comment') && jmenaNastroju(posledniVolani()).includes('start_timer'), '„komentář“ otevře skupinu prace');
  expect(!!k && k.popis === 'Přidat komentář ke kroku „Objednat kování“ (projekt „Truhlářství“): „Kování dorazí v pondělí.“' && k.detail === 'Kování dorazí v pondělí.', `karta komentáře (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  const kom = (await inst.api('GET', '/api/collections/comments/records?filter=' + encodeURIComponent(`goalmap="${map.id}"`), { token: A })).json.items || [];
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && kom.length === 1 && kom[0].text === 'Kování dorazí v pondělí.' && kom[0].author_email === 'admin@example.com' && kom[0].node_id === 'n3', `komentář v DB s autorem z hooku (${JSON.stringify(kom.map((c) => [c.node_id, c.author_email]))})`);
  expect((await inst.api('GET', '/api/collections/notifications/records?filter=' + encodeURIComponent('type="node_comment"'), { token: B })).json.items.length === 1, 'řešitelka kroku dostala upozornění na komentář (jako z UI)');
  // přesun kroku: mapa se stromem root → a → b, c
  const mapaP = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Přesuny', nodes: [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Cíl', title: 'Cíl', status: 'todo' } },
    { id: 'a', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Alfa', status: 'todo' } },
    { id: 'b', type: 'goalNode', position: { x: 0, y: 400 }, data: { title: 'Beta', status: 'todo' } },
    { id: 'c', type: 'goalNode', position: { x: 200, y: 200 }, data: { title: 'Gama', status: 'todo' } },
  ], edges: [{ id: 'e1', source: 'root', target: 'a' }, { id: 'e2', source: 'a', target: 'b' }, { id: 'e3', source: 'root', target: 'c' }] } })).json;
  const rodic = async (nid) => ((await mapaZ(mapaP.id)).edges || []).filter((e) => e.target === nid).map((e) => e.source).join(',');
  fronta.push(nastroj('move_node', { map_id: 'Přesuny', node_id: 'Alfa', parent_id: 'Beta' }), text('x'));
  r = await chatuj(A, { message: 'Přesuň Alfu pod Betu', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /inside the moved step's own subtree/.test(m.content)), 'přesun pod vlastní podkrok → chyba (cyklus)');
  fronta.push(nastroj('move_node', { map_id: 'Přesuny', node_id: 'Gama', parent_id: 'Beta' }));
  r = await chatuj(A, { message: 'Přesuň Gamu pod Betu', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Přesunout krok „Gama“ i s podkroky pod „Beta“ (projekt „Přesuny“)', `karta přesunu (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await rodic('c')) === 'b' && ((await mapaZ(mapaP.id)).edges || []).length === 3, `Gama je pod Betou, hran stále 3 (${await rodic('c')})`);
  const hranaC = ((await mapaZ(mapaP.id)).edges || []).find((e) => e.target === 'c');
  expect(!!hranaC && hranaC.type === 'deletable' && /^edge-/.test(hranaC.id), `nová hrana jako z editoru: type deletable (tlačítko smazání), id edge-… (${JSON.stringify(hranaC)})`);
  fronta.push(nastroj('move_node', { map_id: 'Přesuny', node_id: 'Gama', parent_id: 'apex' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Dej Gamu zpět nahoru' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Přesunout krok „Gama“ i s podkroky pod vrchol projektu (projekt „Přesuny“)', `karta přesunu pod vrchol (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await rodic('c')) === 'root', 'Gama zpět pod vrcholem');
  fronta.push(nastroj('move_node', { map_id: 'Přesuny', node_id: 'Gama', parent_id: 'Beta' }), text('x'));
  r = await chatuj(B, { message: 'Přesuň Gamu pod Betu', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /not found or not accessible|only "work" access/.test(m.content)), 'cizí (nenasdílená) mapa → chyba, bez karty');
  // nápad: založit, upravit podle názvu
  fronta.push(nastroj('add_idea', { title: 'Koupit lepidlo' }), text('x'));
  r = await chatuj(A, { message: 'Nápad: koupit lepidlo', context: { route: '/' } });
  const napad = ((await inst.api('GET', '/api/collections/buffer_nodes/records', { token: A })).json.items || []).find((i) => i.title === 'Koupit lepidlo');
  expect(!!napad, 'nápad v zásobníku');
  fronta.push(nastroj('update_idea', { idea: 'Koupit lepidlo', title: 'Koupit lepidlo na dřevo', description: '2 tuby' }));
  r = await chatuj(A, { chat_id: r.json.chat.id, message: 'Uprav ten nápad: lepidlo na dřevo, 2 tuby' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Upravit nápad „Koupit lepidlo“: název „Koupit lepidlo na dřevo“ · nový popis' && k.detail === '2 tuby', `karta úpravy nápadu (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  const napadPo = (await inst.api('GET', `/api/collections/buffer_nodes/records/${napad.id}`, { token: A })).json;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && napadPo.title === 'Koupit lepidlo na dřevo' && napadPo.description === '2 tuby', 'nápad upraven v DB');
  fronta.push(nastroj('update_idea', { idea: 'Koupit lepidlo na dřevo', title: 'x' }), text('x'));
  r = await chatuj(B, { message: 'Uprav nápad Koupit lepidlo na dřevo', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /not found in the user's buffer/.test(m.content)), 'cizí nápad → chyba, bez karty');
  // stopky
  fronta.push(nastroj('get_timer', {}), text('x'));
  r = await chatuj(A, { message: 'Běží mi stopky?', context: { route: '/' } });
  expect(toolZ(posledniVolani()).some((m) => /No work timer is running/.test(m.content)), 'get_timer: nic neběží');
  fronta.push(nastroj('start_timer', { map_id: 'Truhlářství', node_id: 'Objednat kování' }));
  r = await chatuj(A, { chat_id: r.json.chat.id, message: 'Spusť stopky na kování' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Spustit stopky na krok „Objednat kování“ — běžící stopky se zastaví', `karta stopek (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  const bezici = async () => ((await inst.api('GET', '/api/collections/time_entries/records?filter=' + encodeURIComponent("ended=''"), { token: A })).json.items || []);
  let tb = await bezici();
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && tb.length === 1 && tb[0].node_id === 'n3' && tb[0].map === map.id && tb[0].label === 'Objednat kování' && tb[0].owner_email === 'admin@example.com', `stopky běží na kroku (hook doplnil vlastníka) (${JSON.stringify(tb.map((t) => [t.node_id, t.label]))})`);
  fronta.push(nastroj('start_timer', { label: 'Telefonáty' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Teď měř telefonáty' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  tb = await bezici();
  expect(tb.length === 1 && tb[0].label === 'Telefonáty', 'druhé spuštění zastavilo první (jedny stopky naráz, jako v aplikaci)');
  fronta.push(nastroj('get_timer', {}), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Běží stopky?' });
  expect(toolZ(posledniVolani()).some((m) => /Work timer running since .* — "Telefonáty"/.test(m.content)), 'get_timer: běží s popiskem');
  fronta.push(nastroj('stop_timer', { note: 'volat Novákovi' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Zastav stopky, poznámka volat Novákovi' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Zastavit stopky s poznámkou „volat Novákovi“', `karta zastavení (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  const vsechny = (await inst.api('GET', '/api/collections/time_entries/records?sort=-created', { token: A })).json.items || [];
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await bezici()).length === 0 && vsechny.length === 2 && vsechny.every((t) => t.ended) && vsechny[0].note === 'volat Novákovi' && /saved as an idea/.test(kartaPodleId(chat, k.id).vysledek), `stopky zastavené, 2 záznamy uzavřené, poznámka → nápad (${JSON.stringify(vsechny.map((t) => [t.label, t.duration_min, !!t.ended]))})`);
  expect(((await inst.api('GET', '/api/collections/buffer_nodes/records', { token: A })).json.items || []).some((i) => i.title === 'volat Novákovi'), 'poznámka ke stopkám bez kroku je v zásobníku (hook time_entries)');
  fronta.push(nastroj('stop_timer', {}), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Zastav stopky' });
  expect(toolZ(posledniVolani()).some((m) => /no work timer is running/.test(m.content)), 'bez běžících stopek → chyba, bez karty');
  // dokumenty: koncept → přepis → vrátit verzi → smazat
  fronta.push(nastroj('draft_text', { kind: 'email', title: 'Poptávka kování', text: 'Předmět: Poptávka\n\nDobrý den, poptávám kování.' }), text('Koncept je nahoře.'));
  r = await chatuj(A, { message: 'Napiš poptávku na kování', context: { route: '/' } });
  chat = r.json.chat;
  const doky = async () => ((await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.dokumenty || (await inst.api('GET', '/api/kb/chat/dokumenty', { token: A })).json.documents || []);
  let dk = await doky();
  expect(dk.some((d) => d.title === 'Poptávka kování'), `dokument založen (${JSON.stringify(dk.map((d) => d.title))})`);
  fronta.push(nastroj('revert_document', { document: 'Poptávka kování' }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Vrať předchozí verzi poptávky' });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /has no previous version/.test(m.content)), 'bez předchozí verze → chyba, bez karty');
  fronta.push(nastroj('update_document', { document: 'Poptávka kování', text: 'Předmět: Poptávka kování\n\nDobrý den, poptávám 20 ks kování.' }), text('Upraveno.'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Doplň 20 ks' });
  chat = r.json.chat;
  fronta.push(nastroj('revert_document', { document: 'Poptávka kování' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Vrať to zpátky' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Vrátit předchozí verzi dokumentu „Poptávka kování“', `karta vrácení verze (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  dk = await doky();
  const dokId = (dk.find((d) => d.title === 'Poptávka kování') || {}).id;
  const dok = dokId ? (await inst.api('GET', `/api/kb/chat/dokument/${dokId}`, { token: A })).json.dokument : null;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && !!dok && /poptávám kování\.$/.test(dok.text || ''), `předchozí verze zpět (${dok && (dok.text || '').slice(-40)})`);
  fronta.push(nastroj('delete_document', { document: 'Poptávka kování' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Smaž poptávku kování' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Smazat dokument „Poptávka kování“ — nejde vrátit', `karta smazání dokumentu (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && !(await doky()).some((d) => d.title === 'Poptávka kování'), 'dokument smazán');
  fronta.push(nastroj('delete_document', { document: 'Poptávka kování' }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Smaž to znovu' });
  expect(toolZ(posledniVolani()).some((m) => /document "Poptávka kování" not found/.test(m.content)), 'smazaný dokument → chyba, bez karty');

  console.log('== projekt: přejmenovat (editor), archivovat/obnovit (vlastník), smazat ==');
  fronta.push(nastroj('rename_project', { map_id: 'Truhlářství', title: 'Truhlářství 2026' }));
  r = await chatuj(A, { message: 'Přejmenuj projekt Truhlářství na Truhlářství 2026', context: { route: '/' } });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Přejmenovat projekt „Truhlářství“ na „Truhlářství 2026“', `karta přejmenování (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await mapaZ(map.id)).title === 'Truhlářství 2026', 'projekt přejmenován');
  fronta.push(nastroj('rename_project', { map_id: 'Truhlářství 2026', title: 'Jana si mění' }), text('x'));
  r = await chatuj(B, { message: 'Přejmenuj projekt Truhlářství 2026', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /only "work" access/.test(m.content)), 'spolupracovnice (work) projekt nepřejmenuje');
  fronta.push(nastroj('archive_project', { map_id: 'Truhlářství 2026' }), text('x'));
  r = await chatuj(B, { chat_id: r.json.chat.id, message: 'Archivuj ho' });
  expect(toolZ(posledniVolani()).some((m) => /only the owner .* can archive or restore/.test(m.content)), 'archivovat smí jen vlastník');
  fronta.push(nastroj('archive_project', { map_id: 'Truhlářství 2026' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Archivuj Truhlářství 2026' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Archivovat projekt „Truhlářství 2026“ (zmizí z úvodní stránky, zůstane v Archivu)', `karta archivace (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await mapaZ(map.id)).archived === true, 'projekt archivován');
  fronta.push(nastroj('archive_project', { map_id: 'Truhlářství 2026' }), text('x'));
  r = await chatuj(A, { chat_id: chat.id, message: 'Archivuj znovu' });
  expect(toolZ(posledniVolani()).some((m) => /already archived/.test(m.content)), 'už archivovaný → chyba, bez karty');
  fronta.push(nastroj('archive_project', { map_id: 'Truhlářství 2026', archived: false }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Obnov Truhlářství 2026 z archivu' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Obnovit projekt „Truhlářství 2026“ z archivu', `karta obnovy (archivovaná mapa se najde) (${k && k.popis})`);
  fronta.push(text('x'));
  r = await potvrd(A, chat.id, k.id, true); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'hotovo' && (await mapaZ(map.id)).archived === false, 'projekt obnoven');
  fronta.push(nastroj('delete_project', { map_id: 'Truhlářství 2026' }), text('x'));
  r = await chatuj(B, { message: 'Smaž projekt Truhlářství 2026', context: { route: '/' } });
  expect(r.json.chat.pending.length === 0 && toolZ(posledniVolani()).some((m) => /only the owner .* can delete/.test(m.content)), 'smazat smí jen vlastník');
  fronta.push(nastroj('delete_project', { map_id: 'Truhlářství 2026' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Smaž projekt Truhlářství 2026 úplně' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.popis === 'Smazat projekt „Truhlářství 2026“ se všemi kroky — nejde vrátit', `karta smazání projektu (${k && k.popis})`);
  fronta.push(text('Dobře, nechám ho.'));
  r = await potvrd(A, chat.id, k.id, false); chat = r.json.chat;
  expect(kartaPodleId(chat, k.id).stav === 'zamitnuto' && (await mapaZ(map.id)).id === map.id && toolZ(posledniVolani()).some((m) => /zamítl/.test(m.content)), 'Ne → projekt zůstal, model dostal „uživatel zamítl“');
  // ⚠️ MUTAČNÍ JÁDRO (panel 4. 10.): dvě SOUBĚŽNÁ potvrzení téže karty (druhé okno / opakování po timeoutu) — akce jen jednou,
  // druhý požadavek 404 ještě před vykonáním (pending se odebírá atomicky). Dřív obě prošla a smazání běželo dvakrát.
  fronta.push(nastroj('delete_project', { map_id: 'Truhlářství 2026' }));
  r = await chatuj(A, { chat_id: chat.id, message: 'Ne, fakt ho smaž' });
  chat = r.json.chat; k = posledniKarta(chat, 'akce');
  expect(!!k && k.stav === 'ceka', 'nová karta smazání projektu');
  fronta.push(text('x'), text('x'));
  const dvoji = await Promise.all([potvrd(A, chat.id, k.id, true), potvrd(A, chat.id, k.id, true)]);
  const stavy = dvoji.map((x) => x.status).sort();
  expect(stavy.join(',') === '200,404', `dvojí potvrzení téže karty: jedno 200, druhé 404 (${stavy.join(',')})`);
  chat = ((dvoji.find((x) => x.status === 200) || {}).json || {}).chat;
  expect(!!chat && kartaPodleId(chat, k.id).stav === 'hotovo' && (await inst.api('GET', `/api/collections/goalmaps/records/${map.id}`, { token: A })).status === 404, 'projekt smazán (jednou)');
  expect(fronta.length === 1, `model dopověděl jen jednou — druhý požadavek skončil před vykonáním (ve frontě zbylo ${fronta.length})`);
  fronta.length = 0;
  expect((await inst.api('GET', '/api/collections/api_keys/records', { token: A })).json.totalItems === 0, 'dočasné klíče po zápisech smazány');
}, { nazev: 'AI-CHAT-FUNKCE' });
