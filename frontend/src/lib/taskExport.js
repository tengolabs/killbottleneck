import i18next from 'i18next';
import { statusConfig } from '@/lib/statusMeta';
import { fmtDate } from '@/lib/locale';
import { downloadText, csvEscape, dateStamp } from '@/lib/saveFile';

// Export úkolů: CSV (tabulkový) a Markdown report (podklad i pro budoucí AI souhrn).
// Texty přes i18next.t (modul mimo React) — jazyk dle aktuální volby uživatele.

const t = (key, params) => i18next.t(`common:export.${key}`, params);

// download/csvEscape/datum: sdílené jádro v lib/saveFile.js. BOM dostává CSV (Excel) i Markdown —
// tak to bylo od začátku (stará `download` ho přidávala vždy) a zůstává 1:1.

const statusLabel = (s) => statusConfig[s]?.label || s;

const nodeTitleOf = (map, nodeId) => {
  if (!nodeId) return '';
  const n = (map?.nodes || []).find((x) => x.id === nodeId);
  return n ? (n.data?.title || n.data?.apexText || '') : i18next.t('common:nodeDeleted');
};

// tasks = úkoly nejvyšší úrovně (profiltrované), byParent = podúkoly, maps = plné mapy
export function exportTasksCsv({ tasks, byParent, maps }) {
  const mapById = Object.fromEntries(maps.map((m) => [m.id, m]));
  const header = [
    t('colProject'), t('colNode'), t('colTask'), t('colParentTask'),
    t('colStatus'), t('colAssignee'), t('colDeadline'), t('colCreatedBy'),
  ];
  const rows = [header];
  const push = (tk, parentTitle) => {
    const map = mapById[tk.map_id];
    rows.push([
      map?.title || '',
      nodeTitleOf(map, tk.node_id),
      tk.title,
      parentTitle || '',
      statusLabel(tk.status),
      tk.assignee_email || '',
      tk.deadline || '',
      tk.created_by || '',
    ]);
  };
  for (const tk of tasks) {
    push(tk, '');
    for (const s of byParent[tk.id] || []) push(s, tk.title);
  }
  const csv = rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
  downloadText(`${t('csvFilename')}-${dateStamp()}.csv`, csv, 'text/csv;charset=utf-8', { bom: true });
}

// nodeTrees = { mapId: [kořeny] } — osnova projektů, tasks/byParent jako výše
export function exportMarkdownReport({ tasks, byParent, maps, nodeTrees, orgName }) {
  const mapById = Object.fromEntries(maps.map((m) => [m.id, m]));
  const today = fmtDate(new Date());
  const mark = (s) => (s === 'done' ? 'x' : ' ');
  const line = (tk, indent) =>
    `${'  '.repeat(indent)}- [${mark(tk.status)}] ${tk.title}` +
    `${tk.assignee_email ? ` — @${tk.assignee_email}` : ''}${tk.deadline ? ` (${t('deadlineNote', { date: tk.deadline })})` : ''}` +
    `${tk.status === 'in_progress' ? ` *(${t('inProgressNote')})*` : ''}`;

  let md = `# ${t('reportTitle')}${orgName ? ` — ${orgName}` : ''}\n\n*${t('generated', { date: today })}*\n`;

  const tasksByMap = {};
  for (const tk of tasks) (tasksByMap[tk.map_id || ''] = tasksByMap[tk.map_id || ''] || []).push(tk);

  const mapIds = [...new Set([...Object.keys(nodeTrees), ...Object.keys(tasksByMap).filter(Boolean)])];
  for (const mapId of mapIds) {
    const map = mapById[mapId];
    md += `\n## ${t('projectHeading', { title: map?.title || t('unknownProject') })}\n`;
    const walkNodes = (items, depth) => {
      for (const n of items) {
        md += `${'  '.repeat(depth)}- [${mark(n.status)}] **${n.title}**${n.assignee_email ? ` — @${n.assignee_email}` : ''}${n.deadline ? ` (${t('deadlineNote', { date: n.deadline })})` : ''}\n`;
        const nodeTasks = (tasksByMap[mapId] || []).filter((tk) => tk.node_id === n.node_id);
        for (const tk of nodeTasks) {
          md += line(tk, depth + 1) + '\n';
          for (const s of byParent[tk.id] || []) md += line(s, depth + 2) + '\n';
        }
        walkNodes(n.children || [], depth + 1);
      }
    };
    walkNodes(nodeTrees[mapId] || [], 0);
    const loose = (tasksByMap[mapId] || []).filter((tk) => !tk.node_id);
    if (loose.length) {
      md += `\n${t('tasksWithoutNode')}\n`;
      for (const tk of loose) {
        md += line(tk, 0) + '\n';
        for (const s of byParent[tk.id] || []) md += line(s, 1) + '\n';
      }
    }
  }

  const noMap = tasksByMap[''] || [];
  if (noMap.length) {
    md += `\n## ${t('looseTasks')}\n`;
    for (const tk of noMap) {
      md += line(tk, 0) + '\n';
      for (const s of byParent[tk.id] || []) md += line(s, 1) + '\n';
    }
  }

  // skluzy na závěr
  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const all = [];
  for (const tk of tasks) { all.push(tk); for (const s of byParent[tk.id] || []) all.push(s); }
  const overdue = all.filter((tk) => tk.deadline && tk.status !== 'done' && new Date(tk.deadline + 'T00:00:00') < today0);
  if (overdue.length) {
    md += `\n## ${t('overdueHeading', { count: overdue.length })}\n`;
    for (const tk of overdue) md += line(tk, 0) + '\n';
  }

  downloadText(`${t('reportFilename')}-${dateStamp()}.md`, md, 'text/markdown;charset=utf-8', { bom: true });
}
