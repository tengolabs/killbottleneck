// Úzká hrdla v mapě — POCTIVÁ verze (v2, 9/2026). Jen pozorovatelná fakta:
// dny po termínu, počet blokovaných kroků, dny bez skutečného pohybu. Žádné
// skóre, žádná procenta — přesně tohle byl problém odrazového konceptu
// (Antigravity), který se nepřevzal.
//
// Dělba práce se serverem:
//  • PO TERMÍNU se počítá TADY (getDeadlineStatus) — mění se živě při editaci
//    termínu, server na to není potřeba.
//  • STAGNACE přichází HOTOVÁ ze serveru (GET /api/kb/map-activity →
//    helpers.js:mapStagnantNodes) — jediný předpis „nehýbe se" (nodeLastMoved
//    nad záznamníkem map_changes, práh stuckDays, kandidáti bez blízkého
//    termínu/plánu). Druhý předpis stagnace NEZAVÁDĚT; pole `updated` uzlu
//    neexistuje a cokoli jiného lže (posun uzlu myší ≠ pohyb práce).
//  • VĚTVENÍ (potenciální hrdla) je čistě strukturální — počítá se tady
//    z childrenMap.
//
// Definice (rozhodnutí Richarda 2. 9. 2026):
//  • REÁLNÉ hrdlo (červené, svítí i bez přepínače): nehotový uzel, který
//    (a) je po termínu, NEBO (b) stagnuje A drží ≥1 nehotový navazující krok.
//  • POTENCIÁLNÍ hrdlo (oranžové, jen při zapnutém přepínači): nehotový uzel
//    s ≥2 nehotovými navazujícími kroky, který není reálným hrdlem.
//  • Apex, poznámky a org mapy se nehodnotí; hotový uzel nikdy.
// Tytéž reálné položky servíruje Organizace v sekci „Kde to nejvíc stojí"
// (buildPortfolio.sections.bottlenecks) — jedna definice, jeden zdroj.
import { getDeadlineStatus } from '@/lib/nodeMeta';

const POTENCIAL_PRAH = 2; // ≥2 blokované kroky (rozhodnutí 2. 9. 2026)

const dniPoTerminu = (deadline) => {
  const dl = new Date(String(deadline) + 'T00:00:00');
  if (isNaN(dl.getTime())) return 0;
  const dnes = new Date();
  dnes.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((dnes - dl) / 86400000));
};

// Počet NEHOTOVÝCH potomků v podstromu (s ochranou proti cyklu — hrany kreslí
// uživatel, smyčka nesmí zamrazit editor).
function openDescendants(startId, childrenMap, doneById) {
  let cnt = 0;
  const seen = new Set([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop();
    for (const ch of childrenMap[cur] || []) {
      if (seen.has(ch)) continue;
      seen.add(ch);
      if (doneById[ch] === false) cnt++;
      stack.push(ch);
    }
  }
  return cnt;
}

/**
 * @param nodes    uzly mapy (ReactFlow tvar)
 * @param edges    hrany mapy
 * @param childrenMap  z buildChildrenMap(edges) — editor ho už má spočítaný
 * @param stagnant { [nodeId]: dnyBezPohybu } ze serveru (/api/kb/map-activity);
 *                 prázdný objekt = „ještě nevím" → stagnace se prostě nehlásí
 */
export function detectBottlenecks(nodes, edges, childrenMap, stagnant) {
  const st = stagnant || {};
  const doneById = {};
  const list = [];
  for (const n of Array.isArray(nodes) ? nodes : []) {
    if (!n || n.type === 'note') continue;
    doneById[n.id] = ((n.data || {}).status || 'todo') === 'done';
    list.push(n);
  }

  const bottleneckNodeIds = new Set();
  const nodeAnalysisMap = {};
  let realCount = 0;
  let potentialCount = 0;

  for (const n of list) {
    const d = n.data || {};
    const isApex = n.type === 'apexNode' || d.nodeType === 'apex';
    if (isApex || doneById[n.id]) continue;

    const blockedCount = openDescendants(n.id, childrenMap, doneById);
    const overdue = getDeadlineStatus(d.deadline, d.status) === 'overdue';
    const daysOverdue = overdue ? dniPoTerminu(d.deadline) : 0;
    const stagnuje = Object.prototype.hasOwnProperty.call(st, n.id);
    const daysIdle = stagnuje ? Math.max(1, st[n.id] || 0) : 0;

    const reasons = [];
    let type = 'none';
    if (overdue) {
      type = 'real';
      reasons.push({ key: 'poTerminu', count: daysOverdue });
      if (blockedCount > 0) reasons.push({ key: 'blokujeKroky', count: blockedCount });
    }
    if (stagnuje && blockedCount > 0) {
      type = 'real';
      reasons.push({ key: 'stagnujeBlokuje', days: daysIdle, count: blockedCount });
    }
    if (type === 'none' && blockedCount >= POTENCIAL_PRAH) {
      type = 'potential';
      reasons.push({ key: 'vetveni', count: blockedCount });
    }
    if (type === 'none') continue;

    bottleneckNodeIds.add(n.id);
    if (type === 'real') realCount++; else potentialCount++;
    nodeAnalysisMap[n.id] = {
      id: n.id,
      bottleneckType: type,
      isBottleneck: true,
      isCritical: type === 'real', // reálné svítí i bez přepínače (GoalNode)
      blockedCount: blockedCount,
      daysOverdue: daysOverdue,
      daysIdle: daysIdle,
      reasons: reasons,
    };
  }

  return {
    bottleneckNodeIds,
    nodeAnalysisMap,
    // počítadlo na tlačítku = jen REÁLNÁ hrdla (oranžová jsou hypotéza)
    totalBottlenecks: realCount,
    realCount,
    potentialCount,
  };
}
