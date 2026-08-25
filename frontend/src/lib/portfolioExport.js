import i18next from 'i18next';
import { fmtDate, parsePbDate } from '@/lib/locale';
import { saveBlob } from '@/lib/saveFile';
import { statusConfig } from '@/lib/statusMeta';
import { formatDeadline } from '@/lib/nodeMeta';

// Report z přehledu Organizace: Markdown (pondělní report) a CSV.
// ⚠️ Skládá se z TÉHOŽ JSON, který kreslí stránku (/api/kb/portfolio) —
// stejná čísla, stejné pořadí, žádný druhý výpočet (P3-03, rozhodnutí 25. 8. 2026).
// Texty přes i18next.t (modul mimo React), jména lidí dodává volající
// (`nameOf`), protože adresář členů má stránka, ne tenhle modul.

const t = (key, params) => i18next.t(`organizace:organizace.${key}`, params);
const days = (n) => t('days', { count: n });

// BOM jen do CSV (kvůli Excelu); Markdown ho nepotřebuje
function download(filename, content, mime, bom) {
  const blob = new Blob([(bom ? '﻿' : '') + content], { type: mime });
  saveBlob(blob, filename);
}

// Společné popisky pro stránku i export — jedna definice, stejná slova.
export const accessLabel = (p) => (p.access === 'team' ? t(p.team_access === 'edit' ? 'teamEdit' : 'teamRead') : t('shared'));
// „dnes" podle MÍSTNÍHO dne (razítka jsou v UTC — změna v 00:30 SELČ je pořád dnes)
const localDay = (d) => { const x = parsePbDate(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const whenLabel = (when, today) => (localDay(when) === today ? t('today') : fmtDate(when, { day: 'numeric', month: 'numeric' }));
// Kdo změnu udělal: prázdný autor = automatizace / pravidlo / agent, ne „bez řešitele"
export const actorLabel = (actor, nameOf) => (actor ? nameOf(actor) : t('system'));
// Hodnota změny lidsky: stav popiskem, řešitel jménem (nikdy surový pseudo-e-mail
// externího kontaktu), termín datem; ostatní beze změny
export const changeValue = (ch, v, nameOf) => {
  if (!v) return '—';
  if (ch.field === 'status') return statusConfig[v]?.label || v;
  // řešitel: jméno externího kontaktu dodá server (from_label/to_label), člena adresář
  if (ch.field === 'owner') return nameOf(v, { owner_label: v === ch.from ? ch.from_label : ch.to_label });
  if (ch.field === 'deadline') return formatDeadline(v);
  return v;
};
const MAX_EXCLUDED = 5;
export const excludedLabel = (excluded) => {
  const list = excluded || [];
  if (!list.length) return '';
  const head = list.slice(0, MAX_EXCLUDED).map((e) => `${e.title} (${t('privateWhy')})`).join(', ');
  return t('footerExcluded', { list: head + (list.length > MAX_EXCLUDED ? ' ' + t('excludedMore', { count: list.length - MAX_EXCLUDED }) : '') });
};

const csvEscape = (v) => {
  let s = String(v ?? '');
  // formula injection — cizí názvy cílů mohou začínat `=`; Excel by je vyhodnotil
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const fieldLabel = (f) => t(`changeField.${f}`);
// Markdown: názvy a jména jsou cizí text — svislítko by rozbilo tabulku, zalomení řádek
const md = (v) => String(v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

export function exportPortfolioMarkdown({ data, nameOf, orgName }) {
  const s = data.sections;
  const who = (email, row) => (email ? `@${nameOf(email, row)}` : t('unassigned'));
  let md = `# ${t('export.title')}${orgName ? ` — ${orgName}` : ''}\n\n*${t('export.generated', { date: fmtDate(`${data.today}T00:00:00`) })}*\n\n`;
  md += `${t('projects', { count: data.counts.projects })} (${t('team', { count: data.scope.team })}, ${t('shared', { count: data.scope.shared })}). ${t('privateNote')}\n`;

  md += `\n## ${t('sections.overdue')} (${data.counts.overdue})\n`;
  if (!s.overdue.length) md += `${t('emptyOverdue')}\n`;
  for (const o of s.overdue) md += `- ${md(o.title)} — ${md(who(o.owner, o))} (${md(o.mapTitle)}) — ${t('cols.deadline').toLowerCase()} ${o.deadline}, **${days(o.daysOver)}**\n`;

  md += `\n## ${t('sections.projects')}\n`;
  for (const p of s.projects) {
    md += `- **${md(p.title)}** [${accessLabel(p)}] ${p.pct} % (${t('projMeta', { done: p.done, total: p.total })}) · ${t('projOverdue', { count: p.overdue })} · ${t('projStuck', { count: p.stuck })} · ${t('projOpen', { count: p.open })}\n`;
  }

  md += `\n## ${t('sections.stuck')} (${data.counts.stuck})\n`;
  if (!s.stuck.length) md += `${t('emptyStuck')}\n`;
  for (const o of s.stuck) md += `- ${md(o.title)} — ${md(who(o.owner, o))} (${md(o.mapTitle)}) — ${o.deadline ? `${t('cols.deadline').toLowerCase()} ${o.deadline}` : t('noDeadline')}, **${t('idle', { days: days(o.daysIdle) })}**\n`;

  md += `\n## ${t('sections.people')}\n\n| ${t('cols.who')} | ${t('cols.overdue')} | ${t('cols.stuck')} | ${t('cols.open')} | ${t('cols.projects')} |\n|---|---:|---:|---:|---:|\n`;
  for (const p of s.people) md += `| ${md(p.email ? nameOf(p.email, { owner_label: p.owner_label }) : t('unassigned'))} | ${p.overdue}${p.worst ? ` (${t('worst', { days: days(p.worst) })})` : ''} | ${p.stuck} | ${p.open} | ${p.maps} |\n`;

  md += `\n## ${t('sections.changes')} (${data.counts.changes})\n`;
  if (!s.changes.length) md += `${t('emptyChanges')}\n`;
  for (const c of s.changes) md += `- ${whenLabel(c.when, data.today)} · ${md(c.title)} (${md(c.mapTitle)}) · ${fieldLabel(c.field)}: ${md(changeValue(c, c.from, nameOf))} → ${md(changeValue(c, c.to, nameOf))} · ${md(actorLabel(c.actor, nameOf))}\n`;

  md += `\n---\n${t('footer', { team: data.scope.team, shared: data.scope.shared })}`;
  if (data.scope.excluded?.length) md += ` ${excludedLabel(data.scope.excluded)}`;
  md += '\n';
  download(`${t('export.filename')}-${data.today}.md`, md, 'text/markdown;charset=utf-8', false);
}

export function exportPortfolioCsv({ data, nameOf }) {
  const s = data.sections;
  const who = (email, row) => (email ? nameOf(email, row) : t('unassigned'));
  const rows = [];
  rows.push([t('export.colSection'), t('cols.what'), t('cols.project'), t('cols.who'), t('cols.deadline'), t('cols.overdue'), t('cols.idle')]);
  for (const o of s.overdue) rows.push([t('sections.overdue'), o.title, o.mapTitle, who(o.owner, o), o.deadline, o.daysOver, '']);
  for (const o of s.stuck) rows.push([t('sections.stuck'), o.title, o.mapTitle, who(o.owner, o), o.deadline, '', o.daysIdle]);
  rows.push([]);
  rows.push([t('export.colSection'), t('cols.project'), t('export.colAccess'), t('export.colPct'), t('export.colDone'), t('cols.overdue'), t('cols.stuck'), t('cols.open')]);
  for (const p of s.projects) rows.push([t('sections.projects'), p.title, accessLabel(p), p.pct, `${p.done}/${p.total}`, p.overdue, p.stuck, p.open]);
  rows.push([]);
  rows.push([t('export.colSection'), t('cols.who'), t('cols.overdue'), t('cols.stuck'), t('cols.open'), t('cols.projects')]);
  for (const p of s.people) rows.push([t('sections.people'), who(p.email, { owner_label: p.owner_label }), p.overdue, p.stuck, p.open, p.maps]);
  rows.push([]);
  rows.push([t('export.colSection'), t('cols.when'), t('cols.what'), t('cols.project'), t('cols.change'), t('cols.who')]);
  for (const c of s.changes) rows.push([t('sections.changes'), String(c.when).slice(0, 10), c.title, c.mapTitle, `${fieldLabel(c.field)}: ${changeValue(c, c.from, nameOf)} → ${changeValue(c, c.to, nameOf)}`, actorLabel(c.actor, nameOf)]);
  const csv = rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
  download(`${t('export.filename')}-${data.today}.csv`, csv, 'text/csv;charset=utf-8', true);
}
