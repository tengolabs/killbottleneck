import { useState, useEffect, useCallback, useRef } from 'react';
import { useUpdateNodeInternals } from '@xyflow/react';
import { layoutTree } from '@/lib/treeLayout';
import { cleanMapData as cleanMap } from '@/lib/cleanMap';
import { useMapDirection } from '@/lib/useMapDirection';
import { nactiStupen } from '@/lib/citelnost';

// Rozložení mapy — RANÁ část (F1-07, krok 12, doména LAYOUT): směr zobrazení,
// zámek posunu, refy směru/kanonických pozic/klíče stylu, závora deep-linku,
// vycentrování na uzel a kanonická podoba mapy k uložení (cleanMapData).
// Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026) BEZE ZMĚNY chování.
// Je to zvlášť od useMapLayout proto, že tyhle refy a funkce čtou callbacky a
// efekty editoru (loadPersonalMap, load mapy, autosave, nasadNaPlatno,
// handleSaveTemplate), které vznikají DŘÍV, než jsou k dispozici vstupy druhé
// části (pushHistory, canEdit, isMapOwner…). `nasadNaPlatno` v editoru do
// canonicalPosRef/appliedDirRef ZAPISUJE — proto se refy vracejí ven.
export function useMapLayoutRefs({ nodes, rfInstance, nodesNow, edgesNow, location }) {
  // směr rozložení mapy (na výšku/na šířku); na mobilu se v režimu auto překlopí
  const { setMode: setDirMode, direction, narrow } = useMapDirection();
  const updateNodeInternals = useUpdateNodeInternals(); // přeměřit konektory po změně strany (jinak hrany vedou ke staré pozici)
  // zámek proti omylnému posunu uzlu (hlavně na mobilu) — default zamčeno na malém displeji
  const [locked, setLocked] = useState(narrow);
  // Stupeň Čitelnosti přes ref: rozestupy „Mojí mapy" ho potřebují v callbacích,
  // které vznikají DŘÍV, než se stav deklaruje (viz PERSONAL_LAYOUT). Výchozí
  // hodnota se čte z prohlížeče, ať první vykreslení nesedí vedle.
  const citelnostRef = useRef(nactiStupen());
  // useCallback (F1-06; definice až za rfInstance, jinak TDZ v deps): bez něj se efekt zámku zarovnání a handleAlign přepočítávaly každý render
  const recenterMap = useCallback(() => { setTimeout(() => { try { rfInstance?.fitView({ padding: 0.2, duration: 300 }); } catch { /* ignore */ } }, 60); }, [rfInstance]);
  const directionRef = useRef('vertical'); // aktuální směr pro save/handlery (bez re-renderu)
  const appliedDirRef = useRef('vertical'); // směr posledního přerovnání view (detekce překlopení)
  const canonicalPosRef = useRef(new Map()); // svislé (kanonické) pozice — vodorovné view je NEpřepisuje
  const alignMapKeyRef = useRef(null); // klíč stylu TÉTO mapy — čte i AI přelayout, který nemá závislosti

  // Deep-link ?node= má PŘEDNOST před automatickými fitView. Bez téhle závory
  // spolu obojí závodí: onInit fituje 120 ms po initu plátna, centrování na uzel
  // 60 ms po tom, co jsou k dispozici data mapy. Podle toho, jestli data dorazí
  // před initem nebo po něm, jednou vyhraje zaostření na uzel a podruhé celková
  // mapa — přesně to „jednou to funguje, jindy ne".
  const pendingDeepLink = useRef(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get('node')) pendingDeepLink.current = true;
  }, [location.search]);

  // Vycentrovat pohled na uzel (i s okolím) — deep-link, AI-expand, přepínač směru.
  const centerOnNode = useCallback((nodeId, opts = {}) => {
    const n = nodes.find((x) => x.id === nodeId);
    const pos = opts.pos || n?.position;
    if (!pos || !rfInstance) return;
    const w = n?.measured?.width || n?.width || 220;
    const h = n?.measured?.height || n?.height || 150;
    const z = opts.zoom ?? (narrow ? 0.7 : 1.0);
    setTimeout(() => { try { rfInstance.setCenter(pos.x + w / 2, pos.y + h / 2, { zoom: z, duration: 500 }); } catch { /* ignore */ } }, opts.delay ?? 60);
  }, [nodes, rfInstance, narrow]);

  const cleanMapData = () => {
    // Ve vodorovném (mobilním) view jsou pozice jen pro ZOBRAZENÍ — nikdy je
    // neukládat, jinak by mobil rozhodil svislé rozložení sdílené s desktopem.
    // Uloží se kanonické svislé: existující dle snapshotu, nové dopočítat.
    // Kanonický tvar dat drží sdílená lib/cleanMap.js (parita se serverem).
    // Čte se z refů (nodesNow/edgesNow), ne z uzávěru — letící autosave po
    // await potřebuje SOUČASNÝ stav (viz převzetí mutací pravidel níže).
    const nds = nodesNow.current;
    const eds = edgesNow.current;
    const horizontalView = directionRef.current === 'horizontal';
    const vlayForSave = horizontalView ? layoutTree(nds, eds, 'vertical') : null;
    const posOf = (n) => (horizontalView
      ? (canonicalPosRef.current.get(n.id) || vlayForSave[n.id] || n.position)
      : n.position);
    return cleanMap(nds, eds, posOf);
  };

  return {
    setDirMode, direction, narrow, updateNodeInternals, locked, setLocked, recenterMap, citelnostRef,
    directionRef, appliedDirRef, canonicalPosRef, alignMapKeyRef, pendingDeepLink, centerOnNode, cleanMapData,
  };
}
