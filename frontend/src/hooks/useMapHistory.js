import { useState, useCallback, useRef } from 'react';

// Zpět v editoru mapy: ruční historie (zásobník 50 snímků nodes/edges →
// tlačítko Zpět) a jednorázový snímek před zásahem AI (Vrátit AI změny).
// Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026, F1-07) BEZE ZMĚNY
// chování — nodes/edges/setNodes/setEdges/toast/t přicházejí jako parametry.
export function useMapHistory({ nodes, edges, setNodes, setEdges, toast, t }) {
  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);
  const aiSnapshotRef = useRef(null);
  const [canUndoAi, setCanUndoAi] = useState(false);

  const pushHistory = useCallback(() => {
    historyRef.current.push({ nodes, edges });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(historyRef.current.length > 0);
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop();
    // BEZ skipNextSave: relikt z doby před otiskem — Zpět po Zarovnat/přesunu
    // se do DB nedostalo (plátno původní, DB zarovnaná; nález F1-02). Otisk
    // v autosave sám pozná, že se stav liší, a pošle ho.
    setNodes(prev.nodes.map((n) => ({ ...n })));
    setEdges(prev.edges.map((e) => ({ ...e })));
    setCanUndo(historyRef.current.length > 0);
  }, [setNodes, setEdges]);

  const handleUndoAi = useCallback(() => {
    const snapshot = aiSnapshotRef.current;
    if (!snapshot) return;
    // bez skipNextSave — stejný důvod jako u handleUndo (nález F1-02)
    setNodes(snapshot.nodes.map((n) => ({ ...n })));
    setEdges(snapshot.edges.map((e) => ({ ...e })));
    aiSnapshotRef.current = null;
    setCanUndoAi(false);
    toast({ title: t('toasts.aiUndone'), description: t('toasts.aiUndoneDesc') });
  }, [setNodes, setEdges, toast]);

  return { historyRef, canUndo, pushHistory, handleUndo, aiSnapshotRef, canUndoAi, setCanUndoAi, handleUndoAi };
}
