import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus } from 'lucide-react';
import { RhythmPicker, rytmusPro, terminProDen } from '@/components/node-dialog/sections/RecurrenceSwitch';
import { firstOccurrence, todayStr, formatDay } from '@/lib/rhythm';

// Nový krok PROCESU (maketa 8099/kb-proces, schváleno 25. 10. 2026): název
// a nepovinný rytmus rovnou při přidání. S rytmem dostane krok první termín
// (první výskyt od dneška); bez rytmu je krok popisem procesu.
export default function AddStepDialog({ open, onAdd, onClose }) {
  const { t, i18n } = useTranslation('editor');
  const [nazev, setNazev] = useState('');
  const [rytmus, setRytmus] = useState(null);
  const [termin, setTermin] = useState('');
  useEffect(() => { if (open) { setNazev(''); setRytmus(null); setTermin(''); } }, [open]);

  const zmena = (z) => {
    if (z === null) { setRytmus(null); setTermin(''); return; }
    if (typeof z === 'string') {
      const r = rytmusPro(z, '');
      setRytmus(r);
      setTermin(firstOccurrence(todayStr(), r));
      return;
    }
    if (z.freq === 'weekly' && !(z.days || []).length) return;
    if (z.md) {
      const { md, ...r } = z;
      setRytmus({ ...r, day: md });
      setTermin(terminProDen(md));
      return;
    }
    setRytmus(z);
    setTermin(firstOccurrence(todayStr(), z, termin || todayStr()));
  };
  const pridat = () => {
    const n = nazev.trim();
    if (!n) return;
    onAdd({ title: n.slice(0, 200), rytmus, deadline: rytmus ? termin : '' });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md" data-testid="add-step-dialog">
        <DialogHeader>
          <DialogTitle>{t('process.addStepTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="add-step-title">{t('process.addStepName')}</Label>
            <Input id="add-step-title" autoFocus value={nazev} onChange={(e) => setNazev(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') pridat(); }}
              placeholder={t('process.addStepPlaceholder')} data-testid="add-step-title" />
          </div>
          <div className="space-y-1.5">
            <Label>{t('recurrence.label')} <span className="text-muted-foreground font-normal">{t('process.optional')}</span></Label>
            <RhythmPicker rytmus={rytmus} onChange={zmena} deadline={termin} idPrefix="add-step" />
            <p className="text-xs text-muted-foreground" data-testid="add-step-hint">
              {rytmus ? t('process.firstDue', { date: formatDay(termin, i18n.language) }) : t('process.noRhythmHint')}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('common:actions.cancel')}</Button>
          <Button onClick={pridat} disabled={!nazev.trim()} data-testid="add-step-confirm">
            <Plus className="w-4 h-4" /> {t('process.addStepConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
