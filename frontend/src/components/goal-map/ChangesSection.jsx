// A3 „Co se změnilo" — druhá polovina dashboardu projektu.
//
// Dashboard dosud ukazoval jen KDE STOJÍME (procenta, stavy, lidé). Chyběl mu
// čas — a právě „co se pohnulo od minule" je to, co člověk jinak ručně opisuje
// do chatu a na poradu. To je hlavní nález rešerše konkurence: nástroj, který
// nutí hlásit stav podruhé jinam, lidi po týdnu přestanou aktualizovat.
//
// ⚠️ Nic se nepředgeneruje a nikde se to neukládá — souhrn se spočítá při
// otevření, takže NIKDY není zastaralý (rozhodnutí Richarda 27. 7. 2026: bez AI).
// Kdo si ve středu ráno otevře dashboard před poradou, vidí stav ke středě ráno.
// Proto tu není žádné tlačítko „Aktualizovat" ani notifikace: není co osvěžovat
// a není na co upozorňovat.
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { History, CheckCircle2, Loader, Plus, CalendarClock, UserRound, Trash2, Loader2, ArrowRightLeft } from 'lucide-react';
import { pb } from '@/api/pb';
import { fmtDate } from '@/lib/locale';
import { formatDeadline } from '@/lib/nodeMeta';
import { nactiKlic, ulozKlic } from '@/lib/storageKeys';

const RANGES = [
  { key: '7', label: 'changes.range7' },
  { key: '30', label: 'changes.range30' },
  { key: 'all', label: 'changes.rangeAll' },
];

const GROUPS = [
  { key: 'done', label: 'changes.done', icon: CheckCircle2, cls: 'text-green-600 dark:text-green-400' },
  { key: 'started', label: 'changes.started', icon: Loader, cls: 'text-amber-600 dark:text-amber-400' },
  { key: 'deadline', label: 'changes.deadlineMoved', icon: CalendarClock, cls: 'text-orange-600 dark:text-orange-400' },
  { key: 'owner', label: 'changes.ownerChanged', icon: UserRound, cls: 'text-violet-600 dark:text-violet-400' },
  { key: 'added', label: 'changes.added', icon: Plus, cls: 'text-blue-600 dark:text-blue-400' },
  { key: 'moved', label: 'changes.moved', icon: ArrowRightLeft, cls: 'text-sky-600 dark:text-sky-400' },
  { key: 'removed', label: 'changes.removed', icon: Trash2, cls: 'text-muted-foreground' },
];

const STORE_KEY = 'kb-changes-range';

export default function ChangesSection({ mapId }) {
  const { t } = useTranslation('home');
  const [range, setRange] = useState(() => nactiKlic(STORE_KEY, '7'));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!mapId) return;
    setLoading(true);
    pb.send(`/api/kb/map-changes?map=${mapId}&range=${range}`, { method: 'GET' })
      .then((d) => { setData(d); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [mapId, range]);
  useEffect(load, [load]);

  const pickRange = (key) => {
    setRange(key);
    ulozKlic(STORE_KEY, key);
  };

  // detail řádku podle toho, CO se změnilo — u termínu je zajímavý posun,
  // u řešitele nový člověk, u zbytku nic (stačí název)
  const detailOf = (g, item) => {
    if (g.key === 'deadline') {
      if (!item.to) return t('changes.deadlineCleared');
      if (!item.from) return t('changes.deadlineSet', { to: formatDeadline(item.to) });
      return t('changes.deadlineFromTo', { from: formatDeadline(item.from), to: formatDeadline(item.to) });
    }
    if (g.key === 'owner') {
      return item.to ? t('changes.ownerTo', { to: item.to }) : t('changes.ownerCleared');
    }
    if (g.key === 'moved') {
      // from/to nesou NÁZVY rodičů (kanban: „Reklamace1: D1 → D2")
      return t('changes.movedFromTo', { from: item.from, to: item.to });
    }
    return '';
  };

  const groups = GROUPS.map((g) => ({ ...g, items: data?.groups?.[g.key] || [] })).filter((g) => g.items.length > 0);
  const empty = !loading && !failed && groups.length === 0;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground flex-1 min-w-0">
          <History className="w-4 h-4" />
          {t('changes.title')}
          <span className="text-xs font-normal truncate">
            {data && (range === 'all'
              ? t('changes.sinceAll')
              : data.since ? t('changes.since', { date: fmtDate(`${data.since}T00:00:00`, { day: 'numeric', month: 'numeric' }) }) : '')}
          </span>
        </div>
        {/* ovládání, ne informace → do PDF nepatří; rozsah nese text „od …" vlevo */}
        <div className="flex rounded-lg border overflow-hidden shrink-0 export-ignore">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => pickRange(r.key)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${range === r.key ? 'bg-primary text-primary-foreground' : 'hover:bg-secondary'}`}
            >
              {t(r.label)}
            </button>
          ))}
        </div>
      </div>

      {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}

      {failed && (
        <div className="rounded-lg bg-destructive/10 text-destructive px-3 py-2 text-sm">{t('changes.loadFailed')}</div>
      )}

      {empty && (
        <div className="py-4">
          <p className="text-sm">{t('changes.empty')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('changes.emptyHint')}</p>
          <p className="text-xs text-muted-foreground mt-2">{t('changes.historyNote')}</p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key}>
          <p className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide mb-1 ${g.cls}`}>
            <g.icon className="w-3.5 h-3.5" /> {t(g.label)} ({g.items.length})
          </p>
          <div className="space-y-0.5">
            {g.items.map((item, i) => (
              <div key={`${item.kind}-${item.id}-${item.when}-${i}`} className="flex items-baseline gap-2 text-sm">
                <span className={`min-w-0 truncate ${g.key === 'done' ? 'line-through opacity-70' : ''}`}>{item.title}</span>
                {detailOf(g, item) && <span className="text-xs text-muted-foreground shrink-0">{detailOf(g, item)}</span>}
                <span className="ml-auto flex items-baseline gap-2 shrink-0 text-[11px] text-muted-foreground">
                  {item.actor && <span className="truncate max-w-[150px] hidden sm:inline">{item.actor}</span>}
                  <span>{fmtDate(item.when, { day: 'numeric', month: 'numeric' })}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {data?.truncated && <p className="text-xs text-muted-foreground">{t('changes.truncated')}</p>}
    </div>
  );
}
