import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/lib/AuthContext';
import { useTasks } from '@/hooks/useTasks';
import TaskTable from '@/components/tasks/TaskTable';
import MyDaySection from '@/components/shared/MyDaySection';
import TimeLogPanel from '@/components/time/TimeLogPanel';
import ReportRailButton from '@/components/shared/ReportRailButton';
import TaskBoard from '@/components/tasks/TaskBoard';
import TaskCalendar from '@/components/tasks/TaskCalendar';
import TaskTimeline from '@/components/tasks/TaskTimeline';
import TaskDialog from '@/components/tasks/TaskDialog';
import NewNodeDialog from '@/components/tasks/NewNodeDialog';
import BufferPanel, { useBufferNodes, BufferEditDialog } from '@/components/goal-map/BufferPanel';
import NodeEditDialog from '@/components/shared/NodeEditDialog';
import NewMapActions from '@/components/shared/NewMapActions';
import { useMapCreation } from '@/hooks/useMapCreation';
import { ulozDoMapy } from '@/lib/mapNodes';
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
import { Plus, Loader2, CheckSquare, Search, X, LayoutList, Columns3, CalendarDays, CalendarRange, Download, CircleUser, Send } from 'lucide-react';
import { exportTasksCsv, exportMarkdownReport } from '@/lib/taskExport';
import { useToast } from '@/components/ui/use-toast';
import { STATUSES } from '@/lib/statusMeta';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import { useSidePanels } from '@/hooks/useSidePanels';
import { useTaskFilters, ALL, NONE } from '@/hooks/useTaskFilters';
import { useTasksPageData } from '@/hooks/useTasksPageData';
import { useTaskTrees } from '@/hooks/useTaskTrees';
import { useMapNodeActions } from '@/hooks/useMapNodeActions';

export default function Tasks() {
  const navigate = useNavigate();
  const { user, isLoadingAuth } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation('tasks');
  const [searchParams, setSearchParams] = useSearchParams();
  const tasksApi = useTasks(user);
  const { items, loading, byParent } = tasksApi;

  const [view, setView] = useState(() => nactiKlic('kb-tasks-view') || 'table');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const buffer = useBufferNodes(user);
  const [editBufferItem, setEditBufferItem] = useState(null);
  // nápad čekající na převod na úkol (dialog otevřen, smaže se po založení)
  // Levé plovoucí panely (zásobník + měření času, stejné jako na titulce) —
  // sdílené localStorage klíče; otevřený panel obsah ODSOUVÁ doprava a naráz
  // je otevřený nejvýš jeden (jinak by se překrývaly).
  const { bufferOpen, timeLogOpen, toggleBuffer, toggleTimeLog } = useSidePanels();
  const [editNodeItem, setEditNodeItem] = useState(null);
  // Globální „create mapy" akce v hlavičce sdílené s Home (Nový projekt / Navrhnout s AI / Mapa z textu).
  const { ai, creating, openCreate: openNewProject, openAi, dialogs: mapCreationDialogs } = useMapCreation();

  useEffect(() => {
    if (!isLoadingAuth && !user) navigate('/login');
  }, [isLoadingAuth, user, navigate]);

  // data stránky: mapy (loadMaps), organizace, členové, počty komentářů,
  // e-maily pro našeptávače — viz useTasksPageData (F3-10)
  const { maps, setMaps, loadMaps, org, members, reloadMembers, commentCounts, emailOptions } =
    useTasksPageData({ user, items, dialogOpen });

  const changeView = (v) => {
    setView(v);
    ulozKlic('kb-tasks-view', v);
  };

  // filtry + URL předfiltry (?assignee/?owner/?deadline/?status) — viz
  // useTaskFilters (F3-10). Deep-linky ?convert= a ?task= otevírají DIALOGY,
  // proto zůstávají tady POD voláním hooku — relativní pořadí efektů nad
  // searchParams se nemění.
  const {
    mapFilter, setMapFilter, nodeFilter, assigneeFilter, setAssigneeFilter,
    ownerFilter, setOwnerFilter, statusFilter, setStatusFilter,
    deadlineFilter, setDeadlineFilter, search, setSearch,
    matchesFilters, bufferVisible, clearNodeFilter, nodeFilterLabel,
  } = useTaskFilters({ user, searchParams, setSearchParams, maps, t });

  // deep-link z Home: /tasks?convert=<id nápadu> otevře převod nápadu na úkol
  // (Home nemá dialog úkolu — převod se dokončí tady výběrem projektu)
  useEffect(() => {
    const cid = searchParams.get('convert');
    if (!cid || !buffer.loaded) return; // počkat na PRVNÍ načtení (prázdný ≠ nenačtený)
    const item = buffer.items.find((b) => b.id === cid);
    searchParams.delete('convert'); // param uklidit i když nápad mezitím zmizel
    setSearchParams(searchParams, { replace: true });
    if (item) handleConvertBuffer(item);

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

  }, [items, searchParams]);

  // odvozené stromy a seznamy (activeMaps, topLevel, nodeTrees, kanban,
  // kalendář, zásobník) — viz useTaskTrees (F3-10)
  const { activeMaps, topLevel, nodeTrees, boardNodeItems, calendarItems, bufferItems } = useTaskTrees({
    items, byParent, maps, user, buffer, matchesFilters, bufferVisible,
    mapFilter, nodeFilter, assigneeFilter, ownerFilter, statusFilter, deadlineFilter, search, t,
  });

  const openNodeInMap = (item) => navigate(`/map/${item.map_id}?node=${item.node_id}`);

  // akce nad uzly map (zápis, mazání, sdílení, stash, ikony) — viz
  // useMapNodeActions (F3-10)
  const {
    updateMapNode, shareMapWith, handleEditAppearance, handleSetNodeIcon,
    handleSetProjectIcon, handleStashNodeItem, handleCycleNodeItem,
    handleAssignNodeItem, handleStashNodeFromTable, handleDeleteNodeFromTable,
    addNodeToMap,
  } = useMapNodeActions({ maps, setMaps, user, buffer, toast, t, editNodeItem, setEditNodeItem });

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

  // adaptér pro sjednocený NodeEditDialog (stejný jako na plátně)
  const handleSaveNodeFull = async (nodeId, newData, nodeType) => {
    try {
      await updateMapNode({ map_id: editNodeItem.map_id, node_id: nodeId }, newData, nodeType);
      setEditNodeItem(null);
    } catch { /* toast řeší updateMapNode */ }
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
      // čerstvá mapa + zámek base_updated (ulozDoMapy) — seznam na stránce může být
      // starý a bez zámku by zápis přepsal cizí práci
      const { fresh } = await ulozDoMapy(mapMeta.id, (cerstva) => {
        const nodes = Array.isArray(cerstva.nodes) ? [...cerstva.nodes] : [];
        const edges = Array.isArray(cerstva.edges) ? [...cerstva.edges] : [];
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
        return { nodes, edges };
      });
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
              <TabsTrigger value="timeline" className="gap-1.5">
                <CalendarRange className="w-3.5 h-3.5" /> {t('tasksPage.viewTimeline')}
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

        {/* Strop 500 úkolů s viditelným dotažením (rozhodnutí vlastníka 1. 9.
            2026): org nad 500 úkolů dřív TIŠE neviděla nejstarší. Decentní pruh
            po vzoru TrialBanneru; po „Načíst vše" se dotáhnou zbylé stránky
            a pruh zmizí. */}
        {tasksApi.castecne && (
          <div
            role="status"
            data-testid="tasks-strop"
            className="flex flex-wrap items-center justify-center gap-2 px-4 py-1.5 mb-4 text-xs rounded-md border bg-muted/40 text-muted-foreground"
          >
            <span>{t('tasksPage.stropZobrazeno', { shown: items.length, total: tasksApi.total })}</span>
            <button
              type="button"
              data-testid="tasks-strop-nacist"
              onClick={() => tasksApi.nacistVse()}
              disabled={loading}
              className="underline underline-offset-2 whitespace-nowrap font-medium"
            >
              {t('tasksPage.nacistVse')}
            </button>
          </div>
        )}

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
        ) : view === 'timeline' ? (
          <TaskTimeline
            tasks={topLevel}
            byParent={byParent}
            maps={activeMaps}
            nodeTrees={nodeTrees}
            search={search}
            statusFilter={statusFilter}
            assigneeFilter={assigneeFilter}
            onEdit={openEdit}
            onOpenNode={setEditNodeItem}
          />
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
