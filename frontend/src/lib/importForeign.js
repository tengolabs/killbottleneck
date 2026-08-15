// Import z cizích nástrojů (bod C3 rešerše konkurence): Asana (export CSV)
// a Trello (export JSON) → přenositelný formát killbottleneck.map/1, který pak
// jede běžnou serverovou routou /api/kb/map-import (validace, layout, vlastnictví).
//
// Záměrně SOUBOROVĚ, žádné API/OAuth: sedí to k self-hostu („data neopouštějí
// firmu"), funguje offline a nepřibývá závislost na cizích službách.
// Pozice uzlů se neposílají (0,0) — server si rozložení dopočítá sám
// (layoutTreeServer v /map-import, stejná cesta jako exporty bez pozic).
//
// Model: VŠE jsou uzly (viz rozhodnutí „uzel = práce; termín z něj dělá úkol") —
// sekce/listy = větve, úkoly/karty = uzly, podúkoly/checklisty = poduzly.

export const FOREIGN_MAX_NODES = 400;

// ---------- společné ----------

const nodeBase = (id, title) => ({
  id,
  type: 'goalNode',
  position: { x: 0, y: 0 },
  data: {
    title: String(title || '').trim().slice(0, 200) || '—',
    status: 'todo',
    description: '',
    collapsed: false,
    color: '',
    icon: '',
    nodeType: 'normal',
    goalType: '',
    apexText: '',
    deadline: '',
    owner: '',
    waitForChildren: false,
  },
});

const apexNode = (id, title) => {
  const n = nodeBase(id, title);
  n.type = 'apexNode';
  n.data.nodeType = 'apex';
  n.data.apexText = n.data.title;
  return n;
};

// deadline jen jako čisté datum RRRR-MM-DD (Asana Due Date, Trello due je ISO čas)
const toDate = (v) => {
  const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
};

const wrap = (title, description, nodes, edges) => ({
  format: 'killbottleneck.map/1',
  exported_at: '',
  exported_by: '',
  map: { title: String(title || '').trim().slice(0, 200) || 'Import', description: String(description || '').slice(0, 2000), nodes, edges },
  tasks: [],
});

// ---------- detekce ----------

// → 'asana-csv' | 'trello-json' | null (kb export si volající pozná sám)
export function detectForeign(fileName, text) {
  // UTF-8 BOM pryč — Excel ho při přeuložení CSV přidá vždy a regex na
  // „Task ID" na začátku řádku by jinak nechytil (checkup před v0.13.2)
  const t = String(text || '').replace(/^﻿/, '');
  if (t.trimStart().startsWith('{') || t.trimStart().startsWith('[')) {
    try {
      const obj = JSON.parse(t);
      if (obj && Array.isArray(obj.lists) && Array.isArray(obj.cards)) return 'trello-json';
    } catch (e) { /* není JSON */ }
    return null;
  }
  const firstLine = t.split(/\r?\n/, 1)[0] || '';
  if (/(^|,)"?Task ID"?(,|$)/i.test(firstLine) && /(^|,)"?Name"?(,|$)/i.test(firstLine)) return 'asana-csv';
  return null;
}

// ---------- CSV (RFC 4180: uvozovky, čárky i nové řádky uvnitř polí) ----------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = String(text || '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

// ---------- Asana CSV ----------

// Standardní export projektu z Asany (Project → Export → CSV). Hierarchie:
// Section/Column → úkoly; podúkoly přes Parent Task ID (novější exporty) nebo
// Parent task = NÁZEV rodiče (starší). Completed At ≠ prázdné → hotovo.
export function asanaToPortable(text, fallbackTitle) {
  const rows = parseCsv(String(text || '').replace(/^﻿/, ''));
  if (rows.length < 2) return { error: 'empty' };
  // strop ověřit PŘED zpracováním (žádná zbytečná práce nad obřím souborem);
  // sekce přibývají k úkolům, finální kontrola uzlů je níž
  if (rows.length - 1 > FOREIGN_MAX_NODES) return { error: 'too-big', count: rows.length - 1 };
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (...names) => {
    for (const n of names) { const i = head.indexOf(n.toLowerCase()); if (i !== -1) return i; }
    return -1;
  };
  const cName = col('name');
  const cId = col('task id');
  if (cName === -1 || cId === -1) return { error: 'columns' };
  const cSection = col('section/column', 'section');
  const cDone = col('completed at');
  const cDue = col('due date');
  const cNotes = col('notes');
  const cEmail = col('assignee email');
  const cParentId = col('parent task id');
  const cParentName = col('parent task', 'parent');
  const cProjects = col('projects');

  const get = (r, i) => (i === -1 ? '' : String(r[i] ?? '').trim());
  const items = rows.slice(1).map((r) => ({
    id: get(r, cId),
    name: get(r, cName),
    section: get(r, cSection),
    done: get(r, cDone) !== '',
    due: toDate(get(r, cDue)),
    notes: get(r, cNotes),
    email: get(r, cEmail),
    parentId: get(r, cParentId),
    parentName: get(r, cParentName),
    project: get(r, cProjects),
  })).filter((it) => it.name);

  if (!items.length) return { error: 'empty' };
  const sectionCount = new Set(items.map((it) => it.section).filter(Boolean)).size;
  if (items.length + sectionCount > FOREIGN_MAX_NODES) {
    return { error: 'too-big', count: items.length + sectionCount };
  }

  // název: sloupec Projects (skutečné jméno projektu v Asaně) > název souboru
  const title = (items.find((it) => it.project)?.project || fallbackTitle || 'Asana import').split(',')[0];
  const nodes = [apexNode('apex', title)];
  const edges = [];
  let seq = 0;
  const link = (parent, child) => edges.push({ id: `e${++seq}`, source: parent, target: child });

  // sekce v pořadí prvního výskytu
  const sectionIds = new Map();
  for (const it of items) {
    if (it.section && !sectionIds.has(it.section)) {
      const sid = `sec${sectionIds.size + 1}`;
      sectionIds.set(it.section, sid);
      nodes.push(nodeBase(sid, it.section));
      link('apex', sid);
    }
  }

  const byId = new Map();
  const byName = new Map();
  const taskNode = (it, idx) => {
    const n = nodeBase(`t${idx + 1}`, it.name);
    n.data.status = it.done ? 'done' : 'todo';
    n.data.deadline = it.due;
    n.data.description = it.notes.slice(0, 2000);
    n.data.owner = it.email;
    return n;
  };
  items.forEach((it, idx) => {
    const n = taskNode(it, idx);
    nodes.push(n);
    if (it.id) byId.set(it.id, n.id);
    if (!byName.has(it.name)) byName.set(it.name, n.id);
  });
  // hrany až po založení všech (rodič může být v souboru později než podúkol);
  // self-loop z poškozeného exportu (rodič = on sám) padá na sekci/vrchol
  items.forEach((it, idx) => {
    const nid = `t${idx + 1}`;
    const parent = (it.parentId && byId.get(it.parentId) !== nid && byId.get(it.parentId))
      || (it.parentName && byName.get(it.parentName) !== nid && byName.get(it.parentName))
      || (it.section && sectionIds.get(it.section))
      || 'apex';
    link(parent, nid);
  });

  return { portable: wrap(title, '', nodes, edges), source: 'asana', count: items.length };
}

// ---------- Trello JSON ----------

// Export boardu z Trella (Menu → Print/Export → JSON). Listy = větve, karty
// = uzly, checklisty karet = poduzly. Zavřené (archivované) listy/karty se
// přeskakují. „Hotovo": dueComplete, NEBO karta v listu pojmenovaném Done/Hotovo.
const DONE_LIST_RE = /^(done|hotovo|dokon[cč]eno|complete[d]?|finished)\b/i;

export function trelloToPortable(board, fallbackTitle) {
  if (!board || !Array.isArray(board.lists) || !Array.isArray(board.cards)) return { error: 'columns' };
  // řadit dle `pos` — export nezaručuje pořadí polí podle tabule (checkup)
  const byPos = (a, b) => (a.pos || 0) - (b.pos || 0);
  const lists = board.lists.filter((l) => l && !l.closed).sort(byPos);
  const cards = board.cards.filter((c) => c && !c.closed).sort(byPos);
  if (!cards.length && !lists.length) return { error: 'empty' };

  // checklisty jen ŽIVÝCH karet — položky archivovaných karet uzly nevyrobí
  // a nesmí ani falešně přetéct strop (checkup: 400 checkitems na archivu)
  const liveCardIds = new Set(cards.map((c) => c.id));
  const checkItemsByCard = new Map();
  for (const ch of Array.isArray(board.checklists) ? board.checklists : []) {
    if (!ch || !Array.isArray(ch.checkItems) || !liveCardIds.has(ch.idCard)) continue;
    const arr = checkItemsByCard.get(ch.idCard) || [];
    for (const ci of ch.checkItems) if (ci && ci.name) arr.push(ci);
    checkItemsByCard.set(ch.idCard, arr.sort(byPos));
  }
  const total = lists.length + cards.length
    + [...checkItemsByCard.values()].reduce((a, v) => a + v.length, 0);
  if (total > FOREIGN_MAX_NODES) return { error: 'too-big', count: total };

  const title = board.name || fallbackTitle || 'Trello import';
  const nodes = [apexNode('apex', title)];
  const edges = [];
  let seq = 0;
  const link = (parent, child) => edges.push({ id: `e${++seq}`, source: parent, target: child });

  const listNode = new Map();
  const listDone = new Map();
  lists.forEach((l, i) => {
    const id = `list${i + 1}`;
    listNode.set(l.id, id);
    listDone.set(l.id, DONE_LIST_RE.test(l.name || ''));
    nodes.push(nodeBase(id, l.name));
    link('apex', id);
  });

  let ci = 0;
  cards.forEach((c, i) => {
    const id = `card${i + 1}`;
    const n = nodeBase(id, c.name);
    n.data.status = (c.dueComplete || listDone.get(c.idList)) ? 'done' : 'todo';
    n.data.deadline = toDate(c.due);
    n.data.description = String(c.desc || '').slice(0, 2000);
    nodes.push(n);
    link(listNode.get(c.idList) || 'apex', id);
    for (const item of checkItemsByCard.get(c.id) || []) {
      const cid = `chk${++ci}`;
      const cn = nodeBase(cid, item.name);
      cn.data.status = item.state === 'complete' ? 'done' : 'todo';
      nodes.push(cn);
      link(id, cid);
    }
  });

  return { portable: wrap(title, board.desc || '', nodes, edges), source: 'trello', count: nodes.length - 1 };
}

// ---------- vstupní bod pro dialog ----------

// → { portable, source, count } | { error: 'unknown'|'empty'|'columns'|'too-big', count? }
export function foreignToPortable(fileName, text) {
  const kind = detectForeign(fileName, text);
  if (kind === 'asana-csv') return asanaToPortable(text, String(fileName || '').replace(/\.csv$/i, ''));
  if (kind === 'trello-json') {
    try {
      return trelloToPortable(JSON.parse(text), '');
    } catch (e) {
      return { error: 'unknown' };
    }
  }
  return { error: 'unknown' };
}
