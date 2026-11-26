// UI e2e (headless Chrome, own temporary profile): a request for another deadline must not
// silently vanish — and a withdrawn / declined / approved one must not come back (analysis 5,
// finding c3-1, widened by the sceptic).
//
// The request is written by its own server route (/api/kb/deadline-requests), not by the save of
// the map. Before the fix
//   · the dialog saved the node with the request fields of the copy it was OPENED with: from the
//     Tasks page the request was wiped without any message;
//   · the canvas of the editor never learnt about the request: the next save of the map ran into
//     409 ("the map was changed meanwhile" — by the person's own request), "Keep my changes"
//     wiped it, the dialog went on claiming "You proposed…" and "Withdraw" answered 403;
//   · the other way round, a withdrawn or declined request was written back by the next save.
//
// Two people in two browser contexts (the assigner and the assignee with the right to edit),
// real mouse and keyboard. The database is read through the API.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

const SEF = 'sef@example.com';
const PETR = 'petr@example.com';

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-deadline-request', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(SEF, { name: 'Šéf' });
  await inst.register(PETR, { name: 'Petr' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, SEF, chyby);
  const P = await E.clovek(browser, inst, PETR, chyby);
  const den = (plus) => new Date(Date.now() + plus * 86400000).toISOString().slice(0, 10);
  const TERMIN = den(40);
  const kroky = () => E.NODES().map((n) => (n.type === 'apexNode' ? n : { ...n, data: { ...n.data, deadline: TERMIN, owner: PETR } }));
  const zaloz = async (title) => {
    const m = await E.zalozMapu(inst, S.token, title, { nodes: kroky() });
    const r = await inst.api('POST', '/api/kb/share', { token: S.token, body: { action: 'share', mapId: m.id, email: PETR, permission: 'edit' } });
    if (r.status !== 200) throw new Error(`share failed: ${r.status}`);
    return m;
  };
  const db = (id) => E.mapaZDb(inst, S.token, id);
  const zadost = async (mapId, id) => { const d = (E.uzel(await db(mapId), id) || {}).data || {}; return { wanted: d.deadlineChangeWanted || '', by: d.deadlineChangeRequestedBy || '', status: d.status || 'todo', title: d.title || '', deadline: d.deadline || '' }; };
  const popis = (z) => `wanted="${z.wanted}" by="${z.by}" status=${z.status} title="${z.title}"`;
  const ceka = (fn, what, ms = 10000) => E.cekej(fn, ms, what);
  const dialogText = (Q) => Q.page.evaluate(() => { return [...document.querySelectorAll('[role="dialog"]')].map((x) => x.innerText || '').join('\n'); });
  const oknoKonfliktu = (Q) => Q.page.evaluate(() => /Mapa byla mezitím změněna/.test(document.body.innerText));
  const pruhCizi = (Q) => Q.page.evaluate(() => /Mapu mezitím změnil někdo jiný/.test(document.body.innerText));
  const chybaToast = async (Q) => (await Q.toasty()).filter((x) => /nepodařilo|nepovedlo|Something went wrong/i.test(x));
  // the category of the full dialog (it has a side navigation); the compact one shows all at once
  const kategorie = async (Q, name) => { await Q.klikText(name, '[role="dialog"]'); await sleep(300); };
  // "Navrhnout jiný termín" → pick a day in the calendar → "Odeslat žádost"
  const posliZadost = async (Q) => {
    if (!(await Q.klikText('Navrhnout jiný termín', '[role="dialog"]'))) return false;
    await Q.page.waitForSelector('#dl-request-date', { timeout: 5000 });
    await Q.page.click('#dl-request-date');
    await Q.page.waitForSelector('[data-radix-popper-content-wrapper] table', { timeout: 5000 });
    const day = await Q.page.evaluateHandle(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper] table button')].find((b) => (b.innerText || '').trim() === '15' && !b.disabled) || null);
    if (!day.asElement()) return false;
    await day.asElement().click();
    await sleep(300);
    return Q.klikText('Odeslat žádost', '[role="dialog"]');
  };
  // The toast of the request ("Žádost odeslána…") lies over the bottom right corner of the dialog
  // for a few seconds — a real click on "Uložit" would land on the toast. A person waits it out.
  const ulozDialog = async (Q) => {
    await E.cekej(async () => (await Q.toasty()).length === 0, 15000, 'toasts gone');
    return Q.klikText('Uložit', '[role="dialog"]');
  };
  const zmenStavVDialogu = async (Q, label) => Q.klikText(label, '[role="dialog"]');
  const prepisNazev = async (Q, text) => { await Q.page.click('[role="dialog"] #title', { clickCount: 3 }); await Q.page.keyboard.type(text); };

  console.log('== Tasks page: request, change something else in the same dialog, save → the request stays ==');
  const A = await zaloz('Žádost z Úkolů');
  const otevriZUkolu = async (title) => {
    const btn = await P.page.evaluateHandle((t) => {
      const row = [...document.querySelectorAll('tr')].find((r) => (r.innerText || '').includes(t));
      return row ? [...row.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '').startsWith('Upravit cíl')) || null : null;
    }, title);
    if (!btn.asElement()) return false;
    await btn.asElement().click();
    return P.page.waitForSelector('[role="dialog"] #title', { timeout: 8000 }).then(() => true).catch(() => false);
  };
  await P.page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  await P.page.waitForFunction(() => /Krok jedna/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
  expect(await otevriZUkolu('Krok jedna'), 'Petr: Tasks › pencil "Upravit cíl" on the row of k1');
  expect(await posliZadost(P), 'Petr: "Navrhnout jiný termín" › day 15 › "Odeslat žádost"');
  expect(await ceka(async () => !!(await zadost(A.id, 'k1')).wanted, 'request in DB'), `the request is in the database (${popis(await zadost(A.id, 'k1'))})`);
  const wantedA = (await zadost(A.id, 'k1')).wanted;
  expect(/Navrhli jste/.test(await dialogText(P)), 'the dialog says "Navrhli jste…"');
  expect(await zmenStavVDialogu(P, 'Probíhá'), 'Petr: status → Probíhá in the same dialog');
  expect(await ulozDialog(P), 'Petr: "Uložit"');
  expect(await ceka(async () => (await zadost(A.id, 'k1')).status === 'in_progress', 'status in DB'), 'the status is saved');
  let z = await zadost(A.id, 'k1');
  expect(z.wanted === wantedA && z.by === PETR, `the request SURVIVED the save of the dialog (${popis(z)})`);
  expect((await chybaToast(P)).length === 0, 'no error message');

  console.log('== Tasks page: the reopened dialog tells the truth; a withdrawn request does not come back ==');
  expect(await otevriZUkolu('Krok jedna'), 'Petr: the dialog of k1 again (no reload of the page)');
  expect(/Navrhli jste/.test(await dialogText(P)), 'the reopened dialog shows the request');
  expect(await P.klikText('Vzít zpět', '[role="dialog"]'), 'Petr: "Vzít zpět"');
  expect(await ceka(async () => !(await zadost(A.id, 'k1')).wanted, 'request withdrawn in DB'), 'the request is withdrawn in the database');
  expect((await chybaToast(P)).length === 0, `withdrawing raised no error (${(await chybaToast(P)).join(' | ')})`);
  await prepisNazev(P, 'Krok jedna PO STAŽENÍ');
  expect(await ulozDialog(P), 'Petr: new title › "Uložit"');
  expect(await ceka(async () => (await zadost(A.id, 'k1')).title === 'Krok jedna PO STAŽENÍ', 'title in DB'), 'the title is saved');
  z = await zadost(A.id, 'k1');
  expect(z.wanted === '' && z.by === '', `the withdrawn request did NOT come back with the save (${popis(z)})`);
  expect(await otevriZUkolu('Krok jedna PO STAŽENÍ'), 'Petr: the dialog once more');
  expect(!/Navrhli jste/.test(await dialogText(P)) && /Navrhnout jiný termín/.test(await dialogText(P)), 'the dialog offers "Navrhnout jiný termín" again');
  await P.page.keyboard.press('Escape');

  console.log('== map editor: request, change in the same dialog, save → no conflict, the request stays ==');
  const B = await zaloz('Žádost z mapy');
  await P.otevriMapu(B.id);
  expect(await P.otevriDialog('k1'), 'Petr: dialog of k1 in the map');
  await kategorie(P, 'Zadání');
  expect(await posliZadost(P), 'Petr: request for another deadline sent');
  expect(await ceka(async () => !!(await zadost(B.id, 'k1')).wanted, 'request in DB'), `the request is in the database (${popis(await zadost(B.id, 'k1'))})`);
  const wantedB = (await zadost(B.id, 'k1')).wanted;
  await kategorie(P, 'Základ');
  expect(await zmenStavVDialogu(P, 'Probíhá'), 'Petr: status → Probíhá in the same dialog');
  expect(await ulozDialog(P), 'Petr: "Uložit"');
  expect(await ceka(async () => (await zadost(B.id, 'k1')).status === 'in_progress', 'status in DB'), 'the status is saved');
  await sleep(2500);
  expect((await oknoKonfliktu(P)) === false, 'no "Mapa byla mezitím změněna" dialog over the person\'s own request');
  expect((await pruhCizi(P)) === false, 'no "somebody else changed the map" banner either');
  z = await zadost(B.id, 'k1');
  expect(z.wanted === wantedB && z.by === PETR, `the request survived the save (${popis(z)})`);
  expect(await P.page.evaluate((w) => !!document.querySelector(`.react-flow__node[data-id="k1"] [title*="${w}"]`), wantedB), 'the node on the canvas carries the request badge');

  console.log('== map editor: a later change of the map keeps the request too ==');
  expect(await P.klikStav('k2'), 'Petr: click on the status of ANOTHER node (k2)');
  expect(await ceka(async () => (await zadost(B.id, 'k2')).status === 'in_progress', 'k2 in DB'), 'the status of k2 is saved');
  await sleep(2500);
  expect((await oknoKonfliktu(P)) === false, 'still no conflict dialog');
  z = await zadost(B.id, 'k1');
  expect(z.wanted === wantedB && z.by === PETR, `the request is still there (${popis(z)})`);

  console.log('== map editor: the dialog tells the truth and "Vzít zpět" works; then a save does not bring it back ==');
  expect(await P.otevriDialog('k1'), 'Petr: dialog of k1 again');
  await kategorie(P, 'Zadání');
  expect(/Navrhli jste/.test(await dialogText(P)), 'the dialog shows the request');
  expect(await P.klikText('Vzít zpět', '[role="dialog"]'), 'Petr: "Vzít zpět"');
  expect(await ceka(async () => !(await zadost(B.id, 'k1')).wanted, 'withdrawn in DB'), 'the request is withdrawn in the database (no 403)');
  expect((await chybaToast(P)).length === 0, `no error message (${(await chybaToast(P)).join(' | ')})`);
  await kategorie(P, 'Základ');
  await prepisNazev(P, 'Krok jedna PO STAŽENÍ');
  expect(await ulozDialog(P), 'Petr: new title › "Uložit"');
  expect(await ceka(async () => (await zadost(B.id, 'k1')).title === 'Krok jedna PO STAŽENÍ', 'title in DB'), 'the title is saved');
  await sleep(2500);
  z = await zadost(B.id, 'k1');
  expect(z.wanted === '' && z.by === '', `the withdrawn request did NOT come back (${popis(z)})`);
  expect((await oknoKonfliktu(P)) === false, 'no conflict dialog');
  expect(await P.otevriDialog('k1'), 'Petr: dialog of k1 once more');
  await kategorie(P, 'Zadání');
  expect(!/Navrhli jste/.test(await dialogText(P)), 'the dialog no longer claims a request');
  await P.page.keyboard.press('Escape');

  console.log('== the assigner: a declined request does not come back with the next save ==');
  const C = await zaloz('Žádost zamítnutá');
  expect((await inst.api('POST', '/api/kb/deadline-requests', { token: P.token, body: { mapId: C.id, nodeId: 'k1', action: 'request', date: den(50), note: 'nestíhám' } })).status === 200, 'Petr asked for another deadline of k1 (API)');
  expect((await inst.api('POST', '/api/kb/deadline-requests', { token: P.token, body: { mapId: C.id, nodeId: 'k2', action: 'request', date: den(55), note: '' } })).status === 200, 'Petr asked for another deadline of k2 (API)');
  await S.otevriMapu(C.id);
  expect(await S.otevriDialog('k1'), 'the assigner: dialog of k1');
  await kategorie(S, 'Zadání');
  expect(/navrhuje termín/.test(await dialogText(S)), 'the dialog shows the request to decide');
  expect(await S.klikText('Zamítnout', '[role="dialog"]'), 'the assigner: "Zamítnout"');
  expect(await ceka(async () => !(await zadost(C.id, 'k1')).wanted, 'declined in DB'), 'the request is declined in the database');
  await kategorie(S, 'Základ');
  await prepisNazev(S, 'Krok jedna PO ZAMÍTNUTÍ');
  expect(await ulozDialog(S), 'the assigner: new title › "Uložit"');
  expect(await ceka(async () => (await zadost(C.id, 'k1')).title === 'Krok jedna PO ZAMÍTNUTÍ', 'title in DB'), 'the title is saved');
  await sleep(2500);
  z = await zadost(C.id, 'k1');
  expect(z.wanted === '' && z.by === '', `the declined request did NOT come back (${popis(z)})`);
  expect((await oknoKonfliktu(S)) === false && (await pruhCizi(S)) === false, 'no conflict dialog, no banner');

  console.log('== the assigner: an approved request does not come back with the next save ==');
  const wantedC2 = (await zadost(C.id, 'k2')).wanted;
  expect(await S.otevriDialog('k2'), 'the assigner: dialog of k2');
  await kategorie(S, 'Zadání');
  expect(await S.klikText('Schválit', '[role="dialog"]'), 'the assigner: "Schválit"');
  expect(await ceka(async () => (await zadost(C.id, 'k2')).deadline === wantedC2, 'deadline moved in DB'), `the deadline of k2 is the proposed one (${(await zadost(C.id, 'k2')).deadline})`);
  expect((await zadost(C.id, 'k2')).wanted === '', 'the request is settled');
  expect(await S.klikStav('k2'), 'the assigner: click on the status of k2 (another save of the map)');
  expect(await ceka(async () => (await zadost(C.id, 'k2')).status === 'in_progress', 'status in DB'), 'the status is saved');
  await sleep(2500);
  z = await zadost(C.id, 'k2');
  expect(z.wanted === '' && z.by === '', `the settled request did NOT come back (${popis(z)})`);
  expect(z.deadline === wantedC2, 'the approved deadline stayed');

  const real = chyby.filter((c) => !/favicon|ResizeObserver/.test(c));
  expect(real.length === 0, `the console is clean (${real.slice(0, 2).join(' | ').slice(0, 200) || 'no errors'})`);
}, { nazev: 'UI-DEADLINE-REQUEST-KEEPS' });
