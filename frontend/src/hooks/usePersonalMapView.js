import { useState, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { layoutTree } from '@/lib/treeLayout';
import { nactiKlic } from '@/lib/storageKeys';
import { PERSONAL_LAYOUT, buildPersonalMap, buildDelegatedMap } from '@/lib/personalMap';

// „Moje mapa" v editoru (F1-07, krok 11): záložka Mám udělat/Zadal jsem
// (personalView), seskupení záložky Zadal jsem (delegatedGrouping), cíle uzlů
// pro skok do zdroje (personalTargets → onNodeClick) a (pře)načtení agregace
// (loadPersonalMap). Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026)
// BEZE ZMĚNY chování. Volá se PŘED load-efektem mapy, který loadPersonalMap
// volá; refy směru/pozic/čitelnosti dává useMapLayoutRefs, `skipNextSave` je
// ref editoru — obojí přichází jako vstup. Tři efekty přenačtení (záložka/
// seskupení, adresář, zásobník) ZŮSTÁVAJÍ v editoru za load-efektem: sdílejí
// s ním stav (loading, loadPersonalMap) a přesun sem by je v pořadí deklarace
// (= pořadí spouštění) posunul před něj.
export function usePersonalMapView({
  personalMap, user, t, members, setNodes, setEdges, skipNextSave, location, navigate,
  directionRef, canonicalPosRef, appliedDirRef, citelnostRef,
}) {
  const personalTargets = useRef({}); // „Moje mapa": vid uzlu → { type, mapId/nodeId/taskId }
  // „Moje mapa": záložka mine=„Mám udělat" / delegated=„Zadal jsem" (?view=delegated)
  // + seskupení záložky Zadal jsem (flat=dle termínu / people / projects)
  const [personalView, setPersonalView] = useState(() =>
    new URLSearchParams(location.search).get('view') === 'delegated' ? 'delegated' : 'mine');
  const [delegatedGrouping, setDelegatedGrouping] = useState(() => nactiKlic('kb-delegated-grouping') || 'flat');

  // „Moje mapa": (pře)načte agregaci mých uzlů + volných úkolů. Voláno při vstupu
  // i při změně zásobníku (nápad+termín→volný úkol se objeví bez ruční aktualizace).
  const loadPersonalMap = useCallback(async () => {
    try {
      const [allMaps, allTasks] = await Promise.all([
        base44.entities.GoalMap.list('-updated_date', 200),
        user ? base44.entities.Task.list('-created_date', 1000) : Promise.resolve([]),
      ]);
      const rootLabel = user?.full_name || t('myday:myMap.rootLabel');
      const { nodes: pn, edges: pe, targets } = personalView === 'delegated'
        ? buildDelegatedMap(allMaps, allTasks, user?.email, rootLabel, delegatedGrouping, members)
        : buildPersonalMap(allMaps, allTasks, user?.email, rootLabel);
      personalTargets.current = targets;
      // Respektovat AKTUÁLNÍ směr zobrazení (mobil auto = vodorovně): buildery
      // vracejí kanonické svislé pozice a view-only překlopení se jinak aplikuje
      // jen při ZMĚNĚ směru — re-build (záložka, seskupení, zásobník) by mapu
      // na mobilu tiše vrátil do svislé podoby.
      if (directionRef.current === 'horizontal') {
        canonicalPosRef.current = new Map(pn.filter((n) => n.type !== 'note').map((n) => [n.id, { ...n.position }]));
        const hpos = layoutTree(pn, pe, 'horizontal', PERSONAL_LAYOUT('horizontal', citelnostRef.current));
        for (const n of pn) { const p = hpos[n.id]; if (p) n.position = p; }
        appliedDirRef.current = 'horizontal'; // překlopeno už tady — efekt směru nesmí přerovnávat podruhé
      }
      skipNextSave.current = true;
      setNodes(pn);
      setEdges(pe);
    } catch (e) { console.error(e); }
  }, [user, t, setNodes, setEdges, personalView, delegatedGrouping, members]);

  const onNodeClick = personalMap ? (e, node) => {
  const tgt = personalTargets.current[node.id];
  if (!tgt) return;
  if (tgt.type === 'task') navigate(`/tasks?task=${tgt.taskId}`);
  else navigate(`/map/${tgt.mapId}?node=${tgt.nodeId}`);
  } : undefined;

  return { personalView, setPersonalView, delegatedGrouping, setDelegatedGrouping, loadPersonalMap, onNodeClick };
}
