// Unit: undo of ONE step of the map editor (frontend/src/lib/undoStep.js; code analysis 4, F1-02).
// No docker, no browser. What is guarded above all: undo takes back ONLY what the step did and
// never overwrites what happened later — when it cannot, it refuses and changes nothing.
const path = require('path');
const { pathToFileURL } = require('url');
const { register } = require('node:module');

let pass = 0; let fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));
const n = (id, title, status = 'todo', x = 0, y = 0, extra = {}) => ({ id, type: 'goalNode', position: { x, y }, data: { title, status, ...extra } });
const e = (id, source, target) => ({ id, source, target });
const m = (nodes, edges) => ({ nodes, edges });
const get = (r, id) => (r.nodes || []).find((x) => x.id === id);

(async () => {
  try {
    register(pathToFileURL(path.join(__dirname, '_alias-loader.mjs')));
    const { revertStep } = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/undoStep.js')).href);
    const base = () => [n('root', 'Cíl'), n('a', 'Alfa', 'todo', 0, 100), n('b', 'Beta', 'todo', 200, 100)];
    const edges = () => [e('e1', 'root', 'a'), e('e2', 'root', 'b')];

    console.log('== added node: only the node goes, later changes stay ==');
    {
      const before = m(base(), edges());
      const after = m([...base(), n('c', 'Nový podcíl', 'todo', 0, 200)], [...edges(), e('e3', 'a', 'c')]);
      // later: own status + rename of b, a colleague's tick on a (merged from the server)
      const cur = m([n('root', 'Cíl'), n('a', 'Alfa', 'done', 0, 100), n('b', 'Beta PŘEPSÁNA', 'in_progress', 200, 100), n('c', 'Nový podcíl', 'todo', 0, 200)], after.edges);
      const r = revertStep(before, after, cur);
      ok(r.ok && !get(r, 'c') && r.edges.length === 2, 'the added sub-goal and its connection are gone');
      ok(r.ok && get(r, 'a').data.status === 'done', "a colleague's tick stays");
      ok(r.ok && get(r, 'b').data.title === 'Beta PŘEPSÁNA' && get(r, 'b').data.status === 'in_progress', 'own later rename and status stay');
      ok(r.ok && get(r, 'a') === cur.nodes[1], 'untouched nodes keep their object (no re-render)');
      const r2 = revertStep(before, after, cur, { foreignTouched: (id) => id === 'c' });
      ok(!r2.ok && r2.reason === 'changed' && r2.title === 'Nový podcíl', 'added node changed by somebody else → refused');
      const r3 = revertStep(before, after, cur, { canRemove: (x) => x.id !== 'c' });
      ok(!r3.ok && r3.reason === 'protected', "added node that is now somebody else's assigned task → refused");
      const r4 = revertStep(before, after, m([...cur.nodes, n('d', 'Pod-podcíl')], [...cur.edges, e('e4', 'c', 'd')]));
      ok(!r4.ok && r4.reason === 'linked', 'added node that got its own sub-goal → refused');
      const r5 = revertStep(before, after, m(cur.nodes.filter((x) => x.id !== 'c'), edges()));
      ok(r5.ok && r5.nodes.length === 3 && r5.edges.length === 2, 'added node already gone → nothing to do, nothing else touched');
    }

    console.log('== removed node: comes back with its connections ==');
    {
      const before = m(base(), edges());
      const after = m(base().filter((x) => x.id !== 'b'), [e('e1', 'root', 'a')]);
      const cur = m([n('root', 'Cíl'), n('a', 'Alfa', 'in_progress', 0, 100), n('x', 'Přibyl později')], [e('e1', 'root', 'a'), e('e9', 'a', 'x')]);
      const r = revertStep(before, after, cur);
      ok(r.ok && get(r, 'b') && r.edges.some((x) => x.id === 'e2'), 'the removed node and its connection are back');
      ok(r.ok && get(r, 'x') && get(r, 'a').data.status === 'in_progress' && r.edges.some((x) => x.id === 'e9'), 'what happened since stays');
      const r2 = revertStep(before, after, m(cur.nodes.filter((x) => x.id !== 'root'), [e('e9', 'a', 'x')]));
      ok(!r2.ok && r2.reason === 'gone', 'the parent is gone meanwhile → refused');
    }

    console.log('== changed fields (bulk edit): field by field ==');
    {
      const before = m(base(), edges());
      const after = m([n('root', 'Cíl'), n('a', 'Alfa', 'todo', 0, 100, { owner: 'x@e.cz' }), n('b', 'Beta', 'todo', 200, 100, { owner: 'x@e.cz' })], edges());
      const cur = m([n('root', 'Cíl'), n('a', 'Alfa JINAK', 'done', 0, 100, { owner: 'x@e.cz' }), n('b', 'Beta', 'todo', 200, 100, { owner: 'x@e.cz' })], edges());
      const r = revertStep(before, after, cur);
      ok(r.ok && !get(r, 'a').data.owner && !get(r, 'b').data.owner, 'the field set by the step is taken back');
      ok(r.ok && get(r, 'a').data.title === 'Alfa JINAK' && get(r, 'a').data.status === 'done', 'other fields of the same node, changed later, stay');
      const cur2 = m([n('root', 'Cíl'), n('a', 'Alfa', 'todo', 0, 100, { owner: 'y@e.cz' }), n('b', 'Beta', 'todo', 200, 100, { owner: 'x@e.cz' })], edges());
      const r2 = revertStep(before, after, cur2);
      ok(!r2.ok && r2.reason === 'changed' && r2.title === 'Alfa', 'the very field changed again since → refused, nothing written');
      const r3 = revertStep(before, after, m(cur.nodes.filter((x) => x.id !== 'b'), [e('e1', 'root', 'a')]));
      ok(!r3.ok && r3.reason === 'gone', 'a node of the step deleted meanwhile → refused');
    }

    console.log('== positions (Align): a node moved since keeps its place ==');
    {
      const before = m(base(), edges());
      const after = m([n('root', 'Cíl', 'todo', 50, 0), n('a', 'Alfa', 'todo', 10, 150), n('b', 'Beta', 'todo', 300, 150)], edges());
      const cur = m([n('root', 'Cíl', 'todo', 50, 0), n('a', 'Alfa', 'todo', 10, 150), n('b', 'Beta', 'done', 777, 888)], edges());
      const r = revertStep(before, after, cur);
      ok(r.ok && get(r, 'a').position.y === 100 && get(r, 'root').position.x === 0, 'aligned nodes go back');
      ok(r.ok && get(r, 'b').position.x === 777 && get(r, 'b').data.status === 'done', 'the node dragged since stays where it is, with its later status');
    }

    console.log('== connections ==');
    {
      const before = m(base(), edges());
      const after = m(base(), [e('e1', 'root', 'a')]); // b detached
      const r = revertStep(before, after, m(base(), [e('e1', 'root', 'a')]));
      ok(r.ok && r.edges.length === 2, 'a removed connection comes back');
      const r2 = revertStep(before, after, m(base(), [e('e1', 'root', 'a'), e('e7', 'a', 'b')]));
      ok(!r2.ok && r2.reason === 'structure', 'the node has another parent meanwhile → refused (the map stays a tree)');
      // "Repair tree" on an older damaged map (b had two parents): undo puts the map back as it was
      const damaged = m(base(), [...edges(), e('e8', 'a', 'b')]);
      const rr = revertStep(damaged, m(base(), edges()), m(base(), edges()));
      ok(rr.ok && rr.edges.length === 3, 'undo of "Repair tree" returns the connection the repair removed (as before the fix)');
      const r3 = revertStep(m(base(), [e('e1', 'root', 'a')]), before, m(base(), edges()));
      ok(r3.ok && r3.edges.length === 1 && r3.nodes.length === 3, 'an added connection goes away, the nodes stay');
    }
  } catch (err) { fail++; console.log('  ❌ výjimka: ' + String(err && err.stack || err).slice(0, 400)); }
  console.log(`\n${fail ? '🔴' : '🟢'} UNDO-KROK PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
