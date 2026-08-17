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



// má šablona procesní metadata? (řídí zobrazení data startu a náhledu přiřazení)
export function isProcessTemplate(tpl) {
  return (tpl?.ai_nodes || []).some(
    (n) => n.owner || n.wait_for_children || (n.deadline_offset_days !== null && n.deadline_offset_days !== undefined && n.deadline_offset_days !== '')
  );
}
