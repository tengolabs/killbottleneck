// Přemapování šablonového pravidla na reálná id uzlů mapy přes idMap
// (d1 → node-<ts>-d1). Zrcadlo: pb_hooks/helpers.js:remapRuleIdsServer — FE lib
// a hooks kód nesdílí (vzor templateToMap/templateToMapServer), shodu tvarů
// hlídá parity test v tests/sablony-pravidla.js. Čistá funkce bez importů.
//
// Překládá jen odkazy na uzly: node_id (scope), podmínku parent (value),
// akce move_node.to a create_subnodes.parent a target u setrů — pseudo-cíle
// (trigger_node, parent) nechává být. Odkaz mimo idMap ponechá, jak je —
// serverová validace (validateRuleInput) pravidlo poctivě odmítne, tady se
// nic tiše nezahazuje. Šablonová pole id a name_en se do těla /rules/save
// nepřenáší.
export function remapRuleIds(rule, idMap) {
  const map = (v) => (idMap && Object.prototype.hasOwnProperty.call(idMap, v) ? idMap[v] : v);
  const out = {
    name: rule.name || '',
    node_id: rule.node_id ? map(rule.node_id) : '',
    trigger: rule.trigger,
    conditions: (Array.isArray(rule.conditions) ? rule.conditions : []).map((c) =>
      c && c.field === 'parent' ? { ...c, value: map(c.value) } : c
    ),
    actions: (Array.isArray(rule.actions) ? rule.actions : []).map((a) => {
      if (!a) return a;
      const b = { ...a };
      if (b.type === 'move_node' && b.to) b.to = map(b.to);
      if (b.type === 'create_subnodes' && b.parent && b.parent !== 'trigger_node') b.parent = map(b.parent);
      if (b.target && b.target !== 'trigger_node' && b.target !== 'parent') b.target = map(b.target);
      return b;
    }),
  };
  return out;
}
