import { TableCell, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ChevronRight, Pencil, Trash2, Calendar, MessageSquare, Inbox, RotateCw, CalendarCheck } from 'lucide-react';
import TaskRowActions from '@/components/shared/TaskRowActions';
import { planState } from '@/lib/taskActions';
import { formatDeadline } from '@/lib/nodeMeta';
import { useTranslation } from 'react-i18next';
import { useTaskTable } from './TaskTableContext';
import AssigneePicker from './AssigneePicker';
import { RowTimerButton, StatusBadge, deadlineClass } from './RowBits';

export default function TaskRow({ task, sub, subCount, expanded, onToggle, nodeLabel, canDelete = true }) {
  const { t } = useTranslation('tasks');
  const {
    members,
    commentCounts,
    onRowAction,
    task: { onEdit, onCycle, onDelete, onAssign, onOpenMap: onOpenTaskMap, onStash: onStashTask },
  } = useTaskTable();
  const commentCount = commentCounts[task.id] || 0;
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
