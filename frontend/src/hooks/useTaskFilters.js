import { useState, useEffect, useMemo } from 'react';
import { getDeadlineStatus } from '@/lib/nodeMeta';
import { popisJakoText } from '@/lib/popisFormat';

// Popis bez značek pro hledání. ⚠️ S pamětí: predikát filtru se volá pro každou
// položku při KAŽDÉM stisku klávesy ve vyhledávání, takže rozebírat popis znovu
// a znovu se u delších textů projeví (nález panelu 19. 8. 2026).
const hledaciCache = new Map();
export function hledaciText(popis) {
  const klic = popis || '';
  if (!klic) return '';
  let v = hledaciCache.get(klic);
  if (v === undefined) {
    v = popisJakoText(klic).toLowerCase();
    if (hledaciCache.size > 2000) hledaciCache.clear();   // ať paměť neroste bez konce
    hledaciCache.set(klic, v);
  }
  return v;
}

export const ALL = '__all__';
export const NONE = '__none__'; // „Bez mapy" / „Nepřiřazené" (Radix Select neumí prázdný string)

// Filtry stránky Úkoly: stavy filtrů, URL předfiltry (?assignee/?owner/
// ?deadline/?status), predikát matchesFilters, viditelnost zásobníku a chip
// filtru uzlu. Vytaženo z pages/Tasks.jsx (analýza kódu 27. 8. 2026, F3-10)
// BEZE ZMĚNY chování — deep-linky ?convert= a ?task= zůstávají v Tasks.jsx
// (otevírají dialogy, jejich stav filtrům nepatří); relativní pořadí efektů
// nad searchParams drží pořadí volání hooků na stránce.
export function useTaskFilters({ user, searchParams, setSearchParams, maps, t }) {
  const [mapFilter, setMapFilter] = useState(searchParams.get('map') || ALL);
  const [nodeFilter, setNodeFilter] = useState(searchParams.get('node') || '');
  const [assigneeFilter, setAssigneeFilter] = useState(ALL);
  // ownerFilter: ALL | 'delegated' (úkoly, které jsem zadal někomu jinému)
  const [ownerFilter, setOwnerFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [deadlineFilter, setDeadlineFilter] = useState(ALL);
  const [search, setSearch] = useState('');

  // předfiltr z titulní strany: /tasks?assignee=me zapne „Moje úkoly"
  // (user může doběhnout až po mountu, proto effect a ne init state).
  // /tasks?assignee=<e-mail> = konkrétní člověk (odkaz z přehledu Organizace).
  useEffect(() => {
    const wanted = searchParams.get('assignee');
    if (!wanted || !user?.email) return;
    if (wanted !== 'me' && !wanted.includes('@')) return;
    setAssigneeFilter(wanted === 'me' ? user.email : wanted.toLowerCase());
    setOwnerFilter(ALL);
    searchParams.delete('assignee');
    setSearchParams(searchParams, { replace: true });

  }, [user, searchParams]);

  // předfiltr /tasks?owner=delegated zapne „Zadal jsem"
  useEffect(() => {
    if (searchParams.get('owner') !== 'delegated') return;
    setOwnerFilter('delegated');
    setAssigneeFilter(ALL);
    searchParams.delete('owner');
    setSearchParams(searchParams, { replace: true });

  }, [searchParams]);

  // deep-link termínu z panelu „Můj den" na Home: /tasks?deadline=overdue|today|week
  useEffect(() => {
    const dl = searchParams.get('deadline');
    if (!['overdue', 'today', 'week'].includes(dl)) return;
    setDeadlineFilter(dl);
    searchParams.delete('deadline');
    setSearchParams(searchParams, { replace: true });

  }, [searchParams]);

  // deep-link z Home: /tasks?status=done ukáže odbavenou práci — odpověď na
  // otázku „kam se mi ten úkol poděl, když jsem klikl na hotovo"
  useEffect(() => {
    const st = searchParams.get('status');
    if (!['todo', 'in_progress', 'done'].includes(st)) return;
    setStatusFilter(st);
    searchParams.delete('status');
    setSearchParams(searchParams, { replace: true });

  }, [searchParams]);

  const matchesFilters = (it) => {
    if (mapFilter === NONE && it.map_id) return false;
    if (mapFilter !== ALL && mapFilter !== NONE && it.map_id !== mapFilter) return false;
    if (nodeFilter && it.node_id !== nodeFilter) return false;
    if (assigneeFilter === NONE && it.assignee_email) return false;
    // e-maily bez ohledu na velikost písmen — server (Organizace, v1 API) je posílá malými
    if (assigneeFilter !== ALL && assigneeFilter !== NONE && String(it.assignee_email || '').toLowerCase() !== String(assigneeFilter).toLowerCase()) return false;
    // „Zadal jsem": já autor (u úkolu created_by = owner_email; u uzlu = vlastník
    // mapy, tj. kdo uzel přiřadil), řešitel někdo jiný. Delegace v killBottlenecku je
    // hlavně přes uzly (vlastník mapy přiřadí uzel osobě), proto e-mail, ne id.
    if (ownerFilter === 'delegated' && !(it.created_by === user?.email && it.assignee_email && it.assignee_email !== user?.email)) return false;
    if (statusFilter !== ALL && it.status !== statusFilter) return false;
    if (deadlineFilter === 'overdue' && getDeadlineStatus(it.deadline, it.status) !== 'overdue') return false;
    if (deadlineFilter === 'today') {
      if (!it.deadline || it.status === 'done') return false;
      const days = Math.round((new Date(it.deadline + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000);
      if (days !== 0) return false;
    }
    if (deadlineFilter === 'week') {
      if (!it.deadline || it.status === 'done') return false;
      const st = getDeadlineStatus(it.deadline, it.status);
      const days = Math.round((new Date(it.deadline + 'T00:00:00') - new Date().setHours(0, 0, 0, 0)) / 86400000);
      if (st === 'overdue' || days > 7) return false;
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!(it.title || '').toLowerCase().includes(q) && !hledaciText(it.description).includes(q)) return false;
    }
    return true;
  };

  // Zásobník: sekce se ukazuje, jen když nescopuju na mapu/cizí osobu/stav
  // (nápady nemají mapu, přiřazení ani stav — filtr by lhal). Filtr „Moje
  // úkoly" zásobník NEschovává — nápady jsou vždy moje (chipy v panelu Můj den
  // ho nastavují často a zásobník pak „mizel"). Hledání a termín platí.
  // „Zadal jsem" (delegace jiným) zásobník SCHOVÁVÁ — moje nápady nejsou delegované.
  const bufferVisible = mapFilter === ALL && statusFilter === ALL && !nodeFilter
    && ownerFilter === ALL
    && (assigneeFilter === ALL || assigneeFilter === user?.email);

  const clearNodeFilter = () => {
    setNodeFilter('');
    searchParams.delete('node');
    setSearchParams(searchParams, { replace: true });
  };

  const nodeFilterLabel = useMemo(() => {
    if (!nodeFilter) return '';
    for (const m of maps) {
      const node = (m.nodes || []).find((n) => n.id === nodeFilter);
      if (node) return node.data?.title || node.data?.apexText || t('tasksPage.nodeFallback');
    }
    return t('tasksPage.nodeFallback');
  }, [nodeFilter, maps, t]);

  return {
    mapFilter, setMapFilter, nodeFilter, setNodeFilter,
    assigneeFilter, setAssigneeFilter, ownerFilter, setOwnerFilter,
    statusFilter, setStatusFilter, deadlineFilter, setDeadlineFilter,
    search, setSearch,
    matchesFilters, bufferVisible, clearNodeFilter, nodeFilterLabel,
  };
}
