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
import { Briefcase, Trash2, Pencil, Loader2, Plus, Check, X as XIcon, ChevronDown, ChevronRight, Receipt } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import BusyIcon from '@/components/shared/BusyIcon';
import { useDialogForm } from '@/hooks/useDialogForm';

// Číselník klientů (měření času, přiřazení projektů). Vidí ho každý přihlášený,
// upravovat/mazat smí autor záznamu nebo admin — stejná pravidla vynucuje server (RLS).
// `vybranyId`: klient, který se po otevření rovnou rozbalí k úpravě (odkaz z karty asistenta „Otevřít klienta“, 24. 10. 2026)
export default function ClientsDialog({ open, onClose, onChanged, vybranyId }) {
  const { t } = useTranslation('tasks');
  const { toast } = useToast();
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  // fakturační údaje klienta (9. 10. 2026): nepovinná pole pro faktury vystavené asistentem — rozbalovací
  // blok v úpravě řádku, aby zakládání zůstalo jen jméno + barva (anti-bloat: žádné povinné pole navíc)
  // `currency` (27. 10. 2026): výchozí měna faktur tohoto klienta (německý klient v EUR); prázdná = měna dodavatele
  const PRAZDNE_FAKT = { address: '', ico: '', dic: '', email: '', currency: '' };
  const [editFakt, setEditFakt] = useState(PRAZDNE_FAKT);
  const [faktOpen, setFaktOpen] = useState(false);
  const FAKT_POLE = ['address', 'ico', 'dic', 'email', 'currency'];
  // jen zakládání nového klienta; `loading` (načtení seznamu) a úpravy/mazání
  // řádků mají vlastní mechaniku
  const f = useDialogForm({ open, onClose, submit: () => create(), onError: (e) => toast({ title: t('clients.createFailed'), description: e?.message, variant: 'destructive' }) });

  const zacniUpravu = (c) => { setEditId(c.id); setEditName(c.name); setEditColor(c.color || ''); const fk = {}; for (const k of FAKT_POLE) fk[k] = c[k] || ''; setEditFakt(fk); setFaktOpen(FAKT_POLE.some((k) => c[k]));  };
  const load = () => {
    setLoading(true);
    base44.entities.Client.list('name').then((list) => {
      setClients(list);
      if (vybranyId) { const c = list.find((x) => x.id === vybranyId); if (c) { zacniUpravu(c); setFaktOpen(true); } }
    }).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { if (open) { setName(''); setColor(''); setEditId(null); load(); } }, [open, vybranyId]);

  const canEdit = (c) => user?.role === 'admin' || c.created_by_id === user?.id;

  const create = () => {
    if (!name.trim()) return;
    return f.run(async () => {
      await base44.entities.Client.create({ name: name.trim(), color });
      setName('');
      setColor('');
      load();
      onChanged?.();
    });
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    const mena = String(editFakt.currency || '').trim().toUpperCase();
    if (mena && !/^[A-Z]{3}$/.test(mena)) { toast({ title: t('clients.currencyInvalid'), variant: 'destructive' }); return; }
    try {
      await base44.entities.Client.update(editId, { name: editName.trim(), color: editColor, address: editFakt.address.trim(), ico: editFakt.ico.trim(), dic: editFakt.dic.trim(), email: editFakt.email.trim(), currency: mena });
      setEditId(null);
      load();
      onChanged?.();
    } catch (e) {
      toast({ title: t('clients.billingSaveFailed'), description: e?.message, variant: 'destructive' });
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
    <Dialog open={open} onOpenChange={f.onOpenChange}>
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
              placeholder={t('clients.namePlaceholder')} onKeyDown={f.onEnter} />
            <Button onClick={create} disabled={!name.trim() || f.busy}>
              <BusyIcon busy={f.busy} icon={Plus} />
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
                    <button type="button" className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => setFaktOpen((v) => !v)} data-testid="client-billing-toggle">
                      {faktOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}<Receipt className="w-3.5 h-3.5" />{t('clients.billingToggle')}
                    </button>
                    {faktOpen && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="client-billing">
                        <p className="sm:col-span-2 text-[11px] text-muted-foreground">{t('clients.billingHint')}</p>
                        <div className="sm:col-span-2">
                          <Label htmlFor="client-address" className="text-xs">{t('clients.address')}</Label>
                          <Textarea id="client-address" rows={2} value={editFakt.address} onChange={(e) => setEditFakt((fk) => ({ ...fk, address: e.target.value }))} maxLength={300} className="mt-1 text-sm" data-testid="client-address" />
                        </div>
                        {['ico', 'dic', 'email', 'currency'].map((k) => (
                          <div key={k}>
                            <Label htmlFor={`client-${k}`} className="text-xs">{t(`clients.${k}`)}</Label>
                            <Input id={`client-${k}`} value={editFakt[k]} onChange={(e) => setEditFakt((fk) => ({ ...fk, [k]: k === 'currency' ? String(e.target.value || '').toUpperCase() : e.target.value }))} maxLength={k === 'email' ? 120 : (k === 'currency' ? 3 : 20)} placeholder={k === 'currency' ? t('clients.currencyHint') : undefined} className={`mt-1 h-8 text-sm${k === 'currency' ? ' uppercase' : ''}`} data-testid={`client-${k}`} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color || '#94a3b8' }} />
                    <span className="text-sm font-medium truncate flex-1 min-w-0">{c.name}{c.ico ? <span className="ml-1.5 text-[11px] text-muted-foreground font-normal" data-testid="client-ico">IČO {c.ico}</span> : null}</span>
                    {canEdit(c) && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                          onClick={() => zacniUpravu(c)} title={t('common:actions.edit')}>
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
