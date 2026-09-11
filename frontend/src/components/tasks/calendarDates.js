// Calendar dates are local civil days, not UTC timestamps. Keep calculations at
// noon and use setDate/setMonth so a daylight-saving change cannot skip a day.
const atNoon = (date) => {
  // Neplatný vstup (parseDateKey vrací null) → dnešek, ne pád.
  const src = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const copy = new Date(src.getTime());
  copy.setHours(12, 0, 0, 0);
  return copy;
};

export function dateKey(date) {
  const pad = (number) => String(number).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(2000, 0, 1, 12);
  date.setFullYear(year, month - 1, day);
  return dateKey(date) === key ? date : null;
}

export function addDays(date, delta) {
  const next = atNoon(date);
  next.setDate(next.getDate() + delta);
  return next;
}

export function weekDays(date) {
  const base = atNoon(date);
  const monday = addDays(base, -((base.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function monthDays(date) {
  const first = atNoon(date);
  first.setDate(1);
  const monday = addDays(first, -((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => addDays(monday, index));
}

export function movePeriod(date, view, delta) {
  if (view === 'day') return addDays(date, delta);
  if (view === 'week') return addDays(date, delta * 7);
  // Month and agenda both navigate one calendar month. Clamp to its last day
  // so advancing from January 31 cannot accidentally land in March.
  const next = atNoon(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + delta);
  const last = atNoon(next);
  last.setMonth(last.getMonth() + 1, 0);
  next.setDate(Math.min(day, last.getDate()));
  return next;
}
