// Undo of ONE step of the map editor (code analysis 4, F1-02).
//
// A history step keeps the canvas right before the step (`before`) and right after it (`after`).
// Undo used to put `before` back as a whole — and with it threw away everything that happened
// later and never went into the history (a status change, texts saved from the node dialog, a
// colleague's tick merged in from the server). Here only the DIFFERENCE between `after` and
// `before` is taken back, on top of the canvas as it is NOW:
//   · a node the step added is removed, a node it removed comes back, a field / position it
//     changed returns to the value before — everything else on the canvas stays as it is;
//   · when the thing the step touched has changed since (the field has another value, the node is
//     gone, the added node was edited by someone else or got its own connections, the returned
//     connection would break the tree), the step is NOT undone and nothing is written — the
//     caller tells the person why. Never a silent overwrite.
// Positions are the one lenient case: a node moved since the step simply keeps where it is now
// (Align → drag one node → Undo puts the others back and leaves the dragged one).
//
// Pure function over raw canvas nodes/edges ({ id, position, data, … } / { id, source, target }).
import { stableJson } from '@/lib/mergeMap';
import { spojeniPovoleno } from '@/lib/mapStructure';

const same = (a, b) => stableJson({ v: a }) === stableJson({ v: b });
const index = (list) => new Map((list || []).map((x) => [x.id, x]));
const titleOf = (n) => String((n && n.data && (n.data.title || n.data.apexText)) || '');

// opts.canRemove(node)      → may this node be removed (same guard as the trash button)
// opts.foreignTouched(id)   → was the node changed from the server since the step was recorded
// Returns { ok: true, nodes, edges } or { ok: false, reason, title }
//   reason: 'changed' | 'gone' | 'linked' | 'protected' | 'structure'
export function revertStep(before, after, current, opts = {}) {
  const canRemove = opts.canRemove || (() => true);
  const foreignTouched = opts.foreignTouched || (() => false);
  const fail = (reason, node) => ({ ok: false, reason, title: titleOf(node) });

  const B = index(before.nodes); const A = index(after.nodes); const C = index(current.nodes);
  const removeIds = new Set();
  const replace = new Map();
  const restore = [];

  for (const [id, a] of A) {
    const b = B.get(id); const c = C.get(id);
    if (!b) {
      // added by the step → take it away again (unless it is gone already)
      if (!c) continue;
      if (foreignTouched(id)) return fail('changed', c);
      if (!canRemove(c)) return fail('protected', c);
      removeIds.add(id);
      continue;
    }
    const keys = [...new Set([...Object.keys(b.data || {}), ...Object.keys(a.data || {})])]
      .filter((k) => !same((b.data || {})[k], (a.data || {})[k]));
    const moved = !same(b.position, a.position);
    if (!keys.length && !moved) continue;
    if (!c) { if (keys.length) return fail('gone', b); continue; }
    let next = c;
    if (keys.length) {
      const data = { ...(c.data || {}) };
      for (const k of keys) {
        if (!same(data[k], (a.data || {})[k])) return fail('changed', c);
        data[k] = (b.data || {})[k];
      }
      next = { ...next, data };
    }
    if (moved && same(c.position, a.position)) next = { ...next, position: { ...b.position } };
    if (next !== c) replace.set(id, next);
  }
  for (const [id, b] of B) {
    if (A.has(id)) continue;
    // removed by the step → bring it back; the same id on the canvas again is somebody else's node
    if (C.has(id)) return fail('changed', C.get(id));
    restore.push(b);
  }

  const nodes = (current.nodes || []).filter((n) => !removeIds.has(n.id)).map((n) => replace.get(n.id) || n);
  for (const b of restore) {
    const at = Math.min((before.nodes || []).indexOf(b), nodes.length);
    nodes.splice(at < 0 ? nodes.length : at, 0, { ...b, selected: false });
  }
  const nodeIds = new Set(nodes.map((n) => n.id));

  const EB = index(before.edges); const EA = index(after.edges);
  // connections the step added go away…
  const edges = (current.edges || []).filter((e) => !(EA.has(e.id) && !EB.has(e.id)));
  // …and a node the step added must not have got any other connection since (own sub-goals)
  const linked = edges.find((e) => removeIds.has(e.source) || removeIds.has(e.target));
  if (linked) return fail('linked', C.get(removeIds.has(linked.source) ? linked.source : linked.target));
  // connections the step removed come back — only between nodes that exist and only as a tree
  for (const [id, e] of EB) {
    if (EA.has(id) || edges.some((x) => x.id === id)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return fail('gone', B.get(e.source) || B.get(e.target));
    // A connection that broke the tree already BEFORE the step (an older damaged map; the step was
    // "Repair tree") comes back as it was — undoing the repair is the person's call. Refused is
    // only a connection that was fine then and would break the tree now.
    const brokenBefore = spojeniPovoleno((before.edges || []).filter((x) => x.id !== id), { source: e.source, target: e.target });
    if (!brokenBefore && spojeniPovoleno(edges, { source: e.source, target: e.target })) return fail('structure', C.get(e.target) || B.get(e.target));
    const at = Math.min((before.edges || []).indexOf(e), edges.length);
    edges.splice(at < 0 ? edges.length : at, 0, { ...e });
  }

  return { ok: true, nodes, edges };
}
