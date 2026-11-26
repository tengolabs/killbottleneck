// Unit: deadlines of a template saved from a map (frontend/src/lib/templateConvert.js; whole-app analysis 5, c13-1).
// No docker, no browser. A template made of a running or finished project used to store every deadline that had
// already passed as "0 days" (27 of 39 on the reference project), so a new project had dozens of steps due on its
// first day. Guarded here: the spacing of the source project survives the round trip map → template → map, and a
// fresh project (all deadlines ahead) is converted exactly as before.
const path = require('path');
const { pathToFileURL } = require('url');
const { register } = require('node:module');

let pass = 0; let fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

const TODAY = new Date(2026, 10, 20); // 20 Nov 2026, local time
const day = (offset) => {
  const d = new Date(TODAY); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const node = (id, deadline, extra = {}) => ({ id, type: 'goalNode', position: { x: 0, y: 0 }, data: { title: id, status: 'todo', deadline, ...extra } });
const apex = { id: 'apex', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: 'Project', title: 'Project' } };
const edgesOf = (nodes) => nodes.filter((n) => n.id !== 'apex').map((n) => ({ id: 'e-' + n.id, source: 'apex', target: n.id }));
const offsets = (r) => Object.fromEntries(r.ai_nodes.map((n) => [n.title, n.deadline_offset_days]));

(async () => {
  try {
    register(pathToFileURL(path.join(__dirname, '_alias-loader.mjs')));
    const { mapToTemplateNodes, templateToMap } = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/templateConvert.js')).href);

    console.log('== a running project: deadlines from 47 days ago to 19 days ahead ==');
    {
      const src = [-47, -40, -33, -20, -5, -1, 0, 3, 12, 19];
      const nodes = [apex, ...src.map((o, i) => node('step' + i, day(o)))];
      const r = mapToTemplateNodes(nodes, edgesOf(nodes), { today: TODAY });
      const got = src.map((_, i) => offsets(r)['step' + i]);
      ok(got.filter((x) => x === 0).length === 1, `only the earliest step is due on the start day (zeros: ${got.filter((x) => x === 0).length} of ${got.length})`);
      ok(JSON.stringify(got) === JSON.stringify(src.map((o) => o + 47)), `offsets keep the spacing of the source project (${got.join(', ')})`);
      ok(offsets(r).Project === null, 'a step without a deadline stays without one');
      // round trip: a project started today has the same gaps between steps as the source
      const start = new Date(2027, 0, 4);
      const map = templateToMap({ title: 'T', ai_nodes: r.ai_nodes }, { startDate: start });
      const dl = (title) => map.nodes.find((n) => n.data.title === title).data.deadline;
      const gap = (a, b) => Math.round((new Date(dl(b) + 'T00:00:00') - new Date(dl(a) + 'T00:00:00')) / 86400000);
      ok(dl('step0') === '2027-01-04' && gap('step0', 'step5') === 46 && gap('step5', 'step9') === 20, `new project: first step on the start day, gaps 46 and 20 days (${dl('step0')}, ${dl('step5')}, ${dl('step9')})`);
      ok(new Set(src.map((_, i) => dl('step' + i))).size === src.length, 'ten different deadlines in the source → ten different deadlines in the new project');
    }

    console.log('== a finished project: every deadline has passed ==');
    {
      const nodes = [apex, node('a', day(-90)), node('b', day(-60)), node('c', day(-30))];
      const o = offsets(mapToTemplateNodes(nodes, edgesOf(nodes), { today: TODAY }));
      ok(o.a === 0 && o.b === 30 && o.c === 60, `offsets 0 / 30 / 60 (${o.a} / ${o.b} / ${o.c})`);
    }

    console.log('== a fresh project: nothing has passed → counted from today, as before ==');
    {
      const nodes = [apex, node('a', day(0)), node('b', day(5)), node('c', day(21))];
      const o = offsets(mapToTemplateNodes(nodes, edgesOf(nodes), { today: TODAY }));
      ok(o.a === 0 && o.b === 5 && o.c === 21, `offsets 0 / 5 / 21 (${o.a} / ${o.b} / ${o.c})`);
      const later = [apex, node('a', day(7)), node('b', day(14))];
      const o2 = offsets(mapToTemplateNodes(later, edgesOf(later), { today: TODAY }));
      ok(o2.a === 7 && o2.b === 14, `first deadline in a week stays a week from the start (${o2.a} / ${o2.b})`);
    }

    console.log('== odd data ==');
    {
      const nodes = [apex, node('a', 'not-a-date'), node('b', day(-3)), node('c', day(2)), { id: 'note', type: 'note', position: { x: 0, y: 0 }, data: { deadline: day(-400) } }];
      const o = offsets(mapToTemplateNodes(nodes, edgesOf(nodes), { today: TODAY }));
      ok(o.a === null, 'an unreadable deadline is stored as "no deadline", not as a number');
      ok(o.b === 0 && o.c === 5, `a note is not a step — its date does not move the start (${o.b} / ${o.c})`);
      const def = mapToTemplateNodes([apex, node('x', '2020-01-01')], [{ id: 'e', source: 'apex', target: 'x' }]);
      ok(offsets(def).x === 0, 'without an explicit "today" the real one is used');
    }
  } catch (err) {
    fail++; console.log('  ❌ exception:', String(err && err.stack || err).slice(0, 400));
  }
  console.log(`\n${fail ? '🔴' : '🟢'} TEMPLATE-DEADLINE-OFFSETS PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
