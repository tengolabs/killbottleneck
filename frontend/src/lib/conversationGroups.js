// Grouping of assistant conversations into Today / Yesterday / This week / Older (conversation list, 10 Nov 2026).
// A pure module without imports — unit-tested in node (tests/asistent-strana-unit.js).

export const GROUPS = ['today', 'yesterday', 'week', 'older'];

// PocketBase "2026-11-10 12:34:56.789Z" (UTC) → Date; invalid → null (lands in "Older")
const parseUpdated = (s) => {
  const d = new Date(String(s || '').replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
};

// local midnight `back` calendar days before d — by the calendar, not by 24 h steps (a DST day has 23 or 25 hours)
const midnight = (d, back = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();

export function conversationGroup(updated, now = new Date()) {
  const d = parseUpdated(updated);
  if (!d) return 'older';
  const t = d.getTime();
  if (t >= midnight(now)) return 'today';
  if (t >= midnight(now, 1)) return 'yesterday';
  if (t >= midnight(now, 6)) return 'week';
  return 'older';
}
