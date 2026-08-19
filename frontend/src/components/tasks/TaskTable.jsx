import { useState, useMemo, useEffect, Fragment } from 'react';
import { Link } from 'react-router-dom';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Check, ChevronRight, Pencil, Trash2, Plus, Calendar, Map as MapIcon, ArrowUpDown, ArrowUp, ArrowDown, MessageSquare, Target, ExternalLink, Inbox, Network, UserPlus, RotateCw, Palette, Timer, CalendarCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { labelForEmail } from '@/lib/memberLabel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ProjectColorPicker from '@/components/shared/ProjectColorPicker';
import { projectIcon, projectName } from '@/lib/projectColors';
import { EmojiNabidka } from '@/components/shared/EmojiPicker';
import { statusConfig, cycleStatus } from '@/lib/statusMeta';
import TaskRowActions from '@/components/shared/TaskRowActions';
import { planState } from '@/lib/taskActions';
import { getDeadlineStatus, formatDeadline, getInitials } from '@/lib/nodeMeta';
import { compareLocale } from '@/lib/locale';
import { useTimer } from '@/lib/TimerContext';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

// Stopky u řádku (úkol I cíl-uzel mapy) — VŽDY viditelné hodinky: klik = start
// měření (běžící timer jinde se zavře); běží-li na TÉTO položce, hodinky se
// točí červeně a klik je zastaví. Přes globální TimerContext — widget
// v hlavičce se aktualizuje sám. Měření nemění stav položky.
function RowTimerButton({ target }) {
  const { running, start, stop } = useTimer();
  const { toast } = useToast();
  const { t } = useTranslation('tasks');
  const isMine = target.task_id
    ? running?.task_id === target.task_id
    : !!target.node_id && running?.node_id === target.node_id;
  const handle = async (e) => {
    e.stopPropagation();
    try {
      if (isMine) await stop();
      else await start(target);
    } catch (err) {
      toast({ title: t('common:misc.timerToggleFailed'), description: err?.message, variant: 'destructive' });
    }
  };
  return (
    <Button variant="ghost" size="icon"
      className={`h-7 w-7 ${isMine ? 'text-red-500 hover:text-red-600' : 'text-muted-foreground hover:text-primary'}`}
      title={isMine ? t('taskTable.timerStop') : t('taskTable.timerStart')} onClick={handle}>
      <Timer className={`w-3.5 h-3.5 ${isMine ? 'animate-spin' : ''}`} />
    </Button>
  );
}

// Paleta vzhledu projektu (na hlavičce v tabulce úkolů): název + barva + ikona.
// JEDEN zdroj ikony: emoji se zapisuje do vrcholového (apex) uzlu přes
// onSetProjectIcon — propíše se do mapy i všude, kde se projekt zobrazuje.
function AppearancePopover({ map, onEditAppearance, onSetProjectIcon }) {
  const { t } = useTranslation('tasks');
  const icon = projectIcon(map);
  const bare = projectName(map);
  const [name, setName] = useState(bare);
  useEffect(() => { setName(projectName(map)); }, [map.title]);

  const saveNameIfChanged = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== bare) onEditAppearance(map, { title: trimmed });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={t('taskTable.appearanceTitle')}
          className="shrink-0 text-muted-foreground hover:text-primary opacity-60 hover:opacity-100 transition-all"
        >
          <Palette className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('taskTable.projectNameLabel')}</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { saveNameIfChanged(); e.currentTarget.blur(); } }}
            onBlur={saveNameIfChanged}
            placeholder={t('taskTable.projectNamePlaceholder')}
            className="w-full h-8 px-2 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('taskTable.projectColorLabel')}</p>
          <ProjectColorPicker value={map.color || ''} onChange={(c) => onEditAppearance(map, { color: c })} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">{t('taskTable.projectIconLabel')}</p>
          <EmojiNabidka value={icon} onChange={(e) => onSetProjectIcon(map, e)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

const deadlineClass = (task) => {
  const st = getDeadlineStatus(task.deadline, task.status);
  if (st === 'overdue') return 'text-red-600 dark:text-red-400 font-medium';
  if (st === 'upcoming') return 'text-orange-600 dark:text-orange-400 font-medium';
  return 'text-muted-foreground';
};

const STATUS_ORDER = { todo: 0, in_progress: 1, done: 2 };

function StatusBadge({ task, onCycle }) {
  const { t } = useTranslation('tasks');
  const s = statusConfig[task.status] || statusConfig.todo;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onCycle?.(task); }}
      title={onCycle ? t('taskTable.statusCycleTitle') : t('taskTable.statusNodeTitle')}
      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${onCycle ? 'hover:opacity-80' : 'cursor-default'} ${s.badge}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {task.status === 'done' && <Check className="w-3 h-3" />}
      {s.label}
    </button>
  );
}

// Inline výběr přiřazené osoby — klik na avatar/ikonku otevře seznam členů.
// Externí kontakty (members s external:true) mají vlastní sekci; jméno i iniciály
// se berou z popisku (labelForEmail) — pseudo-e-mail kontaktu se nikdy neukazuje.
function AssigneePicker({ value, members, onAssign }) {
  const { t } = useTranslation('tasks');
  const label = value ? labelForEmail(members, value) : '';
  if (!onAssign || members.length === 0) {
    return value ? (
      <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold inline-flex items-center justify-center" title={label}>
        {getInitials(label)}
      </span>
    ) : (
      <span className="text-xs text-muted-foreground">—</span>
    );
  }
  const team = members.filter((m) => !m.external);
  const external = members.filter((m) => m.external);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          title={value ? t('taskTable.assigneeChangeTitle', { email: label }) : t('taskTable.assignPerson')}
          className="inline-flex items-center justify-center hover:opacity-80"
        >
          {value ? (
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold inline-flex items-center justify-center">
              {getInitials(label)}
            </span>
          ) : (
            <span className="w-6 h-6 rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground inline-flex items-center justify-center">
              <UserPlus className="w-3 h-3" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onAssign('')}>{t('taskTable.nobody')}</DropdownMenuItem>
        {team.map((m) => (
          <DropdownMenuItem key={m.email} onClick={() => onAssign(m.email)}>
            {m.full_name ? `${m.full_name} (${m.email})` : m.email}
          </DropdownMenuItem>
        ))}
        {external.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] text-muted-foreground font-normal">
              {t('nav:externalContacts.group')}
            </DropdownMenuLabel>
            {external.map((m) => (
              <DropdownMenuItem key={m.email} onClick={() => onAssign(m.email)}>
                {m.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Rychlá paleta ikony uzlu (jen emoji) — vedle tužky na řádku uzlu v tabulce.
function NodeIconPopover({ item, onSetNodeIcon }) {
  const { t } = useTranslation('tasks');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={t('taskTable.nodeIconTitle')}
          className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
        >
          <Palette className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2" onClick={(e) => e.stopPropagation()}>
        <EmojiNabidka value={item.icon} onChange={(e) => onSetNodeIcon(item, e)} />
      </PopoverContent>
    </Popover>
  );
}

// Řádek uzlu mapy — osnova projektu. Data žijí v mapě (mapa je nadřazená),
// ale jdou upravit i odsud — stav klikem, osoba pickerem, zbytek dialogem.
function NodeItemRow({ item, depth = 0, hasChildren, collapsed, onToggleCollapse, members, onEdit, onCycle, onAssign, onAddChild, onOpenNode, onSetNodeIcon, onStashNodeItem, onRowAction }) {
  const { t } = useTranslation('tasks');
  const isDone = item.status === 'done';
  const planned = planState(item.plannedOn);
  return (
    <TableRow className="group cursor-pointer bg-secondary/20 hover:bg-secondary/40" onClick={() => onOpenNode(item)}>
      <TableCell className="w-[110px]">
        <StatusBadge task={item} onCycle={onCycle} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 1.5}rem` }}>
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(item.id); }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title={collapsed ? t('taskTable.expandBranch') : t('taskTable.collapseBranch')}
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          {item.icon
            ? <span className="text-sm leading-none shrink-0 w-3.5 text-center">{item.icon}</span>
            : <Target className={`w-3.5 h-3.5 shrink-0 ${item.isApex ? 'text-amber-500' : 'text-primary'}`} />}
          <span className={`text-sm ${item.isApex ? 'font-semibold' : ''} ${isDone ? 'line-through opacity-50' : ''}`}>{item.title}</span>
          {planned && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0"
              title={t(`common:rowActions.planned.${planned}`)}
            >
              <CalendarCheck className="w-2.5 h-2.5" />{t('common:rowActions.plannedBadge')}
            </span>
          )}
          {depth === 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">
              {item.isApex ? t('taskTable.apexBadge') : t('taskTable.nodeBadge')}
            </span>
          )}
          {item.waiting && (
            <span
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 shrink-0"
              title={t('taskTable.waitingTitle')}
            >
              {t('taskTable.waitingBadge')}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(item); }}
            title={t('taskTable.editGoalTitle')}
            className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {onSetNodeIcon && <NodeIconPopover item={item} onSetNodeIcon={onSetNodeIcon} />}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell className="w-[90px]">
        <AssigneePicker value={item.assignee_email} members={members} onAssign={onAssign ? (email) => onAssign(item, email) : undefined} />
        {item.created_by && item.assignee_email && item.created_by !== item.assignee_email && (
          <span className="block text-[10px] text-muted-foreground truncate mt-0.5" title={item.created_by}>
            {t('taskTable.assignedByShort', { email: item.created_by })}
          </span>
        )}
      </TableCell>
      <TableCell className="w-[110px]">
        {item.deadline ? (
          <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${deadlineClass(item)}`}>
            <Calendar className="w-3 h-3" />
            {formatDeadline(item.deadline)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-[110px] text-right">
        {/* hodinky VŽDY viditelné i u cílů-uzlů mapy */}
        <RowTimerButton target={{ node_id: item.node_id, map_id: item.map_id, label: item.title }} />
        {/* Akce se schovávají do hoveru JEN na zařízeních, která hover mají.
            Na dotyku (tablet, telefon v šířce tabulky) hover neexistuje a
            řádkové akce by byly nedosažitelné — stejné pravidlo jako v lite
            režimu, kde jsou vidět pořád. focus-within je odbočka pro klávesnici. */}
        <div className="inline-flex items-center gap-0.5 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          {/* „hotovo" tu záměrně NENÍ — cykluje ho štítek stavu vlevo */}
          {onRowAction && (
            <TaskRowActions item={{ ...item, planned: item.plannedOn }} only={['plan']}
              onDone={(res, note) => onRowAction(null, note)} onError={(e) => onRowAction(e)} />
          )}
          {onStashNodeItem && !item.isApex && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title={t('taskTable.stashTitle')}
              onClick={(e) => { e.stopPropagation(); onStashNodeItem(item); }}>
              <Inbox className="w-3.5 h-3.5" />
            </Button>
          )}
          {onAddChild && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title={t('taskTable.addSubgoal')}
              onClick={(e) => { e.stopPropagation(); onAddChild(item); }}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('common:actions.edit')}
            onClick={(e) => { e.stopPropagation(); onEdit(item); }}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('taskTable.openInMap')}
            onClick={(e) => { e.stopPropagation(); onOpenNode(item); }}>
            <ExternalLink className="w-3.5 h-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

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

function TaskRow({ task, sub, subCount, expanded, onToggle, nodeLabel, onEdit, onCycle, onDelete, canDelete = true, onAssign, onOpenTaskMap, onStashTask, onRowAction, members = [], commentCount }) {
  const { t } = useTranslation('tasks');
  const isDone = task.status === 'done';
  const planned = planState(task.planned_on);
  return (
    <TableRow className="group cursor-pointer" onClick={() => (task.map_id && onOpenTaskMap ? onOpenTaskMap(task) : onEdit(task))}>
      <TableCell className="w-[110px]">
        <StatusBadge task={task} onCycle={onCycle} />
      </TableCell>
      <TableCell>
        <div className={`flex items-center gap-1.5 ${sub ? 'pl-7' : ''}`}>
          {!sub && subCount > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(task.id); }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title={expanded ? t('taskTable.collapseSubtasks') : t('taskTable.expandSubtasks', { subCount })}
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            </button>
          )}
          <span className={`text-sm ${isDone ? 'line-through opacity-50' : ''}`}>{task.title}</span>
          {planned && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0"
              title={t(`common:rowActions.planned.${planned}`)}
            >
              <CalendarCheck className="w-2.5 h-2.5" />{t('common:rowActions.plannedBadge')}
            </span>
          )}
          {task.recurrence && (
            <RotateCw className="w-3.5 h-3.5 text-muted-foreground shrink-0" title={t('taskTable.recurringTitle')} />
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(task); }}
            title={t('taskTable.editTaskTitle')}
            className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {!sub && subCount > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">({subCount})</span>
          )}
          {commentCount > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
              <MessageSquare className="w-3 h-3" />{commentCount}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {nodeLabel}
      </TableCell>
      <TableCell className="w-[90px]">
        <AssigneePicker value={task.assignee_email} members={members} onAssign={onAssign ? (email) => onAssign(task, email) : undefined} />
        {task.created_by && task.assignee_email && task.created_by !== task.assignee_email && (
          <span className="block text-[10px] text-muted-foreground truncate mt-0.5" title={task.created_by}>
            {t('taskTable.assignedByShort', { email: task.created_by })}
          </span>
        )}
      </TableCell>
      <TableCell className="w-[110px]">
        {task.deadline ? (
          <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${deadlineClass(task)}`}>
            <Calendar className="w-3 h-3" />
            {formatDeadline(task.deadline)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-[110px] text-right">
        {/* hodinky VŽDY viditelné (Richard: hover verzi nenašel); ostatní akce na hover */}
        <RowTimerButton target={{ task_id: task.id, map_id: task.map_id || '', label: task.title }} />
        <div className="inline-flex items-center gap-0.5 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          {/* „hotovo" tu záměrně NENÍ — cykluje ho štítek stavu vlevo */}
          {onRowAction && (
            <TaskRowActions item={{ ...task, planned: task.planned_on }} only={['plan']}
              onDone={(res, note) => onRowAction(null, note)} onError={(e) => onRowAction(e)} />
          )}
          {!sub && onStashTask && canDelete && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title={t('taskTable.stashTitle')}
              onClick={(e) => { e.stopPropagation(); onStashTask(task); }}>
              <Inbox className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('common:actions.edit')}
            onClick={(e) => { e.stopPropagation(); onEdit(task); }}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          {/* smazat smí jen zadavatel nebo vlastník projektu (deleteRule) — dřív
              se koš nabízel všem a serverové odmítnutí se tiše spolklo */}
          {canDelete && (
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" title={t('common:actions.delete')}
              onClick={(e) => { e.stopPropagation(); onDelete(task); }}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// Řádek nápadu ze zásobníku — plnohodnotně editovatelný (vlastní entita,
// nekoliduje s mapou). Převod na úkol = přesun.
function BufferRow({ item, onEdit, onDelete, onConvert }) {
  const { t } = useTranslation('tasks');
  return (
    <TableRow className="group cursor-pointer bg-secondary/20 hover:bg-secondary/40" onClick={() => onEdit(item)}>
      <TableCell className="w-[110px]">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Inbox className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="text-sm">{item.title}</span>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary shrink-0">{t('taskTable.ideaBadge')}</span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell className="w-[90px]">
        <span className="text-xs text-muted-foreground">—</span>
      </TableCell>
      <TableCell className="w-[110px]">
        {item.deadline ? (
          <span className={`inline-flex items-center gap-1 text-xs whitespace-nowrap ${deadlineClass(item)}`}>
            <Calendar className="w-3 h-3" />
            {formatDeadline(item.deadline)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="w-[110px] text-right">
        <div className="inline-flex items-center gap-0.5 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('taskTable.insertToProject')}
            onClick={(e) => { e.stopPropagation(); onConvert(item); }}>
            <Network className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" title={t('common:actions.edit')}
            onClick={(e) => { e.stopPropagation(); onEdit(item); }}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" title={t('taskTable.deleteFromBuffer')}
            onClick={(e) => { e.stopPropagation(); onDelete(item); }}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
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
      members={members}
      onEdit={onEditNodeItem}
      onCycle={onCycleNodeItem}
      onAssign={onAssignNodeItem}
      onAddChild={onAddChildNode}
      onOpenNode={onOpenNode}
      onSetNodeIcon={onSetNodeIcon}
      onStashNodeItem={onStashNodeItem}
      onRowAction={onRowAction}
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

  const SortHead = ({ label, sortKey, className }) => (
    <TableHead className={className}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => sortBy(sortKey)}>
        {label}
        {sort.key !== sortKey ? <ArrowUpDown className="w-3 h-3 opacity-40" />
          : sort.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
      </button>
    </TableHead>
  );

  if (tasks.length === 0 && Object.keys(nodeTrees).length === 0 && bufferItems.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        {t('taskTable.emptyFiltered')}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortHead label={t('taskTable.colStatus')} sortKey="status" className="w-[110px]" />
            <SortHead label={t('taskTable.colTask')} sortKey="title" />
            <TableHead className="hidden md:table-cell">{t('taskTable.colNode')}</TableHead>
            <SortHead label={t('taskTable.colAssignee')} sortKey="assignee" className="w-[90px]" />
            <SortHead label={t('taskTable.colDeadline')} sortKey="deadline" className="w-[110px]" />
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
                        {onEditAppearance && <AppearancePopover map={sec.map} onEditAppearance={onEditAppearance} onSetProjectIcon={onSetProjectIcon} />}
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
                    onEdit={onEdit}
                    onCycle={(changed) => onCycle(changed, cycleStatus(changed.status))}
                    onDelete={onDelete}
                    canDelete={task.created_by === meEmail || mapById[task.map_id]?.created_by === meEmail}
                    onAssign={onAssign}
                    onOpenTaskMap={onOpenTaskMap}
                    onStashTask={onStashTask}
                    onRowAction={onRowAction}
                    members={members}
                    commentCount={commentCounts[task.id] || 0}
                  />
                  {expanded.has(task.id) && (byParent[task.id] || []).sort(cmp).map((s) => (
                    <TaskRow
                      key={s.id}
                      task={s}
                      sub
                      nodeLabel={nodeLabel(s)}
                      onEdit={onEdit}
                      onCycle={(changed) => onCycle(changed, cycleStatus(changed.status))}
                      onDelete={onDelete}
                      canDelete={s.created_by === meEmail || mapById[s.map_id]?.created_by === meEmail}
                      onAssign={onAssign}
                    onOpenTaskMap={onOpenTaskMap}
                      onRowAction={onRowAction}
                      members={members}
                      commentCount={commentCounts[s.id] || 0}
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
                <BufferRow key={b.id} item={b} onEdit={onEditBuffer} onDelete={onDeleteBuffer} onConvert={onConvertBuffer} />
              ))}
            </Fragment>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
