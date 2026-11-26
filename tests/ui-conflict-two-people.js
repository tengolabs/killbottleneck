// UI e2e (headless Chrome, own temporary profile): two people edit one map at the same time
// (analysis 5, finding c5-1).
//
// Before the fix the second save ran into 409 and showed "Mapa byla mezitím změněna" even when
// the two had edited DIFFERENT steps — and "Ponechat moje změny" saved the whole canvas of the
// second person over everything the first one had stored meanwhile (all their steps, also those
// saved while the dialog was hanging), with no list of what was lost.
//
// Now: what does not cross is merged without a dialog (a toast only); a real crossing asks, names
// the steps the colleague changed (five at most + "a další N") and the ones that cross — and
// "Ponechat moje změny" overwrites only those, every other change of the colleague stays.
//
// Two signed-in people in two browser contexts, real mouse and keyboard; where the colleague's
// part is only a precondition it is written through the API with the colleague's token. The
// background watcher (45 s) is not waited for — each part opens the map afresh and is done sooner.
// The database is read through the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

const PETR = 'petr@example.com';
const LUCIE = 'lucie@example.com';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-conflict-two-people', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(PETR, { name: 'Petr' });
  await inst.register(LUCIE, { name: 'Lucie' });
  const { browser, chyby } = await H.browser();
  const P = await E.clovek(browser, inst, PETR, chyby);
  const L = await E.clovek(browser, inst, LUCIE, chyby);
  const dalsi = (n) => Array.from({ length: n }, (_, i) => ({ id: `k${i + 3}`, type: 'goalNode', position: { x: 60 + 250 * i, y: 520 }, data: { title: `Krok ${i + 3}`, status: 'todo' } }));
  const zaloz = async (title, navic = 0) => {
    const extra = dalsi(navic);
    const m = await E.zalozMapu(inst, P.token, title, { nodes: [...E.NODES(), ...extra], edges: [...E.EDGES(), ...extra.map((n) => ({ id: `e-${n.id}`, source: 'k1', target: n.id }))] });
    const r = await inst.api('POST', '/api/kb/share', { token: P.token, body: { action: 'share', mapId: m.id, email: LUCIE, permission: 'edit' } });
    if (r.status !== 200) throw new Error(`share failed: ${r.status}`);
    return m;
  };
  const db = (id) => E.mapaZDb(inst, P.token, id);
  const ceka = (fn, what, ms = 10000) => E.cekej(fn, ms, what);
  const prehled = (m) => ((m && m.nodes) || []).map((n) => `${n.id}=${(n.data || {}).title}/${(n.data || {}).status || 'todo'}`).join(' ; ');
  const okno = (Q) => Q.page.evaluate(() => { const h = [...document.querySelectorAll('h3')].find((x) => /Mapa byla mezitím změněna/.test(x.innerText || '')); return h ? (h.parentElement.innerText || '').replace(/\s+/g, ' ') : ''; });
  const nazevNaPlatne = (Q, id) => Q.page.evaluate((i) => ((document.querySelector(`.react-flow__node[data-id="${i}"] h3`) || {}).innerText || '').trim(), id);
  const prejmenuj = async (Q, id, text) => {
    if (!(await Q.otevriDialog(id))) return false;
    await Q.page.click('[role="dialog"] #title', { clickCount: 3 });
    await Q.page.keyboard.type(text);
    return Q.klikText('Uložit', '[role="dialog"]');
  };
  // the colleague's stored change as a precondition (their token, the current version as the base)
  const apiZmena = async (token, mapId, fn) => {
    const m = (await inst.api('GET', `/api/collections/goalmaps/records/${mapId}`, { token })).json;
    const zmena = fn(m);
    return (await inst.api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token, body: { nodes: m.nodes, edges: m.edges, ...zmena, base_updated: m.updated } })).status;
  };
  const sNazvem = (m, id, title) => m.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, title } } : n));
  const grip = (Q, id) => Q.page.evaluate((i) => { const r = document.querySelector(`.react-flow__node[data-id="${i}"] h3`).getBoundingClientRect(); return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 }; }, id);
  const tah = async (Q, id, dx, dy) => {
    const g = await grip(Q, id);
    await Q.page.mouse.move(g.x, g.y); await Q.page.mouse.down();
    for (let i = 1; i <= 10; i++) { await Q.page.mouse.move(g.x + (dx * i) / 10, g.y + (dy * i) / 10); await sleep(25); }
    await Q.page.mouse.up(); await sleep(300);
  };
  const pozice = async (mapId, id) => (E.uzel(await db(mapId), id) || {}).position || null;

  console.log('== two people, two DIFFERENT steps → merged, no dialog ==');
  const A = await zaloz('Souběh různé kroky', 1);
  await P.otevriMapu(A.id); await L.otevriMapu(A.id);
  expect(await prejmenuj(P, 'k1', 'Krok jedna PETR'), 'Petr: k1 renamed in the dialog, saved');
  expect(await ceka(async () => E.nazev(await db(A.id), 'k1') === 'Krok jedna PETR', 'k1 in DB'), 'Petr\'s rename is in the database');
  expect(await prejmenuj(L, 'k2', 'Krok dva LUCIE'), 'Lucie (canvas still old): k2 renamed in the dialog, saved');
  expect(await ceka(async () => E.nazev(await db(A.id), 'k2') === 'Krok dva LUCIE', 'k2 in DB'), 'Lucie\'s rename is in the database');
  await sleep(1500);
  expect((await okno(L)) === '', 'Lucie got NO "Mapa byla mezitím změněna" dialog');
  let m = await db(A.id);
  expect(E.nazev(m, 'k1') === 'Krok jedna PETR' && E.nazev(m, 'k2') === 'Krok dva LUCIE', `the database holds both (${prehled(m)})`);
  expect((await nazevNaPlatne(L, 'k1')) === 'Krok jedna PETR', `Lucie's canvas took Petr's rename over ("${await nazevNaPlatne(L, 'k1')}")`);
  expect((await L.toasty()).some((x) => /přibyly změny někoho jiného/.test(x)), `Lucie was told by a toast (${(await L.toasty()).join(' | ').slice(0, 120)})`);
  // …and the other way round, with a status click and a connection-free change on Petr's side
  expect(await P.klikStav('k3'), 'Petr (canvas old now): click on the status of k3');
  expect(await ceka(async () => E.stav(await db(A.id), 'k3') === 'in_progress', 'k3 in DB'), 'Petr\'s status is in the database');
  await sleep(1500);
  m = await db(A.id);
  expect((await okno(P)) === '' && E.nazev(m, 'k2') === 'Krok dva LUCIE' && E.nazev(m, 'k1') === 'Krok jedna PETR', `Petr got no dialog either and nothing was overwritten (${prehled(m)})`);
  expect((await nazevNaPlatne(P, 'k2')) === 'Krok dva LUCIE', 'Petr\'s canvas took Lucie\'s rename over');

  console.log('== the same step moved by both → my position, no dialog; the map title from one side merges ==');
  expect(await apiZmena(P.token, A.id, (x) => ({ title: 'Souběh PŘEJMENOVANÝ PETREM', nodes: x.nodes.map((n) => (n.id === 'k3' ? { ...n, position: { x: 900, y: 700 } } : n)) })) === 200, 'Petr (API): map renamed and k3 moved');
  const k3Pred = await pozice(A.id, 'k3');
  await tah(L, 'k3', -80, 60);
  expect(await ceka(async () => { const p = await pozice(A.id, 'k3'); return !!p && (p.x !== k3Pred.x || p.y !== k3Pred.y); }, 'k3 moved in DB'), 'Lucie\'s drag of the same step is saved');
  await sleep(1500);
  m = await db(A.id);
  const k3Po = await pozice(A.id, 'k3');
  expect((await okno(L)) === '', 'a position moved by both is no reason for a dialog');
  expect(k3Po.x < 600, `Lucie's position won (k3 x=${Math.round(k3Po.x)}, Petr's was 900)`);
  expect(m.title === 'Souběh PŘEJMENOVANÝ PETREM', `the map title changed by Petr only was merged ("${m.title}")`);

  console.log('== the SAME step edited by both → the dialog names the steps; "Ponechat moje změny" overwrites only the disputed one ==');
  const B = await zaloz('Souběh týž krok', 2);
  await P.otevriMapu(B.id); await L.otevriMapu(B.id);
  expect(await prejmenuj(P, 'k1', 'Krok jedna PETR'), 'Petr: k1 renamed, saved');
  expect(await ceka(async () => E.nazev(await db(B.id), 'k1') === 'Krok jedna PETR', 'k1 in DB'), 'Petr\'s rename of k1 is in the database');
  expect(await prejmenuj(L, 'k1', 'Krok jedna LUCIE'), 'Lucie: the SAME step renamed differently, saved');
  expect(await ceka(async () => (await okno(L)) !== '', 'conflict dialog'), 'Lucie: the dialog "Mapa byla mezitím změněna" is up');
  let text = await okno(L);
  expect(/Mezitím změněno: „Krok jedna PETR“\./.test(text), `the dialog names the step the colleague changed (${text.slice(0, 260)})`);
  expect(/Kříží se s vašimi úpravami: „Krok jedna LUCIE“\./.test(text), 'the dialog names the step that crosses');
  expect(/přepíše cizí úpravy jen tam, kde se kříží/.test(text) && !/úpravy toho druhého se přepíší/.test(text), 'the hint says only the crossing ones get overwritten');
  expect(E.nazev(await db(B.id), 'k1') === 'Krok jedna PETR', 'nothing is written while the dialog is up');
  // while the dialog hangs, Petr goes on working — with the real mouse and keyboard
  expect(await prejmenuj(P, 'k2', 'Krok dva PETR'), 'Petr meanwhile: ANOTHER step (k2) renamed, saved');
  expect(await ceka(async () => E.nazev(await db(B.id), 'k2') === 'Krok dva PETR', 'k2 in DB'), 'Petr\'s rename of k2 is in the database');
  expect(await P.klikStav('k3'), 'Petr meanwhile: click on the status of k3');
  expect(await ceka(async () => E.stav(await db(B.id), 'k3') === 'in_progress', 'k3 in DB'), 'Petr\'s status of k3 is in the database');
  expect(await L.klikText('Ponechat moje změny'), 'Lucie: "Ponechat moje změny"');
  expect(await ceka(async () => E.nazev(await db(B.id), 'k1') === 'Krok jedna LUCIE', 'k1 mine in DB'), 'the disputed step carries Lucie\'s version');
  await sleep(1500);
  m = await db(B.id);
  expect(E.nazev(m, 'k2') === 'Krok dva PETR', `Petr's rename of ANOTHER step survived ("${E.nazev(m, 'k2')}")`);
  expect(E.stav(m, 'k3') === 'in_progress', `Petr's status of a third step survived (${E.stav(m, 'k3')})`);
  expect((await okno(L)) === '', 'the dialog is gone');
  expect((await L.toasty()).some((x) => /Kde se úpravy křížily, platí vaše verze/.test(x)), 'Lucie was told what was saved');
  expect((await nazevNaPlatne(L, 'k2')) === 'Krok dva PETR' && (await L.stavNaPlatne('k3')).includes('Probíhá'), 'Lucie\'s canvas shows Petr\'s other changes');
  // no loop afterwards: Lucie's next edit saves without a dialog
  expect(await L.klikStav('k4'), 'Lucie: click on the status of k4 afterwards');
  expect(await ceka(async () => E.stav(await db(B.id), 'k4') === 'in_progress', 'k4 in DB'), 'saved');
  await sleep(1500);
  expect((await okno(L)) === '', 'no further dialog (no 409 loop)');
  // Petr, whose k1 was overwritten: his next save merges, he keeps the rest
  expect(await prejmenuj(P, 'k3', 'Krok 3 PETR'), 'Petr afterwards: k3 renamed, saved');
  expect(await ceka(async () => E.nazev(await db(B.id), 'k3') === 'Krok 3 PETR', 'k3 in DB'), 'Petr\'s next save got through');
  await sleep(1500);
  m = await db(B.id);
  expect((await okno(P)) === '' && E.nazev(m, 'k1') === 'Krok jedna LUCIE' && E.stav(m, 'k4') === 'in_progress', `Petr got no dialog and overwrote nothing of Lucie's (${prehled(m)})`);

  console.log('== more than five steps changed by the colleague → five names and "a další N"; only the disputed one is overwritten ==');
  const C = await zaloz('Souběh hodně kroků', 6);
  await L.otevriMapu(C.id);
  expect(await apiZmena(P.token, C.id, (x) => ({ nodes: x.nodes.map((n) => (n.type === 'apexNode' || n.id === 'k8' ? n : { ...n, data: { ...n.data, title: `${n.data.title} PETR` } })) })) === 200, 'Petr (API): seven steps renamed (k1…k7)');
  expect(await prejmenuj(L, 'k1', 'Krok jedna LUCIE'), 'Lucie: k1 renamed, saved');
  expect(await ceka(async () => (await okno(L)) !== '', 'conflict dialog'), 'Lucie: the dialog is up');
  text = await okno(L);
  const jmen = (text.match(/Mezitím změněno: (.*?) a další (\d+)\./) || [])[1] || '';
  expect(/a další 2\./.test(text) && (jmen.match(/„/g) || []).length === 5, `five names and "a další 2" (${text.slice(0, 300)})`);
  expect(await L.klikText('Ponechat moje změny'), 'Lucie: "Ponechat moje změny"');
  expect(await ceka(async () => E.nazev(await db(C.id), 'k1') === 'Krok jedna LUCIE', 'k1 mine'), 'the disputed step carries Lucie\'s version');
  await sleep(1200);
  m = await db(C.id);
  const petrovy = ['k2', 'k3', 'k4', 'k5', 'k6', 'k7'].filter((id) => / PETR$/.test(E.nazev(m, id)));
  expect(petrovy.length === 6, `all six other steps keep Petr's names (${petrovy.length}/6: ${prehled(m)})`);

  console.log('== deleted by one, edited by the other → asks; "Ponechat moje změny" keeps my step connected ==');
  const D = await zaloz('Souběh smazáno × upraveno', 1);
  await P.otevriMapu(D.id); await L.otevriMapu(D.id);
  expect(await P.akceUzlu('k2', 'Smazat'), 'Petr: step k2 deleted (the trash on the node)');
  expect(await ceka(async () => !E.uzel(await db(D.id), 'k2'), 'k2 gone'), 'the deletion is in the database');
  expect(await prejmenuj(P, 'k3', 'Krok 3 PETR'), 'Petr: another step renamed');
  expect(await ceka(async () => E.nazev(await db(D.id), 'k3') === 'Krok 3 PETR', 'k3 in DB'), 'saved');
  expect(await prejmenuj(L, 'k2', 'Krok dva LUCIE'), 'Lucie: the deleted step renamed, saved');
  expect(await ceka(async () => (await okno(L)) !== '', 'conflict dialog'), 'Lucie: the dialog is up (deleted × edited)');
  expect(/Kříží se s vašimi úpravami: „Krok dva LUCIE“/.test(await okno(L)), 'the dialog names the step');
  expect(await L.klikText('Ponechat moje změny'), 'Lucie: "Ponechat moje změny"');
  expect(await ceka(async () => E.nazev(await db(D.id), 'k2') === 'Krok dva LUCIE', 'k2 back'), 'Lucie\'s step is in the database again');
  m = await db(D.id);
  expect((m.edges || []).some((e) => e.source === 'root' && e.target === 'k2'), 'with its connection to the top');
  expect(E.nazev(m, 'k3') === 'Krok 3 PETR', 'Petr\'s other rename stayed');

  console.log('== "Načíst aktuální verzi" is as it was: my drafted edit goes, nothing is written ==');
  const F = await zaloz('Souběh načíst');
  await L.otevriMapu(F.id);
  expect(await apiZmena(P.token, F.id, (x) => ({ nodes: sNazvem(x, 'k1', 'Krok jedna PETR') })) === 200, 'Petr (API): k1 renamed');
  expect(await prejmenuj(L, 'k1', 'Krok jedna LUCIE'), 'Lucie: the same step renamed, saved');
  expect(await ceka(async () => (await okno(L)) !== '', 'conflict dialog'), 'Lucie: the dialog is up');
  await Promise.all([L.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}), L.klikText('Načíst aktuální verzi')]);
  await L.page.waitForSelector('.react-flow__node[data-id="k1"]', { timeout: 30000 });
  await sleep(1500);
  expect((await nazevNaPlatne(L, 'k1')) === 'Krok jedna PETR', `after the reload Lucie sees Petr's version ("${await nazevNaPlatne(L, 'k1')}")`);
  expect(E.nazev(await db(F.id), 'k1') === 'Krok jedna PETR', 'the database is untouched');

  const real = chyby.filter((c) => !/favicon|ResizeObserver|409/.test(c));
  expect(real.length === 0, `the console is clean but for the expected 409 (${real.slice(0, 2).join(' | ').slice(0, 200) || 'no other errors'})`);
}, { nazev: 'UI-CONFLICT-TWO-PEOPLE' });
