import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useTasks } from '@/hooks/useTasks';
import TaskTable from '@/components/tasks/TaskTable';
import MyDaySection from '@/components/shared/MyDaySection';
import TimeLogPanel from '@/components/time/TimeLogPanel';
import ReportRailButton from '@/components/shared/ReportRailButton';
import TaskBoard from '@/components/tasks/TaskBoard';
import TaskCalendar from '@/components/tasks/TaskCalendar';
import TaskDialog from '@/components/tasks/TaskDialog';
import NewNodeDialog from '@/components/tasks/NewNodeDialog';
import BufferPanel, { useBufferNodes, BufferEditDialog } from '@/components/goal-map/BufferPanel';
import NodeEditDialog from '@/components/shared/NodeEditDialog';
import NewMapActions from '@/components/shared/NewMapActions';
import { useMapCreation } from '@/hooks/useMapCreation';
import { isExternalOwner, useMembersWithContacts } from '@/lib/externalContacts';
import { shareMap } from '@/functions/shareMap';
import { cycleStatus } from '@/lib/statusMeta';
import { patchNodeData } from '@/lib/taskActions';
import { addNodeToMap as addNodeToMapShared } from '@/lib/mapNodes';
import { computeWaitingSet } from '@/lib/waitStatus';
import AppHeader from '@/components/shared/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SkinPattern from '@/components/shared/SkinPattern';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Loader2, CheckSquare, Search, X, LayoutList, Columns3, CalendarDays, Download, CircleUser, Send } from 'lucide-react';
import { exportTasksCsv, exportMarkdownReport } from '@/lib/taskExport';
import { useToast } from '@/components/ui/use-toast';
import { STATUSES } from '@/lib/statusMeta';
import { getDeadlineStatus } from '@/lib/nodeMeta';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { popisJakoText } from '@/lib/popisFormat';

// Popis bez značek pro hledání. ⚠️ S pamětí: predikát filtru se volá pro každou
// položku při KAŽDÉM stisku klávesy ve vyhledávání, takže rozebírat popis znovu
// a znovu se u delších textů projeví (nález panelu 19. 8. 2026).
const hledaciCache = new Map();
function hledaciText(popis) {
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

const ALL = '__all__';
const NONE = '__none__'; // „Bez mapy" / „Nepřiřazené" (Radix Select neumí prázdný string)

export default function Tasks() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation('tasks');
  const [searchParams, setSearchParams] = useSearchParams();
  const tasksApi = useTasks(user);
  const { items, loading, byParent } = tasksApi;

  const [maps, setMaps] = useState([]);
  const [view, setView] = useState(() => nactiKlic('kb-tasks-view') || 'table');
  const [mapFilter, setMapFilter] = useState(searchParams.get('map') || ALL);
  const [nodeFilter, setNodeFilter] = useState(searchParams.get('node') || '');
  const [assigneeFilter, setAssigneeFilter] = useState(ALL);
  // ownerFilter: ALL | 'delegated' (úkoly, které jsem zadal někomu jinému)
  const [ownerFilter, setOwnerFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [deadlineFilter, setDeadlineFilter] = useState(ALL);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const buffer = useBufferNodes(user);
  const [editBufferItem, setEditBufferItem] = useState(null);
  // nápad čekající na převod na úkol (dialog otevřen, smaže se po založení)
  // Levé plovoucí panely (zásobník + měření času, stejné jako na titulce) —
  // sdílené localStorage klíče; otevřený panel obsah ODSOUVÁ doprava a naráz
  // je otevřený nejvýš jeden (jinak by se překrývaly).
  const [bufferOpen, setBufferOpen] = useState(() => nactiKlic('kb-buffer-open') === '1');
  const [timeLogOpen, setTimeLogOpen] = useState(() =>
    nactiKlic('kb-timelog-open') === '1' && nactiKlic('kb-buffer-open') !== '1');
  const toggleBuffer = () => {
    setBufferOpen((o) => {
      ulozKlic('kb-buffer-open', o ? '0' : '1');
      if (!o) { setTimeLogOpen(false); ulozKlic('kb-timelog-open', '0'); }
      return !o;
    });
  };
  const toggleTimeLog = () => {
    setTimeLogOpen((o) => {
      ulozKlic('kb-timelog-open', o ? '0' : '1');
      if (!o) { setBufferOpen(false); ulozKlic('kb-buffer-open', '0'); }
      return !o;
    });
  };
  // členové + externí kontakty (external:true) — viz useMembersWithContacts
  const [members, reloadMembers] = useMembersWithContacts(user);
  const [org, setOrg] = useState(null);
  const [editNodeItem, setEditNodeItem] = useState(null);
  // Globální „create mapy" akce v hlavičce sdílené s Home (Nový projekt / Navrhnout s AI / Mapa z textu).
  const { ai, creating, openCreate: openNewProject, openAi, dialogs: mapCreationDialogs } = useMapCreation();

  useEffect(() => {
    if (!isLoadingAuth && !user) navigate('/login');
  }, [isLoadingAuth, user, navigate]);

  // Načtení map je i mimo první render: řádková akce v „Můj den" může sáhnout
  // na uzel mapy, a pak je potřeba znovu natáhnout stromy, ne jen úkoly.
  const loadMaps = useCallback(async () => {
    try {
      // org struktura (kind='org') do tabulky úkolů NEPATŘÍ — popisuje kdo je
      // kdo, ne práci; server na ní úkoly stejně odmítá (nález Richardova
      // klik-testu 15. 8.: organizace se tu ukazovala jako projekt)
      const bezOrg = (list) => list.filter((m) => m.kind !== 'org');
      // fáze 1: metadata bez JSON blobů — okamžitý render hlaviček/filtrů
      const meta = await base44.entities.GoalMap.list('-updated_date', 200, {
        fields: 'id,title,owner,owner_email,shared_with,shared_with_edit,shared_with_work,is_public,team_access,color,archived,kind,created,updated',
      });
      setMaps((prev) => (prev.length ? prev : bezOrg(meta)));
      // fáze 2: plné mapy (stromy uzlů) na pozadí
      setMaps(bezOrg(await base44.entities.GoalMap.list('-updated_date', 200)));
    } catch {
      // mapy jen obohacují zobrazení
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    loadMaps();
    base44.org.get().then(setOrg).catch(() => {});
  }, [user, loadMaps]);

  const changeView = (v) => {
    setView(v);
    ulozKlic('kb-tasks-view', v);
  };

  // předfiltr z titulní strany: /tasks?assignee=me zapne „Moje úkoly"
  // (user může doběhnout až po mountu, proto effect a ne init state)
  useEffect(() => {
    if (searchParams.get('assignee') !== 'me' || !user?.email) return;
    setAssigneeFilter(user.email);
    setOwnerFilter(ALL);
    searchParams.delete('assignee');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams]);

  // předfiltr /tasks?owner=delegated zapne „Zadal jsem"
  useEffect(() => {
    if (searchParams.get('owner') !== 'delegated') return;
    setOwnerFilter('delegated');
    setAssigneeFilter(ALL);
    searchParams.delete('owner');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // deep-link termínu z panelu „Můj den" na Home: /tasks?deadline=overdue|today|week
  useEffect(() => {
    const dl = searchParams.get('deadline');
    if (!['overdue', 'today', 'week'].includes(dl)) return;
    setDeadlineFilter(dl);
    searchParams.delete('deadline');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // deep-link z Home: /tasks?status=done ukáže odbavenou práci — odpověď na
  // otázku „kam se mi ten úkol poděl, když jsem klikl na hotovo"
  useEffect(() => {
    const st = searchParams.get('status');
    if (!['todo', 'in_progress', 'done'].includes(st)) return;
    setStatusFilter(st);
    searchParams.delete('status');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // deep-link z Home: /tasks?convert=<id nápadu> otevře převod nápadu na úkol
  // (Home nemá dialog úkolu — převod se dokončí tady výběrem projektu)
  useEffect(() => {
    const cid = searchParams.get('convert');
    if (!cid || !buffer.loaded) return; // počkat na PRVNÍ načtení (prázdný ≠ nenačtený)
    const item = buffer.items.find((b) => b.id === cid);
    searchParams.delete('convert'); // param uklidit i když nápad mezitím zmizel
    setSearchParams(searchParams, { replace: true });
    if (item) handleConvertBuffer(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, buffer.items, buffer.loaded]);

  // deep-link z notifikace: /tasks?task=<id> otevře rovnou dialog úkolu.
  // Když úkol v načteném seznamu ještě není (přišel notifikací zvenku),
  // jednou se seznam přenačte a param se drží, dokud se úkol neobjeví.
  const deepLinkRefreshRef = useRef('');
  useEffect(() => {
    const taskId = searchParams.get('task');
    if (!taskId) return;
    const found = items.find((i) => i.id === taskId);
    if (found) {
      setEditTask(found);
      setDialogOpen(true);
      searchParams.delete('task');
      setSearchParams(searchParams, { replace: true });
    } else if (deepLinkRefreshRef.current !== taskId) {
      deepLinkRefreshRef.current = taskId;
      tasksApi.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, searchParams]);

  // počty komentářů úkolů pro badge v tabulce/kanbanu; přenačítá se po zavření dialogu
  const [commentCounts, setCommentCounts] = useState({});
  useEffect(() => {
    if (!user || dialogOpen) return;
    base44.entities.TaskComment.list('-created_date', 1000)
      .then((list) => {
        const counts = {};
        for (const c of list || []) counts[c.task_id] = (counts[c.task_id] || 0) + 1;
        setCommentCounts(counts);
      })
      .catch(() => {});
  }, [user, dialogOpen]);

  // e-maily pro našeptávač/filtr: členové týmu + sdílení map + assignees úkolů
  // (BEZ pseudo-e-mailů externích kontaktů — do e-mailových našeptávačů nepatří)
  const emailOptions = useMemo(() => {
    const set = new Set();
    if (user?.email) set.add(user.email);
    for (const m of members) if (!m.external) set.add(m.email);
    for (const m of maps) {
      if (m.created_by) set.add(m.created_by);
      for (const em of m.shared_with || []) set.add(em);
    }
    for (const task of items) if (task.assignee_email && !isExternalOwner(task.assignee_email)) set.add(task.assignee_email);
    return [...set].sort();
  }, [maps, items, user, members]);

  const matchesFilters = (it) => {
    if (mapFilter === NONE && it.map_id) return false;
    if (mapFilter !== ALL && mapFilter !== NONE && it.map_id !== mapFilter) return false;
    if (nodeFilter && it.node_id !== nodeFilter) return false;
    if (assigneeFilter === NONE && it.assignee_email) return false;
    if (assigneeFilter !== ALL && assigneeFilter !== NONE && it.assignee_email !== assigneeFilter) return false;
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
  const nodeTrees = useMemo(() => {
    const prune = (list) => list
      .map((n) => {
        const children = prune(n.children);
        if (matchesFilters(n) || children.length > 0) return { ...n, children };
        return null;
      })
      .filter(Boolean);

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
      const roots = Object.values(byId).filter((n) => !hasParent.has(n.node_id));
      const pruned = prune(roots);
      if (pruned.length > 0) res[m.id] = pruned;
    }
    return res;
  }, [activeMaps, mapFilter, nodeFilter, assigneeFilter, ownerFilter, statusFilter, deadlineFilter, search, t]);

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

  const openNodeInMap = (item) => navigate(`/map/${item.map_id}?node=${item.node_id}`);

  // Úprava vzhledu projektu z hlavičky v tabulce (barva / emoji v názvu).
  // Zapisuje jen skalární pole (color/title) bez base_updated → hook 409 přeskočí.
  const handleEditAppearance = async (map, patch) => {
    try {
      const updated = await base44.entities.GoalMap.update(map.id, patch);
      setMaps((prev) => prev.map((m) => (m.id === map.id ? { ...m, ...patch, updated_date: updated.updated_date } : m)));
    } catch (e) {
      toast({ title: t('tasksPage.appearanceFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  // Tužka na hlavičce projektu → plná editace hlavního cíle (vrcholového uzlu).
  const handleEditProject = (map) => {
    const nodes = map.nodes || [];
    const apex = nodes.find((n) => n.type === 'apexNode' || n.data?.nodeType === 'apex') || nodes[0];
    if (!apex) {
      toast({ title: t('tasksPage.noApexGoal'), variant: 'destructive' });
      return;
    }
    setEditNodeItem({
      id: `node-item-${map.id}-${apex.id}`,
      isNode: true,
      title: apex.data?.title || apex.data?.apexText || '',
      status: apex.data?.status || 'todo',
      deadline: apex.data?.deadline || '',
      assignee_email: apex.data?.owner || '',
      map_id: map.id,
      node_id: apex.id,
    });
  };

  // Rychlá paleta ikony uzlu (emoji) z tabulky → zápis do mapy.
  const handleSetNodeIcon = (item, emoji) => {
    updateMapNode(item, { icon: emoji }).catch(() => {});
  };

  // Ikona projektu = ikona vrcholového (apex) uzlu (jeden zdroj) → zápis do apexu.
  const handleSetProjectIcon = (map, emoji) => {
    const nodes = map.nodes || [];
    const apex = nodes.find((n) => n.type === 'apexNode' || n.data?.nodeType === 'apex') || nodes[0];
    if (!apex) return;
    updateMapNode({ map_id: map.id, node_id: apex.id }, { icon: emoji }).catch(() => {});
  };

  // Odložení cíle-uzlu do zásobníku přímo z řádku tabulky (bez otevírání
  // dialogu). Čerstvý fetch mapy vytáhne i popis/barvu uzlu — jinak by se
  // odložením ztratily (řádek nese jen titulek a termín).
  const handleStashNodeItem = async (item) => {
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
  };

  // Zápis do uzlu mapy ze stránky Úkoly. Vlastní zápis dělá sdílený primitiv
  // lib/taskActions.js:patchNodeData (čerstvé načtení mapy těsně před zápisem
  // zmenšuje okno pro kolizi s auto-save otevřeného editoru) — tady zůstává jen
  // to, co je stránce vlastní: volitelná změna typu uzlu, lokální stav a hláška.
  const updateMapNode = async (item, patch, nodeType) => {
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
  };

  // Uzel se zadaným úkolem (termínem) odstraní jen zadavatel (assignedBy,
  // legacy fallback vlastník mapy) nebo vlastník — server to vynucuje na PATCH,
  // tady kvůli pořadí u stashe (nápad se nesmí zduplikovat do zásobníku).
  const nodeRemovalBlockedBy = (map, rawNode) => {
    if (!rawNode?.data?.deadline) return null;
    const assigner = rawNode.data.assignedBy || map?.created_by || '';
    if (user?.email === map?.created_by || user?.email === assigner) return null;
    return assigner;
  };

  // odstranění uzlu z mapy (hrany na něj napojené padají s ním, potomci se odpojí)
  const removeMapNode = async (mapId, nodeId) => {
    const fresh = (await base44.entities.GoalMap.filter({ id: mapId }))[0];
    if (!fresh) throw new Error(t('tasksPage.mapNotFound'));
    const blocked = nodeRemovalBlockedBy(fresh, (fresh.nodes || []).find((n) => n.id === nodeId));
    if (blocked) throw new Error(t('tasksPage.nodeRemoveAssignerOnly', { email: blocked }));
    const nodes = (fresh.nodes || []).filter((n) => n.id !== nodeId);
    const edges = (fresh.edges || []).filter((e) => e.source !== nodeId && e.target !== nodeId);
    await base44.entities.GoalMap.update(mapId, { nodes, edges });
    setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, nodes, edges } : m)));
  };

  // přisdílení mapy (spolupracovník) při přiřazení člena bez přístupu — smí jen vlastník
  const shareMapWith = async (mapId, email) => {
    try {
      // quiet: součást zadání práce — adresát dostane notifikaci o přidělené
      // práci, druhá o sdílení by byla duplikát (Richard 21. 8.)
      const res = await shareMap({ action: 'share', mapId, email, permission: 'work', quiet: true });
      if (res.data?.error) {
        toast({ title: t('tasksPage.shareFailed'), description: res.data.error, variant: 'destructive' });
        return false;
      }
      setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, shared_with: [...(m.shared_with || []), email] } : m)));
      toast({ title: t('tasksPage.mapShared'), description: t('tasksPage.mapSharedDesc', { email }) });
      return true;
    } catch (e) {
      toast({ title: t('tasksPage.shareFailed'), description: e.response?.data?.error || t('tasksPage.shareOwnerOnly'), variant: 'destructive' });
      return false;
    }
  };

  // „Vidí mapu" NESTAČÍ — rozhoduje PRACOVNÍ úroveň (Richard 20. 8. 2026: kdo
  // dostane úkol, musí ho umět vyřešit, a nebo se zadavateli musí nabídnout, ať
  // mu dá jiná práva). Čtenář svůj krok odškrtne i tak (server ho pustí), ale
  // zadavatel by netušil, že ten člověk má mapu jen ke čtení.
  const nodeHasWorkAccess = (map, email) => {
    if (!email || !map) return true;
    if (map.team_access === 'edit') return true;
    return map.created_by === email
      || (map.shared_with_work || []).includes(email)
      || (map.shared_with_edit || []).includes(email);
  };
  const nodeIsShared = (map, email) => !!map && ((map.shared_with || []).includes(email) || !!map.team_access);

  const handleCycleNodeItem = (item) => {
    if (item.status === 'todo' && item.waiting) {
      if (!window.confirm(t('tasksPage.confirmStartWaiting'))) return;
    }
    updateMapNode(item, { status: cycleStatus(item.status) }).catch(() => {});
  };

  const handleAssignNodeItem = async (item, email) => {
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
  };

  // adaptér pro sjednocený NodeEditDialog (stejný jako na plátně)
  const handleSaveNodeFull = async (nodeId, newData, nodeType) => {
    try {
      await updateMapNode({ map_id: editNodeItem.map_id, node_id: nodeId }, newData, nodeType);
      setEditNodeItem(null);
    } catch { /* toast řeší updateMapNode */ }
  };

  const handleStashNodeFromTable = async (nodeId, override) => {
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
  };

  const handleDeleteNodeFromTable = async (nodeId) => {
    const item = editNodeItem;
    if (!window.confirm(t('tasksPage.confirmDeleteNode', { title: item?.title }))) return;
    try {
      await removeMapNode(item.map_id, nodeId);
      setEditNodeItem(null);
      toast({ title: t('tasksPage.nodeDeletedToast'), description: item?.title });
    } catch (e) {
      toast({ title: t('tasksPage.deleteFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  // Nový uzel do mapy ze seznamu. parentNodeId: id uzlu / 'auto' (pod vrchol) / null (kořen).
  // Založení uzlu drží sdílený primitiv lib/mapNodes.js — používá ho i rychlé
  // přidání v lite režimu, ať nevzniknou dvě různá chování téhož.
  const addNodeToMap = async (mapId, parentNodeId, title) => {
    const { nodeId, nodes, edges } = await addNodeToMapShared(mapId, parentNodeId, title);
    setMaps((prev) => prev.map((m) => (m.id === mapId ? { ...m, nodes, edges } : m)));
    return nodeId;
  };

  const handleQuickAddNode = async (mapId, title) => {
    try {
      await addNodeToMap(mapId, 'auto', title);
    } catch (e) {
      toast({ title: t('tasksPage.addGoalFailed'), description: e?.message, variant: 'destructive' });
      throw e;
    }
  };

  const handleAddChildNode = async (item) => {
    try {
      const newId = await addNodeToMap(item.map_id, item.node_id, t('tasksPage.newSubgoal'));
      setEditNodeItem({
        id: `node-item-${item.map_id}-${newId}`,
        isNode: true,
        title: t('tasksPage.newSubgoal'),
        status: 'todo',
        deadline: '',
        assignee_email: '',
        map_id: item.map_id,
        node_id: newId,
      });
    } catch (e) {
      toast({ title: t('tasksPage.addSubgoalFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  // Zásobník: sekce se ukazuje, jen když nescopuju na mapu/cizí osobu/stav
  // (nápady nemají mapu, přiřazení ani stav — filtr by lhal). Filtr „Moje
  // úkoly" zásobník NEschovává — nápady jsou vždy moje (chipy v panelu Můj den
  // ho nastavují často a zásobník pak „mizel"). Hledání a termín platí.
  // „Zadal jsem" (delegace jiným) zásobník SCHOVÁVÁ — moje nápady nejsou delegované.
  const bufferVisible = mapFilter === ALL && statusFilter === ALL && !nodeFilter
    && ownerFilter === ALL
    && (assigneeFilter === ALL || assigneeFilter === user?.email);
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

  // Nápad opouští zásobník JAKO UZEL pod hlavním cílem vybraného projektu —
  // model 27. 7.: „uzel je úkol; když nemáš kam dát, čeká v zásobníku."
  // Dřívější převod na úkolový záznam byl pozůstatek volných úkolů (Richard
  // 7. 8. 2026 v noci: „to bylo v minulosti a pak se řeklo, že uzel je úkol
  // a musí být vždy v projektu").
  const [placeIdea, setPlaceIdea] = useState(null);
  const handleConvertBuffer = (item) => setPlaceIdea(item);
  const handlePlaceIntoMap = async (mapMeta) => {
    const item = placeIdea;
    if (!item) return;
    try {
      // čerstvá mapa — seznam na stránce může být starý a přepsal by cizí práci
      const fresh = (await base44.entities.GoalMap.filter({ id: mapMeta.id }))[0];
      const nodes = Array.isArray(fresh.nodes) ? [...fresh.nodes] : [];
      const edges = Array.isArray(fresh.edges) ? [...fresh.edges] : [];
      const apex = nodes.find((n) => n.type === 'apexNode');
      if (!apex) throw new Error('mapa bez vrcholu');
      const id = `node-${Date.now()}`;
      const sourozenci = edges.filter((e) => e.source === apex.id).length;
      nodes.push({
        id, type: 'goalNode',
        position: { x: (apex.position?.x || 0) + 40 + sourozenci * 40, y: (apex.position?.y || 0) + 260 },
        data: { title: item.title, status: 'todo', description: item.description || '',
          color: item.color || '', deadline: item.deadline || '', nodeType: 'normal', goalType: '', apexText: '' },
      });
      edges.push({ id: `edge-${Date.now()}`, source: apex.id, target: id });
      await base44.entities.GoalMap.update(fresh.id, { nodes, edges });
      try { await buffer.remove(item.id); } catch { /* nápad zůstane, smaže se ručně */ }
      setPlaceIdea(null);
      toast({ title: t('tasksPage.ideaPlaced'), description: t('tasksPage.ideaPlacedDesc', { title: item.title, project: fresh.title || '' }) });
      loadMaps();
    } catch {
      toast({ title: t('tasksPage.ideaPlaceFailed'), variant: 'destructive' });
    }
  };

  const handleDeleteBuffer = (item) => {
    if (!window.confirm(t('tasksPage.confirmDeleteIdea', { title: item.title }))) return;
    buffer.remove(item.id);
  };

  // Úkol → zásobník: přesun (úkol vč. podúkolů a komentářů zmizí, vznikne nápad)
  const handleStashTask = async (task) => {
    // stash = smazání úkolu → stejná práva jako koš (zadavatel / vlastník projektu);
    // kontrola PŘED zápisem do zásobníku, jinak by se nápad zduplikoval
    const srcMap = maps.find((m) => m.id === task.map_id);
    if (task.created_by !== user?.email && srcMap?.created_by !== user?.email) {
      toast({ title: t('tasksPage.deleteFailed'), variant: 'destructive' });
      return;
    }
    const subCount = (byParent[task.id] || []).length;
    const warn = subCount > 0
      ? t('tasksPage.confirmStashTaskWithSubs', { title: task.title, subCount })
      : t('tasksPage.confirmStashTask', { title: task.title });
    if (!window.confirm(warn)) return;
    try {
      await buffer.add({ title: task.title, description: task.description || '', deadline: task.deadline || '' });
      await tasksApi.remove(task.id);
      setDialogOpen(false);
      toast({ title: t('tasksPage.stashedToBuffer'), description: task.title });
    } catch {
      toast({ title: t('tasksPage.stashFailed'), variant: 'destructive' });
    }
  };

  // „Nový úkol" zakládá UZEL (rozhodnutí Richarda 17. 8. 2026) — pod hlavní
  // cíl, nebo pod vybraný uzel; řešitel/termín hned v dalším kroku (dialog uzlu).
  const openCreate = () => setNewNodeOpen(true);

  const handleCreateNode = async (mapId, parentId, title) => {
    try {
      const newId = await addNodeToMap(mapId, parentId, title);
      setEditNodeItem({
        id: `node-item-${mapId}-${newId}`,
        isNode: true,
        title,
        status: 'todo',
        deadline: '',
        assignee_email: '',
        map_id: mapId,
        node_id: newId,
      });
    } catch (e) {
      toast({ title: t('newNode.createFailed'), description: e?.message, variant: 'destructive' });
      throw e;
    }
  };

  // editace zbylé položky (detektor chyby) — TaskDialog už jen upravuje, nic nezakládá
  const openEdit = (task) => {
    setEditTask(task);
    setDialogOpen(true);
  };

  const handleSave = async (data, taskId) => {
    try {
      if (!taskId) throw new Error(t('common:misc.saveFailed'));
      await tasksApi.update(taskId, data);
    } catch (e) {
      toast({ title: t('common:misc.saveFailed'), description: e?.message || t('common:misc.tryAgainPlease'), variant: 'destructive' });
      throw e;
    }
  };

  const handleCycle = (task, next) => {
    tasksApi.update(task.id, { status: next }).catch(() => {
      toast({ title: t('common:misc.statusChangeFailed'), variant: 'destructive' });
    });
  };

  const handleDelete = (task) => {
    const subCount = (byParent[task.id] || []).length;
    const msg = subCount > 0
      ? t('tasksPage.confirmDeleteTaskWithSubs', { title: task.title, subCount })
      : t('tasksPage.confirmDeleteTask', { title: task.title });
    if (!window.confirm(msg)) return;
    tasksApi.remove(task.id).catch(() => toast({ title: t('tasksPage.deleteFailed'), variant: 'destructive' }));
  };

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

  if (isLoadingAuth || !user) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-background relative transition-[padding] ${bufferOpen ? 'sm:pl-72' : timeLogOpen ? 'sm:pl-80' : ''}`}>
      <SkinPattern />
      <AppHeader
        active="tasks"
        org={org}
        onInvited={reloadMembers}
        actions={
          <NewMapActions
            onCreate={openNewProject}
            onAi={openAi}
            ai={ai}
            creating={creating}
          />
        }
      />

      <BufferPanel buffer={buffer} canEdit={false} onConvert={handleConvertBuffer} open={bufferOpen} onToggle={toggleBuffer} fixed leftOffset={timeLogOpen ? 320 : 0} />
      <TimeLogPanel fixed open={timeLogOpen} onToggle={toggleTimeLog} leftOffset={bufferOpen ? 288 : 0} />
      <ReportRailButton fixed top="top-40" leftOffset={bufferOpen ? 288 : timeLogOpen ? 320 : 0} />

      <div className="max-w-6xl mx-auto px-4 py-6">
        <MyDaySection
          user={user}
          ideas={buffer.items}
          onOpenIdea={(item) => setEditBufferItem(item.raw)}
          orgName={org?.name}
          orgLogo={org?.logo_url}
          // Na Úkolech je pod panelem hned tabulka téhož — výchozí je sbalený
          // a pamatuje se ZVLÁŠŤ od Projektů (Richard 11. 8.)
          storageKey="kb-myday-tasks"
          defaultCollapsed
          // Klik vede DO MAPY na uzel, stejně jako u cíle (viz Home.jsx).
          // Editovat jde v mapě tužkou nebo dvojklikem a tady v tabulce.
          onOpenTask={(item) => {
            if (item.mapId && item.nodeId) { openNodeInMap({ map_id: item.mapId, node_id: item.nodeId }); return; }
            const orphan = items.find((x) => x.id === item.id); // osiřelý úkol bez uzlu (stará data)
            if (orphan) openEdit(orphan);
          }}
          onOpenNode={(item) => openNodeInMap({ map_id: item.mapId, node_id: item.id })}
          // řádková akce mohla sáhnout na úkol i na uzel mapy → načíst obojí
          onChanged={() => { tasksApi.refresh(); loadMaps(); }}
          onChipClick={(kind) => {
            if (kind === 'delegated') {
              setOwnerFilter('delegated');
              setAssigneeFilter(ALL);
              setDeadlineFilter(ALL);
              return;
            }
            setOwnerFilter(ALL);
            if (user?.email) setAssigneeFilter(user.email);
            setDeadlineFilter(['overdue', 'today', 'week'].includes(kind) ? kind : ALL);
            // „hotovo: N" v panelu → ukázat odbavenou práci
            setStatusFilter(kind === 'done' ? 'done' : ALL);
          }}
        />

        <div className="flex flex-wrap items-center gap-2 mb-5">
          <Tabs value={view} onValueChange={changeView}>
            <TabsList>
              <TabsTrigger value="table" className="gap-1.5">
                <LayoutList className="w-3.5 h-3.5" /> {t('tasksPage.viewTable')}
              </TabsTrigger>
              <TabsTrigger value="board" className="gap-1.5">
                <Columns3 className="w-3.5 h-3.5" /> {t('tasksPage.viewBoard')}
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-1.5">
                <CalendarDays className="w-3.5 h-3.5" /> {t('tasksPage.viewCalendar')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant={assigneeFilter === user?.email ? 'default' : 'outline'}
            size="sm"
            className="h-9"
            onClick={() => {
              const on = assigneeFilter === user?.email;
              setAssigneeFilter(on ? ALL : user?.email);
              if (!on) setOwnerFilter(ALL);
            }}
            title={t('tasksPage.myTasksTitle')}
          >
            <CircleUser className="w-4 h-4" /> {t('tasksPage.myTasks')}
          </Button>

          <Button
            variant={ownerFilter === 'delegated' ? 'default' : 'outline'}
            size="sm"
            className="h-9"
            onClick={() => {
              const on = ownerFilter === 'delegated';
              setOwnerFilter(on ? ALL : 'delegated');
              if (!on) setAssigneeFilter(ALL);
            }}
            title={t('tasksPage.delegatedTitle')}
          >
            <Send className="w-4 h-4" /> {t('tasksPage.delegated')}
          </Button>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('tasksPage.searchPlaceholder')}
              className="h-9 w-44 pl-8"
            />
          </div>

          <Select value={mapFilter} onValueChange={(v) => { setMapFilter(v); if (v !== mapFilter) clearNodeFilter(); }}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('tasksPage.filterAllMaps')}</SelectItem>
              <SelectItem value={NONE}>{t('tasksPage.filterNoMap')}</SelectItem>
              {activeMaps.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.title || t('common:misc.untitled')}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('tasksPage.filterAnyone')}</SelectItem>
              <SelectItem value={NONE}>{t('tasksPage.filterUnassigned')}</SelectItem>
              {emailOptions.map((em) => (
                <SelectItem key={em} value={em}>{em === user?.email ? t('tasksPage.myTasks') : em}</SelectItem>
              ))}
              {/* externí kontakty — filtr „co má u mě účetní/dodavatel" (jménem, ne pseudo-e-mailem) */}
              {members.filter((m) => m.external).map((m) => (
                <SelectItem key={m.email} value={m.email}>{m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('tasksPage.filterAllStatuses')}</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={deadlineFilter} onValueChange={setDeadlineFilter}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('tasksPage.filterDeadlineAll')}</SelectItem>
              <SelectItem value="overdue">{t('tasksPage.filterOverdue')}</SelectItem>
              <SelectItem value="today">{t('tasksPage.filterToday')}</SelectItem>
              <SelectItem value="week">{t('tasksPage.filterWeek')}</SelectItem>
            </SelectContent>
          </Select>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9" title={t('tasksPage.exportTitle')}>
                <Download className="w-4 h-4" /> <span className="hidden lg:inline">{t('tasksPage.exportButton')}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => exportTasksCsv({ tasks: topLevel, byParent, maps: activeMaps })}>
                {t('tasksPage.exportCsv')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportMarkdownReport({ tasks: topLevel, byParent, maps: activeMaps, nodeTrees, orgName: org?.name })}>
                {t('tasksPage.exportMd')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {nodeFilter && (
            <button
              onClick={clearNodeFilter}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
              title={t('tasksPage.clearNodeFilterTitle')}
            >
              {t('tasksPage.nodeFilterChip', { label: nodeFilterLabel })}
              <X className="w-3 h-3" />
            </button>
          )}

          <Button onClick={openCreate} className="ml-auto">
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">{t('tasksPage.newTask')}</span>
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : items.length === 0 && Object.keys(nodeTrees).length === 0 && bufferItems.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mx-auto mb-4">
              <CheckSquare className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-heading text-lg font-semibold mb-1">{t('tasksPage.emptyTitle')}</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {t('tasksPage.emptyDesc')}
            </p>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" /> {t('tasksPage.createFirstTask')}
            </Button>
          </div>
        ) : view === 'calendar' ? (
          <TaskCalendar
            items={calendarItems}
            onOpen={(it) => (it.kind === 'node' ? setEditNodeItem(it.raw) : openEdit(it.raw))}
          />
        ) : view === 'board' ? (
          <TaskBoard
            tasks={topLevel}
            byParent={byParent}
            maps={activeMaps}
            nodeItems={boardNodeItems}
            members={members}
            commentCounts={commentCounts}
            onEdit={openEdit}
            onOpenNode={setEditNodeItem}
            onUpdate={(id, patch) => tasksApi.update(id, patch).catch(() => toast({ title: t('tasksPage.moveFailed'), variant: 'destructive' }))}
          />
        ) : (
          <TaskTable
            tasks={topLevel}
            byParent={byParent}
            maps={activeMaps}
            members={members}
            nodeTrees={nodeTrees}
            bufferItems={bufferItems}
            commentCounts={commentCounts}
            meEmail={user?.email}
            onEditAppearance={handleEditAppearance}
            onSetProjectIcon={handleSetProjectIcon}
            onEditProject={handleEditProject}
            onSetNodeIcon={handleSetNodeIcon}
            onEdit={openEdit}
            onCycle={handleCycle}
            onDelete={handleDelete}
            onAssign={(task, email) => tasksApi.update(task.id, { assignee_email: email }).catch(() => toast({ title: t('tasksPage.assignFailed'), variant: 'destructive' }))}
            onOpenNode={openNodeInMap}
            onOpenTaskMap={(task) => navigate(`/map/${task.map_id}${task.node_id ? `?node=${task.node_id}` : ''}`)}
            onEditNodeItem={setEditNodeItem}
            onCycleNodeItem={handleCycleNodeItem}
            onAssignNodeItem={handleAssignNodeItem}
            onAddChildNode={handleAddChildNode}
            onQuickAddNode={handleQuickAddNode}
            onEditBuffer={setEditBufferItem}
            onDeleteBuffer={handleDeleteBuffer}
            onConvertBuffer={handleConvertBuffer}
            onStashTask={handleStashTask}
            onStashNodeItem={handleStashNodeItem}
            // řádková akce (odložit / připnout) — chyba přijde jako argument
            onRowAction={(err, note) => {
              if (err) { toast({ title: t('common:rowActions.failed'), description: err?.message, variant: 'destructive' }); return; }
              if (note) toast({ title: note });
              tasksApi.refresh(); loadMaps();
            }}
          />
        )}
      </div>

      <NewNodeDialog
        open={newNodeOpen}
        maps={activeMaps}
        defaultMapId={mapFilter !== ALL && mapFilter !== NONE ? mapFilter : ''}
        defaultParentId={nodeFilter || ''}
        onCreate={handleCreateNode}
        onClose={() => setNewNodeOpen(false)}
      />
      {/* editor ZBYTKOVÝCH položek (detektor): bez komentářů — nové by po
          smazání položky osiřely (migrace 1787240000 vlákna mazala jako
          „bez kontextu") */}
      <TaskDialog
        open={dialogOpen}
        task={editTask}
        maps={activeMaps}
        emailOptions={emailOptions}
        members={members}
        onSave={handleSave}
        onStash={handleStashTask}
        onClose={() => setDialogOpen(false)}
      />
      <BufferEditDialog item={editBufferItem} onSave={buffer.update} onClose={() => setEditBufferItem(null)} />

      {/* Nápad → uzel pod hlavním cílem vybraného projektu (model: žádné volné úkoly) */}
      <Dialog open={!!placeIdea} onOpenChange={(v) => { if (!v) setPlaceIdea(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tasksPage.ideaPlaceTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('tasksPage.ideaPlaceHint', { title: placeIdea?.title || '' })}
          </p>
          <div className="max-h-72 overflow-y-auto space-y-1">
            {maps.filter((m) => !m.archived).map((m) => (
              <button
                key={m.id}
                onClick={() => handlePlaceIntoMap(m)}
                className="w-full text-left px-3 py-2 rounded-lg border hover:bg-secondary text-sm"
                style={m.color ? { borderLeftWidth: 4, borderLeftColor: m.color } : undefined}
              >
                {m.title || '—'}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {editNodeItem && (() => {
        const map = maps.find((m) => m.id === editNodeItem.map_id);
        const rawNode = (map?.nodes || []).find((n) => n.id === editNodeItem.node_id);
        if (!rawNode) return null;
        return (
          <NodeEditDialog
            node={rawNode}
            mapId={editNodeItem.map_id}
            mapAccess={{ ownerEmail: map.created_by, sharedWith: map.shared_with || [], teamAccess: map.team_access || '' }}
            members={members}
            onShareAdd={(email) => shareMapWith(editNodeItem.map_id, email)}
            onContactsChanged={reloadMembers}
            onSave={handleSaveNodeFull}
            onStash={handleStashNodeFromTable}
            onDelete={handleDeleteNodeFromTable}
            onOpenMap={() => openNodeInMap(editNodeItem)}
            onClose={() => setEditNodeItem(null)}
            map={map}
            emailOptions={emailOptions}
            onTasksChanged={() => tasksApi.refresh()}
          />
        );
      })()}
      {mapCreationDialogs}
    </div>
  );
}
