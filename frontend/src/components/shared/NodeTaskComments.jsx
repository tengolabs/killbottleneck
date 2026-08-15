import { useState, useEffect } from 'react';
import { CheckSquare } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { getInitials } from '@/lib/nodeMeta';
import { intlLocale } from '@/lib/locale';
import { useTranslation } from 'react-i18next';

// Agregovaná diskuse uzlu: read-only komentáře ze VŠECH úkolů daného uzlu
// (vlastní komentáře uzlu má vedle CommentThread). Jen čtení — psát se chodí
// k úkolu, kam komentář patří.
export default function NodeTaskComments({ mapId, nodeId }) {
  const { t } = useTranslation('tasks');
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!mapId || !nodeId) { setItems([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const tasks = await base44.entities.Task.filter({ map_id: mapId, node_id: nodeId }, 'created_date', 200);
        if (!tasks.length) { if (!cancelled) setItems([]); return; }
        const titleById = Object.fromEntries(tasks.map((task) => [task.id, task.title]));
        const orFilter = tasks.map((_, i) => `task = {:t${i}}`).join(' || ');
        const params = Object.fromEntries(tasks.map((task, i) => [`t${i}`, task.id]));
        const res = await pb.collection('task_comments').getList(1, 200, {
          filter: pb.filter(orFilter, params),
          sort: 'created',
        });
        if (!cancelled) {
          setItems(res.items.map((c) => ({
            id: c.id,
            text: c.text,
            author_email: c.author_email,
            created: c.created,
            taskTitle: titleById[c.task] || '',
          })));
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [mapId, nodeId]);

  if (items.length === 0) return null;

  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' }) +
      ' ' + d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center gap-2">
        <CheckSquare className="w-4 h-4 text-muted-foreground" />
        <Label className="text-sm font-medium">{t('comments.taskDiscussionHeading', { count: items.length })}</Label>
      </div>
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {items.map((c) => (
          <div key={c.id} className="flex gap-2 p-2 rounded-lg bg-secondary/50">
            <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
              {getInitials(c.author_email) || '?'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium truncate">{c.author_email || t('comments.anonymous')}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(c.created)}</span>
              </div>
              <p className="text-[10px] text-primary truncate">{t('comments.forTask', { title: c.taskTitle })}</p>
              <p className="text-xs text-foreground mt-0.5 break-words whitespace-pre-wrap">{c.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
