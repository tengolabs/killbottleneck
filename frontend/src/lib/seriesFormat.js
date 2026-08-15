// Číslované řady projektů ze šablon — frontendové zrcadlo serverového
// formatSeriesTitle (pb_hooks/helpers.js) pro náhledy. Autoritativní název
// skládá VŽDY server; tohle je jen ukázka „jak se to bude jmenovat".
// UI pracuje s prostým „názvem řady" — formát s {n} je interní uložení.
// Tokeny {n}/{rok}/{nazev} jsou uložený formát v DB — NIKDY nepřekládat.
import i18next from 'i18next';

export function formatSeriesTitle(fmt, n, baseTitle) {
  let hasN = false;
  let out = String(fmt).replace(/\{(n(?::([2-4]))?|rok|nazev)\}/g, (m, tok, pad) => {
    if (tok === 'rok') return String(new Date().getFullYear());
    if (tok === 'nazev') return baseTitle;
    hasN = true;
    return pad ? String(n).padStart(Number(pad), '0') : String(n);
  }).trim();
  if (!hasN) out = (out ? out + ' ' : '') + n;
  return out;
}

// „Nabídka {n}" → „Nabídka"; složitější/rozbité formáty → tokeny pryč, zbytek jako název
export function seriesNameFromFormat(fmt) {
  if (!fmt) return '';
  const m = String(fmt).match(/^(.*?)\s*\{n(?::[2-4])?\}\s*$/);
  if (m) return m[1].trim();
  return String(fmt).replace(/\{(n(?::[2-4])?|rok|nazev)\}/g, '').replace(/\s+/g, ' ').trim();
}

// název řady → uložený formát
export function seriesNameToFormat(name) {
  const clean = String(name || '').trim();
  return clean ? `${clean} {n}` : '';
}

// náhled dalšího názvu v řadě pro šablonu (karta/hint); nový rok = řada od 1
export function nextSeriesTitle(tpl) {
  const year = new Date().getFullYear();
  const n = (tpl?.number_year || 0) === year ? Math.max(tpl?.next_number || 0, 1) : 1;
  return formatSeriesTitle(tpl?.number_format || '', n, tpl?.title || '');
}

// popisek automatického zakládání šablony („každé pondělí" / „1. den v měsíci")
export function autoCreateLabel(tpl) {
  if (tpl?.auto_create === 'weekly') {
    const day = tpl.auto_day >= 1 && tpl.auto_day <= 7 ? tpl.auto_day : 1;
    return i18next.t('common:autoCreate.weekly', { weekday: i18next.t(`common:weekdayAcc.${day}`) });
  }
  if (tpl?.auto_create === 'monthly') {
    return tpl.auto_day >= 29
      ? i18next.t('common:autoCreate.monthlyLast')
      : i18next.t('common:autoCreate.monthlyDay', { day: tpl.auto_day || 1 });
  }
  return '';
}
