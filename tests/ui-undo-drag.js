// UI e2e (headless Chrome, own temporary profile): dragging a node is ONE step of Undo
// (analysis 5, finding c4-1).
//
// Before the fix a drag never entered the history: Ctrl+Z / "Vrátit zpět" after a drag left the
// node where it was dropped and silently took back the step BEFORE it — the title and
// description saved from the dialog of that node or of a completely different one.
//
// One signed-in person, real mouse and real key presses; the database is read through the API.
// Covered: one node, another node than the one edited before, several selected nodes, the frame
// around a selection, the horizontal view (where the SAVED position is the canonical one), and a
// plain click that must not leave a step behind.
const H = require('./_harness');
const { expect, sleep } = H;
const E = require('./_chyby4-editor');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'ui-undo-drag', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('sef@example.com', { name: 'Šéf' });
  const { browser, chyby } = await H.browser();
  const S = await E.clovek(browser, inst, 'sef@example.com', chyby);
  const page = S.page;
  const db = (id) => E.mapaZDb(inst, S.token, id);
  const posDb = async (mapId, id) => { const n = E.uzel(await db(mapId), id); return n ? n.position : null; };
  const fmt = (p) => (p ? `${Math.round(p.x)},${Math.round(p.y)}` : '(none)');
  const near = (a, b, tol = 1) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
  const far = (a, b, min = 40) => !!a && !!b && (Math.abs(a.x - b.x) >= min || Math.abs(a.y - b.y) >= min);
  const posCanvas = (id) => page.evaluate((i) => { const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec((document.querySelector(`.react-flow__node[data-id="${i}"]`) || { style: {} }).style.transform || ''); return m ? { x: Number(m[1]), y: Number(m[2]) } : null; }, id);
  const titleCanvas = (id) => page.evaluate((i) => ((document.querySelector(`.react-flow__node[data-id="${i}"] h3`) || {}).innerText || '').trim(), id);
  // where to grab a node: its title (not a button)
  const grip = (id) => page.evaluate((i) => { const el = document.querySelector(`.react-flow__node[data-id="${i}"] h3`) || document.querySelector(`.react-flow__node[data-id="${i}"]`); const r = el.getBoundingClientRect(); return { x: r.x + Math.min(20, r.width / 2), y: r.y + r.height / 2 }; }, id);
  const dragFrom = async (from, dx, dy) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) { await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10); await sleep(25); }
    await page.mouse.up();
    await sleep(300);
  };
  const drag = async (id, dx, dy) => dragFrom(await grip(id), dx, dy);
  const ctrlZ = async () => { await page.keyboard.down('Control'); await page.keyboard.press('KeyZ'); await page.keyboard.up('Control'); };
  const clickPane = async () => { await page.mouse.click(40, 500); await sleep(200); };
  const waitDb = (fn, what) => E.cekej(fn, 10000, what);
  const rename = async (id, title, description) => {
    if (!(await S.otevriDialog(id))) return false;
    await page.click('[role="dialog"] #title', { clickCount: 3 });
    await page.keyboard.type(title);
    if (description) {
      const ta = await page.$('[role="dialog"] textarea');
      if (ta) { await ta.click(); await page.keyboard.type(description); }
    }
    return S.klikText('Uložit', '[role="dialog"]');
  };

  console.log('== a click on a node is not a step ==');
  const A = await E.zalozMapu(inst, S.token, 'Undo drag');
  await S.otevriMapu(A.id);
  const k1Start = await posDb(A.id, 'k1'); const k2Start = await posDb(A.id, 'k2');
  const g = await grip('k1');
  await page.mouse.click(g.x, g.y);
  await sleep(400);
  await clickPane();
  expect((await S.zpetAktivni()) === false, 'a plain click on a node leaves Undo greyed out');

  console.log('== edit a node, drag the same node, Ctrl+Z → only the position goes back ==');
  expect(await rename('k1', 'Krok jedna PŘEPSÁN', 'Popis, o který nesmím přijít.'), 'k1 renamed and described in the dialog, saved');
  expect(await waitDb(async () => E.nazev(await db(A.id), 'k1') === 'Krok jedna PŘEPSÁN', 'title in DB'), 'the new title of k1 is in the database');
  const descBefore = String(((E.uzel(await db(A.id), 'k1') || {}).data || {}).description || '');
  expect(descBefore.length > 0, `the description of k1 is in the database ("${descBefore.slice(0, 40)}")`);
  // a change that never enters the history (a click on the status badge), made between the step
  // and the drag: neither Undo below may take it back (the step is closed when it happens, not
  // when the next drag or step starts)
  expect(await S.klikStav('k2'), 'status of k2 → Probíhá by a click (outside the history)');
  expect(await waitDb(async () => E.stav(await db(A.id), 'k2') === 'in_progress', 'status in DB'), 'the status of k2 is in the database');
  await drag('k1', 200, 60);
  expect(await waitDb(async () => far(await posDb(A.id, 'k1'), k1Start), 'moved in DB'), `the drag is saved (k1 ${fmt(k1Start)} → ${fmt(await posDb(A.id, 'k1'))})`);
  await clickPane();
  await ctrlZ();
  expect(await waitDb(async () => near(await posDb(A.id, 'k1'), k1Start), 'position back in DB'), `Ctrl+Z put k1 back where it was (${fmt(await posDb(A.id, 'k1'))}, expected ${fmt(k1Start)})`);
  await sleep(1500);
  let m = await db(A.id);
  expect(E.nazev(m, 'k1') === 'Krok jedna PŘEPSÁN', `the title saved before the drag stayed ("${E.nazev(m, 'k1')}")`);
  expect(String(((E.uzel(m, 'k1') || {}).data || {}).description || '') === descBefore, 'the description saved before the drag stayed');
  expect((await titleCanvas('k1')) === 'Krok jedna PŘEPSÁN', `the canvas shows the new title too ("${await titleCanvas('k1')}")`);
  expect(near(await posCanvas('k1'), k1Start), `the canvas shows k1 at its old place (${fmt(await posCanvas('k1'))})`);
  expect((await S.zpetAktivni()) === true, 'Undo stays active — the edit from the dialog is still in the history');

  console.log('== drag ANOTHER node, the Undo button → that node goes back, the edited one keeps its texts ==');
  await drag('k2', -120, 90);
  expect(await waitDb(async () => far(await posDb(A.id, 'k2'), k2Start), 'k2 moved in DB'), `the drag of k2 is saved (${fmt(await posDb(A.id, 'k2'))})`);
  expect(await S.klikTitulek('Vrátit zpět'), 'click on "Vrátit zpět"');
  expect(await waitDb(async () => near(await posDb(A.id, 'k2'), k2Start), 'k2 back in DB'), `Undo put k2 back (${fmt(await posDb(A.id, 'k2'))}, expected ${fmt(k2Start)})`);
  await sleep(1500);
  m = await db(A.id);
  expect(E.nazev(m, 'k1') === 'Krok jedna PŘEPSÁN' && String(((E.uzel(m, 'k1') || {}).data || {}).description || '') === descBefore, `k1 kept its title and description ("${E.nazev(m, 'k1')}")`);
  expect(near(await posDb(A.id, 'k1'), k1Start), 'k1 did not move');

  console.log('== the history keeps its order: the next Undo takes back the edit from the dialog ==');
  await clickPane();
  await ctrlZ();
  expect(await waitDb(async () => E.nazev(await db(A.id), 'k1') === 'Krok jedna', 'title back'), `the second Undo returned the old title of k1 ("${E.nazev(await db(A.id), 'k1')}")`);
  expect((await S.zpetAktivni()) === false, 'the history is empty now');
  await sleep(1500);
  expect(E.stav(await db(A.id), 'k2') === 'in_progress', `the status clicked between the step and the drags stayed through all three Undos (${E.stav(await db(A.id), 'k2')})`);

  console.log('== two drags of one node are two steps ==');
  await drag('k1', 100, 0);
  const k1Mid = await posCanvas('k1');
  await drag('k1', 0, 120);
  expect(await waitDb(async () => far(await posDb(A.id, 'k1'), k1Mid, 30), 'second drag in DB'), 'both drags are saved');
  await clickPane();
  await ctrlZ();
  expect(await waitDb(async () => near(await posDb(A.id, 'k1'), k1Mid), 'first drag kept'), `the first Ctrl+Z returned k1 to where the first drag left it (${fmt(await posDb(A.id, 'k1'))}, expected ${fmt(k1Mid)})`);
  await ctrlZ();
  expect(await waitDb(async () => near(await posDb(A.id, 'k1'), k1Start), 'start'), `the second Ctrl+Z returned k1 to the start (${fmt(await posDb(A.id, 'k1'))})`);

  console.log('== several selected nodes dragged at once = one step ==');
  const B = await E.zalozMapu(inst, S.token, 'Undo drag selection');
  await S.otevriMapu(B.id);
  expect(await rename('k1', 'Krok jedna PŘED TAHEM'), 'k1 renamed in the dialog (a step before the drag)');
  expect(await waitDb(async () => E.nazev(await db(B.id), 'k1') === 'Krok jedna PŘED TAHEM', 'title in DB'), 'the new title of k1 is in the database');
  let g1 = await grip('k1'); let g2 = await grip('k2');
  await page.mouse.click(g1.x, g1.y);
  await page.keyboard.down('Control'); await page.mouse.click(g2.x, g2.y); await page.keyboard.up('Control');
  await sleep(300);
  const selected = await page.evaluate(() => [...document.querySelectorAll('.react-flow__node.selected')].map((n) => n.getAttribute('data-id')).sort().join(','));
  expect(selected === 'k1,k2', `both nodes are selected (${selected})`);
  await drag('k2', 80, 140);
  expect(await waitDb(async () => far(await posDb(B.id, 'k1'), k1Start) && far(await posDb(B.id, 'k2'), k2Start), 'both moved'), `both selected nodes moved (k1 ${fmt(await posDb(B.id, 'k1'))}, k2 ${fmt(await posDb(B.id, 'k2'))})`);
  await clickPane();
  await ctrlZ();
  expect(await waitDb(async () => near(await posDb(B.id, 'k1'), k1Start) && near(await posDb(B.id, 'k2'), k2Start), 'both back'), `one Ctrl+Z put both back (k1 ${fmt(await posDb(B.id, 'k1'))}, k2 ${fmt(await posDb(B.id, 'k2'))})`);
  await sleep(1500);
  expect(E.nazev(await db(B.id), 'k1') === 'Krok jedna PŘED TAHEM', `the title saved before the drag stayed ("${E.nazev(await db(B.id), 'k1')}")`);

  console.log('== the frame around a selection (Shift + drag over the canvas) dragged as a whole ==');
  const r1 = await page.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="k1"]').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
  const r2 = await page.evaluate(() => { const r = document.querySelector('.react-flow__node[data-id="k2"]').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; });
  await page.keyboard.down('Shift');
  await page.mouse.move(r1.x - 30, Math.min(r1.y, r2.y) - 30);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(r1.x - 30 + ((r2.r + 60 - r1.x) * i) / 8, Math.min(r1.y, r2.y) - 30 + ((Math.max(r1.b, r2.b) + 60 - Math.min(r1.y, r2.y)) * i) / 8); await sleep(25); }
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await sleep(400);
  const frame = await page.evaluate(() => { const el = document.querySelector('.react-flow__nodesselection-rect'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + 8 }; });
  expect(!!frame, 'the selection frame is on the canvas');
  if (frame) {
    await dragFrom(frame, -90, 110);
    expect(await waitDb(async () => far(await posDb(B.id, 'k1'), k1Start) && far(await posDb(B.id, 'k2'), k2Start), 'both moved by the frame'), `the frame moved both nodes (k1 ${fmt(await posDb(B.id, 'k1'))}, k2 ${fmt(await posDb(B.id, 'k2'))})`);
    await clickPane();
    await ctrlZ();
    expect(await waitDb(async () => near(await posDb(B.id, 'k1'), k1Start) && near(await posDb(B.id, 'k2'), k2Start), 'both back'), `one Ctrl+Z put both back (k1 ${fmt(await posDb(B.id, 'k1'))}, k2 ${fmt(await posDb(B.id, 'k2'))})`);
    await sleep(1500);
    expect(E.nazev(await db(B.id), 'k1') === 'Krok jedna PŘED TAHEM', `the title saved before the drag stayed ("${E.nazev(await db(B.id), 'k1')}")`);
  }

  console.log('== horizontal view: Undo puts back the SAVED (canonical) position as well ==');
  const C = await E.zalozMapu(inst, S.token, 'Undo drag horizontal');
  await S.otevriMapu(C.id);
  expect(await rename('k2', 'Krok dva PŘEPSÁN'), 'k2 renamed in the dialog (a step before the drag)');
  expect(await waitDb(async () => E.nazev(await db(C.id), 'k2') === 'Krok dva PŘEPSÁN', 'title in DB'), 'the new title of k2 is in the database');
  const dirBtn = await page.$('[data-dir="horizontal"]');
  expect(!!dirBtn, 'the direction switch is in the toolbar');
  if (dirBtn) await dirBtn.click();
  await sleep(1500);
  const top = await page.evaluate(() => document.querySelector('.react-flow__node[data-id="root"]').getBoundingClientRect().x);
  const kid = await page.evaluate(() => document.querySelector('.react-flow__node[data-id="k1"]').getBoundingClientRect().x);
  expect(kid > top + 50, `the tree is drawn left to right now (top x=${Math.round(top)}, k1 x=${Math.round(kid)})`);
  await sleep(1500);
  const savedBefore = await posDb(C.id, 'k1');
  expect(near(savedBefore, k1Start), `switching the view saved nothing (k1 ${fmt(savedBefore)})`);
  const shownBefore = await posCanvas('k1');
  await drag('k1', 90, 130);
  expect(await waitDb(async () => far(await posDb(C.id, 'k1'), k1Start), 'moved in DB'), `the drag in the horizontal view is saved into the canonical position (k1 ${fmt(await posDb(C.id, 'k1'))})`);
  await clickPane();
  await ctrlZ();
  expect(await waitDb(async () => near(await posDb(C.id, 'k1'), k1Start), 'canonical back'), `Ctrl+Z returned the saved position (k1 ${fmt(await posDb(C.id, 'k1'))}, expected ${fmt(k1Start)})`);
  expect(near(await posCanvas('k1'), shownBefore), `and the node on the canvas (${fmt(await posCanvas('k1'))}, expected ${fmt(shownBefore)})`);
  await sleep(1500);
  expect(E.nazev(await db(C.id), 'k2') === 'Krok dva PŘEPSÁN', `the title of k2 saved before the drag stayed ("${E.nazev(await db(C.id), 'k2')}")`);
  expect(near(await posDb(C.id, 'k2'), k2Start), 'k2 did not move');

  const real = chyby.filter((c) => !/favicon|ResizeObserver/.test(c));
  expect(real.length === 0, `the console is clean (${real.slice(0, 2).join(' | ').slice(0, 200) || 'no errors'})`);
}, { nazev: 'UI-UNDO-DRAG' });
