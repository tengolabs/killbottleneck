import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, UserPlus, Lock, Pencil, Trash2, Plus, Check, X as XIcon } from 'lucide-react';
import BusyIcon from '@/components/shared/BusyIcon';
import { useDialogForm } from '@/hooks/useDialogForm';
import { base44 } from '@/api/base44Client';
import { listExternalContacts } from '@/lib/externalContacts';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';

// Adresář EXTERNÍCH kontaktů (Richard 11. 8. 2026) — lidé mimo systém (účetní,
// dodavatelé), kterým jde zadávat uzly/úkoly s termínem. Nemají účet, NIC jim
// nechodí a o ničem nevědí; čistě interní evidence. Vzor ClientsDialog (číselník
// klientů) — stejná pravidla drží server (RLS): privátní kontakt vidí a mění jen
// zakladatel (ani admin ne), veřejný mění autor nebo admin.
// Dialog je záměrně JEDINÉ místo správy — otevírá se kontextově z výběru
// řešitele (anti-bloat: žádná položka v navigaci).
// onCreated(contact) → volající může nový kontakt rovnou vybrat jako řešitele.
export default function ExternalContactDialog({ open, onClose, onCreated }) {
  const { t } = useTranslation('nav');
  const { toast } = useToast();
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState({ name: '', email: '', note: '', private: false });
  const f = useDialogForm({ open, onClose, submit: create, onError: (e) => toast({ title: t('externalContacts.saveFailed'), description: e?.message, variant: 'destructive' }) });

  const load = () => {
    setLoading(true);
    listExternalContacts().then(setContacts).finally(() => setLoading(false));
  };
  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setNote('');
    setIsPrivate(false);
    setEditId(null);
    load();
  }, [open]);

  const canEdit = (c) => c.created_by_id === user?.id || (!c.private && user?.role === 'admin');

  // function (ne const): hook výš ji dostává jako `submit` — deklarace je hoistovaná
  function create() {
    if (!name.trim()) return;
    return f.run(async () => {
      const created = await base44.entities.ExternalContact.create({
        name: name.trim(), email: email.trim(), note: note.trim(), private: isPrivate,
      });
      if (onCreated) { onCreated(created); return; } // volající vybírá → dialog zavře on
      setName(''); setEmail(''); setNote(''); setIsPrivate(false);
      load();
    });
  }

  const saveEdit = async () => {
    if (!edit.name.trim()) return;
    try {
      await base44.entities.ExternalContact.update(editId, {
        name: edit.name.trim(), email: edit.email.trim(), note: edit.note.trim(), private: edit.private,
      });
      setEditId(null);
      load();
    } catch (e) {
      toast({ title: t('common:misc.saveFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  const remove = async (c) => {
    // potvrzení VŽDY — na mobilu není druhá šance (poučení ze ztráty dat v zásobníku)
    if (!window.confirm(t('externalContacts.deleteConfirm', { name: c.name }))) return;
    try {
      await base44.entities.ExternalContact.delete(c.id);
      if (editId === c.id) setEditId(null);
      load();
    } catch (e) {
      toast({ title: t('externalContacts.deleteFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  const privateToggle = (checked, onCheck) => (
    <label className="flex items-center justify-between gap-2 text-sm cursor-pointer">
      <span className="min-w-0">
        <span className="font-medium flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" /> {t('externalContacts.privateLabel')}
        </span>
        <span className="text-[11px] text-muted-foreground block">{t('externalContacts.privateHint')}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheck} />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={f.onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5" /> {t('externalContacts.title')}
          </DialogTitle>
          <DialogDescription>{t('externalContacts.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="ext-name">{t('externalContacts.newContact')}</Label>
          <div className="flex items-center gap-2">
            <Input id="ext-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder={t('externalContacts.namePlaceholder')} onKeyDown={f.onEnter} autoFocus />
            <Button onClick={create} disabled={!name.trim() || f.busy}>
              <BusyIcon busy={f.busy} icon={Plus} />
              {t('common:actions.add')}
            </Button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t('externalContacts.emailPlaceholder')} aria-label={t('externalContacts.emailLabel')} />
            <Input value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t('externalContacts.notePlaceholder')} aria-label={t('externalContacts.noteLabel')} />
          </div>
          <p className="text-[11px] text-muted-foreground">{t('externalContacts.emailHint')}</p>
          {privateToggle(isPrivate, setIsPrivate)}
        </div>

        <div className="space-y-2">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">{t('externalContacts.empty')}</p>
          ) : (
            contacts.map((c) => (
              <div key={c.id} className="rounded-lg border border-border px-3 py-2">
                {editId === c.id ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()} autoFocus />
                      <Button size="icon" variant="ghost" className="shrink-0" onClick={saveEdit} title={t('common:actions.save')}>
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="shrink-0" onClick={() => setEditId(null)} title={t('common:actions.cancel')}>
                        <XIcon className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                        placeholder={t('externalContacts.emailPlaceholder')} />
                      <Input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                        placeholder={t('externalContacts.notePlaceholder')} />
                    </div>
                    {privateToggle(edit.private, (v) => setEdit({ ...edit, private: v }))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-medium truncate flex-1 min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{c.name}</span>
                        {c.private && <Lock className="w-3 h-3 text-muted-foreground shrink-0" aria-label={t('externalContacts.privateBadge')} />}
                      </span>
                      {(c.email || c.note) && (
                        <span className="text-[11px] text-muted-foreground font-normal truncate block">
                          {[c.email, c.note].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    {canEdit(c) && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                          onClick={() => { setEditId(c.id); setEdit({ name: c.name, email: c.email || '', note: c.note || '', private: !!c.private }); }}
                          title={t('common:actions.edit')}>
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
