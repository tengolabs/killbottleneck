// Čistá logika stromu mapy: mapa dětí z hran, počty potomků, uzly skryté
// sbalením a procento pokroku. Vytaženo z pages/GoalMapEditor.jsx (nález F1-07
// analýzy kódu) beze změny chování — `useMemo` v editoru tyhle funkce jen volá;
// styl hran (view) zůstává v editoru.

// Build children map from edges
export function buildChildrenMap(edges) {
  const map = {};
  for (const edge of edges) {
    if (!map[edge.source]) map[edge.source] = [];
    map[edge.source].push(edge.target);
  }
  return map;
}

export function countDescendants(childrenMap, nodeId) {
  // `seen`: a damaged map can hold a cycle (the editor offers "Repair the tree" for it) — without the
  // guard this loop never ended and froze the tab before the offer could show (finding F1-07)
  const seen = new Set([nodeId]);
  const stack = [...(childrenMap[nodeId] || [])];
  while (stack.length > 0) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(childrenMap[current] || []));
  }
  return seen.size - 1;
}

// id uzlů skrytých sbalením předka (celý podstrom sbaleného uzlu)
export function hiddenByCollapse(nodes, childrenMap) {
  const hidden = new Set();
  for (const node of nodes) {
    if (node.data?.collapsed) {
      const stack = [...(childrenMap[node.id] || [])];
      while (stack.length > 0) {
        const current = stack.pop();
        if (hidden.has(current)) continue; // a cycle or a second parent: each node once
        hidden.add(current);
        stack.push(...(childrenMap[current] || []));
      }
    }
  }
  return hidden;
}

// počet potomků každého uzlu (odznak „+N" na sbaleném uzlu)
export function descendantCounts(nodes, childrenMap) {
  const counts = {};
  for (const node of nodes) {
    counts[node.id] = countDescendants(childrenMap, node.id);
  }
  return counts;
}

// pokrok uzlu v % = hotové listy podstromu / všechny listy podstromu
export function computeProgressMap(nodes, childrenMap) {
  const nodeMap = {};
  for (const node of nodes) nodeMap[node.id] = node;

  // `path` = the nodes on the way down: a node met again is a cycle and counts as nothing (no endless recursion)
  const compute = (nodeId, path) => {
    const children = childrenMap[nodeId] || [];
    if (children.length === 0) {
      return { total: 1, done: nodeMap[nodeId]?.data?.status === 'done' ? 1 : 0 };
    }
    let total = 0, done = 0;
    path.add(nodeId);
    for (const childId of children) {
      if (path.has(childId)) continue;
      const r = compute(childId, path);
      total += r.total;
      done += r.done;
    }
    path.delete(nodeId);
    return { total, done };
  };

  const result = {};
  for (const node of nodes) {
    const { total, done } = compute(node.id, new Set());
    result[node.id] = total > 0 ? Math.round((done / total) * 100) : 0;
  }
  return result;
}
