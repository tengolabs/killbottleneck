// GET /api/kb/export — „Stáhnout všechna moje data" (P2-03, rozhodnutí 25. 8. 2026).
// Hlídá: kdo co dostane (jen mapy, které vidím — cizí soukromá ne), tvar
// killbottleneck.export/1 s mapami ve tvaru killbottleneck.map/1 (jde importovat
// zpět přes /map-import), komentáře, přílohy seznamem, zásobník, měření času,
// kontakty, notifikace, sdílení, změny; funguje i PO VYPRŠENÍ ZKUŠEBKY (GET),
// zatímco zápis je 402; rate-limit; nepřihlášený 401; Content-Disposition.
const { execSync } = require('child_process');
const BASE = 'http://127.0.0.1:20567';
const NAME = 'flowmap-e2e-export';
const VOLUME = 'flowmap-e2e-export-data'; // data přežijí restart s vypršenou zkušebkou
const PW = 'testheslo123';
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = (offset) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };
const api = async (path, { token, bearer, body, method } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(BASE + path, { method: method || (body ? 'POST' : 'GET'), headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  let json = null; try { json = await res.json(); } catch { /* SPA HTML na starém buildu */ }
  return { status: res.status, json: json || {}, headers: res.headers };
};
const register = async (email) => {
  const rec = (await api('/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } })).json;
  const r = await api('/api/collections/users/auth-with-password', { body: { identity: email, password: PW } });
  const klic = (await api('/api/kb/api-keys', { token: r.json.token, body: { label: 'seed', scope: 'read_write' } })).json.token;
  return { token: r.json.token, id: rec.id, email, klic };
};
const start = (env) => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} -v ${VOLUME}:/app/pb_data -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 ${env || ''} -p 20567:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
};
const waitUp = async () => { for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* startuje */ } await sleep(1000); } };
const titles = (maps) => (maps || []).map((m) => m.map.title);

(async () => {
  try {
    execSync(`docker rm -f ${NAME} 2>/dev/null; docker volume rm -f ${VOLUME} 2>/dev/null; true`);
    start('');
    await waitUp();
    const admin = await register('admin@e2e.cz');
    const clen = await register('clen@e2e.cz');
    const mapa = async (u, title, tree) => (await api('/api/kb/v1/maps', { bearer: u.klic, body: { title, tree } })).json;
    const share = (u, mapId, body) => api('/api/kb/share', { token: u.token, body: { mapId, ...body } });

    const tymova = await mapa(admin, 'TYMOVA', [{ title: 'T-UZEL', owner: clen.email, deadline: day(3) }, { title: 'T-HOTOVO', status: 'done' }]);
    await share(admin, tymova.id, { action: 'set_team_access', access: 'read' });
    const sdilena = await mapa(admin, 'SDILENA', [{ title: 'S-UZEL', owner: clen.email }]);
    await share(admin, sdilena.id, { action: 'share', email: clen.email, permission: 'work' });
    const soukroma = await mapa(admin, 'SOUKROMA-ADMINA', [{ title: 'P-UZEL', owner: admin.email }]);
    const clenova = await mapa(clen, 'CLENOVA-SOUKROMA', [{ title: 'C-UZEL', owner: clen.email }]);
    // veřejná cizí mapa (vývěska) do exportu NEPATŘÍ; archivovaná vlastní ANO
    const verejna = await mapa(clen, 'CLENOVA-VEREJNA', [{ title: 'V-UZEL' }]);
    await share(clen, verejna.id, { action: 'toggle_public' });
    const archiv = await mapa(admin, 'ADMINOVA-ARCHIV', [{ title: 'A-UZEL' }]);
    await api(`/api/collections/goalmaps/records/${archiv.id}`, { token: admin.token, method: 'PATCH', body: { archived: true } });
    // org mapa (kind=org) — do exportu ano (týmová), do importu ne
    await api('/api/kb/org-map', { token: admin.token, body: {} });
    // 45 map najednou — dřív se seznamy dotazovaly po dávkách 40 map, hranice musí držet
    // (přímo do kolekce — v1 API má vlastní limit 30 zápisů/min, který by seed zastavil)
    for (let i = 1; i <= 45; i++) {
      await api('/api/collections/goalmaps/records', { token: admin.token, body: { title: `HROMADA-${String(i).padStart(2, '0')}`, nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: `HROMADA-${i}`, title: `HROMADA-${i}`, status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: `H-UZEL-${i}`, status: 'todo', owner: admin.email, deadline: day(i) } },
      ], edges: [{ id: 'e1', source: 'apex', target: 'n1' }] } });
    }
    // superuser: úkol, komentář, kontakt, zásobník, měření času, příloha-odkaz
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert su@e2e.local supersu12345`, { stdio: 'ignore' });
    const ST = (await api('/api/collections/_superusers/auth-with-password', { body: { identity: 'su@e2e.local', password: 'supersu12345' } })).json.token;
    const gm = (await api(`/api/collections/goalmaps/records/${tymova.id}`, { token: admin.token })).json;
    const nodeId = (gm.nodes.find((n) => n.data?.title === 'T-UZEL') || {}).id;
    await api('/api/collections/tasks/records', { token: ST, body: { map: tymova.id, node_id: nodeId, owner: admin.id, owner_email: admin.email, title: 'UKOL-V-TYMOVE', status: 'todo', assignee_email: clen.email, deadline: day(2) } });
    // komentář a příloha-odkaz jako přihlášený člověk (hooky plní autora z přihlášení)
    let rk = await api('/api/collections/comments/records', { token: clen.token, body: { goalmap: tymova.id, node_id: nodeId, text: 'KOMENTAR-1' } });
    if (rk.status >= 300) console.log('  (komentář nezaložen:', rk.status, JSON.stringify(rk.json).slice(0, 120), ')');
    rk = await api('/api/collections/node_files/records', { token: admin.token, body: { map: tymova.id, node_id: nodeId, name: 'ODKAZ-PRILOHA', url: 'https://example.com/doc' } });
    if (rk.status >= 300) console.log('  (příloha nezaložena:', rk.status, JSON.stringify(rk.json).slice(0, 120), ')');
    await api('/api/collections/buffer_nodes/records', { token: admin.token, body: { title: 'NAPAD-ADMINA', owner: admin.id } });
    await api('/api/collections/buffer_nodes/records', { token: clen.token, body: { title: 'NAPAD-CLENA', owner: clen.id } });
    await api('/api/collections/external_contacts/records', { token: admin.token, body: { name: 'KONTAKT-VEREJNY', email: 'verejny@partner.cz', note: 'POZNAMKA-V', owner: admin.id, owner_email: admin.email, private: false } });
    await api('/api/collections/external_contacts/records', { token: admin.token, body: { name: 'KONTAKT-TAJNY', email: 'tajny@partner.cz', note: 'POZNAMKA-T', owner: admin.id, owner_email: admin.email, private: true } });
    rk = await api('/api/collections/time_entries/records', { token: admin.token, body: { map: tymova.id, node_id: nodeId, label: 'CAS-ADMINA', started: '2026-08-20 08:00:00.000Z', ended: '2026-08-20 09:00:00.000Z' } });
    if (rk.status >= 300) console.log('  (čas nezaložen:', rk.status, JSON.stringify(rk.json).slice(0, 120), ')');

    console.log('== kdo dostane co ==');
    let r = await api('/api/kb/export');
    expect(r.status === 401, `nepřihlášený → 401 (${r.status})`);
    r = await api('/api/kb/export', { token: admin.token });
    expect(r.status === 200, `admin → 200 (${r.status})`);
    const A = r.json;
    expect(A.format === 'killbottleneck.export/1' && A.exported_by === admin.email, `formát killbottleneck.export/1, exported_by (${A.format})`);
    expect(/attachment; filename="killbottleneck-export-\d{4}-\d{2}-\d{2}\.json"/.test(r.headers.get('content-disposition') || ''), `Content-Disposition se jménem souboru (${r.headers.get('content-disposition')})`);
    const ta = titles(A.maps);
    expect(ta.includes('TYMOVA') && ta.includes('SDILENA') && ta.includes('SOUKROMA-ADMINA'), `admin: své mapy vč. soukromé (${ta})`);
    expect(!ta.includes('CLENOVA-SOUKROMA'), 'admin: soukromá mapa člena NENÍ v exportu (admin není vševidoucí)');
    expect(!ta.includes('CLENOVA-VEREJNA'), 'admin: veřejná cizí mapa (vývěska) NENÍ v exportu');
    const arch = A.maps.find((m) => m.map.title === 'ADMINOVA-ARCHIV');
    expect(!!arch && arch.map.archived === true, 'archivovaná vlastní mapa je v exportu s archived=true');
    const hromada = A.maps.filter((m) => /^HROMADA-/.test(m.map.title));
    expect(hromada.length === 45 && hromada.every((m) => m.map.nodes.some((n) => /^H-UZEL-/.test(n.data?.title || ''))), `45 map, každá se svými uzly (${hromada.length})`);
    r = await api('/api/kb/export', { token: clen.token });
    const C = r.json;
    const tc = titles(C.maps);
    expect(tc.includes('TYMOVA') && tc.includes('SDILENA') && tc.includes('CLENOVA-SOUKROMA'), `člen: týmová, sdílená mu a vlastní (${tc})`);
    expect(!tc.includes('SOUKROMA-ADMINA'), 'člen: adminova soukromá mapa NENÍ v exportu');
    expect(A.maps.some((m) => m.map.kind === 'org'), 'org mapa (organizační struktura) je v exportu — je týmová');
    expect(A.counts.maps === 50 && C.counts.maps === 5, `counts.maps 50/5 vč. org mapy (${A.counts.maps}/${C.counts.maps})`);
    expect(A.errors === null, `žádný dotaz neselhal (errors=${JSON.stringify(A.errors)})`);

    console.log('== obsah mapy = tvar killbottleneck.map/1 + navíc ==');
    const T = A.maps.find((m) => m.map.title === 'TYMOVA');
    expect(T.format === 'killbottleneck.map/1' && Array.isArray(T.map.nodes) && Array.isArray(T.map.edges), 'mapa nese format map/1, nodes, edges');
    expect(T.map.nodes.some((n) => n.data?.title === 'T-UZEL') && T.map.nodes.some((n) => n.data?.status === 'done'), 'uzly včetně stavů');
    expect(T.tasks.some((t) => t.title === 'UKOL-V-TYMOVE' && t.assignee_email === clen.email && t.node_id === nodeId), 'úkoly mapy s řešitelem a uzlem');
    expect(T.comments.some((c) => c.text === 'KOMENTAR-1' && c.author_email === clen.email && c.node_id === nodeId), 'komentáře uzlů');
    expect(T.files.some((f) => f.name === 'ODKAZ-PRILOHA' && f.url === 'https://example.com/doc'), 'přílohy seznamem (odkaz)');
    expect(T.access.team_access === 'read' && T.access.owner_email === admin.email, `přístup mapy (team_access=${T.access.team_access})`);
    const S = A.maps.find((m) => m.map.title === 'SDILENA');
    expect(S.access.shares.some((s) => s.email === clen.email && s.permission === 'work'), 'sdílení mapy (komu a jak)');
    expect(T.changes.some((c) => c.field === 'created' && c.title === 'T-UZEL'), 'záznam změn mapy');
    expect(A.buffer_nodes.some((b) => b.title === 'NAPAD-ADMINA') && !A.buffer_nodes.some((b) => b.title === 'NAPAD-CLENA'), 'zásobník nápadů jen vlastní');
    expect(A.time_entries.some((t) => t.label === 'CAS-ADMINA' && t.duration_min === 60), 'měření času');
    expect(A.external_contacts.some((c) => c.name === 'KONTAKT-TAJNY') && !C.external_contacts.some((c) => c.name === 'KONTAKT-TAJNY') && C.external_contacts.some((c) => c.name === 'KONTAKT-VEREJNY'), 'kontakty: vlastní privátní ano, cizí privátní ne, veřejné ano');
    const kt = A.external_contacts.find((c) => c.name === 'KONTAKT-TAJNY');
    expect(kt && kt.email === 'tajny@partner.cz' && kt.note === 'POZNAMKA-T' && kt.private === true && kt.owner_email === admin.email, 'kontakt nese e-mail, poznámku, soukromí i vlastníka (ne jen jméno)');
    expect(Array.isArray(T.task_comments) && T.map.client !== undefined && T.map.archived_at !== undefined, 'mapa nese task_comments, client, archived_at');
    expect(A.members.every((m) => m.notify_prefs === undefined && m.token_hash === undefined) && A.members.some((m) => m.email === clen.email), 'členové jen bezpečnou podmnožinou polí');
    expect(A.user.email === admin.email && A.user.role === 'admin', 'vlastní účet (e-mail, role)');
    expect(Array.isArray(C.notifications) && C.notifications.length >= 1, `notifikace vlastní (${C.notifications.length})`);
    expect(A.truncated === null, 'bez zkrácení = null');

    console.log('== exportovaná mapa jde naimportovat zpět ==');
    r = await api('/api/kb/map-import', { token: clen.token, body: { format: T.format, map: T.map, tasks: T.tasks, rules: T.rules } });
    expect(r.status === 200 && r.json.nodes_imported >= 2, `import exportované mapy → 200, uzly ${r.json.nodes_imported} (${r.status} ${r.json.error || ''})`);

    console.log('== nahrát celý export zpět (/import-all) ==');
    r = await api('/api/kb/import-all', { token: clen.token, body: { format: 'nesmysl' } });
    expect(r.status === 400, `špatný formát → 400 (${r.status})`);
    const pred = (await api('/api/collections/goalmaps/records?perPage=200', { token: clen.token })).json.totalItems;
    r = await api('/api/kb/import-all', { token: clen.token, body: A });
    expect(r.status === 200, `import celého adminova exportu jako člen → 200 (${r.status} ${JSON.stringify(r.json).slice(0, 100)})`);
    const I = r.json;
    expect(I.maps_imported === 49 && I.nodes_imported > 49, `naimportováno 49 projektů (${I.maps_imported}, uzlů ${I.nodes_imported})`);
    expect(I.maps_skipped.some((x) => x.reason === 'org'), 'org mapa se přeskočila přiznaně');
    expect(I.ideas_imported === 1, `zásobník nápadů nahrán (${I.ideas_imported})`);
    const po = (await api('/api/collections/goalmaps/records?perPage=200', { token: clen.token })).json;
    expect(po.totalItems === pred + 49, `člen má o 49 map víc (${pred} → ${po.totalItems})`);
    const arch2 = po.items.find((m) => m.title === 'ADMINOVA-ARCHIV');
    expect(!!arch2 && arch2.archived === true && arch2.owner_email === clen.email, 'archivovaná mapa zůstala archivovaná a patří importérovi');
    expect(po.items.filter((m) => m.owner_email === clen.email && m.title === 'TYMOVA').every((m) => m.team_access === '' && !m.is_public), 'importovaná kopie nikomu nesdílí (team_access prázdné, neveřejná)');
    // jedna mapa s `nodes` nad 5 MB (maxSize pole) dřív shodila celou dávku na
    // „Something went wrong" a už založené mapy zůstaly (nález S3-03, 27. 8.)
    const obr = { format: 'killbottleneck.export/1', maps: [
      // normalizace řeže title 500 / description 10 000 znaků, počet uzlů ne → 600 uzlů ≈ 6 MB
      { format: 'killbottleneck.map/1', map: { title: 'OBRI',
        nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { title: 'Obří', status: 'todo' } }]
          .concat(Array.from({ length: 600 }, (_, i) => ({ id: 'o' + i, type: 'goalNode', position: { x: 0, y: i + 1 }, data: { title: 'Uzel ' + i, status: 'todo', description: 'x'.repeat(10000) } }))),
        edges: Array.from({ length: 600 }, (_, i) => ({ id: 'e' + i, source: 'root', target: 'o' + i })) } },
      { format: 'killbottleneck.map/1', map: { title: 'MALA-PO-OBRI', nodes: [{ id: 'n1', type: 'apex', position: { x: 0, y: 0 }, data: { title: 'Malá', status: 'todo' } }], edges: [] } },
    ] };
    await sleep(61000); // minutové okno importu (2/min, počítá se i odmítnutý formát) — čistá minuta
    r = await api('/api/kb/import-all', { token: clen.token, body: obr });
    expect(r.status === 200 && r.json.maps_imported === 1 && r.json.maps_skipped.some((x) => x.title === 'OBRI'),
      `obří mapa se přeskočí přiznaně, malá za ní projde (${r.status} imported=${r.json && r.json.maps_imported} skipped=${String(JSON.stringify((r.json || {}).maps_skipped)).slice(0, 80)})`);
    r = await api('/api/kb/import-all', { token: clen.token, body: A }); r = await api('/api/kb/import-all', { token: clen.token, body: A });
    expect(r.status === 429, `třetí import za minutu → 429 (${r.status})`);

    console.log('== rate-limit ==');
    let last = 200;
    for (let i = 0; i < 7; i++) { last = (await api('/api/kb/export', { token: clen.token })).status; if (last === 429) break; }
    expect(last === 429, `po 5 staženích za minutu 429 (${last})`);

    console.log('== po vypršení zkušebky export JDE, zápis ne ==');
    start('-e KB_TRIAL_UNTIL=2020-01-01'); // stejná data (volume), jen zkušebka skončila
    await waitUp();
    const tok2 = (await api('/api/collections/users/auth-with-password', { body: { identity: admin.email, password: PW } })).json.token;
    expect(!!tok2, 'přihlášení po vypršení funguje');
    r = await api('/api/kb/v1/maps', { bearer: admin.klic, body: { title: 'X', tree: [{ title: 'y' }] } });
    expect(r.status === 402, `zápis po vypršení → 402 (${r.status})`);
    r = await api('/api/kb/export', { token: tok2 });
    expect(r.status === 200 && r.json.format === 'killbottleneck.export/1' && titles(r.json.maps).includes('TYMOVA'), `export po vypršení → 200 se všemi mapami (${r.status})`);
    r = await api('/api/kb/config');
    expect(r.json.trial_expired === true, 'config hlásí trial_expired (pruh v aplikaci ukáže „Stáhnout data")');
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.message);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; docker volume rm -f ${VOLUME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} export-vsech-dat: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
