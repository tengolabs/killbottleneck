// Code analysis 4, wave 7 (missing tests) — a recurring project template (cron auto_templates →
// helpers.instantiateTemplate) whose assignees do not exist on the instance. Nobody is there to
// ask when the cron runs, so:
//   • the project is created with ALL its steps, the run does not fail;
//   • an assignee who has an account gets the project shared (work) and a notification;
//   • an address WITHOUT an account gets no authorization row and does not stay in the share
//     mirror of the project (syncShares, S4-02);
//   • a malformed assignee (no @) is skipped by the share sync, the project still exists;
//   • the rules the template carries: an unknown assignee of a "create sub-steps" item is emptied,
//     the rule is created and works (S2-03, commit 208d0267) — RED before that commit.
// No LLM, no e-mail.
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-sablona-resitel.js
const { execSync } = require('child_process');
const H = require('./_harness');
const { expect, sleep } = H;

const DUCH = 'duch@nikde.example';
const DUCH_PRAVIDLA = 'duch-pravidla@nikde.example';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'chyby4-sablona-resitel', env: { KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0 } });
  const { api } = inst;
  const ids = {}; const T = {};
  for (const j of ['admin', 'eva', 'cyril']) ids[j] = (await inst.register(`${j}@t.cz`)).json.id; // admin first
  for (const j of Object.keys(ids)) T[j] = await inst.login(`${j}@t.cz`);
  const ST = await inst.superuser();
  const q = (f) => encodeURIComponent(f);
  const notif = async (token) => (await api('GET', '/api/collections/notifications/records?perPage=200&sort=-created', { token })).json.items || [];
  const sekce = async (fn) => { try { await fn(); } catch (err) { expect(false, `výjimka v sekci: ${err && err.stack ? err.stack.split('\n').slice(0, 2).join(' ') : err}`); } };
  // the weekday of the CONTAINER (UTC), not of the host — they differ around midnight
  const dow = Number(execSync(`docker exec ${inst.name} date +%u`).toString().trim());
  const evinyMapy = async () => (await api('GET', `/api/collections/goalmaps/records?perPage=50&filter=${q(`owner="${ids.eva}"`)}`, { token: ST })).json.items || [];
  const sdileni = async (mapId) => ((await api('GET', `/api/collections/map_shares/records?perPage=50&filter=${q(`map="${mapId}"`)}`, { token: ST })).json.items || []).map((x) => `${x.email}:${x.permission}`).sort();
  const krok = (m, title) => (m.nodes || []).find((n) => (n.data || {}).title === title);

  console.log('== šablona s řešiteli, kteří na instanci nejsou: uzly ==');
  let M = null;
  await sekce(async () => {
    let r = await api('POST', '/api/collections/templates/records', { token: T.eva, body: {
      title: 'Týdenní úklid', node_type: 'mise', goal: 'Týdenní úklid',
      ai_nodes: [{ id: 'k', title: 'Týdenní úklid', parentId: null },
        { id: 'a', title: 'Krok pro Cyrila', parentId: 'k', owner: 'cyril@t.cz', deadline_offset_days: 2 },
        { id: 'b', title: 'Krok pro ducha', parentId: 'k', owner: DUCH },
        { id: 'c', title: 'Krok pro překlep', parentId: 'k', owner: 'franta-bez-zavinace' },
        { id: 'd', title: 'Krok bez řešitele', parentId: 'k' },
        { id: 'e', title: 'Krok pro Cyrila velkými', parentId: 'k', owner: 'Cyril@T.cz' }],
      auto_create: 'weekly', auto_day: dow, auto_last: '' } });
    expect(r.status === 200 && !!r.json.id, `Eva uložila opakovanou šablonu s neexistujícími řešiteli (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
    r = await api('POST', '/api/kb/run-auto-templates', { token: ST });
    expect(r.status === 200 && r.json.created === 1, `průchod opakovaných šablon nespadl a založil 1 projekt (${r.status} ${JSON.stringify(r.json)})`);
    M = (await evinyMapy()).find((x) => String(x.title || '').startsWith('Týdenní úklid'));
    expect(!!M, 'projekt ze šablony existuje');
    if (!M) return;
    const tituly = (M.nodes || []).map((n) => n.data.title);
    expect(M.nodes.length === 6 && ['Krok pro Cyrila', 'Krok pro Cyrila velkými', 'Krok pro ducha', 'Krok pro překlep', 'Krok bez řešitele'].every((t) => tituly.includes(t)) && (M.edges || []).length === 5,
      `vznikly VŠECHNY kroky šablony včetně těch s neznámým řešitelem (${M.nodes.length} uzlů, ${(M.edges || []).length} hran)`);
    expect((krok(M, 'Krok pro Cyrila') || { data: {} }).data.owner === 'cyril@t.cz' && !!(krok(M, 'Krok pro Cyrila') || { data: {} }).data.deadline, 'krok skutečného člena má řešitele i dopočítaný termín');
    // an address written with other capitals than the account still reaches the person, in the canonical form
    expect((krok(M, 'Krok pro Cyrila velkými') || { data: {} }).data.owner === 'cyril@t.cz', `řešitel zapsaný velkými písmeny se zapsal kanonicky (${JSON.stringify((krok(M, 'Krok pro Cyrila velkými') || { data: {} }).data.owner)})`);
    const sd = await sdileni(M.id);
    expect(sd.join() === 'cyril@t.cz:work', `oprávnění k projektu dostal jen skutečný člen, adresa bez účtu ani překlep ne (${sd.join(', ') || 'nic'})`);
    expect(!(M.shared_with || []).includes(DUCH) && !(M.shared_with_work || []).includes(DUCH) && !(M.shared_with_edit || []).includes(DUCH),
      `adresa bez účtu není v seznamu sdílení na záznamu projektu (${JSON.stringify(M.shared_with)})`);
    expect((await api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: T.cyril })).status === 200, 'Cyril projekt otevře');
    expect((await notif(T.cyril)).some((n) => n.type === 'node_assigned' && n.map === M.id), 'Cyril dostal oznámení o přiřazení');
    expect((await notif(T.eva)).some((n) => n.type === 'map_created' && n.map === M.id), 'Eva (vlastnice šablony) dostala oznámení o založeném projektu');
    // an assignee the instance does not know is emptied on the STEP too, as in rule items and in
    // import (Richard 13 Nov 2026): the step does not hang on nobody and no pending share is made
    const naDuchovi = (krok(M, 'Krok pro ducha') || { data: {} }).data.owner;
    const naPreklepu = (krok(M, 'Krok pro překlep') || { data: {} }).data.owner;
    expect(!naDuchovi && !naPreklepu, `krok s adresou bez účtu i krok s překlepem vznikly BEZ řešitele (${JSON.stringify(naDuchovi)}, ${JSON.stringify(naPreklepu)})`);
    expect((M.shared_with || []).join() === 'cyril@t.cz', `v seznamu sdílení projektu je jen skutečný člen (${JSON.stringify(M.shared_with)})`);
    const cek = (await api('GET', `/api/collections/share_invites/records?perPage=50&filter=${q(`map="${M.id}"`)}`, { token: ST }));
    const cekajici = ((cek.json || {}).items || []).map((x) => `${x.email}:${x.permission}`);
    expect(cek.status === 200 && cekajici.length === 0, `pro adresu bez účtu nevzniklo čekající sdílení projektu (${cek.status} ${JSON.stringify(cekajici)})`);
    // the owner can keep working with the project: an ordinary save goes through
    const f = (await api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: T.eva })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${M.id}`, { token: T.eva, body: { base_updated: f.updated, edges: f.edges,
      nodes: f.nodes.map((n) => (n.data.title === 'Krok bez řešitele' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)) } });
    expect(r.status === 200, `vlastnice projekt s neznámými řešiteli dál normálně uloží (${r.status} ${String(r.json && (r.json.error || r.json.message) || '').slice(0, 140)})`);
    r = await api('POST', '/api/kb/run-auto-templates', { token: ST });
    expect(r.status === 200 && r.json.created === 0, `kontrola: druhý průchod téhož dne nic nezaloží (${JSON.stringify(r.json)})`);
  });

  console.log('== šablona s pravidlem „založ podkroky“ pro neznámého řešitele (S2-03) ==');
  await sekce(async () => {
    let r = await api('POST', '/api/collections/templates/records', { token: T.eva, body: {
      title: 'Reklamace s pravidlem', node_type: 'mise', goal: 'Reklamace s pravidlem',
      ai_nodes: [{ id: 'k', title: 'Reklamace s pravidlem', parentId: null }, { id: 'p', title: 'Přijato', parentId: 'k' }],
      rules: [{ name: 'Po přijetí založ kroky', node_id: 'p', trigger: { type: 'node_status_changed', status: 'done' },
        actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [
          { title: 'Pro ducha z pravidla', owner: DUCH_PRAVIDLA, children: [{ title: 'Vnořený pro ducha', owner: DUCH_PRAVIDLA }] },
          { title: 'Pro Cyrila z pravidla', owner: 'cyril@t.cz' }] }] }],
      auto_create: 'weekly', auto_day: dow, auto_last: '' } });
    expect(r.status === 200, `Eva uložila šablonu s pravidlem (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
    r = await api('POST', '/api/kb/run-auto-templates', { token: ST });
    expect(r.status === 200 && r.json.created === 1, `průchod založil projekt i z této šablony (${JSON.stringify(r.json)})`);
    const P = (await evinyMapy()).find((x) => String(x.title || '').startsWith('Reklamace s pravidlem'));
    expect(!!P, 'projekt z šablony s pravidlem existuje');
    if (!P) return;
    const pravidla = (await api('GET', `/api/collections/automation_rules/records?perPage=50&filter=${q(`map="${P.id}"`)}`, { token: ST })).json.items || [];
    const items = (((pravidla[0] || {}).actions || [])[0] || {}).items || [];
    expect(pravidla.length === 1 && pravidla[0].enabled === true && pravidla[0].created_by === 'eva@t.cz', `pravidlo šablony vzniklo, zapnuté, autor = vlastnice šablony (${pravidla.length})`);
    expect(items.length === 2 && items[0].owner === '' && ((items[0].children || [])[0] || {}).owner === '',
      `neznámý řešitel podkroku (i vnořeného) je v uloženém pravidle vyprázdněný (${JSON.stringify(items).slice(0, 200)})`);
    expect((items[1] || {}).owner === 'cyril@t.cz', 'skutečný řešitel v pravidle zůstal');
    expect(!JSON.stringify(pravidla).includes(DUCH_PRAVIDLA), 'neexistující adresa v pravidle není nikde');
    // the rule works: tick the trigger step → sub-steps exist, the ghost one without an assignee
    const f = (await api('GET', `/api/collections/goalmaps/records/${P.id}`, { token: T.eva })).json;
    r = await api('PATCH', `/api/collections/goalmaps/records/${P.id}`, { token: T.eva, body: { base_updated: f.updated, edges: f.edges,
      nodes: f.nodes.map((n) => (n.data.title === 'Přijato' ? Object.assign({}, n, { data: Object.assign({}, n.data, { status: 'done' }) }) : n)) } });
    await sleep(800);
    const po = (await api('GET', `/api/collections/goalmaps/records/${P.id}`, { token: T.eva })).json;
    const duch = krok(po, 'Pro ducha z pravidla'); const vnoreny = krok(po, 'Vnořený pro ducha');
    expect(r.status === 200 && !!duch && !duch.data.owner && !!vnoreny && !vnoreny.data.owner && !JSON.stringify(po.nodes).includes(DUCH_PRAVIDLA),
      `běh pravidla: podkroky pro ducha vznikly BEZ řešitele (${duch ? JSON.stringify(duch.data.owner) : 'podkrok nevznikl'})`);
    expect((krok(po, 'Pro Cyrila z pravidla') || { data: {} }).data.owner === 'cyril@t.cz', 'podkrok pro Cyrila vznikl i s řešitelem');
    const sd = await sdileni(P.id);
    expect(sd.join() === 'cyril@t.cz:work', `projekt je po běhu sdílen jen Cyrilovi (${sd.join(', ') || 'nic'})`);
    const behy = (await api('GET', `/api/collections/rule_runs/records?perPage=50&filter=${q(`rule="${(pravidla[0] || {}).id}"`)}`, { token: ST })).json.items || [];
    expect(behy.length === 1 && behy[0].status === 'ok', `běh pravidla skončil v pořádku (${behy.map((b) => b.status + ': ' + String(b.detail || '').slice(0, 100)).join(' | ') || 'žádný běh'})`);
  });

  console.log('== log instance ==');
  await sekce(async () => {
    await sleep(4500); // PocketBase writes its log in batches
    const logy = JSON.stringify((await api('GET', '/api/logs?perPage=300&sort=-created', { token: ST })).json || {}) + inst.logs(400);
    expect(!/auto_templates: instantiace selhala|auto_templates: běh selhal/.test(logy), 'v logu není selhání instantiace šablony');
    expect(/unknown assignees of sub-steps were emptied/.test(logy) && logy.includes(DUCH_PRAVIDLA), 'vyprázdnění neznámého řešitele pravidla je v logu i s adresou');
    expect(!/panic|GoError|TypeError|ReferenceError/.test(inst.logs(400)), 've výstupu kontejneru není pád ani chyba skriptu');
  });
}, { nazev: 'CHYBY4 SABLONA RESITEL' });
