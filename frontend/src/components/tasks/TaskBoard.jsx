import { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import { Calendar, Map as MapIcon, ListChecks, MessageSquare, Target, CalendarCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { STATUSES } from '@/lib/statusMeta';
import { labelForEmail } from '@/lib/memberLabel';
import { getDeadlineStatus, formatDeadline, getInitials } from '@/lib/nodeMeta';
import { planState } from '@/lib/taskActions';

const deadlineClass = (task) => {
  const st = getDeadlineStatus(task.deadline, task.status);
  if (st === 'overdue') return 'text-red-600 dark:text-red-400';
  if (st === 'upcoming') return 'text-orange-600 dark:text-orange-400';
  return 'text-muted-foreground';
};

// pořadí ve sloupci: sort_order vzestupně, bez sort_order na konec dle vzniku
const orderCmp = (a, b) =>
  (a.sort_order || Number.MAX_SAFE_INTEGER) - (b.sort_order || Number.MAX_SAFE_INTEGER)
  || ((a.created_date || '') < (b.created_date || '') ? -1 : 1);

function TaskCard({ task, mapTitle, subStats, commentCount, onEdit, labelOf }) {
  const { t: tt } = useTranslation('tasks');
  return (
    <div
      onClick={() => onEdit?.(task)}
      className="rounded-lg border bg-card p-3 shadow-sm cursor-pointer hover:shadow-md hover:border-muted-foreground/40 transition-all"
    >
      <p className={`text-sm font-medium ${task.status === 'done' ? 'line-through opacity-50' : ''}`}>
        {task.title}
      </p>
      {/* Jen ZNAČKA připnutí. Akce tu nejsou vědomě: celá karta je úchyt pro
          přetahování (dnd-kit listeners), takže tlačítko uvnitř by soupeřilo
          se startem tažení. Plánovat se dá v tabulce a v „Můj den". */}
      {planState(task.planned_on) && (
        <span className="mt-1 inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
          <CalendarCheck className="w-2.5 h-2.5" />{tt('common:rowActions.plannedBadge')}
        </span>
      )}
      {(mapTitle || subStats || commentCount > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {mapTitle && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
              <MapIcon className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[140px]">{mapTitle}</span>
            </span>
          )}
          {subStats && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
              <ListChecks className="w-3 h-3" /> {subStats.done}/{subStats.total}
            </span>
          )}
          {commentCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
              <MessageSquare className="w-3 h-3" /> {commentCount}
            </span>
          )}
        </div>
      )}
      {(task.deadline || task.assignee_email) && (
        <div className="mt-2 flex items-center justify-between">
          {task.deadline ? (
            <span className={`inline-flex items-center gap-1 text-[10px] ${deadlineClass(task)}`}>
              <Calendar className="w-3 h-3" /> {formatDeadline(task.deadline)}
            </span>
          ) : <span />}
          {task.assignee_email && (
            <span
              className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold inline-flex items-center justify-center"
              title={labelOf ? labelOf(task.assignee_email) : task.assignee_email}
            >
              {getInitials(labelOf ? labelOf(task.assignee_email) : task.assignee_email)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// obal karty: draggable (celá karta) + droppable (drop před tuto kartu)
function DraggableTaskCard({ task, children }) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: task.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: `before:${task.id}` });
  return (
    <div
      ref={(el) => { setDragRef(el); setDropRef(el); }}
      {...attributes}
      {...listeners}
      style={{ touchAction: 'manipulation' }}
      className={isDragging ? 'opacity-30' : ''}
    >
      {children}
    </div>
  );
}

// karta odvozená z uzlu mapy — nejde přetahovat (stav se mění v mapě)
function NodeCard({ item, mapTitle, onOpenNode, labelOf }) {
  const { t } = useTranslation('tasks');
  return (
    <div
      onClick={() => onOpenNode(item)}
      title={t('board.nodeCardTitle')}
      className="rounded-lg border border-dashed bg-secondary/30 p-3 cursor-pointer hover:border-primary/50 transition-all"
    >
      <div className="flex items-start gap-1.5">
        <Target className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
        <p className={`text-sm font-medium ${item.status === 'done' ? 'line-through opacity-50' : ''}`}>
          {item.title}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{t('board.nodeBadge')}</span>
        {mapTitle && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground min-w-0">
            <MapIcon className="w-3 h-3 shrink-0" />
            <span className="truncate max-w-[140px]">{mapTitle}</span>
          </span>
        )}
      </div>
      {(item.deadline || item.assignee_email) && (
        <div className="mt-2 flex items-center justify-between">
          {item.deadline ? (
            <span className={`inline-flex items-center gap-1 text-[10px] ${deadlineClass(item)}`}>
              <Calendar className="w-3 h-3" /> {formatDeadline(item.deadline)}
            </span>
          ) : <span />}
          {item.assignee_email && (
            <span
              className="w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold inline-flex items-center justify-center"
              title={labelOf ? labelOf(item.assignee_email) : item.assignee_email}
            >
              {getInitials(labelOf ? labelOf(item.assignee_email) : item.assignee_email)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Column({ col, highlighted, children }) {
  const { setNodeRef } = useDroppable({ id: `col:${col.value}` });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border bg-secondary/30 p-3 min-h-[200px] transition-colors ${
        highlighted ? 'border-primary/60 bg-primary/5' : ''
      }`}
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={`w-2 h-2 rounded-full ${col.dot}`} />
        <h3 className="text-sm font-semibold">{col.label}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{col.tasks.length + col.nodes.length}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// tasks = úkoly nejvyšší úrovně (profiltrované); podúkoly jen jako čítač na kartě;
// nodeItems = odvozené uzly map s termínem (read-only karty).
// DnD přes dnd-kit: myš (od 6 px) i dotyk (podržení 250 ms — krátký tap = otevřít,
// scroll prstem zůstává volný).
export default function TaskBoard({ tasks, byParent, maps, nodeItems = [], members = [], onEdit, onUpdate, onOpenNode, commentCounts = {} }) {
  const { t } = useTranslation('tasks');
  const [activeId, setActiveId] = useState(null);
  const [overCol, setOverCol] = useState(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } })
  );

  const mapById = useMemo(() => Object.fromEntries(maps.map((m) => [m.id, m])), [maps]);
  // jméno místo e-mailu (a jméno kontaktu místo pseudo-e-mailu externího řešitele)
  const labelOf = useMemo(() => (em) => labelForEmail(members, em), [members]);

  const columns = useMemo(
    () => STATUSES.map((s) => ({
      ...s,
      tasks: tasks.filter((task) => task.status === s.value).sort(orderCmp),
      nodes: nodeItems.filter((n) => n.status === s.value),
    })),
    [tasks, nodeItems]
  );

  const colOfTask = (taskId) => columns.find((c) => c.tasks.some((task) => task.id === taskId));

  // id droppablu → sloupec, nad kterým se vznáší (kvůli zvýraznění)
  const resolveOverCol = (overId) => {
    if (!overId) return null;
    if (String(overId).startsWith('col:')) return String(overId).slice(4);
    if (String(overId).startsWith('before:')) return colOfTask(String(overId).slice(7))?.value || null;
    return null;
  };

  // drop na sloupec = změna stavu (na konec); drop na kartu = zařazení před ni
  const handleDragEnd = ({ active, over }) => {
    setActiveId(null);
    setOverCol(null);
    if (!over) return;
    const taskId = active.id;
    const task = tasks.find((it) => it.id === taskId);
    if (!task) return;

    let col, beforeTask = null;
    if (String(over.id).startsWith('before:')) {
      const beforeId = String(over.id).slice(7);
      if (beforeId === taskId) return;
      col = colOfTask(beforeId);
      beforeTask = col?.tasks.find((it) => it.id === beforeId) || null;
    } else if (String(over.id).startsWith('col:')) {
      col = columns.find((c) => c.value === String(over.id).slice(4));
    }
    if (!col) return;

    const colTasks = col.tasks.filter((it) => it.id !== taskId);
    let sortOrder;
    if (!beforeTask) {
      const last = colTasks[colTasks.length - 1];
      sortOrder = last ? (last.sort_order || 0) + 1000 : 1000;
    } else {
      const idx = colTasks.findIndex((it) => it.id === beforeTask.id);
      const prev = idx > 0 ? colTasks[idx - 1] : null;
      const nextOrder = beforeTask.sort_order || 0;
      // průměr sousedů; před první kartou půlka její hodnoty
      sortOrder = prev ? ((prev.sort_order || 0) + nextOrder) / 2 : nextOrder / 2;
    }
    const patch = { sort_order: sortOrder };
    if (task.status !== col.value) patch.status = col.value;
    onUpdate(taskId, patch);
  };

  const subStats = (task) => {
    const subs = byParent[task.id] || [];
    if (subs.length === 0) return null;
    return { total: subs.length, done: subs.filter((s) => s.status === 'done').length };
  };

  const activeTask = activeId ? tasks.find((task) => task.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragOver={({ over }) => setOverCol(resolveOverCol(over?.id))}
      onDragCancel={() => { setActiveId(null); setOverCol(null); }}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-start">
        {columns.map((col) => (
          <Column key={col.value} col={col} highlighted={overCol === col.value}>
            {col.nodes.map((n) => (
              <NodeCard key={n.id} item={n} mapTitle={mapById[n.map_id]?.title || ''} onOpenNode={onOpenNode} labelOf={labelOf} />
            ))}
            {col.tasks.map((task) => (
              <DraggableTaskCard key={task.id} task={task}>
                <TaskCard
                  task={task}
                  mapTitle={task.map_id ? (mapById[task.map_id]?.title || '') : ''}
                  subStats={subStats(task)}
                  commentCount={commentCounts[task.id] || 0}
                  onEdit={onEdit}
                  labelOf={labelOf}
                />
              </DraggableTaskCard>
            ))}
            {col.tasks.length === 0 && col.nodes.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">{t('board.emptyColumn')}</p>
            )}
          </Column>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && (
          <div className="rotate-2 shadow-xl">
            <TaskCard
              task={activeTask}
              mapTitle={activeTask.map_id ? (mapById[activeTask.map_id]?.title || '') : ''}
              subStats={subStats(activeTask)}
              commentCount={commentCounts[activeTask.id] || 0}
              labelOf={labelOf}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
