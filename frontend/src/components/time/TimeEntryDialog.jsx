import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import DatePicker from '@/components/DatePicker';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { useDialogForm } from '@/hooks/useDialogForm';

const NONE = '__none__';

// Ruční zápis odpracovaného času („včera 2 h na projektu X") — doplněk stopek.
// duration_min si přepočítá server ze started/ended.
export default function TimeEntryDialog({ open, onClose, onSaved, maps = [] }) {
  const { t } = useTranslation('tasks');
  const { toast } = useToast();
  const [date, setDate] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mapId, setMapId] = useState('');
  const [clientId, setClientId] = useState('');
  const [note, setNote] = useState('');
  const [clients, setClients] = useState([]);
  const f = useDialogForm({ open, onClose, submit: () => save(), onError: (e) => toast({ title: t('timeEntry.saveFailed'), description: e?.message, variant: 'destructive' }) });

  useEffect(() => {
    if (!open) return;
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    setDate(`${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`);
    const hourAgo = new Date(now.getTime() - 3600000);
    setFrom(`${p(hourAgo.getHours())}:${p(hourAgo.getMinutes())}`);
    setTo(`${p(now.getHours())}:${p(now.getMinutes())}`);
    setMapId('');
    setClientId('');
    setNote('');
    base44.entities.Client.list('name').then(setClients).catch(() => {});
  }, [open]);

  const minutes = (() => {
    if (!from || !to) return 0;
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    return th * 60 + tm - (fh * 60 + fm);
  })();

  const save = () => {
    if (f.busy) return; // dřív než validační toast — během ukládání Enter mlčí
    if (!date || minutes <= 0) {
      toast({ title: t('timeEntry.endAfterStart'), variant: 'destructive' });
      return;
    }
    return f.run(async () => {
      const mapTitle = maps.find((m) => m.id === mapId)?.title || '';
      await base44.entities.TimeEntry.create({
        started: new Date(`${date}T${from}:00`).toISOString(),
        ended: new Date(`${date}T${to}:00`).toISOString(),
        map_id: mapId,
        client_id: clientId,
        note,
        label: (note || mapTitle || t('timeEntry.manualEntryLabel')).slice(0, 200),
      });
      onSaved?.();
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={f.onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> {t('timeEntry.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t('timeEntry.date')}</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="te-from">{t('timeEntry.from')}</Label>
              <Input id="te-from" type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="te-to">{t('timeEntry.to')}</Label>
              <Input id="te-to" type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {minutes > 0
              ? (Math.floor(minutes / 60)
                ? t('timeEntry.totalHM', { h: Math.floor(minutes / 60), m: minutes % 60 })
                : t('timeEntry.totalM', { m: minutes % 60 }))
              : t('timeEntry.endAfterStart')}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('common:labels.project')}</Label>
              <Select value={mapId || NONE} onValueChange={(v) => setMapId(v === NONE ? '' : v)}>
                <SelectTrigger><SelectValue placeholder={t('common:misc.noProject')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('common:misc.noProject')}</SelectItem>
                  {maps.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.title || t('common:misc.untitled')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('common:labels.client')}</Label>
              <Select value={clientId || NONE} onValueChange={(v) => setClientId(v === NONE ? '' : v)}>
                <SelectTrigger><SelectValue placeholder={t('timeEntry.clientByProject')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t('timeEntry.clientByProjectNone')}</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="te-note">{t('common:labels.note')}</Label>
            <Input id="te-note" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={t('timeEntry.notePlaceholder')} onKeyDown={f.onEnter} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button onClick={save} disabled={f.busy || minutes <= 0}>{t('timeEntry.saveButton')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
