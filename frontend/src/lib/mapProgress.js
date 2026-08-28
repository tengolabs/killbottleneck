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
  let count = 0;
  const stack = [...(childrenMap[nodeId] || [])];
  while (stack.length > 0) {
    const current = stack.pop();
    count += 1;
    stack.push(...(childrenMap[current] || []));
  }
  return count;
}

// id uzlů skrytých sbalením předka (celý podstrom sbaleného uzlu)
export function hiddenByCollapse(nodes, childrenMap) {
  const hidden = new Set();
  for (const node of nodes) {
    if (node.data?.collapsed) {
      const stack = [...(childrenMap[node.id] || [])];
      while (stack.length > 0) {
        const current = stack.pop();
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

  const compute = (nodeId) => {
    const children = childrenMap[nodeId] || [];
    if (children.length === 0) {
      return { total: 1, done: nodeMap[nodeId]?.data?.status === 'done' ? 1 : 0 };
    }
    let total = 0, done = 0;
    for (const childId of children) {
      const r = compute(childId);
      total += r.total;
      done += r.done;
    }
    return { total, done };
  };

  const result = {};
  for (const node of nodes) {
    const { total, done } = compute(node.id);
    result[node.id] = total > 0 ? Math.round((done / total) * 100) : 0;
  }
  return result;
}
