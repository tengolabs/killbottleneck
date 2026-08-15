import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTimer, formatElapsed, formatTimeRange } from '@/lib/TimerContext';
import { formatMinutes } from '@/components/time/TimeSummary';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { intlLocale } from '@/lib/locale';
import { useTranslation } from 'react-i18next';
import { Timer, Square, X as XIcon, Trash2 } from 'lucide-react';

const NONE = '__none__';
const parseDate = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);

// Levý panel „Měření času" (pod zásobníkem nápadů — vzor BufferPanel, včetně
// `fixed` varianty pro rolující stránky): běžící měření + moje poslední záznamy
// NAPŘÍČ vším (inbox chování). Nepřiřazené záznamy jsou zvýrazněné a jdou
// zpětně přiřadit k uzlu TÉTO mapy (jen v editoru) nebo k projektu.
// Měření nikdy nemění stav uzlů. Stav open/onToggle vlastní STRÁNKA — kvůli
// odsouvání obsahu (sm:pl-80) a vzájemné výlučnosti se zásobníkem.
// leftOffset: posun zavřeného ouška doprava (px), když je otevřený zásobník.
export default function TimeLogPanel({ mapId = '', nodes = [], fixed = false, open, onToggle, leftOffset = 0 }) {
  const { t } = useTranslation('tasks');
  const { toast } = useToast();
  const { running, elapsed, stop } = useTimer();
  const pos = fixed ? 'fixed' : 'absolute';
  const [entries, setEntries] = useState([]);
  const [maps, setMaps] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    base44.entities.TimeEntry.list('-started', 20)
      .then((list) => setEntries((list || []).filter((e) => e.ended)))
      .catch(() => {});
    base44.entities.GoalMap.list('-updated_date', 200, { fields: 'id,title,archived' })
      .then((list) => setMaps((list || []).filter((m) => !m.archived)))
      .catch(() => {});
  };
  // načíst při otevření a po startu/zastavení stopek (running mění identitu jen tehdy)
  useEffect(() => { if (open) load(); }, [open, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const nodeOptions = useMemo(
    () => nodes
      .filter((n) => n.type !== 'note')
      .map((n) => ({ id: n.id, title: n.data?.title || n.data?.apexText || t('common:misc.untitled') })),
    [nodes]
  );
  const nodeTitle = (id) => nodeOptions.find((n) => n.id === id)?.title || '';

  const handleStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const rec = await stop({ note: note.trim() });
      setNote('');
      const unassigned = rec && !rec.map_id && !rec.task_id && !rec.node_id;
      toast({
        title: t('timeLog.timeRecorded'),
        description: t(unassigned && rec?.note ? 'timeLog.recordedDescInbox' : 'timeLog.recordedDesc', { minutes: rec?.duration_min ?? 0 }),
      });
    } catch (e) {
      toast({ title: t('timeLog.stopFailed'), description: e?.message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const patchEntry = async (id, patch) => {
    try {
      const rec = await base44.entities.TimeEntry.update(id, patch);
      setEntries((prev) => prev.map((e) => (e.id === id ? rec : e)));
    } catch (e) {
      toast({ title: t('common:misc.saveFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  const removeEntry = async (entry) => {
    const noteText = entry.note || entry.label;
    if (!window.confirm(noteText
      ? t('timeLog.confirmDeleteEntryNote', { time: formatMinutes(entry.duration_min), note: noteText })
      : t('timeLog.confirmDeleteEntry', { time: formatMinutes(entry.duration_min) }))) return;
    try {
      await base44.entities.TimeEntry.delete(entry.id);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (e) {
      toast({ title: t('tasksPage.deleteFailed'), description: e?.message, variant: 'destructive' });
    }
  };

  if (!open) {
    return (
      <button
        onClick={onToggle}
        style={{ left: leftOffset }}
        className={`${pos} top-28 z-30 flex items-center gap-1.5 rounded-r-lg border bg-card px-2 py-2 text-xs font-medium text-muted-foreground hover:text-primary shadow-md transition-all ${leftOffset ? '' : 'border-l-0'}`}
        title={t('timeLog.openTitle')}
      >
        <Timer className={`w-4 h-4 ${running ? 'text-red-500 animate-spin' : ''}`} />
        {running && <span className="font-mono tabular-nums text-red-500">{formatElapsed(elapsed)}</span>}
      </button>
    );
  }

  return (
    <div className={`${pos} left-0 top-0 bottom-0 z-20 w-full sm:w-80 bg-card border-r shadow-xl flex flex-col`}>
      <div className="h-12 px-3 flex items-center gap-2 border-b shrink-0">
        {/* klik na ikonku/název zavírá stejně jako křížek — jedním klikem tam i zpět */}
        <button onClick={onToggle} title={t('timeLog.closeTitle')} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
          <Timer className={`w-4 h-4 ${running ? 'text-red-500 animate-spin' : 'text-primary'}`} />
          <span className="text-sm font-heading font-semibold">{t('timeLog.heading')}</span>
        </button>
        <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={onToggle} title={t('common:actions.close')}>
          <XIcon className="w-4 h-4" />
        </Button>
      </div>

      {running && (
        <div className="p-3 border-b space-y-2 shrink-0 bg-primary/5">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary animate-pulse shrink-0" />
            <span className="font-mono text-sm tabular-nums text-primary">{formatElapsed(elapsed)}</span>
            <span className="text-xs text-muted-foreground truncate">{running.label}</span>
          </div>
          <div className="flex items-center gap-2">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('timeLog.notePlaceholder')}
              className="h-8 text-sm" onKeyDown={(e) => e.key === 'Enter' && handleStop()} />
            <Button size="sm" className="h-8 shrink-0" onClick={handleStop} disabled={busy}>
              <Square className="w-3.5 h-3.5" /> {t('timeLog.stopButton')}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t('timeLog.unassignedHint')}
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">{t('timeLog.empty')}</p>
        ) : (
          entries.map((e) => {
            const unassigned = !e.map_id && !e.task_id && !e.node_id;
            return (
              <div key={e.id} className={`rounded-lg border px-2.5 py-2 space-y-1.5 ${unassigned ? 'border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20' : ''}`}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {parseDate(e.started)?.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'numeric' })}
                  </span>
                  <span className="text-muted-foreground tabular-nums shrink-0">{formatTimeRange(e.started, e.ended)}</span>
                  <span className="font-semibold tabular-nums shrink-0">{formatMinutes(e.duration_min)}</span>
                  {unassigned && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 shrink-0">
                      {t('timeLog.unassignedBadge')}
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto shrink-0 hover:text-destructive" title={t('timeLog.deleteEntryTitle')} onClick={() => removeEntry(e)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
                {(e.note || e.label) && <p className="text-xs truncate">{e.note || e.label}</p>}
                <div className="flex items-center gap-1.5">
                  {mapId && nodeOptions.length > 0 && (
                    <Select
                      value={e.map_id === mapId && e.node_id && nodeOptions.some((n) => n.id === e.node_id) ? e.node_id : NONE}
                      onValueChange={(v) => patchEntry(e.id, v === NONE
                        ? { node_id: '' }
                        : { node_id: v, map_id: mapId })}
                    >
                      <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder={t('timeLog.nodePlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>{t('timeLog.thisMapNodeItem')}</SelectItem>
                        {nodeOptions.map((n) => (
                          <SelectItem key={n.id} value={n.id}>{n.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={e.map_id || NONE} onValueChange={(v) => patchEntry(e.id, v === NONE
                    ? { map_id: '', node_id: '' }
                    : { map_id: v, ...(v !== e.map_id ? { node_id: '' } : {}) })}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs"><SelectValue placeholder={t('common:labels.project')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{t('common:misc.noProject')}</SelectItem>
                      {maps.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.title || t('common:misc.untitled')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {e.map_id === mapId && e.node_id && nodeTitle(e.node_id) && (
                  <p className="text-[11px] text-muted-foreground truncate">→ {nodeTitle(e.node_id)}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
