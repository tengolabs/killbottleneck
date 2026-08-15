import { useState, useEffect, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useTimer } from '@/lib/TimerContext';
import { Button } from '@/components/ui/button';
import TimeEntryDialog from '@/components/time/TimeEntryDialog';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { Clock, Plus } from 'lucide-react';

const parseDate = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);

// i18next.t (ne hook) — funkce se volá i mimo komponenty
export const formatMinutes = (min) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0
    ? `${i18next.t('common:time.hoursShort', { count: h })} ${m ? i18next.t('common:time.minutesShort', { count: m }) : ''}`.trim()
    : i18next.t('common:time.minutesShort', { count: m });
};

// Odpracovaný čas „dnes / tento týden" + rozpad po projektech a klientech.
// Agregace v JS z posledních záznamů (owner-only přes RLS). Běžící stopky se
// započtou po zastavení. onStats hlásí data nahoru pro PNG export dashboardu.
export default function TimeSummary({ maps = [], onStats }) {
  const { t } = useTranslation('tasks');
  const { running } = useTimer();
  const [entries, setEntries] = useState([]);
  const [clients, setClients] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = () => {
    base44.entities.TimeEntry.list('-started', 500).then(setEntries).catch(() => {});
    base44.entities.Client.list('name').then(setClients).catch(() => {});
  };
  useEffect(load, []);
  // po zastavení stopek (running → null) se souhrn přenačte
  useEffect(() => { if (!running) load(); }, [running]);

  const stats = useMemo(() => {
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week0 = new Date(today0);
    week0.setDate(week0.getDate() - ((today0.getDay() + 6) % 7)); // pondělí
    const mapTitle = Object.fromEntries(maps.map((m) => [m.id, m.title || t('common:misc.untitled')]));
    const clientById = Object.fromEntries(clients.map((c) => [c.id, c]));

    let todayMin = 0, weekMin = 0;
    const byProject = {}, byClient = {};
    for (const e of entries) {
      if (!e.duration_min || !e.ended) continue; // běžící se započte po zastavení
      const day = parseDate(e.started);
      if (!day || day < week0) continue;
      weekMin += e.duration_min;
      if (day >= today0) todayMin += e.duration_min;
      const pKey = e.map_id || '';
      const pName = pKey ? (mapTitle[pKey] || t('timeSummary.deletedProject')) : (e.label || t('common:misc.noProject'));
      byProject[pName] = (byProject[pName] || 0) + e.duration_min;
      if (e.client_id) {
        const c = clientById[e.client_id];
        const cName = c?.name || t('timeSummary.deletedClient');
        if (!byClient[cName]) byClient[cName] = { min: 0, color: c?.color || '' };
        byClient[cName].min += e.duration_min;
      }
    }
    const top = (obj, val) => Object.entries(obj).sort((a, b) => val(b[1]) - val(a[1])).slice(0, 5);
    return {
      todayMin,
      weekMin,
      projects: top(byProject, (v) => v).map(([name, min]) => ({ name, min })),
      clients: top(byClient, (v) => v.min).map(([name, v]) => ({ name, min: v.min, color: v.color })),
    };
  }, [entries, clients, maps, t]);

  useEffect(() => { onStats?.(stats); }, [stats, onStats]);

  return (
    <div className="rounded-lg border bg-background p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-primary shrink-0" />
        <span className="text-xs font-semibold">{t('timeSummary.heading')}</span>
        <Button variant="ghost" size="sm" className="h-7 ml-auto" onClick={() => setDialogOpen(true)} title={t('timeSummary.addEntryTitle')}>
          <Plus className="w-3.5 h-3.5" /> {t('timeSummary.addEntry')}
        </Button>
      </div>

      <div className="flex items-baseline gap-6">
        <div>
          <p className="text-[11px] text-muted-foreground">{t('timeSummary.today')}</p>
          <p className="text-xl font-heading font-bold tabular-nums">{formatMinutes(stats.todayMin)}</p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">{t('timeSummary.thisWeek')}</p>
          <p className="text-xl font-heading font-bold tabular-nums">{formatMinutes(stats.weekMin)}</p>
        </div>
      </div>

      {(stats.projects.length > 0 || stats.clients.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
          {stats.projects.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t('timeSummary.byProject')}</p>
              {stats.projects.map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="truncate flex-1 min-w-0">{p.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatMinutes(p.min)}</span>
                </div>
              ))}
            </div>
          )}
          {stats.clients.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{t('timeSummary.byClient')}</p>
              {stats.clients.map((c) => (
                <div key={c.name} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.color || '#94a3b8' }} />
                  <span className="truncate flex-1 min-w-0">{c.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums shrink-0">{formatMinutes(c.min)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <TimeEntryDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={load} maps={maps} />
    </div>
  );
}
