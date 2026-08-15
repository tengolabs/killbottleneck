// „Čekající" uzly: uzel s data.waitForChildren je blokovaný, dokud nejsou
// hotové VŠECHNY uzly v jeho podstromu (noty se přeskakují).
// Serverové dvojče: server/pb_hooks/helpers.js nodesToWaitState — držet v synchronizaci!

export function computeWaitingSet(nodes, edges) {
  const byId = {};
  for (const n of nodes) if (n.type !== 'note') byId[n.id] = n;
  const children = {};
  for (const e of edges) {
    if (byId[e.source] && byId[e.target]) {
      (children[e.source] = children[e.source] || []).push(e.target);
    }
  }
  const waiting = new Set();
  for (const n of Object.values(byId)) {
    if (!n.data?.waitForChildren || n.data?.status === 'done') continue;
    // DFS podstromem — blokuje jakýkoli nehotový potomek
    const stack = [...(children[n.id] || [])];
    const seen = new Set(); // cyklus v hranách nesmí zacyklit DFS
    let blocked = false;
    while (stack.length > 0) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const child = byId[id];
      if (!child) continue;
      if (child.data?.status !== 'done') { blocked = true; break; }
      stack.push(...(children[id] || []));
    }
    if (blocked) waiting.add(n.id);
  }
  return waiting;
}

// „Koho blokuju": moje nehotové uzly, které drží nějaký čekající (waitForChildren)
// uzel. Vrací { [nodeId]: titulek čekajícího uzlu } — jen pro uzly s data.owner === email.
// Serverové dvojče: server/pb_hooks/helpers.js findBlockingForOwnerServer — držet v synchronizaci!
export function findBlockingForOwner(nodes, edges, email) {
  if (!email) return {};
  const byId = {};
  for (const n of nodes) if (n.type !== 'note') byId[n.id] = n;
  const children = {};
  for (const e of edges) {
    if (byId[e.source] && byId[e.target]) {
      (children[e.source] = children[e.source] || []).push(e.target);
    }
  }
  const blocking = {};
  for (const waitId of computeWaitingSet(nodes, edges)) {
    const waiter = byId[waitId];
    const title = waiter?.data?.title || waiter?.data?.apexText || '';
    const stack = [...(children[waitId] || [])];
    const seen = new Set();
    while (stack.length > 0) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId[id];
      if (!node) continue;
      if (node.data?.status !== 'done' && node.data?.owner === email) {
        blocking[id] = blocking[id] || title;
      }
      stack.push(...(children[id] || []));
    }
  }
  return blocking;
}
