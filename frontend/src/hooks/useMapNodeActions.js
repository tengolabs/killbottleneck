import { useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { shareMap } from '@/api/kb';
import { cycleStatus } from '@/lib/statusMeta';
import { patchNodeData } from '@/lib/taskActions';
import { addNodeToMap as addNodeToMapShared, ulozDoMapy } from '@/lib/mapNodes';

// Akce nad uzly map ze stránky Úkoly (zápis do uzlu, odstranění, sdílení,
// přiřazení, stash do zásobníku, ikony/vzhled). Vytaženo z pages/Tasks.jsx
// (analýza kódu 27. 8. 2026, F3-10) BEZE ZMĚNY chování — nové jsou jen
// useCallback obaly se skutečnými závislostmi (memoizace, součást nálezu).
// `editNodeItem`/`setEditNodeItem` je stav dialogu stránky — handlery „FromTable"
// nad ním drží closure, proto přichází jako vstup a stav zůstává v Tasks.jsx.
export function useMapNodeActions({ maps, setMaps, user, buffer, toast, t, editNodeItem, setEditNodeItem }) {
  // Zápis do uzlu mapy ze stránky Úkoly. Vlastní zápis dělá sdílený primitiv
  // lib/taskActions.js:patchNodeData (čerstvé načtení mapy těsně před zápisem
  // zmenšuje okno pro kolizi s auto-save otevřeného editoru) — tady zůstává jen
  // to, co je stránce vlastní: volitelná změna typu uzlu, lokální stav a hláška.
  const updateMapNode = useCallback(async (item, patch, nodeType) => {
    try {
      // typ i data JEDNÍM uložením — dřív to byly dva zápisy za sebou
      const nodes = await patchNodeData(item.map_id, item.node_id, patch,
        nodeType ? { type: nodeType } : null);
      setMaps((prev) => prev.map((m) => (m.id === item.map_id ? { ...m, nodes } : m)));
    } catch (e) {
      const msg = e?.message === 'mapNotFound' ? t('tasksPage.mapNotFound') : e?.message;
      toast({ title: t('tasksPage.saveToMapFailed'), description: msg, variant: 'destructive' });
      throw e;
    }
  }, [setMaps, t, toast]);

  // Uzel se zadaným úkolem (termínem) odstraní jen zadavatel (assignedBy,
  // legacy fallback vlastník mapy) nebo vlastník — server to vynucuje na PATCH,
  // tady kvůli pořadí u stashe (nápad se nesmí zduplikovat do zásobníku).
  const nodeRemovalBlockedBy = useCallback((map, rawNode) => {
    if (!rawNode?.data?.deadline) return null;
    const assigner = rawNode.data.assignedBy || map?.created_by || '';
    if (user?.email === map?.created_by || user?.email === assigner) return null;
    return assigner;
  }, [user]);

  // odstranění uzlu z mapy (hrany na něj napojené padají s ním, potomci se odpojí)
  const removeMapNode = useCallback(async (mapId, nodeId) => {
    // se zámkem base_updated (ulozDoMapy) — dřív bez něj a souběh s editorem přepsal cizí práci
    let vysl;
    try {
      vysl = await ulozDoMapy(mapId, (fresh) => {
        const blocked = nodeRemovalBlockedBy(fresh, (fresh.nodes || []).find((n) => n.id === nodeId));
        if (blocked) throw new Error(t('tasksPage.nodeRemoveAssignerOnly', { email: blocked }));
        return {
          nodes: (fresh.nodes || []).filter((n) => n.id !== nodeId),
          edges: (fresh.edges || []).filter((e) => e.source !== nodeId && e.target !== nodeId),
        };
      });
    } catch (e) {
      if (e?.message === 'mapNotFound') throw new Error(t('tasksPage.mapNotFound'));
      throw e;
    }
    const { nodes, edges } = vysl;
    setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, nodes, edges } : m)));
  }, [nodeRemovalBlockedBy, setMaps, t]);

  // přisdílení mapy (spolupracovník) při přiřazení člena bez přístupu — smí jen vlastník
  const shareMapWith = useCallback(async (mapId, email) => {
    try {
      // quiet: součást zadání práce — adresát dostane notifikaci o přidělené
      // práci, druhá o sdílení by byla duplikát (Richard 21. 8.)
      const res = await shareMap({ action: 'share', mapId, email, permission: 'work', quiet: true });
      if (res?.error) {
        toast({ title: t('tasksPage.shareFailed'), description: res.error, variant: 'destructive' });
        return false;
      }
      setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, shared_with: [...(m.shared_with || []), email] } : m)));
      toast({ title: t('tasksPage.mapShared'), description: t('tasksPage.mapSharedDesc', { email }) });
      return true;
    } catch (e) {
      toast({ title: t('tasksPage.shareFailed'), description: e.response?.error || t('tasksPage.shareOwnerOnly'), variant: 'destructive' });
      return false;
    }
  }, [setMaps, t, toast]);

  // „Vidí mapu" NESTAČÍ — rozhoduje PRACOVNÍ úroveň (Richard 20. 8. 2026: kdo
  // dostane úkol, musí ho umět vyřešit, a nebo se zadavateli musí nabídnout, ať
  // mu dá jiná práva). Čtenář svůj krok odškrtne i tak (server ho pustí), ale
  // zadavatel by netušil, že ten člověk má mapu jen ke čtení.
  const nodeHasWorkAccess = useCallback((map, email) => {
    if (!email || !map) return true;
    if (map.team_access === 'edit') return true;
    return map.created_by === email
      || (map.shared_with_work || []).includes(email)
      || (map.shared_with_edit || []).includes(email);
  }, []);
  const nodeIsShared = useCallback((map, email) => !!map && ((map.shared_with || []).includes(email) || !!map.team_access), []);

  // Úprava vzhledu projektu z hlavičky v tabulce (barva / emoji v názvu).
  // Zapisuje jen skalární pole (color/title) bez base_updated → hook 409 přeskočí.
  const handleEditAppearance = useCallback(async (map, patch) => {
    try {
      const updated = await base44.entities.GoalMap.update(map.id, patch);
      setMaps((prev) => prev.map((m) => (m.id === map.id ? { ...m, ...patch, updated_date: updated.updated_date } : m)));
    } catch (e) {
      toast({ title: t('tasksPage.appearanceFailed'), description: e?.message, variant: 'destructive' });
    }
  }, [setMaps, t, toast]);

  // Rychlá paleta ikony uzlu (emoji) z tabulky → zápis do mapy.
  const handleSetNodeIcon = useCallback((item, emoji) => {
    updateMapNode(item, { icon: emoji }).catch(() => {});
  }, [updateMapNode]);

  // Ikona projektu = ikona vrcholového (apex) uzlu (jeden zdroj) → zápis do apexu.
  const handleSetProjectIcon = useCallback((map, emoji) => {
    const nodes = map.nodes || [];
    const apex = nodes.find((n) => n.type === 'apexNode' || n.data?.nodeType === 'apex') || nodes[0];
    if (!apex) return;
    updateMapNode({ map_id: map.id, node_id: apex.id }, { icon: emoji }).catch(() => {});
  }, [updateMapNode]);

  // Odložení cíle-uzlu do zásobníku přímo z řádku tabulky (bez otevírání
  // dialogu). Čerstvý fetch mapy vytáhne i popis/barvu uzlu — jinak by se
  // odložením ztratily (řádek nese jen titulek a termín).
  const handleStashNodeItem = useCallback(async (item) => {
    if (!window.confirm(t('tasksPage.confirmStashNode', { title: item.title }))) return;
    try {
      const fresh = (await base44.entities.GoalMap.filter({ id: item.map_id }))[0];
      const raw = (fresh?.nodes || []).find((n) => n.id === item.node_id);
      // kontrola PŘED zápisem do zásobníku — jinak by se nápad zduplikoval
      const blocked = nodeRemovalBlockedBy(fresh, raw);
      if (blocked) {
        toast({ title: t('tasksPage.stashFailed'), description: t('tasksPage.nodeRemoveAssignerOnly', { email: blocked }), variant: 'destructive' });
        return;
      }
      await buffer.add({
        title: item.title,
        description: raw?.data?.description || '',
        color: raw?.data?.color || '',
        deadline: item.deadline || '',
      });
      await removeMapNode(item.map_id, item.node_id);
      toast({ title: t('tasksPage.stashedToBuffer'), description: item.title });
    } catch (e) {
      toast({ title: t('tasksPage.stashFailed'), description: e?.message, variant: 'destructive' });
    }
  }, [buffer, nodeRemovalBlockedBy, removeMapNode, t, toast]);

  const handleCycleNodeItem = useCallback((item) => {
    if (item.status === 'todo' && item.waiting) {
      if (!window.confirm(t('tasksPage.confirmStartWaiting'))) return;
    }
    updateMapNode(item, { status: cycleStatus(item.status) }).catch(() => {});
  }, [t, updateMapNode]);

  const handleAssignNodeItem = useCallback(async (item, email) => {
    const map = maps.find((m) => m.id === item.map_id);
    if (email && !nodeHasWorkAccess(map, email)) {
      const jenCte = nodeIsShared(map, email);
      const otazka = jenCte ? 'tasksPage.confirmUpgradeAssign' : 'tasksPage.confirmShareAssign';
      if (!window.confirm(t(otazka, { email, title: map?.title }))) {
        // odmítnutí povýšení přiřazení NERUŠÍ — práci na svém kroku dokončí i čtenář
        if (!jenCte) return;
      } else {
        const ok = await shareMapWith(item.map_id, email);
        if (!ok && !jenCte) return;
      }
    }
    updateMapNode(item, { owner: email }).catch(() => {});
  }, [maps, nodeHasWorkAccess, nodeIsShared, shareMapWith, t, updateMapNode]);

  const handleStashNodeFromTable = useCallback(async (nodeId, override) => {
    const item = editNodeItem;
    const nodeTitle = (override?.title || item?.title || '').trim();
    if (!nodeTitle) return;
    const freshMap = (await base44.entities.GoalMap.filter({ id: item.map_id }))[0];
    const blocked = nodeRemovalBlockedBy(freshMap, (freshMap?.nodes || []).find((n) => n.id === nodeId));
    if (blocked) {
      toast({ title: t('tasksPage.stashFailed'), description: t('tasksPage.nodeRemoveAssignerOnly', { email: blocked }), variant: 'destructive' });
      return;
    }
    try {
      await buffer.add({
        title: nodeTitle,
        description: override?.description ?? '',
        color: override?.color ?? '',
        deadline: override?.deadline ?? '',
      });
      await removeMapNode(item.map_id, nodeId);
      setEditNodeItem(null);
      toast({ title: t('tasksPage.stashedToBuffer'), description: nodeTitle });
    } catch (e) {
      toast({ title: t('tasksPage.stashFailed'), description: e?.message, variant: 'destructive' });
    }
  }, [buffer, editNodeItem, nodeRemovalBlockedBy, removeMapNode, setEditNodeItem, t, toast]);

  const handleDeleteNodeFromTable = useCallback(async (nodeId) => {
    const item = editNodeItem;
    if (!window.confirm(t('tasksPage.confirmDeleteNode', { title: item?.title }))) return;
    try {
      await removeMapNode(item.map_id, nodeId);
      setEditNodeItem(null);
      toast({ title: t('tasksPage.nodeDeletedToast'), description: item?.title });
    } catch (e) {
      toast({ title: t('tasksPage.deleteFailed'), description: e?.message, variant: 'destructive' });
    }
  }, [editNodeItem, removeMapNode, setEditNodeItem, t, toast]);

  // Nový uzel do mapy ze seznamu. parentNodeId: id uzlu / 'auto' (pod vrchol) / null (kořen).
  // Založení uzlu drží sdílený primitiv lib/mapNodes.js — používá ho i rychlé
  // přidání v lite režimu, ať nevzniknou dvě různá chování téhož.
  const addNodeToMap = useCallback(async (mapId, parentNodeId, title) => {
    const { nodeId, nodes, edges } = await addNodeToMapShared(mapId, parentNodeId, title);
    setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, nodes, edges } : m)));
    return nodeId;
  }, [setMaps]);

  return {
    updateMapNode, nodeRemovalBlockedBy, removeMapNode, shareMapWith,
    nodeHasWorkAccess, nodeIsShared, handleEditAppearance, handleSetNodeIcon,
    handleSetProjectIcon, handleStashNodeItem, handleCycleNodeItem,
    handleAssignNodeItem, handleStashNodeFromTable, handleDeleteNodeFromTable,
    addNodeToMap,
  };
}
