import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import TimeSummary, { formatMinutes } from '@/components/time/TimeSummary';
import { formatTimeRange } from '@/lib/TimerContext';
import { useToast } from '@/components/ui/use-toast';
import { intlLocale } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { Clock, Trash2, Briefcase } from 'lucide-react';
import ClientsDialog from '@/components/time/ClientsDialog';

const NONE = '__none__';
const parseDate = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);

// Přehled odpracovaného času (user-menu) — souhrn dnes/týden + poslední záznamy
// s možností DODATEČNĚ přiřadit projekt/klienta (use-case: stopky puštěné
// narychlo bez cíle se sem zpětně roztřídí).
export default function TimeOverviewDialog({ open, onClose }) {
  const { t } = useTranslation('tasks');
  const { toast } = useToast();
  const [maps, setMaps] = useState([]);
  const [clients, setClients] = useState([]);
  const [entries, setEntries] = useState([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Správa klientů bydlí TADY, ne v user-menu — klient je vlastnost měření
  // času, samostatná položka v menu matla (Richard 8. 8. 2026).
  const [clientsOpen, setClientsOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    base44.entities.GoalMap.list('-updated_date', 200, { fields: 'id,title,archived' })
      .then((list) => setMaps((list || []).filter((m) => !m.archived)))
      .catch(() => {});
    base44.entities.Client.list('name').then(setClients).catch(() => {});
    base44.entities.TimeEntry.list('-started', 20).then((list) => setEntries((list || []).filter((e) => e.ended))).catch(() => {});
  }, [open, reloadKey]);

  const patchEntry = async (id, patch) => {
    try {
      const rec = await base44.entities.TimeEntry.update(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? rec : e)));
      setReloadKey((k) => k + 1); // souhrn nahoře se přepočítá
    } catch (e) {
      toast({ title: t('common:misc.saveFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  const removeEntry = async (entry) => {
    if (!window.confirm(entry.label
      ? t('timeLog.confirmDeleteEntryNote', { time: formatMinutes(entry.duration_min), note: entry.label })
      : t('timeLog.confirmDeleteEntry', { time: formatMinutes(entry.duration_min) }))) return;
    try {
      await base44.entities.TimeEntry.delete(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({ title: t('tasksPage.deleteFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2 pr-6">
            <span className="flex items-center gap-2">
              <Clock className="w-5 h-5" /> {t('timeSummary.heading')}
            </span>
            <Button variant="outline" size="sm" onClick={() => setClientsOpen(true)}>
              <Briefcase className="w-4 h-4 mr-1.5" /> {t('timeOverview.clientsButton')}
            </Button>
          </DialogTitle>
        </DialogHeader>

        {open && <TimeSummary key={reloadKey} maps={maps} />}

        {entries.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
              {t('timeOverview.recentHeading')}
            </p>
            {entries.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-12">
                  {parseDate(e.started)?.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'numeric' })}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0" title={t('timeOverview.fromToTitle')}>
                  {formatTimeRange(e.started, e.ended)}
                </span>
                <span className="text-sm font-medium tabular-nums shrink-0 w-16">{formatMinutes(e.duration_min)}</span>
                <span className="text-xs text-muted-foreground truncate flex-1 min-w-[80px]">{e.note || e.label}</span>
                <Select value={e.map_id || NONE} onValueChange={(v) => patchEntry(e.id, v === NONE
                  ? { map_id: '', node_id: '' }
                  : { map_id: v, ...(v !== e.map_id ? { node_id: '' } : {}) })}>
                  <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue placeholder={t('common:labels.project')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('common:misc.noProject')}</SelectItem>
                    {maps.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.title || t('common:misc.untitled')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={e.client_id || NONE} onValueChange={(v) => patchEntry(e.id, { client_id: v === NONE ? '' : v })}>
                  <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue placeholder={t('common:labels.client')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t('common:misc.noClient')}</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 hover:text-destructive" title={t('timeLog.deleteEntryTitle')} onClick={() => removeEntry(e)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
      <ClientsDialog open={clientsOpen}
        onClose={() => { setClientsOpen(false); setReloadKey((k) => k + 1); }} />
    </Dialog>
  );
}
