import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { X, Plus, Trash2, Inbox, GripVertical, ArrowRight, Loader2, Pencil, Calendar, X as XIcon, Network } from 'lucide-react';
import DatePicker from '@/components/DatePicker';
import { intlLocale } from '@/lib/locale';
import { popisJakoText } from '@/lib/popisFormat';

export const BUFFER_DRAG_MIME = 'application/kb-buffer';

// Osobní zásobník nápadů — sdílený napříč všemi mapami uživatele.
// Stav vlastní editor (hook), aby mohl odkládat uzly z mapy a mazat po vložení.
export function useBufferNodes(user) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  // loaded = proběhl aspoň jeden fetch — odlišuje „ještě nenačteno" od „prázdný zásobník"
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      setItems(await base44.entities.BufferNode.list('-created_date'));
    } catch {
      // panel není kritický — při chybě jen zůstane prázdný
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const add = useCallback(async ({ title, description = '', color = '', deadline = '' }) => {
    const item = await base44.entities.BufferNode.create({ title, description, color, deadline });
    setItems((prev) => [item, ...prev]);
    return item;
  }, []);

  const remove = useCallback(async (id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    try {
      await base44.entities.BufferNode.delete(id);
    } catch {
      refresh();
    }
  }, [refresh]);

  const update = useCallback(async (id, patch) => {
    const item = await base44.entities.BufferNode.update(id, patch);
    setItems((prev) => prev.map((i) => (i.id === id ? item : i)));
    return item;
  }, []);

  return { items, loading, loaded, add, remove, update, refresh };
}

const formatDeadline = (d) => {
  const date = new Date(d);
  return isNaN(date) ? d : date.toLocaleDateString(intlLocale());
};

// Převod nápadu na úkol — přesun (nápad zmizí, vznikne úkol v CÍLOVÉM projektu;
// úkol bez projektu neexistuje, server ho odmítne). Cíl vybírá volající:
// stránka Úkoly přes dialog, editor mapy použije otevřený projekt.
export function BufferEditDialog({ item, onSave, onClose }) {
  const { t } = useTranslation('editor');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) {
      setTitle(item.title || '');
      setDescription(item.description || '');
      setDeadline(item.deadline || '');
    }
  }, [item]);

  const handleSave = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(item.id, { title: title.trim(), description, deadline });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('buffer.editTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="buffer-title">{t('tasks:taskDialog.labelTitle')}</Label>
            <Input
              id="buffer-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="buffer-desc">{t('tasks:taskDialog.labelDescription')}</Label>
            <Textarea
              id="buffer-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder={t('buffer.descPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="buffer-deadline">{t('tasks:taskDialog.labelDeadline')}</Label>
            <div className="flex gap-2">
              <DatePicker id="buffer-deadline" value={deadline} onChange={setDeadline} className="flex-1 h-8" />
              {deadline && (
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setDeadline('')} title={t('tasks:taskDialog.clearDeadline')}>
                  <XIcon className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!title.trim() || saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : t('common:actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// fixed: na stránkách, co rolují (titulka), se panel ukotví k oknu;
// v editoru zůstává absolute uvnitř plátna (pod hlavičkou).
// leftOffset: posun zavřeného ouška doprava (px) — když je otevřený DRUHÝ levý
// panel, ouško se přilepí na jeho hranu místo plavání přes jeho obsah.
export default function BufferPanel({ buffer, canEdit, onInsert, onConvert, open, onToggle, fixed = false, leftOffset = 0 }) {
  const { t } = useTranslation('editor');
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const { items, loading } = buffer;
  const toggle = onToggle;
  const pos = fixed ? 'fixed' : 'absolute';

  const handleAdd = async () => {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await buffer.add({ title });
      setNewTitle('');
    } finally {
      setAdding(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={toggle}
        title={t('tasks:taskTable.bufferSection')}
        style={{ left: leftOffset }}
        className={`${pos} top-16 z-30 flex items-center gap-1.5 rounded-r-lg border bg-card px-2 py-2.5 shadow-md hover:bg-secondary transition-all ${leftOffset ? '' : 'border-l-0'}`}
      >
        <Inbox className="w-4 h-4 text-primary" />
        {items.length > 0 && (
          <span className="min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">
            {items.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`${pos} left-0 top-0 bottom-0 w-full sm:w-72 bg-card border-r shadow-xl flex flex-col z-20`}>
      <div className="h-12 border-b flex items-center justify-between px-4 shrink-0">
        {/* klik na ikonku/název zavírá stejně jako křížek — jedním klikem tam i zpět */}
        <button onClick={toggle} title={t('buffer.closeTitle')} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
          <Inbox className="w-4 h-4 text-primary" />
          <span className="font-heading font-semibold text-sm">{t('buffer.heading')}</span>
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground">({items.length})</span>
          )}
        </button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggle}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-3 border-b shrink-0">
        <div className="flex gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder={t('buffer.newPlaceholder')}
            className="h-8 text-sm"
          />
          <Button size="icon" className="h-8 w-8 shrink-0" onClick={handleAdd} disabled={!newTitle.trim() || adding}>
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {loading && items.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            <Loader2 className="w-5 h-5 mx-auto animate-spin" />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div className="text-center text-muted-foreground text-sm py-8">
            <Inbox className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>{t('buffer.emptyTitle')}</p>
            <p className="text-xs mt-1">{t('buffer.emptyHint')}</p>
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            draggable={canEdit}
            onDragStart={(e) => {
              e.dataTransfer.setData(BUFFER_DRAG_MIME, JSON.stringify(item));
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={`group rounded-lg border bg-background p-2.5 flex items-start gap-2 ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''}`}
          >
            {canEdit && <GripVertical className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/50" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium break-words">{item.title}</p>
              {item.description && (
                <p className="text-xs text-muted-foreground break-words line-clamp-2 mt-0.5">{popisJakoText(item.description)}</p>
              )}
              {item.deadline && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium mt-1 px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                  <Calendar className="w-2.5 h-2.5" />
                  {formatDeadline(item.deadline)}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title={t('buffer.insertTitle')}
                  onClick={() => onInsert(item)}
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
              {/* vložení do projektu (výběr mapy dodá stránka) — uzel pod hlavní
                  cíl; převod na volný úkolový záznam byl pozůstatek a je pryč
                  (Richard 7. 8. 2026: „uzel je úkol a musí být vždy v mapě") */}
              {onConvert && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  title={t('tasks:taskTable.insertToProject')}
                  onClick={() => onConvert(item)}
                >
                  <Network className="w-3.5 h-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title={t('common:actions.edit')}
                onClick={() => setEditItem(item)}
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive/70 hover:text-destructive"
                title={t('tasks:taskTable.deleteFromBuffer')}
                onClick={() => {
                  // STEJNÉ potvrzení jako na stránce Úkoly — tady chybělo a na
                  // mobilu (drobné ikonky, žádný tooltip) stálo Richarda nápad,
                  // nenávratně (7. 8. 2026 v noci, ověřeno v datech instance).
                  if (!window.confirm(t('tasks:tasksPage.confirmDeleteIdea', { title: item.title }))) return;
                  buffer.remove(item.id);
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {canEdit && items.length > 0 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            {t('buffer.dragHint')}
          </p>
        )}
      </div>
      <BufferEditDialog item={editItem} onSave={buffer.update} onClose={() => setEditItem(null)} />
    </div>
  );
}
