import { useState, useMemo, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronRight, Pencil, Plus, Map as MapIcon, Inbox } from 'lucide-react';
import { labelForEmail } from '@/lib/memberLabel';
import { projectIcon, projectName } from '@/lib/projectColors';
import { cycleStatus } from '@/lib/statusMeta';
import { compareLocale } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';
import TaskTableContext from './table/TaskTableContext';
import NodeItemRow from './table/NodeItemRow';
import TaskRow from './table/TaskRow';
import BufferRow from './table/BufferRow';
import AppearancePopover from './table/AppearancePopover';
import { SortHead } from './table/RowBits';

const STATUS_ORDER = { todo: 0, in_progress: 1, done: 2 };

// Průběžná osnova: řádek pro rychlé psaní cílů projektu (Enter = uložit a psát dál)
function QuickAddNodeRow({ onAdd }) {
  const { t } = useTranslation('tasks');
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!val.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(val.trim());
      setVal('');
    } catch { /* toast řeší volající */ } finally {
      setBusy(false);
    }
  };
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={6} className="py-1">
        <div className="flex items-center gap-2 pl-2">
          <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <input
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={t('taskTable.quickAddPlaceholder')}
            disabled={busy}
            className="flex-1 h-7 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </TableCell>
    </TableRow>
  );
}

// tasks = úkoly nejvyšší úrovně (už profiltrované), byParent = všechny podúkoly,
// nodeTrees = { mapId: [kořeny stromu uzlů] } — osnova projektu (editovatelná),
// bufferItems = nápady ze zásobníku (editovatelné, sekce na konci)
export default function TaskTable({ tasks, byParent, maps, members = [], nodeTrees = {}, bufferItems = [], meEmail, onEditAppearance, onSetProjectIcon, onEditProject, onSetNodeIcon, onEdit, onCycle, onDelete, onAssign, onOpenNode, onOpenTaskMap, onEditNodeItem, onCycleNodeItem, onAssignNodeItem, onAddChildNode, onQuickAddNode, onEditBuffer, onDeleteBuffer, onConvertBuffer, onStashTask, onStashNodeItem, onRowAction, commentCounts = {} }) {
  const { t } = useTranslation('tasks');
  const canEditMap = (m) => !!m && (m.created_by === meEmail || (m.shared_with_edit || []).includes(meEmail) || m.team_access === 'edit');
  const [expanded, setExpanded] = useState(() => new Set());
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      return new Set(JSON.parse(nactiKlic('kb-collapsed-projects') || '[]'));
    } catch {
      return new Set();
    }
  });
  const [sort, setSort] = useState({ key: 'created_date', dir: 'desc' });

  const toggleNodeCollapse = (id) => setCollapsedNodes((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleSection = (key) => setCollapsedSections((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    ulozKlic('kb-collapsed-projects', JSON.stringify([...next]));
    return next;
  });

  const countNodes = (items) => items.reduce((a, n) => a + 1 + countNodes(n.children || []), 0);

  // Dedup uzel+úkol v počtu sekce: úkol pověšený na zobrazený uzel je jeho
  // detail — jednotku práce počítá uzel. Úkol s osiřelým/odfiltrovaným uzlem
  // se počítá samostatně.
  const collectNodeIds = (items, acc = new Set()) => {
    for (const n of items) { acc.add(n.node_id); collectNodeIds(n.children || [], acc); }
    return acc;
  };
  const sectionCount = (sec) => {
    const shown = collectNodeIds(sec.nodeRoots);
    return sec.tasks.filter((task) => !(task.node_id && shown.has(task.node_id))).length + countNodes(sec.nodeRoots);
  };

  const renderNodeRows = (items, depth) => items.flatMap((n) => [
    <NodeItemRow
      key={n.id}
      item={n}
      depth={depth}
      hasChildren={(n.children || []).length > 0}
      collapsed={collapsedNodes.has(n.id)}
      onToggleCollapse={toggleNodeCollapse}
    />,
    ...(!collapsedNodes.has(n.id) ? renderNodeRows(n.children || [], depth + 1) : []),
  ]);

  const mapById = useMemo(() => Object.fromEntries(maps.map((m) => [m.id, m])), [maps]);

  const nodeLabel = (task) => {
    if (!task.node_id) return <span className="text-xs text-muted-foreground">—</span>;
    const map = mapById[task.map_id];
    const node = (map?.nodes || []).find((n) => n.id === task.node_id);
    if (!node) {
      return <span className="text-xs text-red-600 dark:text-red-400">{t('taskTable.nodeDeleted')}</span>;
    }
    return (
      <Link
        to={`/map/${task.map_id}?node=${task.node_id}`}
        onClick={(e) => e.stopPropagation()}
        className="text-xs text-muted-foreground line-clamp-1 hover:text-primary hover:underline"
        title={t('taskTable.openNodeInMap')}
      >
        {node.data?.title || node.data?.apexText || t('common:misc.untitled')}
      </Link>
    );
  };

  const toggle = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  // cache popisků pro řazení (plní se líně, resetuje se změnou members)
  const labelCacheMap = useMemo(() => new Map(), [members]);
  const labelCache = (em) => {
    if (!em) return '';
    let v = labelCacheMap.get(em);
    if (v === undefined) { v = labelForEmail(members, em); labelCacheMap.set(em, v); }
    return v;
  };

  const cmp = (a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    switch (sort.key) {
      case 'title': return dir * compareLocale(a.title || '', b.title || '');
      case 'status': return dir * ((STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0));
      // řadí se podle zobrazeného JMÉNA (externí kontakt by se jinak řadil podle
      // pseudo-e-mailu); labely předpočítané — find v komparátoru byl O(n·log n·m)
      case 'assignee': return dir * (labelCache(a.assignee_email) || '￿').localeCompare(labelCache(b.assignee_email) || '￿');
      case 'deadline': return dir * ((a.deadline || '9999') < (b.deadline || '9999') ? -1 : a.deadline === b.deadline ? 0 : 1);
      default: return dir * ((a.created_date || '') < (b.created_date || '') ? -1 : 1);
    }
  };

  // seskupení podle mapy; volné úkoly na konec jako „Bez mapy"
  const sections = useMemo(() => {
    const groups = {};
    const grp = (k) => (groups[k] = groups[k] || { tasks: [], nodeRoots: [] });
    for (const task of tasks) grp(task.map_id || '').tasks.push(task);
    for (const [mapId, roots] of Object.entries(nodeTrees)) grp(mapId).nodeRoots = roots;
    const keys = Object.keys(groups).sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return compareLocale(mapById[a]?.title || '', mapById[b]?.title || '');
    });
    return keys.map((k) => ({
      mapId: k,
      map: mapById[k],
      tasks: groups[k].tasks.sort(cmp),
      nodeRoots: groups[k].nodeRoots,
    }));
  }, [tasks, nodeTrees, mapById, sort]);

  // Handlery a sdílená data pro řádky (F3-07) — dřív 18 props prodrátovaných
  // přes NodeItemRow/TaskRow/BufferRow. Obal onCycle (cycleStatus) je tentýž,
  // jaký dřív dostával každý TaskRow inline.
  const tableCtx = useMemo(() => ({
    members,
    meEmail,
    commentCounts,
    node: {
      onEdit: onEditNodeItem,
      onCycle: onCycleNodeItem,
      onAssign: onAssignNodeItem,
      onAddChild: onAddChildNode,
      onOpen: onOpenNode,
      onSetIcon: onSetNodeIcon,
      onStash: onStashNodeItem,
    },
    task: {
      onEdit,
      onCycle: (changed) => onCycle(changed, cycleStatus(changed.status)),
      onDelete,
      onAssign,
      onOpenMap: onOpenTaskMap,
      onStash: onStashTask,
    },
    buffer: { onEdit: onEditBuffer, onDelete: onDeleteBuffer, onConvert: onConvertBuffer },
    project: { onEditAppearance, onSetProjectIcon },
    onRowAction,
  }), [members, meEmail, commentCounts, onEditNodeItem, onCycleNodeItem, onAssignNodeItem, onAddChildNode, onOpenNode, onSetNodeIcon, onStashNodeItem, onEdit, onCycle, onDelete, onAssign, onOpenTaskMap, onStashTask, onEditBuffer, onDeleteBuffer, onConvertBuffer, onEditAppearance, onSetProjectIcon, onRowAction]);

  if (tasks.length === 0 && Object.keys(nodeTrees).length === 0 && bufferItems.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        {t('taskTable.emptyFiltered')}
      </div>
    );
  }

  return (
    <TaskTableContext.Provider value={tableCtx}>
    <div className="rounded-xl border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead label={t('taskTable.colStatus')} sortKey="status" className="w-[110px]" sort={sort} onSort={sortBy} />
            <SortHead label={t('taskTable.colTask')} sortKey="title" sort={sort} onSort={sortBy} />
            <TableHead className="hidden md:table-cell">{t('taskTable.colNode')}</TableHead>
            <SortHead label={t('taskTable.colAssignee')} sortKey="assignee" className="w-[90px]" sort={sort} onSort={sortBy} />
            <SortHead label={t('taskTable.colDeadline')} sortKey="deadline" className="w-[110px]" sort={sort} onSort={sortBy} />
            <TableHead className="w-[110px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((sec, si) => (
            <Fragment key={sec.mapId || 'none'}>
              {si > 0 && (
                <tr aria-hidden="true" className="h-3 bg-transparent hover:bg-transparent">
                  <td colSpan={6} className="p-0" />
                </tr>
              )}
              <TableRow
                className="border-t-2 border-primary/40 bg-secondary hover:bg-secondary cursor-pointer"
                style={sec.map?.color ? { backgroundColor: `${sec.map.color}30`, borderTopColor: sec.map.color } : undefined}
                onClick={() => toggleSection(sec.mapId)}
              >
                <TableCell colSpan={6} className="py-2.5 border-l-4 border-l-primary" style={{ borderLeftColor: sec.map?.color || undefined }}>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleSection(sec.mapId); }}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      title={collapsedSections.has(sec.mapId) ? t('taskTable.expandProject') : t('taskTable.collapseProject')}
                    >
                      <ChevronRight className={`w-4 h-4 transition-transform ${collapsedSections.has(sec.mapId) ? '' : 'rotate-90'}`} />
                    </button>
                    {sec.map && projectIcon(sec.map) ? (
                      <span className="text-base leading-none shrink-0">{projectIcon(sec.map)}</span>
                    ) : (
                      <MapIcon className="w-4 h-4 text-primary shrink-0" style={{ color: sec.map?.color || undefined }} />
                    )}
                    {sec.map ? (
                      <Link to={`/map/${sec.mapId}`} className="hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                        {projectName(sec.map) || t('common:misc.untitled')}
                      </Link>
                    ) : (
                      t('taskTable.noMapSection')
                    )}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums px-1.5 py-0.5 rounded-full bg-background/70">
                      {sectionCount(sec)}
                    </span>
                    {sec.map && canEditMap(sec.map) && (
                      <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {onEditProject && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onEditProject(sec.map); }}
                            title={t('taskTable.editApexTitle')}
                            className="shrink-0 text-muted-foreground hover:text-primary opacity-60 hover:opacity-100 transition-all"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {onEditAppearance && <AppearancePopover map={sec.map} />}
                      </span>
                    )}
                  </span>
                </TableCell>
              </TableRow>
              {!collapsedSections.has(sec.mapId) && (
                <Fragment>
              {renderNodeRows(sec.nodeRoots, 0)}
              {sec.mapId && onQuickAddNode && (
                <QuickAddNodeRow onAdd={(title) => onQuickAddNode(sec.mapId, title)} />
              )}
              {sec.tasks.map((task) => (
                <Fragment key={task.id}>
                  <TaskRow
                    task={task}
                    subCount={(byParent[task.id] || []).length}
                    expanded={expanded.has(task.id)}
                    onToggle={toggle}
                    nodeLabel={nodeLabel(task)}
                    canDelete={task.created_by === meEmail || mapById[task.map_id]?.created_by === meEmail}
                  />
                  {expanded.has(task.id) && (byParent[task.id] || []).sort(cmp).map((s) => (
                    <TaskRow
                      key={s.id}
                      task={s}
                      sub
                      nodeLabel={nodeLabel(s)}
                      canDelete={s.created_by === meEmail || mapById[s.map_id]?.created_by === meEmail}
                    />
                  ))}
                </Fragment>
              ))}
                </Fragment>
              )}
            </Fragment>
          ))}
          {bufferItems.length > 0 && (
            <Fragment>
              {sections.length > 0 && (
                <tr aria-hidden="true" className="h-3 bg-transparent hover:bg-transparent">
                  <td colSpan={6} className="p-0" />
                </tr>
              )}
              <TableRow className="border-t-2 border-primary/40 bg-secondary hover:bg-secondary">
                <TableCell colSpan={6} className="py-2.5 border-l-4 border-l-muted-foreground/40">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Inbox className="w-4 h-4 text-muted-foreground shrink-0" />
                    {t('taskTable.bufferSection')}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums px-1.5 py-0.5 rounded-full bg-background/70">
                      {bufferItems.length}
                    </span>
                  </span>
                </TableCell>
              </TableRow>
              {bufferItems.map((b) => (
                <BufferRow key={b.id} item={b} />
              ))}
            </Fragment>
          )}
        </TableBody>
      </Table>
    </div>
    </TaskTableContext.Provider>
  );
}
