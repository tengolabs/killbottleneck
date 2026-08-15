// Formátování data/času a řazení dle aktivního jazyka UI — jediné místo s locale.
// EN záměrně en-GB (24h čas, den před měsícem) — pro evropské nasazení přirozenější než en-US.
import i18next from 'i18next';
// ⚠️ ŽÁDNÝ import date-fns: tenhle modul tahá eager TimerContext, takže by
// date-fns (~55 kB min) přitekl do vstupního chunku i pro lite režim.
// dateFnsLocale žije v DatePicker.jsx (jediný konzument, lazy chunk).

// PocketBase vrací datum jako „2026-07-25 10:00:00.000Z" — s MEZEROU místo `T`.
// To není platný ISO 8601 a enginy, které si to samy nedoplní (Safari, starší
// WebKity na mobilu), vrátí Invalid Date → v UI „NaN min" nebo prázdno.
// JEDINÉ místo, kde se PB datum převádí na Date; nikdy nevolat new Date(pbHodnota) přímo.
export const parsePbDate = (d) => (d instanceof Date ? d : new Date(String(d ?? '').replace(' ', 'T')));

// Krátké datum pro karty/tabulky. CZ zůstává „23.07.2026" (schválený stav v0.5),
// EN čitelné „23 Jul 2026" místo dřívějšího hardcoded dd.MM.yyyy (i18n oprava).
// Ručně místo date-fns (bundle) — vlastní tabulka měsíců, protože Intl en-GB
// píše „Sept" (4 znaky), zatímco schválený formát má „Sep" jako date-fns.
// Parita s date-fns ověřena mutačně na 4000 hodnotách (obě locale, oba formáty).
const pad2 = (n) => String(n).padStart(2, '0');
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDateShort = (d) => {
  const x = parsePbDate(d);
  return i18next.language === 'cs'
    ? `${pad2(x.getDate())}.${pad2(x.getMonth() + 1)}.${x.getFullYear()}`
    : `${x.getDate()} ${EN_MONTHS[x.getMonth()]} ${x.getFullYear()}`;
};

export const fmtDateTimeShort = (d) => {
  const x = parsePbDate(d);
  return `${fmtDateShort(x)} ${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
};

export const intlLocale = () => (i18next.language === 'cs' ? 'cs-CZ' : 'en-GB');

export const fmtDate = (d, opts) => parsePbDate(d).toLocaleDateString(intlLocale(), opts);

export const fmtTime = (d, opts) => parsePbDate(d).toLocaleTimeString(intlLocale(), opts);

export const fmtDateTime = (d, opts) => parsePbDate(d).toLocaleString(intlLocale(), opts);

export const compareLocale = (a, b) =>
  String(a ?? '').localeCompare(String(b ?? ''), i18next.language === 'cs' ? 'cs' : 'en');
