import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Trash2, MessageSquare } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { getInitials } from '@/lib/nodeMeta';
import { intlLocale } from '@/lib/locale';
import { useTranslation } from 'react-i18next';

// Jedno diskusní vlákno pro obě kolekce (comments uzlů i task_comments úkolů).
// entity = 'Comment' | 'TaskComment'; filter = identifikace vlákna
// (Comment: {goalmap_id, node_id}, TaskComment: {task_id}).
export default function CommentThread({ entity, filter, onCountChange }) {
  const { t } = useTranslation('tasks');
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const ready = filter && Object.values(filter).every(Boolean);
  const filterKey = JSON.stringify(filter);

  const loadComments = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    try {
      const result = await base44.entities[entity].filter(filter, 'created_date', 100);
      setComments(result || []);
      onCountChange?.((result || []).length);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity, filterKey, ready]);

  useEffect(() => {
    setText('');
    if (ready) loadComments();
    else setComments([]);
  }, [loadComments, ready]);

  const handleAdd = async () => {
    if (!text.trim() || !ready) return;
    setSubmitting(true);
    try {
      const created = await base44.entities[entity].create({ ...filter, text: text.trim() });
      setComments((prev) => {
        const next = [...prev, created];
        onCountChange?.(next.length);
        return next;
      });
      setText('');
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (commentId) => {
    try {
      await base44.entities[entity].delete(commentId);
      setComments((prev) => {
        const next = prev.filter((c) => c.id !== commentId);
        onCountChange?.(next.length);
        return next;
      });
    } catch (e) {
      console.error(e);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' }) +
      ' ' + d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-2 pt-2 border-t">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-muted-foreground" />
        <Label className="text-sm font-medium">{t('comments.heading', { count: comments.length })}</Label>
      </div>

      {loading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{t('comments.empty')}</p>
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="flex gap-2 p-2 rounded-lg bg-secondary/50">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                {getInitials(c.author_email) || '?'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium truncate">{c.author_email || t('comments.anonymous')}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{formatDate(c.created_date)}</span>
                </div>
                <p className="text-xs text-foreground mt-0.5 break-words whitespace-pre-wrap">{c.text}</p>
              </div>
              {c.author_email === user?.email && (
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5"
                  title={t('comments.deleteTitle')}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleAdd())}
          placeholder={t('comments.inputPlaceholder')}
          className="flex-1 h-8 px-2 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
          disabled={submitting || !ready}
        />
        <Button size="icon" onClick={handleAdd} disabled={submitting || !text.trim() || !ready} title={t('comments.addTitle')}>
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
