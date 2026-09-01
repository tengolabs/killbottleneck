import { useMemo } from 'react';
import { computeWaitingSet } from '@/lib/waitStatus';
import { getDeadlineStatus } from '@/lib/nodeMeta';
import { hledaciText } from '@/hooks/useTaskFilters';

// Odvozená data stránky Úkoly: aktivní mapy, stromy uzlů, položky kanbanu,
// kalendáře a zásobníku. Vytaženo z pages/Tasks.jsx (analýza kódu 27. 8. 2026,
// F3-10). JEDINÁ ZMĚNA CHOVÁNÍ oproti stránce: původní jeden memo `nodeTrees`
// je rozdělený na `rawTrees` (computeWaitingSet + stavba byId + hrany; závisí
// jen na datech map) a prořez filtry — dřív se čekající množina a stromy VŠECH
// map přepočítávaly při každém stisku klávesy ve vyhledávání (stejná třída
// problému jako `hledaciCache`). Výsledná data jsou identická (ověřeno
// porovnáním JSON.stringify staré a nové verze na testovacích datech).
export function useTaskTrees({
  items, byParent, maps, user, buffer, matchesFilters, bufferVisible,
  mapFilter, nodeFilter, assigneeFilter, ownerFilter, statusFilter, deadlineFilter, search, t,
}) {
  // archivované projekty v úkolech nefigurují (žijí na /archive) — filtruje se
  // mapa i úkoly na ni navěšené. Stejně jako Home ukazujeme jen projekty, kde
  // mám roli: moje / sdílené se mnou / mám v nich cíl-uzel či úkol / organizační.
  // (RLS vrací i cizí VEŘEJNÉ mapy — ty by tu byly navíc oproti Home.)
  const activeMaps = useMemo(() => {
    const email = user?.email;
    const relevant = (m) =>
      m.created_by_id === user?.id
      || (m.shared_with || []).includes(email)
      || (m.nodes || []).some((n) => n.type !== 'note' && n.data?.owner === email)
      || items.some((task) => task.map_id === m.id && task.assignee_email === email)
      || !!m.team_access;
    return maps.filter((m) => !m.archived && relevant(m));
  }, [maps, items, user]);
  const archivedMapIds = useMemo(
    () => new Set(maps.filter((m) => m.archived).map((m) => m.id)),
    [maps]
  );

  // úkol nejvyšší úrovně projde, když odpovídá sám, nebo některý jeho podúkol
  const topLevel = useMemo(
    () => items.filter((task) => !task.parent_id && !archivedMapIds.has(task.map_id) && (matchesFilters(task) || (byParent[task.id] || []).some(matchesFilters))),
    [items, byParent, archivedMapIds, mapFilter, nodeFilter, assigneeFilter, ownerFilter, statusFilter, deadlineFilter, search]
  );

  // Celý strom uzlů každé mapy (mapa = projekt, uzly = jeho cíle) — odvozeno
  // z JSON mapy, filtry prořezávají větve (uzel zůstane, když odpovídá sám
  // nebo některý potomek). Mapa zůstává zdrojem pravdy.
  // Neprořezané stromy — závisí jen na datech map (t: fallback názvu uzlu),
  // NE na filtrech; prořez dělá až memo `nodeTrees` níž.
  const rawTrees = useMemo(() => {
    const res = {};
    for (const m of activeMaps) {
      const mapWaiting = computeWaitingSet(m.nodes || [], m.edges || []);
      const byId = {};
      for (const n of m.nodes || []) {
        if (n.type === 'note') continue;
        const d = n.data || {};
        byId[n.id] = {
          waiting: mapWaiting.has(n.id),
          id: `node-item-${m.id}-${n.id}`,
          isNode: true,
          isApex: n.type === 'apexNode' || d.nodeType === 'apex',
          icon: d.icon || '',
          title: d.title || (d.apexText || '').slice(0, 60) || t('common:misc.untitled'),
          status: d.status || 'todo',
          deadline: d.deadline || '',
          plannedOn: d.plannedOn || d.pinnedOn || '',
          assignee_email: d.owner || '',
          // „kdo zadal" uzel = vlastník mapy (uzly nemají vlastní pole autora);
          // umožní filtr „Zadal jsem" a zobrazení zadavatele v tabulce
          created_by: m.created_by || '',
          map_id: m.id,
          node_id: n.id,
          children: [],
        };
      }
      const hasParent = new Set();
      for (const e of m.edges || []) {
        if (byId[e.source] && byId[e.target] && !hasParent.has(e.target)) {
          byId[e.source].children.push(byId[e.target]);
          hasParent.add(e.target);
        }
      }
      res[m.id] = Object.values(byId).filter((n) => !hasParent.has(n.node_id));
    }
    return res;
  }, [activeMaps, t]);

  // prořez filtrů nad rawTrees (prune kopíruje přes spread, rawTrees nemutuje)
  const nodeTrees = useMemo(() => {
    const prune = (list) => list
      .map((n) => {
        const children = prune(n.children);
        if (matchesFilters(n) || children.length > 0) return { ...n, children };
        return null;
      })
      .filter(Boolean);

    const res = {};
    for (const [mapId, roots] of Object.entries(rawTrees)) {
      const pruned = prune(roots);
      if (pruned.length > 0) res[mapId] = pruned;
    }
    return res;
  }, [rawTrees, mapFilter, nodeFilter, assigneeFilter, ownerFilter, statusFilter, deadlineFilter, search]);

  // kanban zůstává jen o rozpracovanosti — z uzlů ukazuje dál jen ty s termínem
  const boardNodeItems = useMemo(() => {
    const out = [];
    const walk = (list) => list.forEach((n) => { if (n.deadline && matchesFilters(n)) out.push(n); walk(n.children); });
    for (const roots of Object.values(nodeTrees)) walk(roots);
    return out;
  }, [nodeTrees]);

  // C3 kalendář: úkoly (i podúkoly) a uzly map s termínem, sjednocené na jeden seznam
  const calendarItems = useMemo(() => {
    const out = [];
    const pushTask = (task) => {
      if (task.deadline) out.push({ key: `t-${task.id}`, title: task.title, deadline: task.deadline, status: task.status, kind: 'task', raw: task });
    };
    topLevel.forEach((task) => { pushTask(task); (byParent[task.id] || []).forEach(pushTask); });
    boardNodeItems.forEach((n) => out.push({ key: n.id, title: n.title, deadline: n.deadline, status: n.status, kind: 'node', raw: n }));
    return out;
  }, [topLevel, byParent, boardNodeItems]);

  const bufferItems = useMemo(() => {
    if (!bufferVisible) return [];
    return buffer.items.filter((b) => {
      if (deadlineFilter === 'overdue' && getDeadlineStatus(b.deadline, 'todo') !== 'overdue') return false;
      if (deadlineFilter === 'week') {
        if (!b.deadline) return false;
        const st = getDeadlineStatus(b.deadline, 'todo');
        const days = Math.round((new Date(b.deadline + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000);
        if (st === 'overdue' || days > 7) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!(b.title || '').toLowerCase().includes(q) && !hledaciText(b.description).includes(q)) return false;
      }
      return true;
    });
  }, [buffer.items, bufferVisible, deadlineFilter, search]);

  return { activeMaps, archivedMapIds, topLevel, nodeTrees, boardNodeItems, calendarItems, bufferItems };
}
