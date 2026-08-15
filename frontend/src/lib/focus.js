// Denní fokus: JEDEN nejdůležitější úkol na dnes a jeden na zítra (Richard
// 31. 7. 2026). NENÍ to pole priority (to bylo zamítnuto — rozhodnutí 27. 7.):
// je to osobní volba na konkrétní DEN, uložená k účtu, a vyprší sama — klíče
// jsou data (YYYY-MM-DD), čte se jen dnešek a zítřek, staré server zahazuje
// (vzor „plán do minulosti vyprší sám", žádný úklidový cron).
//
// Tvar users.focus: { "2026-07-31": { kind: 'node'|'task', id, map }, ... }
// — max 2 záznamy, obsah sanitizuje users hook (vzor notify_prefs/skin_custom).
import { base44 } from '@/api/base44Client';
import { toTarget } from '@/lib/taskActions';

export const focusDateKey = (when) => {
  const d = new Date();
  if (when === 'tomorrow') d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA');
};

const entryFor = (user, when) => {
  const f = user?.focus;
  return f && typeof f === 'object' ? f[focusDateKey(when)] || null : null;
};

// → 'today' | 'tomorrow' | null — je TENHLE řádek můj nejdůležitější?
export const focusStateOf = (user, item) => {
  const t = toTarget(item);
  if (!t || t.kind === 'idea') return null;
  for (const when of ['today', 'tomorrow']) {
    const e = entryFor(user, when);
    if (e && e.kind === t.kind && e.id === t.id && String(e.map || '') === String(t.mapId || '')) return when;
  }
  return null;
};

// Fokusovaný řádek plave na začátek své sekce (dnešní před zítřejším),
// pořadí ostatních se nemění.
export const sortFocusFirst = (items, user) => {
  if (!Array.isArray(items) || !user?.focus) return items;
  const rank = (it) => { const s = focusStateOf(user, it); return s === 'today' ? 0 : s === 'tomorrow' ? 1 : 2; };
  return [...items].sort((a, b) => rank(a) - rank(b));
};

// item = označit, null = zrušit označení pro daný den. Persistenci na účet
// dělá tady (vzor jazyka/skinů: localStorage netřeba — fokus bez účtu nedává
// smysl), volajícímu vrací PŘEDCHOZÍ stav kvůli vrácení jedním klikem.
export const setFocus = async (user, patchUser, when, item) => {
  const prev = user?.focus && typeof user.focus === 'object' ? { ...user.focus } : {};
  const clean = {};
  for (const w of ['today', 'tomorrow']) {
    const k = focusDateKey(w);
    if (prev[k]) clean[k] = prev[k];
  }
  const key = focusDateKey(when);
  if (item) {
    const t = toTarget(item);
    if (!t || t.kind === 'idea') return prev;
    clean[key] = { kind: t.kind, id: t.id, map: String(t.mapId || '') };
  } else {
    delete clean[key];
  }
  if (user?.id) await base44.entities.User.update(user.id, { focus: clean });
  patchUser?.({ focus: clean });
  return prev;
};

// vrácení omylu: obnovit celý předchozí stav fokusu
export const restoreFocus = async (user, patchUser, prev) => {
  if (user?.id) await base44.entities.User.update(user.id, { focus: prev });
  patchUser?.({ focus: prev });
};
