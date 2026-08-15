import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { statusConfig } from '@/lib/statusMeta';
import { intlLocale } from '@/lib/locale';

// C3: měsíční kalendář termínů. Ukazuje úkoly i uzly map s termínem na jejich dni.
// items: [{ key, title, deadline: "YYYY-MM-DD", status, kind, raw }]; onOpen(item) otevře detail.
// Data lokálně (fmt níže) — toISOString() by v CEST posunul den (viz [[feedback...]]).

const fmt = (d) => {
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
};

export default function TaskCalendar({ items = [], onOpen }) {
  const { t } = useTranslation('tasks');
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const byDay = useMemo(() => {
    const map = {};
    for (const it of items) {
      if (!it.deadline) continue;
      (map[it.deadline] = map[it.deadline] || []).push(it);
    }
    return map;
  }, [items]);

  // mřížka 6 týdnů od pondělí obsahujícího 1. den měsíce
  const grid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // Po=0 … Ne=6
    const start = new Date(first);
    start.setDate(1 - offset);
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [cursor]);

  const todayKey = fmt(today);
  const monthLabel = cursor.toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' });
  const move = (delta) => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-heading font-semibold capitalize">{monthLabel}</h3>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" className="h-8" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>
            {t('calendar.todayButton')}
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(-1)} title={t('calendar.prevMonth')}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(1)} title={t('calendar.nextMonth')}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 text-xs font-medium text-muted-foreground border-b border-border">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="px-2 py-1.5 text-center">{t(`calendar.dow.${i}`)}</div>)}
      </div>

      <div className="grid grid-cols-7">
        {grid.map((d, i) => {
          const key = fmt(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const dayItems = byDay[key] || [];
          const isToday = key === todayKey;
          return (
            <div
              key={i}
              className={`min-h-[92px] border-b border-r border-border p-1 ${i % 7 === 0 ? 'border-l' : ''} ${
                inMonth ? '' : 'bg-muted/30'
              }`}
            >
              <div className={`text-xs mb-1 px-1 ${inMonth ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                <span className={isToday ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-foreground font-semibold' : ''}>
                  {d.getDate()}
                </span>
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 3).map((it) => {
                  const cfg = statusConfig[it.status] || statusConfig.todo;
                  return (
                    <button
                      key={it.key}
                      onClick={() => onOpen?.(it)}
                      title={`${it.title}${it.kind === 'node' ? t('calendar.nodeSuffix') : ''}`}
                      className={`w-full text-left truncate rounded px-1 py-0.5 text-[11px] leading-tight ${cfg.badge} ${
                        it.status === 'done' ? 'line-through opacity-70' : ''
                      } hover:ring-1 hover:ring-primary/40`}
                    >
                      {it.kind === 'node' ? '◇ ' : ''}{it.title}
                    </button>
                  );
                })}
                {dayItems.length > 3 && (
                  <div className="text-[10px] text-muted-foreground px-1">{t('calendar.more', { moreCount: dayItems.length - 3 })}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
