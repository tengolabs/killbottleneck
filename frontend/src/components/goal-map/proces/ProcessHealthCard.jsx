import { useTranslation } from 'react-i18next';
import { HeartPulse } from 'lucide-react';
import { rhythmLabel, formatDay } from '@/lib/rhythm';
import { fmtRun, daysLate } from './processFormat';

// ZDRAVÍ BĚHU procesu — v přehledu mapy místo „Celkového pokroku" (maketa
// 8099/kb-proces, schváleno 25. 10. 2026). Data z /api/kb/process-health:
// opakované kroky včas / po termínu, průchody za 30 dní, poslední průchod
// a tabulka kroků. Kroky bez rytmu se nepočítají (jsou to popis procesu).
export default function ProcessHealthCard({ health }) {
  const { t, i18n } = useTranslation('editor');
  if (!health) return null;
  const kroky = [...(health.steps || [])].sort((a, b) => (Number(b.late) - Number(a.late)) || String(a.deadline).localeCompare(String(b.deadline)));
  const kpi = (label, cislo, pod, barva = '', testid) => (
    <div className="rounded-xl border bg-card p-4 space-y-1" data-testid={testid}>
      <div className={`text-xs font-medium ${barva || 'text-muted-foreground'}`}>{label}</div>
      <div className="text-3xl font-heading font-bold text-foreground tabular-nums">{cislo}</div>
      <p className="text-xs text-muted-foreground truncate">{pod}</p>
    </div>
  );
  return (
    <div className="rounded-xl border bg-card p-4 space-y-4" data-testid="process-health-card">
      <h3 className="flex items-center gap-2 text-sm font-heading font-semibold text-foreground">
        <HeartPulse className="w-4 h-4 text-primary" /> {t('process.healthHeading')}
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpi(t('process.kpiOk'), health.ok, t('process.kpiOkSub'), 'text-green-600 dark:text-green-400', 'health-ok')}
        {kpi(t('process.kpiLate'), health.late, t('process.kpiLateSub'), 'text-red-600 dark:text-red-400', 'health-late')}
        {kpi(t('process.kpiRuns'), health.runs30, t('process.kpiRunsSub'), '', 'health-runs')}
        <div className="rounded-xl border bg-card p-4 space-y-1" data-testid="health-last">
          <div className="text-xs font-medium text-muted-foreground">{t('process.kpiLast')}</div>
          <div className="text-lg font-heading font-bold text-foreground py-1">{health.last ? fmtRun(health.last.at, t) : '—'}</div>
          <p className="text-xs text-muted-foreground truncate">{health.last ? health.last.title : t('process.kpiLastNone')}</p>
        </div>
      </div>
      {kroky.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="health-table">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="py-1.5 pr-3 font-medium">{t('process.colStep')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('process.colRhythm')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('process.colLast')}</th>
                <th className="py-1.5 pr-3 font-medium text-right">{t('process.colRuns')}</th>
                <th className="py-1.5 pr-3 font-medium text-right">{t('process.colLate')}</th>
                <th className="py-1.5 font-medium">{t('process.colNow')}</th>
              </tr>
            </thead>
            <tbody>
              {kroky.map((st) => (
                <tr key={st.id} className="border-b last:border-0">
                  <td className="py-1.5 pr-3">{st.title}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{rhythmLabel(t, st.rhythm, st.deadline)}</td>
                  <td className="py-1.5 pr-3">{st.last_at ? fmtRun(st.last_at, t) : '—'}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{st.runs90}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${st.late90 ? 'text-red-600 dark:text-red-400' : ''}`}>{st.late90}</td>
                  <td className={`py-1.5 ${st.late ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {st.late
                      ? t('process.nowLate', { count: daysLate(st.deadline, health.today) })
                      : (st.deadline ? t('process.nowOk', { date: formatDay(st.deadline, i18n.language) }) : t('process.nowNoDeadline'))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('process.noRecurring')}</p>
      )}
      <p className="text-xs text-muted-foreground">{t('process.healthHint')}</p>
    </div>
  );
}
