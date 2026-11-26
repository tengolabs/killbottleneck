import { useState, useCallback, useRef, useEffect } from 'react';
import { revertStep } from '@/lib/undoStep';

// Undo in the map editor: a manual history (a stack of 50 steps → the Undo button).
// Extracted from GoalMapEditor.jsx (code analysis 27 Aug 2026, F1-07).
//
// A step = the canvas right BEFORE the action (taken by pushHistory from the latest-refs, not
// from a closure — F1-05) and right AFTER it (taken at the first render in which the canvas
// differs; pushHistory is called just before the action sets the state). Undo takes back only
// the difference between the two, over the canvas as it is NOW (lib/undoStep.js) — later changes
// that never entered the history and changes merged in from colleagues stay (code analysis 4,
// F1-02). A step that cannot be taken back safely is dropped and reported; nothing is written.
//
// `undoEnv` is filled by the editor on every render with what only exists further down:
//   canRemove(node)        — the guard of the trash button (somebody else's assigned task)
//   restoreBufferItem(it)  — put an idea back into the buffer (async); the step carries it in
//                            meta.bufferItem (F1-08: an idea inserted and undone was lost)
//   onRefused(result)      — tell the person why the step was not undone
//   onRestoreFailed()      — the idea could not be returned; the step stays in the history
//   restoreProjectColor(c) — a step saved from the dialog of the top node also set the PROJECT
//                            colour (meta.projectColor = { from, to }); it goes back only when the
//                            project still has the colour the step gave it
//   restoreCanon(list)     — a drag in the horizontal view also moved the canonical (saved)
//                            position (meta.canon = [{ id, from, to }]); see pushMove
//
// A DRAG is a step too (analysis 5, c4-1: it was not, so Undo after a drag took back the step
// before it — the name and description of some node). The editor calls beginMove() when a drag
// starts and pushMove(starts) when it ends. Such a step is built as "the canvas after the drag,
// with the dragged nodes at the positions they started from" — so its difference is POSITIONS of
// the dragged nodes and nothing else, whatever else changed on the canvas during the drag.
export function useMapHistory({ nodesNow, edgesNow, setNodes, setEdges }) {
  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const undoEnv = useRef({});
  const pending = useRef(null);   // the step whose "after" is not known yet
  const seq = useRef(0);
  const foreignAt = useRef(new Map()); // node id → seq of the last change taken over from the server
  const busy = useRef(false);

  const moving = useRef(null);    // the drag step whose final canvas has not rendered yet
  const moveTimer = useRef(0);
  useEffect(() => () => { if (moveTimer.current) clearTimeout(moveTimer.current); }, []);

  const now = () => ({ nodes: nodesNow.current, edges: edgesNow.current });
  const samePos = (a, b) => !!a && !!b && a.x === b.x && a.y === b.y;
  // Closes whatever step is still open, with the canvas as it is right now.
  const settle = () => {
    if (pending.current) { pending.current.after = now(); pending.current = null; }
    const e = moving.current;
    if (!e) return;
    moving.current = null;
    // Both sides of the step are the canvas of this moment with only the dragged nodes placed:
    // where they started (before) and where the drag left them (after).
    const cur = now();
    const place = (at) => (cur.nodes || []).map((n) => {
      const p = e.starts.has(n.id) ? at.get(n.id) : null;
      return p && !samePos(p, n.position) ? { ...n, position: { ...p } } : n;
    });
    e.before = { nodes: place(e.starts), edges: cur.edges };
    e.after = { nodes: place(e.ends), edges: cur.edges };
  };
  // runs after every render: the refs already hold the canvas of this render
  useEffect(() => {
    const e = pending.current;
    if (!e) return;
    if (nodesNow.current !== e.before.nodes || edgesNow.current !== e.before.edges) {
      e.after = now();
      pending.current = null;
    }
  });

  const pushHistory = useCallback((meta) => {
    settle();
    const entry = { before: now(), after: null, seq: ++seq.current, meta: meta && (meta.bufferItem || meta.projectColor) ? { bufferItem: meta.bufferItem || null, projectColor: meta.projectColor || null } : null };
    pending.current = entry;
    historyRef.current.push(entry);
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(historyRef.current.length > 0);
  }, [nodesNow, edgesNow]);

  // A drag starts: the step before it is closed now, so that the first pixel of the drag is not
  // taken for its result (a step whose action never changed the canvas would otherwise swallow it).
  const beginMove = useCallback(() => { settle(); }, []);
  // A drag ended. `starts` / `ends` = Map(node id → position before / after the drag) of the nodes
  // that really moved, `meta.canon` see undoEnv. The last position change of the drag may still
  // be on its way to the state when the canvas library reports the end, so the step is closed a
  // tick later (or by whatever comes first: another step, a merge from the server, Undo itself).
  const pushMove = useCallback((starts, ends, meta) => {
    settle();
    if (!starts || !starts.size) return; // a click, or a drag back to the same spot — no step
    const entry = { before: null, after: null, seq: ++seq.current, starts, ends, meta: meta && meta.canon && meta.canon.length ? { canon: meta.canon } : null };
    moving.current = entry;
    historyRef.current.push(entry);
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(true);
    if (moveTimer.current) clearTimeout(moveTimer.current);
    moveTimer.current = setTimeout(() => { moveTimer.current = 0; if (moving.current === entry) settle(); }, 0);
  }, [nodesNow, edgesNow]);

  // Nodes changed by somebody else (merged in from the server). A step that ADDED such a node
  // is not undone over that change.
  const noteForeign = useCallback((ids) => {
    // A step whose action never changed the canvas (e.g. a refused delete) is closed here, before
    // the merged change renders — otherwise it would take the colleague's change for its own.
    settle();
    const at = ++seq.current;
    for (const id of ids || []) foreignAt.current.set(id, at);
  }, []);

  const handleUndo = useCallback(async () => {
    if (busy.current) return;
    settle();
    // steps that changed nothing are skipped — a click on Undo must not be spent on them
    let entry = null;
    while (historyRef.current.length > 0) {
      entry = historyRef.current[historyRef.current.length - 1];
      if (!entry.after) { entry.after = now(); if (pending.current === entry) pending.current = null; }
      if (entry.after.nodes !== entry.before.nodes || entry.after.edges !== entry.before.edges) break;
      historyRef.current.pop();
      entry = null;
    }
    if (!entry) { setCanUndo(false); return; }
    const env = undoEnv.current || {};
    const plan = () => revertStep(entry.before, entry.after, now(), {
      canRemove: env.canRemove,
      foreignTouched: (id) => (foreignAt.current.get(id) || 0) > entry.seq,
    });
    const drop = () => { historyRef.current = historyRef.current.filter((x) => x !== entry); setCanUndo(historyRef.current.length > 0); };
    let r = plan();
    if (!r.ok) { drop(); if (env.onRefused) env.onRefused(r); return; }
    if (entry.meta && entry.meta.bufferItem && env.restoreBufferItem) {
      // the idea goes back to the buffer FIRST: if that fails, the node stays in the map and the
      // step in the history — the idea is never in neither place
      busy.current = true;
      try { await env.restoreBufferItem(entry.meta.bufferItem); } catch { if (env.onRestoreFailed) env.onRestoreFailed(); return; } finally { busy.current = false; }
      r = plan(); // the canvas may have moved while the buffer was being written
      if (!r.ok) { drop(); if (env.onRefused) env.onRefused(r); return; }
    }
    drop();
    if (entry.meta && entry.meta.projectColor && env.restoreProjectColor) env.restoreProjectColor(entry.meta.projectColor);
    if (entry.meta && entry.meta.canon && env.restoreCanon) {
      // only for the nodes whose position on the canvas really went back (a node moved again
      // since the step keeps where it is — and so does its saved position)
      const back = new Map(r.nodes.map((n) => [n.id, n]));
      env.restoreCanon(entry.meta.canon.filter((c) => samePos((back.get(c.id) || {}).position, entry.starts.get(c.id))));
    }
    // No skipNextSave: the fingerprint in the autosave notices the difference and sends it.
    setNodes(r.nodes);
    setEdges(r.edges);
  }, [setNodes, setEdges, nodesNow, edgesNow]);
  // NOTE: lib/undoStep.js compares node `data` + `position` and edge existence only; a future step
  // that changes a node's `type` / `hidden` or re-plugs an edge under the same id needs it extended.

  return { historyRef, canUndo, pushHistory, beginMove, pushMove, handleUndo, undoEnv, noteForeign };
}
