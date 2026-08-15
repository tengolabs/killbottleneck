import i18next from 'i18next';
import { layoutTree } from '@/lib/treeLayout';
import { optsNoveMapy } from '@/lib/alignStyles';

// Jediný zdroj pravdy pro konverzi šablona ↔ mapa.
// ai_nodes položka: {id, title, description, parentId} + procesní rozšíření
// {owner, deadline_offset_days, wait_for_children} — stará data bez nich fungují dál.

const dateOnly = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// formát YYYY-MM-DD v LOKÁLNÍM čase — toISOString() by v CET/CEST posunul den
const fmtLocal = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (d, days) => {
  const x = dateOnly(d);
  x.setDate(x.getDate() + days);
  return fmtLocal(x);
};

// Dvojjazyčné šablony: v EN rozhraní se použijí *_en varianty polí, POKUD
// existují — jinak po jednotlivých polích fallback na češtinu (starší data
// a osobní šablony EN nemají a musí fungovat beze změny). Jediné místo výběru
// jazyka pro šablony — výpis i konverze jdou tudy.
export function templateForLang(tpl, lang = i18next.language) {
  if (!tpl || !String(lang || '').startsWith('en')) return tpl;
  const enNodes = Array.isArray(tpl.ai_nodes_en) && tpl.ai_nodes_en.length ? tpl.ai_nodes_en : null;
  return {
    ...tpl,
    title: tpl.title_en || tpl.title,
    description: tpl.description_en || tpl.description,
    goal: tpl.goal_en || tpl.goal,
    ai_nodes: enNodes || tpl.ai_nodes,
    // vestavěná pravidla: jediný lidský text je name → per-pravidlo name_en
    // (žádné paralelní rules_en; ai_nodes_en má STEJNÁ id, takže odkazy platí)
    ...(Array.isArray(tpl.rules) && tpl.rules.length
      ? { rules: tpl.rules.map((r) => ({ ...r, name: r.name_en || r.name })) }
      : {}),
  };
}

// šablona → {nodes, edges} pro mapu; startDate = od kdy počítat ofsety termínů
export function templateToMap(rawTpl, { startDate } = {}) {
  const tpl = templateForLang(rawTpl);
  // Kanban šablona (nese pravidla) se otevírá jako DESKA: sloupce v JEDNÉ řadě
  // (Richard 15. 8.: „měla by se otevřít jako kanban"). Kompakt/pásy by řadu
  // zabalily do dvou pater — proto klasika bez ohledu na zámek stylu.
  const jeKanban = Array.isArray(tpl.rules) && tpl.rules.length > 0;
  const start = startDate || new Date();
  const ts = Date.now();
  const aiNodes = tpl.ai_nodes || [];
  const nodes = aiNodes.map((n) => {
    const isRoot = !n.parentId || !aiNodes.some((p) => p.id === n.parentId);
    const deadline = Number.isFinite(Number(n.deadline_offset_days)) && n.deadline_offset_days !== null && n.deadline_offset_days !== undefined && n.deadline_offset_days !== ''
      ? addDays(start, Number(n.deadline_offset_days))
      : '';
    const common = {
      description: n.description || '',
      status: 'todo',
      color: '',
      collapsed: false,
      deadline,
      owner: n.owner || '',
      waitForChildren: !!n.wait_for_children,
    };
    return {
      id: `node-${ts}-${n.id}`,
      type: isRoot ? 'apexNode' : 'goalNode',
      position: { x: 0, y: 0 },
      data: isRoot
        ? {
            ...common,
            nodeType: 'apex',
            goalType: '', // typy mise/vize/strategie/cíl zrušeny (šablona.node_type se nemapuje)
            apexText: n.title || tpl.goal || tpl.title,
            title: (n.title || tpl.goal || tpl.title).slice(0, 60),
            waitForChildren: false, // vrchol nečeká — čekání je pro pracovní uzly
          }
        : {
            ...common,
            nodeType: 'normal',
            title: n.title || i18next.t('editor:defaults.newGoal'),
            goalType: '',
            apexText: '',
          },
    };
  });
  const edges = aiNodes
    .filter((n) => n.parentId && aiNodes.some((p) => p.id === n.parentId))
    .map((n) => ({
      id: `edge-${ts}-${n.id}`,
      source: `node-${ts}-${n.parentId}`,
      target: `node-${ts}-${n.id}`,
      type: 'deletable',
    }));
  // Nová mapa vzniká v zamčeném stylu, jinak kompaktně (Richard 11. 8. v noci).
  // Dřív se layoutovalo bez parametrů, tedy vždy „do šířky" — a to i v době,
  // kdy server zakládal úvodní mapu kompaktně.
  const positions = layoutTree(nodes, edges, 'vertical', jeKanban ? {} : optsNoveMapy());
  // idMap: krátké id šablony (n1…) → reálné id uzlu — pro navěšení úkolů ze seeds
  const idMap = {};
  for (const n of aiNodes) idMap[n.id] = `node-${ts}-${n.id}`;
  return {
    nodes: nodes.map((n) => ({ ...n, position: positions[n.id] || n.position })),
    edges,
    idMap,
  };
}

// ofset termínu ode dneška (dny, min 0); null = bez termínu
const deadlineOffset = (deadline) => {
  if (!deadline) return null;
  const today = dateOnly(new Date());
  const diff = Math.round((dateOnly(new Date(deadline + 'T00:00:00')) - today) / 86400000);
  return Math.max(0, diff);
};

// mapa → {ai_nodes, nodeIdMap} pro uložení šablony; termíny → ofsety ode dneška (min 0).
// nodeIdMap (reálné id uzlu → n1…) slouží k převodu úkolů mapy na task_seeds.
export function mapToTemplateNodes(nodes, edges) {
  const parentOf = {};
  for (const e of edges) parentOf[e.target] = e.source;
  const real = nodes.filter((n) => n.type !== 'note');
  const shortId = {};
  real.forEach((n, i) => { shortId[n.id] = `n${i + 1}`; });
  const aiNodes = real.map((n) => {
    const d = n.data || {};
    return {
      id: shortId[n.id],
      title: d.title || (d.apexText || '').slice(0, 60) || i18next.t('home:misc.untitled'),
      description: d.nodeType === 'apex' ? (d.apexText || d.description || '') : (d.description || ''),
      parentId: parentOf[n.id] && shortId[parentOf[n.id]] ? shortId[parentOf[n.id]] : null,
      owner: d.owner || '',
      deadline_offset_days: deadlineOffset(d.deadline),
      wait_for_children: !!d.waitForChildren,
    };
  });
  return { ai_nodes: aiNodes, nodeIdMap: shortId };
}

// úkoly mapy → task_seeds šablony (vč. podúkolů; termíny jako ofsety, opakování
// a přiřazení 1:1). node se překládá přes nodeIdMap z mapToTemplateNodes.
export function tasksToSeeds(tasks, nodeIdMap) {
  const list = tasks || [];
  const shortId = {};
  list.forEach((t, i) => { shortId[t.id] = `t${i + 1}`; });
  return list.map((t) => ({
    id: shortId[t.id],
    parent: t.parent_id && shortId[t.parent_id] ? shortId[t.parent_id] : null,
    node: t.node_id && nodeIdMap[t.node_id] ? nodeIdMap[t.node_id] : '',
    title: t.title || 'Úkol',
    description: t.description || '',
    deadline_offset_days: deadlineOffset(t.deadline),
    recurrence: t.recurrence || '',
    assignee_email: t.assignee_email || '',
  }));
}

// task_seeds šablony → payloady pro Task.create (v pořadí: nejdřív hlavní úkoly,
// pak podúkoly — volající po založení rodiče doplní parent_id z vráceného mapování).
// Seed bez namapovaného uzlu se PŘESKOČÍ (podúkol uzel zdědí přes parent_id na
// serveru): úkol patří na konkrétní cíl a server by ho stejně odmítl
// (err.taskNeedsNode, 13. 8. 2026).
export function seedsToTasks(seeds, idMap, startDate) {
  const start = startDate || new Date();
  const list = Array.isArray(seeds) ? seeds : [];
  const ordered = list.filter((s) => !s.parent).concat(list.filter((s) => s.parent))
    .filter((s) => s.parent || (s.node && idMap?.[s.node]));
  return ordered.map((s) => ({
    seedId: s.id,
    parentSeedId: s.parent || null,
    data: {
      title: s.title || 'Úkol',
      description: s.description || '',
      status: 'todo',
      deadline: s.deadline_offset_days !== null && s.deadline_offset_days !== undefined && s.deadline_offset_days !== ''
        ? addDays(start, Number(s.deadline_offset_days))
        : '',
      recurrence: s.recurrence || '',
      assignee_email: s.assignee_email || '',
      node_id: (s.node && idMap?.[s.node]) || '',
    },
  }));
}

// má šablona procesní metadata? (řídí zobrazení data startu a náhledu přiřazení)
export function isProcessTemplate(tpl) {
  return (tpl?.ai_nodes || []).some(
    (n) => n.owner || n.wait_for_children || (n.deadline_offset_days !== null && n.deadline_offset_days !== undefined && n.deadline_offset_days !== '')
  );
}
