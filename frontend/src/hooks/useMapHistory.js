import { useState, useCallback, useRef } from 'react';

// Zpět v editoru mapy: ruční historie (zásobník 50 snímků nodes/edges →
// tlačítko Zpět) a jednorázový snímek před zásahem AI (Vrátit AI změny).
// Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026, F1-07).
// pushHistory čte snímek z latest-refů nodesNow/edgesNow, ne z uzávěru (F1-05):
// toast „Opravit strom" držel opravitStrom z doby načtení a Zpět po opravě vracel
// mapu bez mezitím přidaných uzlů. Vedlejší zisk: pushHistory je stabilní →
// vypadne z deps ~10 handlerů (handleAddChild, insertBufferItem, handleAlign…).
export function useMapHistory({ nodesNow, edgesNow, setNodes, setEdges }) {
  const historyRef = useRef([]);
  const [canUndo, setCanUndo] = useState(false);

  const pushHistory = useCallback(() => {
    historyRef.current.push({ nodes: nodesNow.current, edges: edgesNow.current });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(historyRef.current.length > 0);
  }, [nodesNow, edgesNow]);

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

  return { historyRef, canUndo, pushHistory, handleUndo };
}
