import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Plus, Loader2, Trash2, Pencil, Calendar, ExternalLink, ListChecks, Sparkles, FilePlus2 } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useTasks } from '@/hooks/useTasks';
import { useAiModes } from '@/hooks/useAiEnabled';
import { advisor } from '@/functions/advisor';
import TaskDialog from '@/components/tasks/TaskDialog';
import CommentThread from '@/components/shared/CommentThread';
import { statusConfig, cycleStatus } from '@/lib/statusMeta';
import { getDeadlineStatus, formatDeadline, getInitials } from '@/lib/nodeMeta';
import { labelForEmail } from '@/lib/memberLabel';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';

// Úkoly jednoho uzlu mapy — otevírá badge na uzlu. Úkoly žijí ve vlastní
// kolekci, dialog se nedotýká stavu mapy ani jejího auto-save.
export default function NodeTasksDialog({ map, nodeId, canEdit, emailOptions = [], members = [], onClose, onChanged }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useTranslation('tasks');
  const navigate = useNavigate();
  const tasksApi = useTasks(user, { mapId: map?.id });
  const { items, loading, byParent } = tasksApi;
  const [quickTitle, setQuickTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const ai = useAiModes();
  const [aiSuggesting, setAiSuggesting] = useState(false);

  const nodeTitle = useMemo(() => {
    const node = (map?.nodes || []).find((n) => n.id === nodeId);
    return node?.data?.title || node?.data?.apexText || '';
  }, [map, nodeId]);

  const nodeTasks = useMemo(
    () => items.filter((task) => task.node_id === nodeId && !task.parent_id),
    [items, nodeId]
  );

  const quickAdd = async () => {
    if (!quickTitle.trim() || adding) return;
    setAdding(true);
    try {
      await tasksApi.add({ title: quickTitle.trim(), map_id: map.id, node_id: nodeId });
      setQuickTitle('');
      onChanged?.();
    } catch {
      toast({ title: t('nodeTasksDialog.createFailed'), variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  // AI rozpad uzlu na úkoly (mode expand/subgoals) — návrhy se rovnou založí
  const handleAiSuggest = async () => {
    if (aiSuggesting) return;
    setAiSuggesting(true);
    try {
      const node = (map?.nodes || []).find((n) => n.id === nodeId);
      const result = await advisor({
        goal: map?.title || '',
        mode: 'expand',
        action: 'subgoals',
        path: [],
        node: {
          id: nodeId,
          title: node?.data?.title || node?.data?.apexText || '',
          description: node?.data?.description || '',
        },
        count: 5,
        type: 'cil',
      });
      const data = result.data;
      if (data?.error || !Array.isArray(data?.nodes) || data.nodes.length === 0) {
        toast({ title: t('nodeTasksDialog.aiNoSuggestions'), description: data?.error || t('nodeTasksDialog.tryAgain'), variant: 'destructive' });
        return;
      }
      for (const s of data.nodes) {
        await tasksApi.add({ title: s.title, description: s.description || '', map_id: map.id, node_id: nodeId });
      }
      onChanged?.();
      toast({ title: t('nodeTasksDialog.aiSuggested'), description: t('nodeTasksDialog.aiSuggestedDesc', { taskCount: data.nodes.length }) });
    } catch (err) {
      toast({ title: t('nodeTasksDialog.aiError'), description: err.response?.data?.error || err.message, variant: 'destructive' });
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleCycle = (task) => {
    tasksApi.update(task.id, { status: cycleStatus(task.status) })
      .then(() => onChanged?.())
      .catch(() => toast({ title: t('common:misc.statusChangeFailed'), variant: 'destructive' }));
  };

  const handleDelete = (task) => {
    if (!window.confirm(t('nodeTasksDialog.confirmDeleteTask', { title: task.title }))) return;
    tasksApi.remove(task.id)
      .then(() => onChanged?.())
      .catch(() => toast({ title: t('tasksPage.deleteFailed'), variant: 'destructive' }));
  };

  const handleSave = async (data, taskId) => {
    try {
      if (taskId) await tasksApi.update(taskId, data);
      else await tasksApi.add(data);
      onChanged?.();
    } catch (e) {
      toast({ title: t('common:misc.saveFailed'), variant: 'destructive' });
      throw e;
    }
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
                <div key={task.id} className="group flex items-center gap-2 p-2 rounded-lg border bg-card hover:border-muted-foreground/40 transition-colors">
                  <button
                    onClick={() => handleCycle(task)}
                    title={t('nodeTasksDialog.statusCycle', { status: s.label })}
                    className={`shrink-0 w-5 h-5 rounded-full border-2 inline-flex items-center justify-center transition-colors ${
                      task.status === 'done'
                        ? 'bg-green-500 border-green-500 text-white'
                        : task.status === 'in_progress'
                          ? 'border-amber-500'
                          : 'border-muted-foreground/40 hover:border-muted-foreground'
                    }`}
                  >
                    {task.status === 'done' && <Check className="w-3 h-3" />}
                    {task.status === 'in_progress' && <span className="w-2 h-2 rounded-full bg-amber-500" />}
                  </button>
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
                  <div className="shrink-0 inline-flex opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-6 w-6" title={t('common:actions.edit')}
                      onClick={() => { setEditTask(task); setEditOpen(true); }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    {canEdit && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 hover:text-destructive" title={t('common:actions.delete')}
                        onClick={() => handleDelete(task)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {canEdit && (
          <div className="flex gap-2">
            <Input
              value={quickTitle}
              onChange={(e) => setQuickTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && quickAdd()}
              placeholder={t('nodeTasksDialog.quickAddPlaceholder')}
              className="h-9"
              disabled={adding}
            />
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={quickAdd} disabled={adding || !quickTitle.trim()} title={t('nodeTasksDialog.addTask')}>
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            </Button>
            {ai.has('expand') && (
              <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleAiSuggest} disabled={aiSuggesting} title={t('nodeTasksDialog.aiSuggestTitle')}>
                {aiSuggesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              </Button>
            )}
          </div>
        )}

        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="justify-start"
            onClick={() => { setEditTask(null); setEditOpen(true); }}
          >
            <FilePlus2 className="w-4 h-4" /> {t('nodeTasksDialog.newTaskDetailed')}
          </Button>
        )}

        <Button
          variant="link"
          className="justify-start px-0 h-auto text-xs"
          onClick={() => navigate(`/tasks?map=${map.id}&node=${nodeId}`)}
        >
          <ExternalLink className="w-3 h-3" /> {t('nodeTasksDialog.openInTasks')}
        </Button>

        <TaskDialog
          open={editOpen}
          task={editTask}
          defaults={{ map_id: map?.id || '', node_id: nodeId }}
          maps={map ? [map] : []}
          emailOptions={emailOptions}
          members={members}
          onSave={handleSave}
          onClose={() => setEditOpen(false)}
        >
          {editTask && <CommentThread entity="TaskComment" filter={{ task_id: editTask.id }} />}
        </TaskDialog>
      </DialogContent>
    </Dialog>
  );
}
