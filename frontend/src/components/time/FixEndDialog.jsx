import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import { useDialogForm } from '@/hooks/useDialogForm';
import { intlLocale } from '@/lib/locale';
import { noteWithoutMark } from '@/lib/timeFix';

const parseDate = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);
const p2 = (n) => String(n).padStart(2, '0');
// value of <input type="datetime-local"> in the local time zone
const toLocalInput = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;

// Corrects the end of an entry closed by the 12 h auto-stop (decision 16 Nov 2026). The end can only move
// earlier and must stay after the start — the same rule the server enforces. A 12 h entry may cross midnight,
// hence one date-and-time field. Saving also drops the auto-stop marker from the note.
export default function FixEndDialog({ entry, onClose, onSaved }) {
  const { t } = useTranslation('tasks');
  const { toast } = useToast();
  const open = !!entry;
  const [value, setValue] = useState('');
  const f = useDialogForm({ open, onClose, submit: () => save(), onError: (e) => toast({ title: t('timeFix.saveFailed'), description: e?.message, variant: 'destructive' }) });

  const started = parseDate(entry?.started);
  const ended = parseDate(entry?.ended);
  useEffect(() => { if (entry) setValue(''); }, [entry?.id]);

  // The field has minute resolution, the stored start has seconds: carry them over, so that
  // "3 hours after the start" is 180 minutes and not 179 (unless that would pass the old end).
  const typed = value ? new Date(value) : null;
  const carried = typed && started && !Number.isNaN(typed.getTime()) ? new Date(typed.getTime() + (started.getTime() % 60000)) : typed;
  const picked = carried && ended && carried >= ended ? typed : carried;
  const valid = !!picked && !Number.isNaN(picked.getTime()) && !!started && !!ended && picked > started && picked < ended;
  const minutes = valid ? Math.round((picked - started) / 60000) : 0;
  const fmt = (d) => (d ? d.toLocaleString(intlLocale(), { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?');

  const save = () => {
    if (f.busy || !valid) return undefined;
    return f.run(async () => {
      const rec = await base44.entities.TimeEntry.update(entry.id, { ended: picked.toISOString(), note: noteWithoutMark(entry.note) });
      toast({ title: t('timeFix.saved') });
      onSaved?.(rec);
      onClose();
    });
  };

  return (
    <Dialog open={open} onOpenChange={f.onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="oprava-konce-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" /> {t('timeFix.title')}
          </DialogTitle>
          <DialogDescription>{t('timeFix.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm" data-testid="oprava-konce-rozsah">
            {t('timeFix.range', { from: fmt(started), to: fmt(ended) })}
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="tf-end">{t('timeFix.endLabel')}</Label>
            <Input id="tf-end" type="datetime-local" data-testid="oprava-konce-cas" value={value}
              min={started ? toLocalInput(started) : undefined} max={ended ? toLocalInput(ended) : undefined}
              onChange={(e) => setValue(e.target.value)} onKeyDown={f.onEnter} />
          </div>
          <p className={`text-xs ${value && !valid ? 'text-destructive' : 'text-muted-foreground'}`} data-testid="oprava-konce-souhrn">
            {valid
              ? (Math.floor(minutes / 60)
                ? t('timeEntry.totalHM', { h: Math.floor(minutes / 60), m: minutes % 60 })
                : t('timeEntry.totalM', { m: minutes % 60 }))
              : t('timeFix.rule')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button onClick={save} disabled={f.busy || !valid} data-testid="oprava-konce-ulozit">{t('timeFix.saveButton')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
