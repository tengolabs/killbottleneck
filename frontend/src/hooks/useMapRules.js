import { useState, useEffect, useCallback, useMemo } from 'react';
import { recurrenceOf } from '@/lib/recurrenceRule';
import { rulesApi } from '@/components/rules/rulesApi';
import { useLazyNs } from '@/i18n/lazyNs';

// Automatizační pravidla mapy v editoru: načtení pravidel, stav dialogu
// pravidel (RulesDialog + předvolby z uzlu), odvozené množiny uzlů (blesk,
// opakování), indikátor kanbanu a vstup do builderu z kontextu uzlu.
// Vytaženo z GoalMapEditor.jsx (analýza kódu 27. 8. 2026, F1-07) BEZE ZMĚNY
// chování — `mapRulesNow` je latest-ref editoru (čte ho letící autosave dřív,
// než tenhle hook vznikne), proto přichází jako parametr a hook ho jen plní.
export function useMapRules({ activeMapId, canEdit, isPublicView, setNodes, mapRulesNow }) {
  // automatizační pravidla mapy — pro badge blesku na uzlech a kategorii
  // Automatizace v okně uzlu. Jen editor (routa /rules je editor-only);
  // bez realtime — pravidla se mění výhradně přes RulesDialog, který po
  // změně zavolá reload (onRulesChanged).
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rulesDefaults, setRulesDefaults] = useState({});
  const [mapRules, setMapRules] = useState([]);
  mapRulesNow.current = mapRules; // latest-ref pro letící autosave (viz výš)
  useEffect(() => {
    if (!activeMapId || !canEdit || isPublicView) { setMapRules([]); return; }
    rulesApi.list(activeMapId).then(setMapRules).catch(() => setMapRules([]));
  }, [activeMapId, canEdit, isPublicView]);
  const ruleNodes = useMemo(() => new Set(mapRules.filter((r) => r.node_id).map((r) => r.node_id)), [mapRules]);
  // 🔁 uzly s čistým opakovacím pravidlem (v0.35) — badge na kartě cíle
  const recurrenceNodes = useMemo(() => {
    const out = new Set();
    for (const r of mapRules) {
      if (!r?.node_id) continue;
      const st = recurrenceOf(mapRules, r.node_id);
      if (st && !st.custom) out.add(r.node_id);
    }
    return out;
  }, [mapRules]);
  // KANBAN REŽIM: mapa má zapnutá pravidla posunu. Tlačítko Zarovnat se mění
  // na indikátor „Kanban" (Richard 15. 8.): na kanban desce styly zarovnání
  // nemají co přeskládat (sloupce mají děti), cyklení názvů naprázdno matlo —
  // rozložení tu drží pravidla posunu, ne styly. Vědomá výjimka z pravidla
  // „Zarovnat musí vždy něco udělat": tady místo akce ŘEKNE, proč nekoná.
  const kanbanAktivni = useMemo(() => mapRules.some((r) => r.enabled && (r.actions || []).some((a) => a.type === 'move_node')), [mapRules]);
  // texty indikátoru žijí v LAZY namespace `rules` (lite dieta — práh 490 kB
  // se nezvedá); než se donačte, ukazuje se běžné Zarovnat
  const kanbanNsReady = useLazyNs('rules');
  // společný vstup do builderu z kontextu uzlu (panel Automatizace, Chování);
  // triggerType přednastaví spouštěč (propojka „po odblokování")
  const openRulesFromNode = useCallback((nid, openNew, triggerType, showRunsRule, openKanban) => {
    // showRunsRule: undefined = bez logu; '' = log celé mapy; id = log pravidla
    // (nález Richarda 15. 8.: z panelu uzlu se na log běhů nedalo dostat)
    // openKanban: rovnou průvodce „Zapnout kanban na řadě" s uzlem jako řadou
    setRulesDefaults({ node_id: nid, openNew, trigger_type: triggerType || '', showRunsRule, openKanban });
    setRulesOpen(true);
  }, []);
  // slíbená náprava z builderu: pravidlo „po odblokování" na uzlu bez čekání
  // by se nikdy nespustilo → zapnout standardní cestou (setNodes + autosave).
  // ⚠️ Otevřený dialog uzlu se tím přenačte ze stavu mapy (stejné chování jako
  // u každé jiné změny uzlu na pozadí) — přepínač v Chování ukáže nový stav.
  const handleEnableWaiting = useCallback((nodeId) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, waitForChildren: true } } : n)));
  }, [setNodes]);

  return {
    rulesOpen, setRulesOpen, rulesDefaults, setRulesDefaults, mapRules, setMapRules,
    ruleNodes, recurrenceNodes, kanbanAktivni, kanbanNsReady, openRulesFromNode, handleEnableWaiting,
  };
}
