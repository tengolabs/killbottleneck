import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronRight, Pencil, Plus, Calendar, Target, ExternalLink, Inbox, CalendarCheck } from 'lucide-react';
import TaskRowActions from '@/components/shared/TaskRowActions';
import { planState } from '@/lib/taskActions';
import { formatDeadline } from '@/lib/nodeMeta';
import { useTranslation } from 'react-i18next';
import { useTaskTable } from './TaskTableContext';
import AssigneePicker from './AssigneePicker';
import { RowTimerButton, StatusBadge, NodeIconPopover, deadlineClass } from './RowBits';

// Řádek uzlu mapy — osnova projektu. Data žijí v mapě (mapa je nadřazená),
// ale jdou upravit i odsud — stav klikem, osoba pickerem, zbytek dialogem.
export default function NodeItemRow({ item, depth = 0, hasChildren, collapsed, onToggleCollapse }) {
  const { t } = useTranslation('tasks');
  const {
    members,
    onRowAction,
    node: { onEdit, onCycle, onAssign, onAddChild, onOpen: onOpenNode, onSetIcon: onSetNodeIcon, onStash: onStashNodeItem },
  } = useTaskTable();
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
