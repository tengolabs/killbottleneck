import { pb } from '@/api/pb';

// Tenký klient session rout pravidel (/api/kb/rules*). Tvar pravidla drží
// server (validateRuleInput) — tady se nic nevaliduje, jen přenáší.
export const rulesApi = {
  list: (mapId) => pb.send(`/api/kb/rules?map=${encodeURIComponent(mapId)}`, { method: 'GET' }).then((r) => r.rules || []),
  save: (body) => pb.send('/api/kb/rules/save', { method: 'POST', body }).then((r) => r.rule),
  toggle: (mapId, id, enabled) => pb.send('/api/kb/rules/save', { method: 'POST', body: { map: mapId, id, enabled } }).then((r) => r.rule),
  remove: (id) => pb.send('/api/kb/rules/delete', { method: 'POST', body: { id } }),
  runs: (mapId, ruleId) => pb.send(`/api/kb/rule-runs?map=${encodeURIComponent(mapId)}${ruleId ? `&rule=${encodeURIComponent(ruleId)}` : ''}`, { method: 'GET' }).then((r) => r.runs || []),
  // šablony = knihovna instance (tvar pravidla bez mapy/scope); načtení do mapy
  // dělá klient tak, že obsah šablony předvyplní do builderu → vznikne kopie
  templates: () => pb.send('/api/kb/rule-templates', { method: 'GET' }).then((r) => r.templates || []),
  templateSave: (body) => pb.send('/api/kb/rule-templates/save', { method: 'POST', body }).then((r) => r.template),
  templateRemove: (id) => pb.send('/api/kb/rule-templates/delete', { method: 'POST', body: { id } }),
};

// Outline šablonky pod-uzlů: odsazení (2 mezery / tab) = podúroveň.
// Builder ukládá TREE_ITEM strom (stejný formát jako MCP add_nodes).
export function parseOutline(text) {
  const root = { children: [] };
  const stack = [{ depth: -1, item: root }];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)(.*)$/);
    const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
    const item = { title: m[2].trim(), children: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].item.children.push(item);
    stack.push({ depth, item });
  }
  const strip = (it) => ({ title: it.title, ...(it.children.length ? { children: it.children.map(strip) } : {}) });
  return root.children.map(strip);
}

export function outlineToText(items, depth = 0) {
  return (items || []).map((it) =>
    '  '.repeat(depth) + (it.title || '') + (it.children?.length ? '\n' + outlineToText(it.children, depth + 1) : '')
  ).join('\n');
}
