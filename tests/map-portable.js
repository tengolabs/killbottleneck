// Export/import schématu jako JSON — aby si lidé mohli projekty posílat.
// Unit část: lib/mapPortable.js (skládání souboru, volba „bez jmen").
// E2E část: serverová routa /api/flowmap/map-import — přegenerování id, ověření
// e-mailů, žádné notifikace, žádné zděděné sdílení.
const path = require('path');
const { pathToFileURL } = require('url');
const { execSync } = require('child_process');

const NAME = 'flowmap-e2e-portable';
const PORT = 20513;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};
const reg = (email) => api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
const login = async (email) => (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;

const NODES = [
  { id: 'root', type: 'apexNode', position: { x: 0, y: 0 },
    data: { apexText: 'Onboarding klienta', title: 'Onboarding klienta', status: 'todo' } },
  { id: 'n1', type: 'goalNode', position: { x: 0, y: 100 },
    data: { title: 'Sesbírat podklady', status: 'todo', owner: 'a@example.com', deadline: '2026-09-01' } },
  { id: 'n2', type: 'goalNode', position: { x: 200, y: 100 },
    data: { title: 'Vygenerovat smlouvu', status: 'todo', owner: 'nikdo@jinde.cz',
      executorKind: 'automation', executorName: 'n8n smlouvy' } },
];
const EDGES = [
  { id: 'e1', source: 'root', target: 'n1' },
  { id: 'e2', source: 'root', target: 'n2' },
];

(async () => {
  try {
    const mod = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/mapPortable.js')).href);
    const { buildMapExport, looksLikeExport, exportFilename, EXPORT_FORMAT } = mod;

    console.log('== unit: skládání exportu ==');
    const full = buildMapExport({
      map: { title: 'Onboarding', description: 'popis' }, nodes: NODES, edges: EDGES,
      tasks: [{ id: 't1', title: 'Zavolat klientovi', status: 'todo', assignee_email: 'a@example.com', node_id: 'n1' }],
      includePeople: true, exportedBy: 'a@example.com',
    });
    expect(full.format === EXPORT_FORMAT && looksLikeExport(full), 'export má rozpoznatelný formát');
    expect(full.map.nodes[2].data.executorKind === 'automation' && full.map.nodes[2].data.executorName === 'n8n smlouvy',
      'export nese vykonavatele');
    expect(full.tasks.length === 1 && full.tasks[0].assignee_email === 'a@example.com', 'export nese úkoly s řešitelem');

    const anon = buildMapExport({ map: { title: 'Onboarding' }, nodes: NODES, edges: EDGES,
      tasks: [{ id: 't1', title: 'Zavolat', status: 'todo', assignee_email: 'a@example.com' }],
      includePeople: false, exportedBy: 'a@example.com' });
    expect(anon.map.nodes.every((n) => !n.data.owner) && !anon.tasks[0].assignee_email && !anon.exported_by,
      'volba „bez jmen" vyprázdní garanty, řešitele i autora exportu');
    expect(anon.map.nodes[2].data.executorName === 'n8n smlouvy',
      'jméno agenta zůstává i bez jmen lidí (je to popis procesu)');
    expect(!looksLikeExport({ format: 'neco/jineho', map: { nodes: [] } }), 'cizí formát prekontrolou neprojde');
    expect(exportFilename('Můj projekt / 2026') === 'muj-projekt-2026.kb.json',
      `název souboru bez diakritiky a lomítek (${exportFilename('Můj projekt / 2026')})`);
    // PŘECHOD po přejmenování: soubor vyexportovaný ze starší verze leží uživateli
    // na disku a musí jít otevřít pořád — jinak by přejmenování produktu znamenalo
    // ztrátu jeho vlastních dat.
    expect(looksLikeExport({ format: 'flowmap.map/1', map: { nodes: [] } }),
      'starý export (flowmap.map/1) se pozná i po přejmenování');

    console.log('== e2e: import na serveru ==');
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} -e KB_UVODNI_MAPA=0 -p ${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 30; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }

    await reg('a@example.com');
    await reg('b@example.com');
    const A = await login('a@example.com');
    const B = await login('b@example.com');

    // B importuje export, ve kterém je přiřazený a@example.com (existuje)
    // a nikdo@jinde.cz (neexistuje)
    let r = await api('POST', '/api/flowmap/map-import', { token: B, body: full });
    expect(r.status === 200, `import prošel (${r.status})`);
    expect(r.json.nodes_imported === 3 && r.json.tasks_imported === 0 && r.json.tasks_skipped === 1,
      `3 uzly; položky-úkoly se NEIMPORTUJÍ (slovník 17. 8.) a poctivě se počítají (${r.json.nodes_imported}/${r.json.tasks_imported}/${r.json.tasks_skipped})`);
    expect(r.json.assignments_dropped === 1,
      `neznámý e-mail zahozen a započítán (${r.json.assignments_dropped})`);

    const imported = (await api('GET', `/api/collections/goalmaps/records/${r.json.id}`, { token: B })).json;
    expect(imported.owner_email === 'b@example.com', 'mapa patří importujícímu, ne autorovi exportu');
    expect(!imported.is_public && (imported.shared_with || []).length === 0 && !imported.team_access,
      'importovaná mapa NENÍ veřejná ani sdílená');
    expect(imported.nodes.every((n) => !/^root$|^n1$|^n2$/.test(n.id)),
      'id uzlů jsou přegenerovaná (nekolidují s originálem)');
    expect(imported.edges.length === 2 && imported.edges.every((ed) =>
      imported.nodes.some((n) => n.id === ed.source) && imported.nodes.some((n) => n.id === ed.target)),
    'hrany ukazují na přegenerovaná id');
    const aiNode = imported.nodes.find((n) => n.data.executorKind === 'automation');
    expect(!!aiNode && aiNode.data.executorName === 'n8n smlouvy', 'vykonavatel přežil import');
    expect(aiNode.data.owner === '', 'neznámý garant vyprázdněn');
    expect(imported.nodes.find((n) => n.data.title === 'Sesbírat podklady').data.owner === 'a@example.com',
      'známý garant zachován');

    const tasks = (await api('GET', '/api/collections/tasks/records', { token: B })).json;
    expect(tasks.totalItems === 0, `žádná položka-úkol z importu nevznikla (${tasks.totalItems})`);

    // import nesmí vyrobit ANI JEDNU notifikaci (jinak by podvržený soubor spamoval)
    const nA = (await api('GET', '/api/collections/notifications/records?perPage=1', { token: A })).json;
    expect(nA.totalItems === 0, `import nikoho neupozornil (${nA.totalItems})`);

    // POZOR: rate-limit se počítá PŘED validací formátu (záplava nesmyslů je taky
    // záplava), takže tyhle kontroly musí jet na účtu, který ještě neimportoval —
    // jinak by je odbavil 429 místo očekávané validační chyby.
    console.log('== odmítnutí vadného vstupu ==');
    r = await api('POST', '/api/flowmap/map-import', { token: A, body: { format: 'neco/jineho', map: { nodes: [] } } });
    expect(r.status === 400, `cizí formát → 400 (${r.status})`);
    r = await api('POST', '/api/flowmap/map-import', { token: A, body: { format: 'flowmap.map/1', map: { nodes: [], edges: [] } } });
    expect(r.status === 400, `export bez uzlů → 400 (${r.status})`);
    r = await api('POST', '/api/flowmap/map-import', { body: full });
    expect(r.status === 401 || r.status === 403, `bez přihlášení odmítnuto (${r.status})`);
    // strom: uzel se dvěma rodiči musí být odmítnut, ne uložen rozbitý
    r = await api('POST', '/api/flowmap/map-import', { token: A, body: {
      format: 'flowmap.map/1',
      map: { title: 'Rozbitá', nodes: NODES, edges: EDGES.concat([{ id: 'e3', source: 'n1', target: 'n2' }]) },
    } });
    expect(r.status === 400, `uzel se dvěma rodiči → 400 (${r.status})`);
    // …i s VYPLNĚNÝMI pozicemi (reálný export je vždy má — bez téhle varianty
    // by kontrolu mohl náhodně suplovat dopočet layoutu, ne skutečný štít
    // v normalizeMapData; Richard 13. 8.: import nesmí pustit projekt s vadou).
    // Vlastní uživatel C: rate-limit importu (3/min) počítá i odmítnuté pokusy
    // a A/B už mají čerpáno — bez C by tyhle kontroly dostaly 429 místo 400.
    await reg('c@example.com');
    const C = await login('c@example.com');
    const sPozicemi = (ns) => ns.map((n, ix) => ({ ...n, position: { x: ix * 200 + 10, y: 100 } }));
    r = await api('POST', '/api/flowmap/map-import', { token: C, body: {
      format: 'flowmap.map/1',
      map: { title: 'Rozbitá s pozicemi', nodes: sPozicemi(NODES), edges: EDGES.concat([{ id: 'e3', source: 'n1', target: 'n2' }]) },
    } });
    expect(r.status === 400, `dva rodiče s pozicemi → 400 (${r.status})`);
    // odpojený kruh (n1↔n2 bokem stromu): každý uzel má JEDNOHO rodiče,
    // multi-parent kontrola ho nechytí — musí ho chytit detekce cyklu
    r = await api('POST', '/api/flowmap/map-import', { token: C, body: {
      format: 'flowmap.map/1',
      map: { title: 'Kruh', nodes: sPozicemi(NODES), edges: [
        { id: 'e1', source: 'n1', target: 'n2' }, { id: 'e2', source: 'n2', target: 'n1' },
      ] },
    } });
    expect(r.status === 400, `odpojený kruh → 400 (${r.status})`);

    console.log('== rate-limit ==');
    let limited = false;
    for (let i = 0; i < 5; i++) {
      const rr = await api('POST', '/api/flowmap/map-import', { token: B, body: full });
      if (rr.status === 429) { limited = true; break; }
    }
    expect(limited, 'série importů narazí na rate-limit');
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  } finally {
    try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch { /* už je pryč */ }
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} MAP PORTABLE PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
