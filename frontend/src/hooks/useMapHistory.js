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
export function useMapHistory({ nodesNow, edgesNow, setNodes, setEdges }) {
  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const undoEnv = useRef({});
  const pending = useRef(null);   // the step whose "after" is not known yet
  const seq = useRef(0);
  const foreignAt = useRef(new Map()); // node id → seq of the last change taken over from the server
  const busy = useRef(false);

  const now = () => ({ nodes: nodesNow.current, edges: edgesNow.current });
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
    if (pending.current) { pending.current.after = now(); pending.current = null; }
    const entry = { before: now(), after: null, seq: ++seq.current, meta: meta && meta.bufferItem ? { bufferItem: meta.bufferItem } : null };
    pending.current = entry;
    historyRef.current.push(entry);
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(historyRef.current.length > 0);
  }, [nodesNow, edgesNow]);

  // Nodes changed by somebody else (merged in from the server). A step that ADDED such a node
  // is not undone over that change.
  const noteForeign = useCallback((ids) => {
    // A step whose action never changed the canvas (e.g. a refused delete) is closed here, before
    // the merged change renders — otherwise it would take the colleague's change for its own.
    if (pending.current) { pending.current.after = now(); pending.current = null; }
    const at = ++seq.current;
    for (const id of ids || []) foreignAt.current.set(id, at);
  }, []);

  const handleUndo = useCallback(async () => {
    if (busy.current) return;
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
    // No skipNextSave: the fingerprint in the autosave notices the difference and sends it.
    setNodes(r.nodes);
    setEdges(r.edges);
  }, [setNodes, setEdges, nodesNow, edgesNow]);
  // NOTE: lib/undoStep.js compares node `data` + `position` and edge existence only; a future step
  // that changes a node's `type` / `hidden` or re-plugs an edge under the same id needs it extended.

  return { historyRef, canUndo, pushHistory, handleUndo, undoEnv, noteForeign };
}
