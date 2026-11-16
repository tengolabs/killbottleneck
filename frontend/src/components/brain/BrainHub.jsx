import { useTranslation } from 'react-i18next';
import { Award, Check, Flame, Sparkles, Trophy } from 'lucide-react';
import { GAMES, formatScore, unitLabel, maxLevels } from './brainApi';

// Hub of the brain training zone: the game of the day (one of the 11, picked by the server — summary.today.game) with
// the streak and today's bonus (other games finished today), this week's progress (distinct games since Monday, all 11 =
// the week's badge) and one card per game with the level choice and the personal best. Personal statistics only — no
// leaderboard.
function Week({ week, t }) {
  const done = (week && week.done) || [];
  const total = (week && week.total) || GAMES.length;
  const full = done.length >= total;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border bg-card px-4 py-2.5" data-testid="brain-tyden" data-tyden={done.length} data-celkem={total}>
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
        {full ? <Award className="h-4 w-4 text-amber-500" /> : null}{t('weekTitle')}
      </span>
      <span className="text-sm text-muted-foreground" data-testid="brain-tyden-text">{full ? t('weekDone', { total }) : t('weekHint', { done: done.length, total })}</span>
      <span className="flex basis-full flex-wrap gap-1 sm:flex-1 sm:basis-auto sm:justify-end" aria-hidden="true">
        {GAMES.map(({ id, Icon }) => (
          <span key={id} title={t(`game.${id}`)} data-testid={`brain-tyden-${id}`} data-hotovo={done.includes(id) ? '1' : '0'}
            className={`flex h-6 w-6 items-center justify-center rounded-md ${done.includes(id) ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground opacity-60'}`}>
            <Icon className="h-3.5 w-3.5" />
          </span>
        ))}
      </span>
    </div>
  );
}

export default function BrainHub({ summary, loading, levels, onLevel, onPlay, narrow = false }) {
  const { t } = useTranslation('brain');
  const today = (summary && summary.today) || { done: [], bonus: 0 };
  // without a summary (still loading, offline) every game is one list, as before the game of the day existed
  const daily = summary && today.game && GAMES.some((g) => g.id === today.game) ? today.game : '';
  const todays = daily ? GAMES.filter((g) => g.id === daily) : GAMES;
  const others = daily ? GAMES.filter((g) => g.id !== daily) : [];
  const streak = (summary && summary.streak) || 0;
  const bests = (summary && summary.bests) || {};
  const bonus = Number(today.bonus) || 0;
  const card = ({ id, Icon, skill }) => {
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
        {/* wraps on a 320 px phone (two narrow cards: levels + "10 correct" did not fit) */}
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
          {max > 1 ? (
            <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t('level')}>
              {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => onLevel(id, n)} aria-pressed={lvl === n} title={`${t('level')} ${n}`}
                  className={`h-6 min-w-6 rounded-md px-1.5 tabular-nums ${lvl === n ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`} data-testid={`brain-uroven-${id}-${n}`}>{n}</button>
              ))}
            </div>
          ) : <span />}
          <span className="inline-flex items-center gap-1 text-muted-foreground" title={t('best')} data-testid={`brain-nejlepsi-${id}`}>
            <Trophy className="h-3.5 w-3.5" />{best === undefined ? '—' : `${formatScore(id, best)}${unitLabel(t, id, best)}`}
          </span>
        </div>
      </div>
    );
  };
  return (
    <div className="h-full overflow-y-auto px-3 py-3 sm:px-5" data-testid="brain-hub">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border bg-card px-4 py-3" data-testid="brain-souhrn" data-nacteno={summary ? '1' : '0'}>
          {/* the text keeps ≥ 14rem; on a phone the bonus and streak chips wrap under it instead of squeezing it */}
          <div className="min-w-0 flex-[1_1_14rem]">
            <p className="text-base font-semibold">{t('todayTitle')}{daily ? ` · ${t(`game.${daily}`)}` : ''}</p>
            <p className="text-sm text-muted-foreground" data-testid="brain-dnes" data-splneno={today.dailyDone ? '1' : '0'}>{today.dailyDone ? t('todayDone') : t('todayHint')}</p>
          </div>
          {bonus > 0 && (
            <div className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm" title={t('bonusTitle')} data-testid="brain-bonus" data-bonus={bonus}>
              <Sparkles className="h-4 w-4 text-amber-500" /><b className="tabular-nums">{t('bonusLabel', { count: bonus })}</b>
            </div>
          )}
          <div className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm" title={t('streakTitle')} data-testid="brain-serie" data-serie={streak}>
            <Flame className={`h-4 w-4 ${streak > 0 ? 'text-orange-500' : 'text-muted-foreground'}`} />
            <b className="tabular-nums">{streak}</b>
            <span className="text-muted-foreground">{streak === 1 ? t('streakOneDay') : t('streakLabel')}</span>
          </div>
          {loading && !summary && <span className="text-xs text-muted-foreground" data-testid="brain-nacitam">{t('loading')}</span>}
        </div>

        <div className={daily ? 'grid grid-cols-1 gap-3 sm:max-w-xs' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'} data-testid="brain-karty">
          {todays.map(card)}
        </div>
        {summary && summary.week && <Week week={summary.week} t={t} />}
        {others.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="brain-dalsi">
            <div>
              <p className="text-sm font-semibold">{t('moreGames')}</p>
              <p className="text-xs text-muted-foreground">{t('moreHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="brain-karty-dalsi">
              {others.map(card)}
            </div>
          </div>
        )}
        <p className="text-center text-xs text-muted-foreground">{t('privacy')}</p>
      </div>
    </div>
  );
}
