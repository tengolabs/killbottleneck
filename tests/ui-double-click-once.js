// UI e2e: a double click (or an impatient second tap) does ONE thing (whole-app analysis 5, x2-1).
// Five places had no "in flight" lock and did the thing twice:
//   1) Tasks › "+" in a row                      → two sub-goals
//   2) Tasks › step window › "Odložit do zásobníku" → the same idea twice in the buffer
//   3) stopwatch on a slow connection            → two time entries (nothing on the screen changes while waiting)
//   5) map editor › step window › "Odložit do zásobníku", and the icon on the node (one confirmation answers both
//      clicks of a double click) → the same idea twice in the buffer
//   4) lite › ✓ tapped twice                     → the second tap ticked ANOTHER task: the ticked row left the
//      list and the next one slid under the finger (200–400 ms later; 80 ms was swallowed by the row itself)
// Counted in the database, with real mouse clicks / touch taps at the same coordinates.
const H = require('./_harness');
const { expect, sleep } = H;

const USER = 'dvojklik@e2e.cz';
const today = () => new Date().toLocaleDateString('en-CA');

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'double-click', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(USER);
  const T = await inst.login(USER);
  const step = (id, title, extra = {}) => ({ id, type: 'goalNode', position: { x: 0, y: 380 }, data: { title, status: 'todo', owner: USER, ...extra } });
  const makeMap = async (title, steps) => (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
    title,
    nodes: [{ id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title, status: 'todo' } }].concat(steps),
    edges: steps.map((s) => ({ id: 'e-' + s.id, source: 'apex', target: s.id })),
  } })).json;
  const map = await makeMap('Audit', [step('n1', 'Audit stage one', { deadline: '2030-01-10' })]);
  expect(!!map.id, 'project with one step created');
  const nodesOf = async (id) => (await inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: T })).json.nodes || [];
  const count = async (collection) => (await inst.api('GET', `/api/collections/${collection}/records?perPage=1`, { token: T })).json.totalItems;

  const signIn = async (page) => {
    await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#email');
    await page.type('#email', USER);
    await page.type('#password', H.PW);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
    await sleep(1000);
  };
  const centre = async (page, handle) => { const b = await handle.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const clickTwice = async (page, at, gap) => { await page.mouse.click(at.x, at.y); await sleep(gap); await page.mouse.click(at.x, at.y); };
  // a real double click: the second press follows at once, as the mouse does it (click, click, dblclick)
  const doubleClick = async (page, at) => {
    await page.mouse.move(at.x, at.y);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
  };

  const { page, chyby } = await H.browser({ viewport: { width: 1440, height: 900 } });
  await signIn(page);

  console.log('== 1) Tasks › "+" in the row, double click ==');
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('button[title="Přidat podcíl"]', { timeout: 15000 });
  let before = (await nodesOf(map.id)).length;
  await doubleClick(page, await centre(page, await page.$('button[title="Přidat podcíl"]')));
  await sleep(2500);
  let after = (await nodesOf(map.id)).length;
  expect(after === before + 1, `one sub-goal added (steps ${before} → ${after})`);

  console.log('== 2) step window › "Odložit do zásobníku", double click ==');
  const stash = await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Odložit do zásobníku/.test(b.innerText || '')) || null);
  expect(!!stash.asElement(), 'the window of the new sub-goal offers "Odložit do zásobníku"');
  if (stash.asElement()) {
    before = await count('buffer_nodes');
    await doubleClick(page, await centre(page, stash.asElement()));
    await sleep(2500);
    after = await count('buffer_nodes');
    expect(after === before + 1, `one idea in the buffer (${before} → ${after})`);
    expect((await nodesOf(map.id)).length === 2, 'and the sub-goal left the map once (apex + the original step remain)');
  }

  console.log('== 3) stopwatch on a slow connection: second click 0.4 s after the first ==');
  await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('button[title="Spustit měření času"]', { timeout: 15000 });
  await page.setRequestInterception(true);
  const slow = (req) => {
    if (req.method() === 'POST' && /\/time_entries\/records/.test(req.url())) setTimeout(() => req.continue().catch(() => {}), 2000);
    else req.continue().catch(() => {});
  };
  page.on('request', slow);
  before = await count('time_entries');
  await clickTwice(page, await centre(page, await page.$('button[title="Spustit měření času"]')), 400);
  await sleep(4500);
  after = await count('time_entries');
  expect(after === before + 1, `one time entry (${before} → ${after})`);
  const running = (await inst.api('GET', '/api/collections/time_entries/records?filter=' + encodeURIComponent("ended=''"), { token: T })).json.totalItems;
  expect(running === 1, `and it is running (${running})`);
  page.off('request', slow);
  await page.setRequestInterception(false);
  expect(chyby.length === 0, `console without errors (${chyby.slice(0, 2).join(' | ')})`);

  console.log('== 4) lite on a phone: two taps on ✓, the second where the next row slides in ==');
  const lite = await makeMap('Today', ['a', 'b', 'c', 'd'].map((x) => step('t' + x, 'Today task ' + x.toUpperCase(), { deadline: today() })));
  const doneIn = async () => (await nodesOf(lite.id)).filter((n) => (n.data || {}).status === 'done').length;
  const phone = await H.browser({ mobil: true });
  await signIn(phone.page);
  for (const gap of [200, 400, 1500]) {
    await phone.page.goto(`${inst.base}/lite`, { waitUntil: 'networkidle2' });
    await phone.page.waitForSelector('button[aria-label="Hotovo"]', { timeout: 15000 });
    await sleep(900); // longer than the settle time of the previous round
    const first = await phone.page.$('button[aria-label="Hotovo"]');
    const at = await centre(phone.page, first);
    before = await doneIn();
    await phone.page.touchscreen.tap(at.x, at.y);
    await sleep(gap);
    // the same place on the glass — after the reload another task's ✓ lies there
    const under = await phone.page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !!(el && el.closest('button[aria-label="Hotovo"]')); }, at);
    await phone.page.touchscreen.tap(at.x, at.y);
    await sleep(2000);
    after = await doneIn();
    if (gap < 1000) expect(after === before + 1, `gap ${gap} ms: one task ticked (${before} → ${after}; another ✓ under the finger: ${under})`);
    else expect(after === before + 2, `gap ${gap} ms (a deliberate second tap after the settle time): two tasks ticked (${before} → ${after})`);
  }
  expect(phone.chyby.length === 0, `phone: console without errors (${phone.chyby.slice(0, 2).join(' | ')})`);

  console.log('== 5) map editor: "Odložit do zásobníku" in the step window and on the node, double click ==');
  const ed = await makeMap('Editor', [
    Object.assign(step('e1', 'Editor step one'), { position: { x: 0, y: 300 } }),
    Object.assign(step('e2', 'Editor step two'), { position: { x: 420, y: 300 } }),
  ]);
  const errorsBefore = chyby.length;
  await page.goto(`${inst.base}/map/${ed.id}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.react-flow__node[data-id="e2"]', { timeout: 15000 });
  await sleep(1500);
  const onNode = async (id, title) => {
    await page.hover(`.react-flow__node[data-id="${id}"]`);
    await sleep(300);
    return page.$(`.react-flow__node[data-id="${id}"] button[title="${title}"]`);
  };
  const ideas = async (title) => (await inst.api('GET', '/api/collections/buffer_nodes/records?filter=' + encodeURIComponent(`title='${title}'`), { token: T })).json.totalItems;
  // a) the step window opened from the map
  const pencil = await onNode('e1', 'Upravit');
  expect(!!pencil, 'the node offers "Upravit"');
  if (pencil) {
    await pencil.click();
    await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
    await sleep(600);
    const stashEd = await page.evaluateHandle(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Odložit do zásobníku/.test(b.innerText || '')) || null);
    expect(!!stashEd.asElement(), 'the step window of the editor offers "Odložit do zásobníku"');
    if (stashEd.asElement()) {
      await doubleClick(page, await centre(page, stashEd.asElement()));
      await sleep(2500);
      const n = await ideas('Editor step one');
      expect(n === 1, `step window of the editor: one idea in the buffer (${n})`);
      expect(!(await page.$('.react-flow__node[data-id="e1"]')), 'and the step left the map');
    }
  }
  // b) the icon on the node: a double click asks once, the single answer reaches both clicks
  const icon = await onNode('e2', 'Odložit do zásobníku');
  expect(!!icon, 'the node offers the icon "Odložit do zásobníku"');
  if (icon) {
    await doubleClick(page, await centre(page, icon));
    await page.waitForSelector('[role="alertdialog"], [role="dialog"]', { timeout: 8000 });
    await sleep(500);
    const yes = await page.evaluateHandle(() => [...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find((b) => (b.innerText || '').trim() === 'Potvrdit') || null);
    expect(!!yes.asElement(), 'the confirmation offers "Potvrdit"');
    if (yes.asElement()) {
      await doubleClick(page, await centre(page, yes.asElement()));
      await sleep(2500);
      const n = await ideas('Editor step two');
      expect(n === 1, `icon on the node: one idea in the buffer (${n})`);
      expect(!(await page.$('.react-flow__node[data-id="e2"]')), 'and the step left the map');
    }
  }
  await sleep(2000); // autosave
  const left = (await nodesOf(ed.id)).map((n) => n.id).join(',');
  expect(left === 'apex', `the saved map keeps only the apex (${left})`);
  expect(chyby.length === errorsBefore, `editor: console without errors (${chyby.slice(errorsBefore, errorsBefore + 2).join(' | ')})`);
}, { nazev: 'UI-DOUBLE-CLICK-ONCE' });
