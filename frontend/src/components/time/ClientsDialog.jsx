import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ProjectColorPicker from '@/components/shared/ProjectColorPicker';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { Briefcase, Trash2, Pencil, Loader2, Plus, Check, X as XIcon } from 'lucide-react';

// Číselník klientů (měření času, přiřazení projektů). Vidí ho každý přihlášený,
// upravovat/mazat smí autor záznamu nebo admin — stejná pravidla vynucuje server (RLS).
export default function ClientsDialog({ open, onClose, onChanged }) {
  const { t } = useTranslation('tasks');
  const { toast } = useToast();
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');

  const load = () => {
    setLoading(true);
    base44.entities.Client.list('name').then(setClients).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { if (open) { setName(''); setColor(''); setEditId(null); load(); } }, [open]);

  const canEdit = (c) => user?.role === 'admin' || c.created_by_id === user?.id;

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await base44.entities.Client.create({ name: name.trim(), color });
      setName('');
      setColor('');
      load();
      onChanged?.();
    } catch (e) {
      toast({ title: t('clients.createFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setCreating(false);
    }
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    try {
      await base44.entities.Client.update(editId, { name: editName.trim(), color: editColor });
      setEditId(null);
      load();
      onChanged?.();
    } catch (e) {
      toast({ title: t('common:misc.saveFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  const remove = async (c) => {
    if (!window.confirm(t('clients.confirmDelete', { name: c.name }))) return;
    try {
      await base44.entities.Client.delete(c.id);
      load();
      onChanged?.();
    } catch (e) {
      toast({ title: t('tasksPage.deleteFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5" /> {t('clients.title')}
          </DialogTitle>
          <DialogDescription>
            {t('clients.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="client-name">{t('clients.newClient')}</Label>
          <div className="flex items-center gap-2">
            <Input id="client-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('clients.namePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && create()} />
            <Button onClick={create} disabled={!name.trim() || creating}>
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t('common:actions.add')}
            </Button>
          </div>
          <ProjectColorPicker value={color} onChange={setColor} />
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t('clients.empty')}</p>
          ) : (
            clients.map((c) => (
              <div key={c.id} className="rounded-lg border border-border px-3 py-2">
                {editId === c.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()} autoFocus />
                      <Button size="icon" variant="ghost" className="shrink-0" onClick={saveEdit} title={t('common:actions.save')}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setEditId(null)} title={t('common:actions.cancel')}>
                        <XIcon className="w-4 h-4" />
                      </Button>
                    </div>
                    <ProjectColorPicker value={editColor} onChange={setEditColor} />
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color || '#94a3b8' }} />
                    <span className="text-sm font-medium truncate flex-1 min-w-0">{c.name}</span>
                    {canEdit(c) && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                          onClick={() => { setEditId(c.id); setEditName(c.name); setEditColor(c.color || ''); }} title={t('common:actions.edit')}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 hover:text-destructive"
                          onClick={() => remove(c)} title={t('common:actions.delete')}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
