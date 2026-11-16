import { useTranslation } from 'react-i18next';
import { Check, Flame, Trophy } from 'lucide-react';
import { GAMES, formatScore, unitLabel, maxLevels } from './brainApi';

// Hub of the brain training zone: today's set (one round of every game), the streak of days and one card
// per game with the level choice and the personal best. Personal statistics only — no leaderboard.
function Ring({ done, total }) {
  const r = 20; const c = 2 * Math.PI * r; const p = total ? done / total : 0;
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12 shrink-0" aria-hidden="true">
      <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="5" />
      <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 24 24)" className="text-primary transition-[stroke-dasharray] duration-500" />
      <text x="24" y="28" textAnchor="middle" fontSize="13" fontWeight="600" fill="currentColor">{done}/{total}</text>
    </svg>
  );
}

export default function BrainHub({ summary, loading, levels, onLevel, onPlay, narrow = false }) {
  const { t } = useTranslation('brain');
  const today = (summary && summary.today) || { done: [], count: 0, total: GAMES.length };
  const streak = (summary && summary.streak) || 0;
  const bests = (summary && summary.bests) || {};
  return (
    <div className="h-full overflow-y-auto px-3 py-3 sm:px-5" data-testid="brain-hub">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3" data-testid="brain-souhrn" data-nacteno={summary ? '1' : '0'}>
          <Ring done={today.count} total={today.total} />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">{t('todayTitle')}</p>
            <p className="text-sm text-muted-foreground" data-testid="brain-dnes">{today.count >= today.total ? t('todayDone') : t('todayHint', { done: today.count, total: today.total })}</p>
          </div>
          <div className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm" title={t('streakTitle')} data-testid="brain-serie" data-serie={streak}>
            <Flame className={`h-4 w-4 ${streak > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />
            <b className="tabular-nums">{streak}</b>
            <span className="text-muted-foreground">{streak === 1 ? t('streakOneDay') : t('streakLabel')}</span>
          </div>
          {loading && !summary && <span className="text-xs text-muted-foreground" data-testid="brain-nacitam">{t('loading')}</span>}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="brain-karty">
          {GAMES.map(({ id, Icon, skill }) => {
            const max = maxLevels(id, narrow);
            const lvl = Math.min(max, Math.max(1, Number(levels[id]) || 1));
            const done = (today.done || []).includes(id);
            const best = bests[id] && bests[id][lvl];
            return (
              <div key={id} className={`flex flex-col gap-2 rounded-2xl border bg-card p-3 transition-colors ${done ? 'border-primary/60' : ''}`} data-testid={`brain-karta-${id}`} data-hotovo={done ? '1' : '0'}>
                <button type="button" onClick={() => onPlay(id, lvl)} className="flex items-start gap-2 text-left" data-testid={`brain-hrat-${id}`}>
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${done ? 'bg-primary text-primary-foreground' : 'bg-secondary text-foreground'}`}>
                    {done ? <Check className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{t(`game.${id}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(skill)}</span>
                  </span>
                </button>
                <div className="flex items-center justify-between gap-2 text-xs">
                  {max > 1 ? (
                    <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t('level')}>
                      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" onClick={() => onLevel(id, n)} aria-pressed={lvl === n} title={`${t('level')} ${n}`}
                          className={`h-6 min-w-6 rounded-md px-1.5 tabular-nums ${lvl === n ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`} data-testid={`brain-uroven-${id}-${n}`}>{n}</button>
                      ))}
                    </div>
                  ) : <span />}
                  <span className="inline-flex items-center gap-1 text-muted-foreground" title={t('best')} data-testid={`brain-nejlepsi-${id}`}>
                    <Trophy className="h-3.5 w-3.5" />{best === undefined ? '—' : `${formatScore(id, best)}${unitLabel(t, id)}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-center text-xs text-muted-foreground">{t('privacy')}</p>
      </div>
    </div>
  );
}
