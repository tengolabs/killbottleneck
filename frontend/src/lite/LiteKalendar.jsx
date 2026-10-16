import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Plane, DoorOpen, Building2, CalendarClock, ExternalLink } from 'lucide-react';
import { listUdalosti, listKdoJePryc, sledujKolekci } from '@/api/udalosti';
import { saveMode, MODE_FULL } from '@/lib/liteMode';
import { klicDne, posunDny } from '@/lib/kalendar';
import { fmtDate } from '@/lib/locale';

// Zjednodušený KALENDÁŘ (lite, týmový kalendář 14. 10. 2026): agenda na 7 dní — vlastní
// události, firemní akce a rezervace ze sdílených kalendářů, a kdo je který den pryč.
// Jen čtení (zápis dělá celá aplikace nebo asistent); klepnutí otevře detail v celé aplikaci.
// ⚠️ Lite dieta (tests/lite-bundle.js): žádný Radix, dnd-kit ani TaskCalendar — prostý seznam.
const DNU = 7;
const IKONA = { shared: Building2, resource: DoorOpen, absence: Plane };

export default function LiteKalendar() {
  const { t } = useTranslation('lite');
  const navigate = useNavigate();
  const [udalosti, setUdalosti] = useState([]);
  const [pryc, setPryc] = useState([]);
  const [failed, setFailed] = useState(false);
  const dnes = klicDne(new Date());
  const konec = posunDny(dnes, DNU - 1);

  const nacti = useCallback(async () => {
    try {
      const [u, p] = await Promise.all([listUdalosti(dnes, konec), listKdoJePryc(dnes, konec)]);
      setUdalosti((u?.events || []).filter((ev) => ev.kind !== 'absence'));
      setPryc(p?.away || []);
      setFailed(false);
    } catch { setFailed(true); }
  }, [dnes, konec]);
  useEffect(() => {
    nacti();
    const od = sledujKolekci('events', nacti);
    window.addEventListener('kb-native-resume', nacti);
    return () => { od(); window.removeEventListener('kb-native-resume', nacti); };
  }, [nacti]);

  const dny = [];
  for (let i = 0, d = dnes; i < DNU; i++, d = posunDny(d, 1)) dny.push(d);
  const vDen = (ev, d) => ev.day <= d && (ev.end_day || ev.day) >= d;
  const otevri = (ev) => { saveMode(MODE_FULL); navigate(`/kalendar?udalost=${encodeURIComponent(ev.id)}`); };
  const nadpisDne = (d, i) => (i === 0 ? t('calendar.today') : i === 1 ? t('calendar.tomorrow') : fmtDate(d));

  return (
    <div className="max-w-xl mx-auto pb-4" data-testid="lite-kalendar">
      <h1 className="px-4 pt-2 pb-3 text-lg font-semibold flex items-center gap-2">
        <CalendarDays className="w-5 h-5 text-primary" /> {t('calendar.title')}
      </h1>
      {failed && <p className="px-4 text-sm text-destructive">{t('loadFailed')}</p>}
      {dny.map((d, i) => {
        const items = udalosti.filter((ev) => vDen(ev, d));
        const kdo = pryc.filter((a) => a.from <= d && a.to >= d).map((a) => a.email);
        if (!items.length && !kdo.length) return null;
        return (
          <section key={d} className="mb-4" data-testid={`lite-kal-den-${d}`}>
            <p className="px-4 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{nadpisDne(d, i)}</p>
            <div className="bg-card border-y">
              {kdo.length > 0 && (
                <p className="flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground border-b" data-testid={`lite-kal-pryc-${d}`}>
                  <Plane className="w-3.5 h-3.5 shrink-0" /> <span><span className="font-semibold">{t('today.away')}:</span> {Array.from(new Set(kdo)).join(', ')}</span>
                </p>
              )}
              {items.map((ev) => {
                const I = IKONA[ev.kind] || CalendarClock;
                const cas = ev.day === d && ev.time ? `${ev.time}${ev.end_time && !ev.end_day ? '–' + ev.end_time : ''}` : t('today.allDay');
                return (
                  <button key={ev.id} type="button" onClick={() => otevri(ev)} className="w-full flex items-center gap-3 px-4 py-2 text-sm text-left border-b last:border-b-0 active:bg-secondary" data-testid={`lite-kal-udalost-${ev.id}`}>
                    <span className="w-16 shrink-0 tabular-nums text-xs font-semibold text-sky-700 dark:text-sky-300">{cas}</span>
                    <I className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{ev.title}</span>
                    {ev.calendar_name && <span className="ml-auto text-[10px] rounded px-1 bg-secondary text-muted-foreground truncate max-w-[7rem]">{ev.calendar_name}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!failed && !udalosti.length && !pryc.length && (
        <p className="px-4 text-sm text-muted-foreground">{t('calendar.empty')}</p>
      )}
      <p className="px-4 pt-2 text-xs text-muted-foreground flex items-center gap-1">
        <ExternalLink className="w-3 h-3" /> {t('calendar.hint')}
      </p>
    </div>
  );
}
