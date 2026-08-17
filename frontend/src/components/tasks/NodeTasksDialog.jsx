import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Loader2, Trash2, Calendar, ListChecks } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useTasks } from '@/hooks/useTasks';
import { statusConfig } from '@/lib/statusMeta';
import { getDeadlineStatus, formatDeadline, getInitials } from '@/lib/nodeMeta';
import { labelForEmail } from '@/lib/memberLabel';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';

// DETEKTOR CHYBY (rozhodnutí Richarda 17. 8. 2026): položky-úkoly u uzlu už
// nemají jak vzniknout — úkol = uzel s řešitelem nebo termínem. Badge a tenhle
// dialog zůstávají jen proto, aby zbylá/chybná data byla VIDĚT a šla smazat.
// Když se badge ukáže, je to signál chyby, ne funkce.
export default function NodeTasksDialog({ map, nodeId, canEdit, onClose, onChanged, members = [] }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation('tasks');
  const tasksApi = useTasks(user, { mapId: map?.id });
  const { items, loading, byParent } = tasksApi;

  const nodeTitle = useMemo(() => {
    const node = (map?.nodes || []).find((n) => n.id === nodeId);
    return node?.data?.title || node?.data?.apexText || '';
  }, [map, nodeId]);

  const nodeTasks = useMemo(
    () => items.filter((task) => task.node_id === nodeId && !task.parent_id),
    [items, nodeId]
  );

  const handleDelete = (task) => {
    if (!window.confirm(t('nodeTasksDialog.confirmDeleteTask', { title: task.title }))) return;
    tasksApi.remove(task.id)
      .then(() => onChanged?.())
      .catch(() => toast({ title: t('tasksPage.deleteFailed'), variant: 'destructive' }));
  };

  const deadlineClass = (task) => {
    const st = getDeadlineStatus(task.deadline, task.status);
    if (st === 'overdue') return 'text-red-600 dark:text-red-400';
    if (st === 'upcoming') return 'text-orange-600 dark:text-orange-400';
    return 'text-muted-foreground';
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-primary" />
            {t('nodeTasksDialog.title', { node: nodeTitle || t('nodeTasksDialog.nodeFallback') })}
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs text-muted-foreground">{t('nodeTasksDialog.legacyNotice')}</p>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : nodeTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center">
            {t('nodeTasksDialog.empty')}
          </p>
        ) : (
          <div className="space-y-1.5">
            {/* ⚠️ proměnná NESMÍ být `t` — zastínila by překladovou funkci a
                render spadl (TypeError → černá obrazovka; Richardův nález na
                mobilu, task #17: stačil uzel s jedním úkolem) */}
            {nodeTasks.map((task) => {
              const s = statusConfig[task.status] || statusConfig.todo;
              const subs = byParent[task.id] || [];
              return (
                <div key={task.id} className="group flex items-center gap-2 p-2 rounded-lg border bg-card transition-colors">
                  <span
                    title={s.label}
                    className={`shrink-0 w-5 h-5 rounded-full border-2 inline-flex items-center justify-center ${
                      task.status === 'done'
                        ? 'bg-green-500 border-green-500 text-white'
                        : task.status === 'in_progress'
                          ? 'border-amber-500'
                          : 'border-muted-foreground/40'
                    }`}
                  >
                    {task.status === 'done' && <Check className="w-3 h-3" />}
                    {task.status === 'in_progress' && <span className="w-2 h-2 rounded-full bg-amber-500" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${task.status === 'done' ? 'line-through opacity-50' : ''}`}>{task.title}</p>
                    {(task.deadline || subs.length > 0) && (
                      <div className="flex items-center gap-2 mt-0.5">
                        {task.deadline && (
                          <span className={`inline-flex items-center gap-1 text-[10px] ${deadlineClass(task)}`}>
                            <Calendar className="w-2.5 h-2.5" /> {formatDeadline(task.deadline)}
                          </span>
                        )}
                        {subs.length > 0 && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {t('nodeTasksDialog.subtasksCount', { done: subs.filter((x) => x.status === 'done').length, total: subs.length })}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {task.assignee_email && (
                    <span
                      className="shrink-0 w-5 h-5 rounded-full bg-primary/20 text-primary text-[9px] font-bold inline-flex items-center justify-center"
                      title={labelForEmail(members, task.assignee_email)}
                    >
                      {getInitials(labelForEmail(members, task.assignee_email))}
                    </span>
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 hover:text-destructive" title={t('common:actions.delete')}
                      onClick={() => handleDelete(task)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
