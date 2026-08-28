// „Moje mapa" a „Zadal jsem": čisté buildery osobního přehledu (read-only agregát
// mých uzlů a úkolů napříč projekty). Vytaženo z pages/GoalMapEditor.jsx (nález
// F1-07 analýzy kódu) beze změny chování — editor je jen importuje. Relativní
// importy, aby soubor šel načíst i z node unit testu (product/tests/personal-map.js).
import { layoutTree } from './treeLayout.js';
import { findBlockingForOwner } from './waitStatus.js';
import { labelForEmail } from './memberLabel.js';
import { isExternalOwner } from './externalContacts.js';
import { ALIGN_OPTS, platnyStyl } from './alignStyles.js';
import { nactiKlic } from './storageKeys.js';

// těsnější rozestupy pro „Moje mapu" (plochá struktura pod „Já" → jinak velké mezery).
// Slot musí být ≥ velikost uzlu (uzly s popisem jsou vysoké) — jinak se překrývají:
// vodorovně stackují sourozence na Y (slot = výška), svisle vedle sebe na X (slot = šířka).
// Krok mezi úrovněmi musí být ≥ rozměr uzlu v ose úrovní: vodorovně = ŠÍŘKA uzlu
// (jinak se řady 2/3 překrývají do strany), svisle = VÝŠKA. Slot = rozestup sourozenců.

// Styl zvolený v „Moje mapě". Bez tohohle si popisek styl pamatoval, ale mapa
// se pokaždé stavěla klasicky — tlačítko tedy hlásilo něco, co na plátně
// nebylo (panel /checkup 12. 8.; táž vada, jakou vlna opravovala pro běžné mapy).
export const optsMojiMapy = () => ALIGN_OPTS[platnyStyl(nactiKlic('kb-zarovnat-styl:moje-mapa'))] || {};

// ⚠️ VODOROVNÝ `slot` MUSÍ BÝT VĚTŠÍ NEŽ VÝŠKA KARTY — je to příčná osa, na
// které se sourozenci řadí pod sebe, takže při rovnosti se karty dotknou.
// Kompaktní karta „Mojí mapy" má naměřeno 108 / 116 / 120 px podle stupně
// Čitelnosti (product/tests/vysky-karet.js), takže ve stupni „jen název"
// sedí PŘESNĚ na starém slotu 120 — a na telefonu se dva uzly reálně
// překrývaly (změřeno 13. 8. 2026). Slot proto v tomhle stupni povyroste.
// Pozice „Mojí mapy" se NIKAM NEUKLÁDAJÍ (je to read-only agregát počítaný
// při každém vykreslení), takže se tím nic v datech nemění.
export const PERSONAL_LAYOUT = (direction, citelnost) => direction === 'horizontal'
  ? { slot: citelnost === 'titleOnly' ? 136 : 120, step: 300, apexStep: 200 } // kruh 120 + mezera 80
  // apexStep i svisle: kořen „Já" je kruh 120 (ne apex 260) — bez toho by
  // default 380 zdvojnásobil mezeru pod kořenem (checkup před v0.13.2)
  : { slot: 245, step: 210, apexStep: 210 };

// „Moje mapa": read-only agregace mých uzlů napříč projekty (jen odkazy, ne kopie).
// Kořen „Já"; hierarchie se drží JEN mezi mými uzly (cizí mezičlánky se vynechají);
// + moje úkoly s termínem jako listy. Vrací i `targets` (vid→zdroj).
export function buildPersonalMap(maps, tasks, email, rootLabel) {
  const targets = {};
  if (!email) return { nodes: [], edges: [], targets };
  // archivované projekty do osobního přehledu nepatří (uzly ani jejich úkoly) —
  // stejně jako panel Můj den a serverový digest
  const archivedIds = new Set(maps.filter((m) => m.archived).map((m) => m.id));
  const shown = new Set();
  // sběr položek (uzel + hrana + termín); pushneme až SEŘAZENÉ dle termínu, aby
  // sourozenci šli zleva od nejbližšího termínu (bez termínu na konec)
  const items = [];
  // Struktura kopíruje PROJEKTY (Richard 11. 8.: „moje mapa má řešit více
  // projektů… proč nevypadá stejně a jde do šířky?" — 18 položek jednoho
  // projektu viselo vedle sebe přímo pod kořenem). Pod kořenem je uzel za
  // každý projekt (klik → mapa) a POD ním moje uzly zavěšené přes SKUTEČNÉ
  // mezičlánky projektu — i cizí/nepřiřazené (jen kontext, klik vede do mapy).
  const projItems = {};
  const apexOf = (m) => ((m.nodes || []).find((n) => String(n.type || '').startsWith('apex')) || {}).id || '';
  const ensureProject = (m) => {
    if (projItems[m.id]) return projItems[m.id];
    const vid = `proj::${m.id}`;
    targets[vid] = { type: 'node', mapId: m.id, nodeId: apexOf(m) };
    const it = {
      deadline: '',
      node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: {
        nodeType: 'normal', collapsed: false, title: m.title || '—', status: 'todo',
        deadline: '', owner: '', color: m.color || '#64748b', description: '' } },
      edge: { id: `pe-${vid}`, source: 'me', target: vid, type: 'deletable' },
    };
    projItems[m.id] = it;
    items.push(it);
    return it;
  };
  const mapById = {};
  for (const m of maps) mapById[m.id] = m;
  for (const m of maps) {
    if (m.archived) continue;
    const mine = new Set();
    const byId = {};
    for (const n of (m.nodes || [])) {
      byId[n.id] = n;
      const d = n.data || {};
      if (n.type !== 'note' && d.owner === email && d.status !== 'done') mine.add(n.id);
    }
    if (!mine.size) continue;
    ensureProject(m);
    const apex = apexOf(m);
    const blocking = findBlockingForOwner(m.nodes || [], m.edges || [], email); // moje uzly, co blokují cizí
    const parentOf = {};
    for (const e of (m.edges || [])) parentOf[e.target] = e.source;
    // mezičlánky: celý řetěz předků mých uzlů až k vrcholu (vrchol zastupuje
    // uzel projektu) — díky tomu má větev projektu STEJNÝ tvar jako mapa
    const context = new Set();
    for (const nid of mine) {
      let p = parentOf[nid]; const seen = new Set();
      while (p && p !== apex && !seen.has(p)) {
        if (!mine.has(p) && byId[p] && byId[p].type !== 'note') context.add(p);
        seen.add(p); p = parentOf[p];
      }
    }
    for (const nid of mine) shown.add(`${m.id}::${nid}`);
    const included = (id) => mine.has(id) || context.has(id);
    const sourceFor = (nid) => {
      const p = parentOf[nid];
      if (!p || p === apex || !included(p)) return `proj::${m.id}`;
      return `${m.id}::${p}`;
    };
    for (const nid of [...mine, ...context]) {
      const d = byId[nid].data || {};
      const vid = `${m.id}::${nid}`;
      targets[vid] = { type: 'node', mapId: m.id, nodeId: nid };
      items.push({
        deadline: d.deadline || '',
        // popis vynecháme → uzly mají jednotnou výšku a rozestup jde rovnoměrně těsný
        node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { ...d, nodeType: 'normal', collapsed: false, description: '', title: d.title || d.apexText || '—', blocks: mine.has(nid) ? (blocking[nid] || '') : '' } },
        edge: { id: `pe-${vid}`, source: sourceFor(nid), target: vid, type: 'deletable' },
      });
    }
  }
  for (const tk of tasks) {
    if (tk.parent_id || tk.status === 'done') continue;
    if (tk.map_id && archivedIds.has(tk.map_id)) continue;
    const mineTask = tk.assignee_email === email || (tk.created_by === email && !tk.assignee_email);
    if (!mineTask) continue;
    // úkol vždy patří do projektu — jako list se ukazuje jen s termínem
    // (klik vede na uzel/mapu projektu); legacy úkol bez mapy = fallback na dialog
    if (tk.map_id && !tk.deadline) continue;
    if (tk.map_id && tk.node_id && shown.has(`${tk.map_id}::${tk.node_id}`)) continue;
    const vid = `task::${tk.id}`;
    targets[vid] = tk.map_id ? { type: 'node', mapId: tk.map_id, nodeId: tk.node_id } : { type: 'task', taskId: tk.id };
    // úkol s projektem visí pod SVÝM projektem; bez mapy (legacy) pod kořenem
    const proj = tk.map_id && mapById[tk.map_id] && !mapById[tk.map_id].archived ? ensureProject(mapById[tk.map_id]) : null;
    items.push({
      deadline: tk.deadline || '',
      node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { nodeType: 'normal', collapsed: false, title: tk.title, status: tk.status, deadline: tk.deadline || '', owner: '', color: '' } },
      edge: { id: `pe-${vid}`, source: proj ? proj.node.id : 'me', target: vid, type: 'deletable' },
    });
  }
  // řazení dle NEJBLIŽŠÍHO termínu v celém PODSTROMU — větev se posune podle
  // nejdřívějšího potomka (uzel bez termínu, ale s brzkým potomkem, jde dopředu)
  const childrenOf = {};
  const deadlineOf = {};
  for (const it of items) {
    deadlineOf[it.node.id] = it.deadline || '9999-99-99';
    (childrenOf[it.edge.source] = childrenOf[it.edge.source] || []).push(it.node.id);
  }
  const subMinCache = {};
  const subMin = (vid) => {
    if (subMinCache[vid] !== undefined) return subMinCache[vid];
    subMinCache[vid] = '…'; // ochrana proti cyklu
    let m = deadlineOf[vid] || '9999-99-99';
    for (const c of (childrenOf[vid] || [])) { const cm = subMin(c); if (cm < m) m = cm; }
    subMinCache[vid] = m;
    return m;
  };
  items.sort((a, b) => subMin(a.node.id).localeCompare(subMin(b.node.id)));
  const nodes = [{ id: 'me', type: 'personalRoot', position: { x: 0, y: 0 }, data: { title: rootLabel } }];
  const edges = [];
  items.forEach((it, i) => {
    it.node.position = { x: i, y: 0 }; // pořadí dle termínu (crossOf) pro layoutTree
    nodes.push(it.node);
    edges.push(it.edge);
  });
  const pos = layoutTree(nodes, edges, 'vertical', { ...PERSONAL_LAYOUT('vertical'), ...optsMojiMapy() });
  for (const n of nodes) { const p = pos[n.id]; if (p) n.position = { x: p.x, y: p.y }; }
  return { nodes, edges, targets };
}

// „Zadal jsem" — druhá záložka Mojí mapy: položky, které jsem zadal JINÝM.
// Uzly s owner≠já v MÝCH mapách + úkoly, které jsem zadal (created_by=já,
// řešitel≠já); dedup jako panel Můj den (úkol na uzlu téhož řešitele počítá
// uzel). grouping: 'flat' (dle termínu) | 'people' (dle lidí) | 'projects'.
export function buildDelegatedMap(maps, tasks, email, rootLabel, grouping, members = []) {
  const targets = {};
  if (!email) return { nodes: [], edges: [], targets };
  const items = []; // { deadline, assignee, project, node }
  const nodeByKey = {};
  const mapById = {};
  for (const m of maps) {
    mapById[m.id] = m;
    if (m.archived) continue;
    const iOwn = m.created_by === email;
    for (const n of (m.nodes || [])) {
      if (n.type === 'note') continue;
      const d = n.data || {};
      nodeByKey[`${m.id}:${n.id}`] = { owner: d.owner || '', mapOwner: m.created_by };
      if (!iOwn || !d.owner || d.owner === email || d.status === 'done') continue;
      const vid = `${m.id}::${n.id}`;
      targets[vid] = { type: 'node', mapId: m.id, nodeId: n.id };
      items.push({
        deadline: d.deadline || '', assignee: d.owner, project: m.title || '—', projectId: m.id,
        node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { ...d, nodeType: 'normal', collapsed: false, description: '', title: d.title || d.apexText || '—' } },
      });
    }
  }
  for (const tk of tasks) {
    if (tk.parent_id || tk.status === 'done') continue;
    if (tk.map_id && mapById[tk.map_id]?.archived) continue; // archiv do přehledu nepatří
    if (tk.created_by !== email || !tk.assignee_email || tk.assignee_email === email) continue;
    const node = tk.map_id && tk.node_id ? nodeByKey[`${tk.map_id}:${tk.node_id}`] : null;
    if (node && node.mapOwner === email && node.owner === tk.assignee_email) continue; // fold do uzlu
    const vid = `task::${tk.id}`;
    targets[vid] = tk.node_id ? { type: 'node', mapId: tk.map_id, nodeId: tk.node_id } : { type: 'task', taskId: tk.id };
    items.push({
      deadline: tk.deadline || '', assignee: tk.assignee_email, project: mapById[tk.map_id]?.title || '—', projectId: tk.map_id || '',
      node: { id: vid, type: 'goalNode', position: { x: 0, y: 0 }, data: { nodeType: 'normal', collapsed: false, title: tk.title, status: tk.status, deadline: tk.deadline || '', owner: tk.assignee_email, color: '' } },
    });
  }
  const nodes = [{ id: 'me', type: 'personalRoot', position: { x: 0, y: 0 }, data: { title: rootLabel } }];
  const edges = [];
  const byDeadline = (a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999');
  let order = 0;
  if (grouping === 'flat') {
    items.sort(byDeadline);
    for (const it of items) {
      it.node.position = { x: order++, y: 0 }; // pořadí dle termínu (crossOf) pro layoutTree
      nodes.push(it.node);
      edges.push({ id: `pe-${it.node.id}`, source: 'me', target: it.node.id, type: 'deletable' });
    }
  } else {
    // mezistupeň = člověk/projekt; skupiny řazené dle nejbližšího termínu uvnitř.
    // Projekty klíčovat ID (dva stejně pojmenované projekty se nesmí slít).
    const keyOf = grouping === 'people' ? (it) => it.assignee : (it) => it.projectId;
    // externí kontakt se ukazuje JMÉNEM (pseudo-e-mail nikdy); členové zůstávají
    // e-mailem jako dosud — jméno se u nich řeší až v uzlu (labelForEmail v GoalNode)
    const labelOf = grouping === 'people'
      ? (it) => (isExternalOwner(it.assignee) ? labelForEmail(members, it.assignee) : it.assignee)
      : (it) => it.project;
    const groups = {};
    for (const it of items) {
      const k = keyOf(it);
      (groups[k] = groups[k] || { key: k, label: labelOf(it), list: [] }).list.push(it);
    }
    const entries = Object.values(groups);
    for (const g of entries) g.list.sort(byDeadline);
    entries.sort((a, b) => (a.list[0]?.deadline || '9999').localeCompare(b.list[0]?.deadline || '9999'));
    for (const { key, label, list } of entries) {
      const gid = `grp::${key}`;
      nodes.push({ id: gid, type: 'goalNode', position: { x: order++, y: 0 }, data: {
        nodeType: 'normal', collapsed: false, title: label, status: 'todo', deadline: '', color: '#64748b',
        owner: grouping === 'people' ? label : '', description: '',
      } });
      edges.push({ id: `pe-${gid}`, source: 'me', target: gid, type: 'deletable' });
      for (const it of list) {
        it.node.position = { x: order++, y: 0 };
        nodes.push(it.node);
        edges.push({ id: `pe-${it.node.id}`, source: gid, target: it.node.id, type: 'deletable' });
      }
    }
  }
  const pos = layoutTree(nodes, edges, 'vertical', { ...PERSONAL_LAYOUT('vertical'), ...optsMojiMapy() });
  for (const n of nodes) { const p = pos[n.id]; if (p) n.position = { x: p.x, y: p.y }; }
  return { nodes, edges, targets };
}
