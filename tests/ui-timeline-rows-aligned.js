// UI e2e: on the timeline of Tasks every bar sits in the row of its own name (whole-app analysis 5, c8-1).
// The left panel is a column flexbox with its own scrolling; its sticky header had no `shrink-0`, so as soon as
// the list was taller than the axis the header was squeezed from 70 px to the height of its text (17 px) and
// every bar on the right lay 54 px — a row and a half — below its name. A short list was fine, which is why the
// older timeline suite (5 rows) never saw it. Here: 24 steps (the list overflows) and 3 steps (it does not).
const H = require('./_harness');
const { expect, sleep } = H;

const USER = 'timeline@e2e.cz';
const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const mapBody = (title, count) => ({
  title,
  nodes: [{ id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title, status: 'todo' } }]
    .concat(Array.from({ length: count }, (_, i) => ({ id: `n${i + 1}`, type: 'goalNode', position: { x: i * 250, y: 380 }, data: { title: `Step ${String(i + 1).padStart(2, '0')}`, status: 'todo', deadline: day(2 + i), owner: USER } }))),
  edges: Array.from({ length: count }, (_, i) => ({ id: `e${i + 1}`, source: 'apex', target: `n${i + 1}` })),
});

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'timeline-rows', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register(USER);
  const T = await inst.login(USER);
  const big = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: mapBody('Long project', 24) })).json;
  expect(!!big.id, 'project with 24 dated steps created');

  const { page, chyby } = await H.browser({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${inst.base}/login`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#email');
  await page.type('#email', USER);
  await page.type('#password', H.PW);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await sleep(1000);

  const openTimeline = async () => {
    await page.goto(`${inst.base}/tasks`, { waitUntil: 'networkidle2' });
    await sleep(800);
    for (const h of await page.$$('[role="tab"]')) {
      if ((await page.evaluate((el) => (el.textContent || '').trim(), h)) === 'Časová osa') { await h.click(); break; }
    }
    await page.waitForSelector('[data-testid="osa-hlavicka-vlevo"]', { timeout: 10000 });
    await sleep(1000);
  };
  // top edge of every name row × top edge of the row its bar lies in
  const measure = () => page.evaluate(() => {
    const header = document.querySelector('[data-testid="osa-hlavicka-vlevo"]');
    const panel = header.parentElement;
    const rows = [...document.querySelectorAll('[data-testid^="osa-radek-"]')].map((row) => {
      const key = row.getAttribute('data-testid').slice('osa-radek-'.length);
      const bar = document.querySelector(`[data-testid="osa-pruh-${key}"]`);
      return { rowTop: Math.round(row.getBoundingClientRect().top), barRowTop: bar ? Math.round(bar.parentElement.getBoundingClientRect().top) : null };
    });
    return { headerHeight: Math.round(header.getBoundingClientRect().height), overflows: panel.scrollHeight > panel.clientHeight + 1, rows };
  });
  const report = (m) => {
    const deltas = [...new Set(m.rows.filter((r) => r.barRowTop !== null).map((r) => r.barRowTop - r.rowTop))];
    return { deltas, worst: deltas.reduce((a, d) => Math.max(a, Math.abs(d)), 0) };
  };

  console.log('== 24 steps: the list is taller than the axis ==');
  await openTimeline();
  let m = await measure();
  let r = report(m);
  expect(m.rows.length === 25 && m.rows.every((x) => x.barRowTop !== null), `25 name rows (the goal + 24 steps), each with its bar (${m.rows.length})`);
  expect(m.overflows, 'the list really overflows the axis (the condition of the defect)');
  expect(m.headerHeight === 70, `the header of the left panel keeps its 70 px (${m.headerHeight} px)`);
  expect(r.worst <= 2, `every bar is level with its name — difference ${JSON.stringify(r.deltas)} px (a row is 36 px)`);
  // scrolled: the two halves scroll together, the rows must stay level
  await page.evaluate(() => { document.querySelector('[data-testid="osa-hlavicka-vlevo"]').parentElement.scrollTop = 400; });
  await sleep(600);
  m = await measure(); r = report(m);
  expect(r.worst <= 2, `still level after scrolling the list by 400 px — difference ${JSON.stringify(r.deltas)} px`);

  console.log('== 3 steps: the list fits — as before ==');
  const all = (await inst.api('GET', `/api/collections/goalmaps/records/${big.id}`, { token: T })).json;
  const keep = new Set(['apex', 'n1', 'n2', 'n3']);
  const cut = await inst.api('PATCH', `/api/collections/goalmaps/records/${big.id}`, { token: T, body: {
    base_updated: all.updated, nodes: all.nodes.filter((n) => keep.has(n.id)), edges: all.edges.filter((e) => keep.has(e.target)) } });
  expect(cut.status === 200, `project cut down to 3 steps (${cut.status})`);
  await openTimeline();
  m = await measure(); r = report(m);
  expect(m.rows.length === 4 && !m.overflows && m.headerHeight === 70 && r.worst <= 2, `${m.rows.length} rows (the goal + 3 steps), no overflow, header ${m.headerHeight} px, difference ${JSON.stringify(r.deltas)} px`);
  expect(chyby.length === 0, `console without errors (${chyby.slice(0, 2).join(' | ')})`);
}, { nazev: 'UI-TIMELINE-ROWS-ALIGNED' });
