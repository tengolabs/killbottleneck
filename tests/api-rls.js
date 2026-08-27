// RLS / autorizační smoke testy — čerstvý kontejner, jen API (bez prohlížeče).
// Pokrývá negativní případy pravidel kolekcí: cizí member, guest, read vs edit share,
// multi-match regresi (2 share řádky na jedné mapě — migrace 013), role guard,
// team_access, úkoly mimo veřejné mapy (migrace 009), zamčené ai_settings.
// Referenční sada převedená na _harness.js (vlna E, 27. 8. 2026): 61 kontrol beze změny.
const H = require('./_harness');
const { expect, sleep, PW } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'rls', env: { KB_UVODNI_MAPA: 0 } });
  const { api, login } = inst;
  const reg = (email) => inst.register(email);
  console.log('== role ==');
  const rA = await reg('a@example.com');
  expect(rA.status === 200 && rA.json.role === 'admin', `první registrace = admin (${rA.json?.role})`);
  const rB = await reg('b@example.com');
  const rC = await reg('c@example.com');
  expect(rB.json?.role === 'user' && rC.json?.role === 'user', 'další registrace = user');
  const A = await login('a@example.com'), B = await login('b@example.com'), C = await login('c@example.com');

  const sp = await api('PATCH', `/api/collections/users/records/${rB.json.id}`, { token: B, body: { role: 'admin' } });
  expect(sp.status === 200 && sp.json.role === 'user', `self-promote na admina hook tiše vrátí (role zůstala ${sp.json?.role})`);

  console.log('== goalmaps: soukromí a sdílení ==');
  const m1 = (await api('POST', '/api/collections/goalmaps/records', {
    token: A, body: { title: 'Mapa A1', nodes: [
      { id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } },
      { id: 'pub1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Veřejný krok', status: 'todo' } },
    ], edges: [{ id: 'e1', source: 'root', target: 'pub1' }] },
  })).json;
  expect(!!m1.id && m1.owner === rA.json.id, 'mapa vznikla, owner z přihlášení (hook)');

  let r = await api('GET', `/api/collections/goalmaps/records/${m1.id}`, { token: B });
  expect(r.status === 404, `cizí mapa pro B neviditelná (${r.status})`);
  r = await api('GET', '/api/collections/goalmaps/records', { token: B });
  expect(r.json?.totalItems === 0, `B ve výpisu nevidí nic (${r.json?.totalItems})`);

  r = await api('POST', '/api/flowmap/share', { token: B, body: { action: 'share', mapId: m1.id, email: 'c@example.com' } });
  expect(r.status === 403, `sdílení smí jen vlastník (B → ${r.status})`);

  await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: m1.id, email: 'b@example.com', permission: 'read' } });
  r = await api('GET', `/api/collections/goalmaps/records/${m1.id}`, { token: B });
  expect(r.status === 200, `read-share: B mapu vidí (${r.status})`);
  r = await api('PATCH', `/api/collections/goalmaps/records/${m1.id}`, { token: B, body: { title: 'Hacknuto' } });
  expect(r.status === 404, `read-share: B mapu NEupraví (${r.status})`);

  await api('POST', '/api/flowmap/share', { token: A, body: { action: 'update_permission', mapId: m1.id, memberEmail: 'b@example.com', permission: 'edit' } });
  r = await api('PATCH', `/api/collections/goalmaps/records/${m1.id}`, { token: B, body: { title: 'Mapa A1 (upraveno B)' } });
  expect(r.status === 200, `edit-share: B mapu upraví (${r.status})`);

  // multi-match regrese (migrace 013): DRUHÝ share řádek nesmí rozbít přístup prvního
  await api('POST', '/api/flowmap/share', { token: A, body: { action: 'share', mapId: m1.id, email: 'c@example.com', permission: 'read' } });
  r = await api('GET', `/api/collections/goalmaps/records/${m1.id}`, { token: B });
  const r2 = await api('PATCH', `/api/collections/goalmaps/records/${m1.id}`, { token: B, body: { description: 'edit po druhém share' } });
  expect(r.status === 200 && r2.status === 200, `multi-match: 2 share řádky, B stále čte i edituje (${r.status}/${r2.status})`);
  r = await api('GET', `/api/collections/goalmaps/records/${m1.id}`, { token: C });
  const r3 = await api('PATCH', `/api/collections/goalmaps/records/${m1.id}`, { token: C, body: { title: 'C hack' } });
  expect(r.status === 200 && r3.status === 404, `multi-match: C čte (read), needituje (${r.status}/${r3.status})`);
  // cross-párování email × email_edit přes různé řádky (jádro multi-match bugu):
  // C má read řádek, B má edit řádek — C nesmí získat edit přes B-ův řádek
  r = await api('PATCH', `/api/collections/goalmaps/records/${m1.id}`, { token: C, body: { description: 'cross' } });
  expect(r.status === 404, `cross-match: C nezíská edit z cizího řádku (${r.status})`);

  r = await api('PATCH', `/api/collections/goalmaps/records/${m1.id}`, { token: B, body: { is_public: true, shared_with: ['b@example.com', 'x@x.cz'] } });
  expect(r.status === 200 && r.json.is_public === false && !r.json.shared_with.includes('x@x.cz'),
    'pole sdílení (is_public/shared_with) editor nezmění — hook je vrací');

  console.log('== guest + veřejné mapy ==');
  r = await api('GET', `/api/collections/goalmaps/records/${m1.id}`);
  expect(r.status === 404, `guest soukromou mapu nevidí (${r.status})`);
  r = await api('POST', '/api/flowmap/public-maps', { body: { mapId: m1.id } });
  expect(r.status === 403, `public-maps: neveřejná mapa → 403 (${r.status})`);
  await api('POST', '/api/flowmap/share', { token: A, body: { action: 'toggle_public', mapId: m1.id } });
  r = await api('POST', '/api/flowmap/public-maps', { body: { mapId: m1.id } });
  expect(r.status === 200 && Array.isArray(r.json.map?.nodes), `public-maps: veřejná mapa vydá obsah (${r.status})`);
  // Výpis veřejných map je od 6. 8. 2026 jen pro přihlášené: veřejná mapa má
  // být dostupná ODKAZEM (mapId výš), ne k nalezení. Anonym by si jinak vypsal
  // názvy všech veřejných map instance a s vráceným id stáhl jejich obsah.
  r = await api('POST', '/api/flowmap/public-maps', { body: {} });
  expect(r.status === 400, `public-maps: guest výpis NEDOSTANE (${r.status})`);
  r = await api('POST', '/api/flowmap/public-maps', { token: A, body: {} });
  expect(r.status === 200 && r.json.maps?.length === 1 && r.json.maps[0].nodes === undefined,
    'public-maps: přihlášenému výpis jen metadata (bez nodes)');

  console.log('== team_access (organizace) ==');
  const m2 = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Mapa org', nodes: [], edges: [] } })).json;
  r = await api('GET', `/api/collections/goalmaps/records/${m2.id}`, { token: B });
  expect(r.status === 404, `bez team_access B nevidí (${r.status})`);
  await api('POST', '/api/flowmap/share', { token: A, body: { action: 'set_team_access', mapId: m2.id, access: 'read' } });
  r = await api('GET', `/api/collections/goalmaps/records/${m2.id}`, { token: B });
  const rg = await api('GET', `/api/collections/goalmaps/records/${m2.id}`);
  expect(r.status === 200 && rg.status === 404, `team_access=read: člen vidí, guest ne (${r.status}/${rg.status})`);
  r = await api('PATCH', `/api/collections/goalmaps/records/${m2.id}`, { token: B, body: { description: 'x' } });
  expect(r.status === 404, `team_access=read: člen needituje (${r.status})`);
  await api('POST', '/api/flowmap/share', { token: A, body: { action: 'set_team_access', mapId: m2.id, access: 'edit' } });
  r = await api('PATCH', `/api/collections/goalmaps/records/${m2.id}`, { token: B, body: { description: 'org edit' } });
  expect(r.status === 200, `team_access=edit: člen edituje (${r.status})`);
  await api('POST', '/api/flowmap/share', { token: A, body: { action: 'set_team_access', mapId: m2.id, access: '' } });

  console.log('== tasks (položky zanikly — zákaz create + RLS nad zbytky) ==');
  // SLOVNÍK 17. 8. 2026: úkol = uzel s řešitelem nebo termínem; položky-úkoly
  // nejde založit ŽÁDNOU uživatelskou cestou (create hook 403). Kolekce žije
  // jen jako detektor zbytků — RLS čtení/úprav/mazání nad nimi musí dál držet.
  const m3 = (await api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Soukromá s úkoly',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Soukromá s úkoly', title: 'Soukromá s úkoly', status: 'todo' } },
      { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo' } },
      { id: 'n2', type: 'goalNode', position: { x: 300, y: 300 }, data: { title: 'Krok 2', status: 'todo' } },
      { id: 'pozn1', type: 'note', position: { x: 600, y: 300 }, data: { title: 'Lísteček' } },
    ],
    edges: [{ id: 'e1', source: 'apex', target: 'n1' }, { id: 'e2', source: 'apex', target: 'n2' }] } })).json;
  // create je zakázaný VŽDY — i s platným uzlem, i vlastníkovi mapy
  r = await api('POST', '/api/collections/tasks/records', { token: A, body: { title: 'Úkol na kroku', status: 'todo', map: m3.id, node_id: 'n1' } });
  // createRule=null → 400 z datové vrstvy; hook by dal 403 — obě vrstvy znamenají NE
  expect(r.status === 400 || r.status === 403, `create položky jako uživatel neprojde i s platným uzlem (${r.status})`);
  r = await api('POST', '/api/collections/tasks/records', { token: B, body: { title: 'B na cizí mapě', status: 'todo', map: m3.id, node_id: 'n1' } });
  // na cizí mapě padne dřív createRule kolekce (400) — hook 403 je pro povolené;
  // podstatné je, že create neprojde NIKDY a nic neprozradí
  expect(r.status === 400 || r.status === 403, `create položky na cizí mapě neprojde (${r.status})`);

  // zbytková data zakládá superuser (jediná povolená cesta — fixtury/admin)
  const ST = await inst.superuser(); // su@e2e.local / supersu12345 (výchozí v harnessu)
  const uid = async (email) => ((await api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email='${email}'`)}`, { token: ST })).json.items || [])[0].id;
  const uidA = await uid('a@example.com');
  const suTask = async (body) => (await api('POST', '/api/collections/tasks/records', { token: ST, body })).json;
  const t1 = await suTask({ title: 'Úkol na kroku', status: 'todo', map: m3.id, node_id: 'n1', owner: uidA, owner_email: 'a@example.com' });
  expect(!!t1.id && t1.node_id === 'n1', `zbytková položka založena superuserem (${t1.id})`);
  // úprava zbytku nesmí model rozbít: odpojení, vrchol ani vymyšlený uzel neprojdou
  r = await api('PATCH', `/api/collections/tasks/records/${t1.id}`, { token: A, body: { node_id: '' } });
  expect(r.status === 400, `odpojení položky od uzlu server odmítne (${r.status})`);
  r = await api('PATCH', `/api/collections/tasks/records/${t1.id}`, { token: A, body: { node_id: 'apex' } });
  expect(r.status === 400, `přesun položky na vrchol server odmítne (${r.status})`);
  r = await api('PATCH', `/api/collections/tasks/records/${t1.id}`, { token: A, body: { node_id: 'neexistuje-123' } });
  expect(r.status === 400, `přesun na vymyšlený uzel server odmítne (${r.status})`);
  // OSIŘELÝ zbytek: po smazání uzlu jde dál odbavit (ponechání původního node_id)
  const tOs = await suTask({ title: 'Osiřelý', status: 'todo', map: m3.id, node_id: 'n2', owner: uidA, owner_email: 'a@example.com' });
  const m3stav = (await api('GET', `/api/collections/goalmaps/records/${m3.id}`, { token: A })).json;
  r = await api('PATCH', `/api/collections/goalmaps/records/${m3.id}`, { token: A, body: {
    nodes: m3stav.nodes.filter((n) => n.id !== 'n2'),
    edges: m3stav.edges.filter((ed) => ed.target !== 'n2'),
    base_updated: m3stav.updated } });
  expect(r.status === 200, `uzel n2 smazán z mapy (${r.status})`);
  r = await api('PATCH', `/api/collections/tasks/records/${tOs.id}`, { token: A, body: { status: 'done' } });
  expect(r.status === 200, `osiřelá položka jde dál odbavit (${r.status})`);
  r = await api('GET', `/api/collections/tasks/records/${t1.id}`, { token: B });
  expect(r.status === 404, `položku na cizí soukromé mapě B nevidí (${r.status})`);
  const t2 = await suTask({ title: 'Pro B', status: 'todo', map: m3.id, node_id: 'n1', assignee_email: 'b@example.com', owner: uidA, owner_email: 'a@example.com' });
  r = await api('GET', `/api/collections/tasks/records/${t2.id}`, { token: B });
  const ru = await api('PATCH', `/api/collections/tasks/records/${t2.id}`, { token: B, body: { status: 'done' } });
  expect(r.status === 200 && ru.status === 200, `assignee položku vidí a mění stav (${r.status}/${ru.status})`);
  r = await api('DELETE', `/api/collections/tasks/records/${t2.id}`, { token: B });
  expect(r.status === 404, `assignee položku NEsmaže (${r.status})`);
  r = await api('DELETE', `/api/collections/tasks/records/${t1.id}`, { token: A });
  expect(r.status === 204, `zadavatel zbytek smaže — jediná cesta k úklidu (${r.status})`);

  // is_public mapa ≠ veřejné úkoly (migrace 009)
  const tp = await suTask({ title: 'Na veřejné mapě', status: 'todo', map: m1.id, node_id: 'pub1', owner: uidA, owner_email: 'a@example.com' });
  r = await api('GET', `/api/collections/tasks/records/${tp.id}`);
  expect(r.status === 404, `guest položku veřejné mapy nevidí (${r.status})`);

  console.log('== role manažer (vedení vidí SPOLEČNOU práci, ne cizí soukromou) ==');
  const inv = await api('POST', '/api/flowmap/invite', { token: A, body: { email: 'd@example.com', role: 'manager' } });
  expect(inv.status === 200 && !!inv.json.temp_password, 'admin pozve manažera (temp heslo bez SMTP)');
  const D = await login('d@example.com', inv.json.temp_password);
  r = await api('GET', `/api/collections/tasks/records/${tOs.id}`, { token: D });
  // ⚠️ ZMĚNA 6. 8. 2026 (Richard): „privátní je privátní a to je extrémně
  // důležité, ty nikdy nesmí být vidět. Týmové ano." Do té doby tu stálo
  // opačné tvrzení — vedení vidělo úkoly i na cizích SOUKROMÝCH mapách,
  // přestože samotnou mapu nevidělo. Podrobně: product/tests/ukoly-soukromi.js
  expect(r.status === 404, `manažer cizí SOUKROMÝ úkol nevidí (${r.status})`);
  // volné úkoly zrušeny (úkol vždy v projektu) → úkol na B-ho SOUKROMÉ mapě
  const mB = (await api('POST', '/api/collections/goalmaps/records', { token: B, body: { title: 'Soukromá B', nodes: [
    { id: 'bx', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Soukromá B', title: 'Soukromá B', status: 'todo' } },
    { id: 'b1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok B', status: 'todo' } },
  ], edges: [{ id: 'eb1', source: 'bx', target: 'b1' }] } })).json;
  const st = await suTask({ title: 'Samostatný B', status: 'todo', map: mB.id, node_id: 'b1', owner: await uid('b@example.com'), owner_email: 'b@example.com' });
  r = await api('GET', `/api/collections/tasks/records/${st.id}`, { token: D });
  const rc2 = await api('GET', `/api/collections/tasks/records/${st.id}`, { token: C });
  expect(r.status === 404 && rc2.status === 404,
    `úkol na cizí soukromé mapě nevidí ani manažer, ani kolega (${r.status}/${rc2.status})`);
  r = await api('POST', '/api/flowmap/invite', { token: D, body: { email: 'e@example.com', role: 'admin' } });
  expect(r.status === 200 && r.json.role === 'user', `manažer zve jen členy — role admin degradována na user (${r.json?.role})`);
  r = await api('POST', '/api/flowmap/invite', { token: B, body: { email: 'f@example.com' } });
  expect(r.status === 403, `řadový člen zvát nesmí (${r.status})`);

  console.log('== komentáře ==');
  const cm = (await api('POST', '/api/collections/comments/records', { token: C, body: { goalmap: m1.id, node_id: 'root', text: 'komentář C' } })).json;
  expect(!!cm.id && cm.author_email === 'c@example.com', 'read-share smí komentovat, autor z přihlášení');
  r = await api('PATCH', `/api/collections/comments/records/${cm.id}`, { token: B, body: { text: 'přepsáno' } });
  expect(r.status === 404, `cizí komentář nejde editovat (${r.status})`);
  const tc = (await api('POST', '/api/collections/task_comments/records', { token: B, body: { task: t2.id, text: 'jdu na to' } })).json;
  expect(!!tc.id, 'assignee komentuje svůj úkol');
  r = await api('GET', `/api/collections/task_comments/records/${tc.id}`, { token: C });
  expect(r.status === 404, `komentář úkolu nevidí nezúčastněný (${r.status})`);

  console.log('== zásobník (buffer_nodes) ==');
  await api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Nápad A', owner: rA.json.id } });
  r = await api('GET', '/api/collections/buffer_nodes/records', { token: B });
  expect(r.json?.totalItems === 0, `zásobník je per-user (B vidí ${r.json?.totalItems})`);
  r = await api('POST', '/api/collections/buffer_nodes/records', { token: B, body: { title: 'Podvrh', owner: rA.json.id } });
  expect(r.status === 400, `nápad s cizím ownerem nejde založit (${r.status})`);

  console.log('== notifikace ==');
  r = await api('POST', '/api/collections/notifications/records', { token: B, body: { user: rB.json.id, type: 'task_assigned', text: 'podvrh' } });
  expect(r.status === 403, `notifikace klient nezaloží — jen server (${r.status})`);
  r = await api('GET', '/api/collections/notifications/records', { token: B });
  const mine = (r.json?.items || []);
  expect(mine.length >= 1 && mine.every((n) => n.user === rB.json.id), `B má notifikaci z přiřazení a vidí jen své (${mine.length})`);
  r = await api('GET', '/api/collections/notifications/records', { token: C });
  expect((r.json?.items || []).every((n) => n.user === rC.json.id), 'C nevidí cizí notifikace');

  console.log('== šablony ==');
  const tplP = (await api('POST', '/api/collections/templates/records', { token: B, body: { title: 'Osobní šablona B', nodes: [], edges: [], visibility: 'personal' } })).json;
  const tplO = (await api('POST', '/api/collections/templates/records', { token: B, body: { title: 'Org šablona B', nodes: [], edges: [] } })).json;
  expect(tplO.visibility === 'org', `bez visibility → default org (${tplO.visibility})`);
  r = await api('GET', '/api/collections/templates/records?perPage=200', { token: C });
  const titles = (r.json?.items || []).map((t) => t.title);
  expect(!titles.includes('Osobní šablona B') && titles.includes('Org šablona B'), 'C vidí org šablonu, osobní ne');
  r = await api('GET', '/api/collections/templates/records?perPage=200');
  expect((r.json?.items || []).every((t) => t.owner === ''), 'guest vidí jen systémové šablony (demo galerie)');
  r = await api('DELETE', `/api/collections/templates/records/${tplP.id}`, { token: C });
  expect(r.status === 404, `cizí člen šablonu nesmaže (${r.status})`);
  r = await api('DELETE', `/api/collections/templates/records/${tplP.id}`, { token: A });
  expect(r.status === 204, `admin šablonu člena smaže (${r.status})`);

  console.log('== ai_settings + config ==');
  r = await api('GET', '/api/flowmap/ai-settings', { token: B });
  expect(r.status === 403, `ai-settings jen pro admina (${r.status})`);
  r = await api('GET', '/api/flowmap/ai-settings', { token: A });
  expect(r.status === 200 && r.json.source === 'env', `admin čte AI config (source=${r.json?.source})`);
  r = await api('GET', '/api/collections/ai_settings/records', { token: A });
  expect(r.status !== 200, `zamčená kolekce ai_settings ani pro admina přes API (${r.status})`);
  r = await api('GET', '/api/flowmap/config');
  expect(r.status === 200 && r.json.ai_enabled === false && r.json.claimed === true,
    `config: bez provideru AI vypnuté, instance zabraná (${r.json?.ai_provider})`);

  console.log('== members ==');
  r = await api('GET', '/api/flowmap/members');
  expect(r.status === 401, `adresář členů chce přihlášení (${r.status})`);
  r = await api('GET', '/api/flowmap/members', { token: C });
  expect(r.status === 200 && (r.json.members || []).length >= 4, `člen vidí adresář týmu (${(r.json?.members || []).length})`);
}, { nazev: 'API-RLS' });
