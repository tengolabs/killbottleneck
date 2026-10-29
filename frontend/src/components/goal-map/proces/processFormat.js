import { parsePbDate } from '@/lib/locale';
import { todayStr, addDays, formatDay } from '@/lib/rhythm';
import i18next from 'i18next';

// Kdy krok naposledy prošel — razítko ze záznamníku (UTC) v MÍSTNÍM čase:
// „dnes 9:12", „včera 15:40", „po 19. 10. 8:12". Texty přes globální
// i18next (common:rhythm.*) — volající může mít překladač s keyPrefix.
export function fmtRun(stamp, _t) {
  const t = i18next.t.bind(i18next);
  if (!stamp) return '—';
  const d = parsePbDate(stamp);
  if (!d || Number.isNaN(d.getTime())) return '—';
  const den = todayStr(d);
  const cas = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dnes = todayStr();
  if (den === dnes) return `${t('common:rhythm.today')} ${cas}`;
  if (den === addDays(dnes, -1)) return `${t('common:rhythm.yesterday')} ${cas}`;
  return `${formatDay(den, i18next.language)} ${cas}`;
}

// počet dní po termínu (kladné číslo) nebo 0
export function daysLate(deadline, today = todayStr()) {
  if (!deadline || deadline >= today) return 0;
  return Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${deadline}T00:00:00Z`)) / 864e5);
}
