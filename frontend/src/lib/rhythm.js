// Rytmus opakovaného kroku (styl Proces, Richard 21. 10. 2026) — zrcadlo
// serverového výpočtu dalšího termínu (helpers.js: dalsiTermin / dalsiTerminRytmus).
// Rytmus = { freq: 'daily'|'weekly'|'monthly', every: 1–4, days?: [1–7], day?: 1–31 }
// (days jen u týdne, 1 = pondělí … 7 = neděle; day = den v měsíci, jen u měsíce).
// Kotvou rytmu je termín kroku: sudý/lichý týden i měsíc se počítají od něj; den
// v měsíci z `day`, jinak z termínu (/checkup 29. 10. 2026: bez `day` by se 31.
// po únoru natrvalo posunulo na 28.). Datumy jsou 'YYYY-MM-DD'
// v UTC — stejně jako na serveru, ať přechod času neposune den.

const D = (s) => new Date(`${s}T00:00:00Z`);
const S = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); };
const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
export const weekday = (s) => { const x = D(s).getUTCDay(); return x === 0 ? 7 : x; };
const monday = (s) => addDays(s, 1 - weekday(s));
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

// dnešek uživatele jako 'YYYY-MM-DD' (místní den, ne UTC)
export function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const everyOf = (r) => (Number.isInteger(r?.every) && r.every > 1 ? r.every : 1);
const dayOf = (r, anchor) => (r?.freq === 'monthly' && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31 ? r.day : D(anchor).getUTCDate());
const daysOf = (r, anchor) => (r?.freq === 'weekly' && Array.isArray(r.days) && r.days.length ? r.days : [weekday(anchor)]);

// Padá den `s` na výskyt rytmu s kotvou `anchor`?
export function isOccurrence(s, r, anchor) {
  const every = everyOf(r);
  if (r.freq === 'daily') return ((diff(anchor, s) % every) + every) % every === 0;
  if (r.freq === 'weekly') {
    if (!daysOf(r, anchor).includes(weekday(s))) return false;
    const w = diff(monday(anchor), monday(s)) / 7;
    return ((w % every) + every) % every === 0;
  }
  if (r.freq === 'monthly') {
    const d = D(s); const a = D(anchor);
    const y = d.getUTCFullYear(); const m = d.getUTCMonth();
    if (d.getUTCDate() !== Math.min(dayOf(r, anchor), daysInMonth(y, m))) return false;
    const md = (y - a.getUTCFullYear()) * 12 + (m - a.getUTCMonth());
    return ((md % every) + every) % every === 0;
  }
  return false;
}

// první výskyt v den `from` nebo později (kotva = `anchor`, bez ní `from`)
export function firstOccurrence(from, r, anchor = from) {
  let s = from;
  for (let i = 0; i < 800; i++) {
    if (isOccurrence(s, r, anchor)) return s;
    s = addDays(s, 1);
  }
  return from;
}

// Další termín po odškrtnutí: první výskyt PŘÍSNĚ po max(termín, dnes).
// Bez termínu se rytmus zakládá ode dneška.
export function nextDue(deadline, r, today = todayStr()) {
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(deadline || '') ? deadline : today;
  const base = anchor > today ? anchor : today;
  return firstOccurrence(addDays(base, 1), r, anchor);
}

// Budoucí výskyty v okně [from, to] (kalendář: „duchové" dalších opakování)
export function occurrencesBetween(deadline, r, from, to, max = 60) {
  const out = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline || '')) return out;
  let s = from > deadline ? from : addDays(deadline, 1);
  for (let i = 0; s <= to && i < 800 && out.length < max; i++) {
    if (isOccurrence(s, r, deadline)) out.push(s);
    s = addDays(s, 1);
  }
  return out;
}

// Lidský popis rytmu: „každé pondělí", „každý 2. týden: Út, Čt", „každý měsíc 15."
// `t` = překladač s namespace common (klíče rhythm.*); den v měsíci z termínu.
export function rhythmLabel(t, r, deadline) {
  if (!r) return '';
  const every = everyOf(r);
  if (r.freq === 'daily') return every === 1 ? t('common:rhythm.daily') : t('common:rhythm.dailyN', { n: every });
  if (r.freq === 'weekly') {
    const ds = Array.isArray(r.days) && r.days.length ? [...r.days].sort() : (deadline ? [weekday(deadline)] : []);
    if (every === 1 && ds.join() === '1,2,3,4,5') return t('common:rhythm.workdays');
    if (every === 1 && ds.length === 7) return t('common:rhythm.daily');
    if (every === 1 && ds.length === 1) return t(`common:rhythm.each.${ds[0]}`);
    const head = every === 1 ? t('common:rhythm.weekly') : t('common:rhythm.weeklyN', { n: every });
    return ds.length ? `${head}: ${ds.map((d) => t(`common:rhythm.dow.${d}`)).join(', ')}` : head;
  }
  if (r.freq === 'monthly') {
    const md = Number.isInteger(r.day) ? r.day : (deadline ? D(deadline).getUTCDate() : null);
    if (every === 1) return md ? t('common:rhythm.monthlyDay', { d: md }) : t('common:rhythm.monthly');
    return md ? t('common:rhythm.monthlyNDay', { n: every, d: md }) : t('common:rhythm.monthlyN', { n: every });
  }
  return '';
}

// krátké datum dne: „po 26. 10." / „Mon, 10/26" (místní zápis, den v týdnu)
export function formatDay(s, lang = 'cs') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return '';
  const loc = String(lang || '').startsWith('en') ? 'en-GB' : 'cs-CZ';
  return D(s).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
}
