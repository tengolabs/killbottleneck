// Opakování na cílech (v0.35, Richard 17. 8. 2026): žádný nový pojem v modelu —
// opakovaný cíl je OBYČEJNÉ automatizační pravidlo „když Hotovo → vrať na
// Založeno + posuň termín o interval (rytmus od původního termínu)".
// Přepínač v detailu cíle takové pravidlo zakládá/mění/maže a poznává ho
// STRUKTUROU (ne jménem ani skrytým polem) — ručně upravené pravidlo se
// přizná jako „vlastní" a přepínač na něj nesahá.

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'];

// Vrátí { freq, rule } pro čisté opakovací pravidlo, { custom: true, rule }
// pro strukturálně podobné-ale-upravené (nebo vypnuté), null když uzel
// opakování nemá.
export function recurrenceOf(rules, nodeId) {
  // kandidát = KAŽDÉ pravidlo uzlu, které hýbe termínem přes advance (i s jiným
  // triggerem než done — jinak by přepínač ručně upravené pravidlo neviděl
  // a dovolil založit druhé, které termínem hýbe taky). Čistý tvar má přednost
  // před custom — pořadí pravidel v poli nesmí rozhodovat.
  const kandidati = (rules || []).filter((r) => r && r.node_id === nodeId
    && (Array.isArray(r.actions) ? r.actions : []).some((a) => a && a.type === 'set_deadline' && a.advance !== undefined));
  let custom = null;
  for (const r of kandidati) {
    const acts = Array.isArray(r.actions) ? r.actions : [];
    const setStatus = acts.find((a) => a && a.type === 'set_status');
    const setDeadline = acts.find((a) => a && a.type === 'set_deadline');
    const cisty = acts.length === 2
      && (r.trigger || {}).type === 'node_status_changed' && (r.trigger || {}).status === 'done'
      && (r.conditions || []).length === 0
      && setStatus && setStatus.status === 'todo' && (setStatus.target === undefined || setStatus.target === 'trigger_node')
      && setDeadline && RECURRENCE_FREQS.includes(setDeadline.advance) && (setDeadline.target === undefined || setDeadline.target === 'trigger_node');
    if (cisty && r.enabled !== false) return { freq: setDeadline.advance, rule: r };
    if (!custom) custom = { custom: true, rule: r };
  }
  return custom;
}

// Payload pro rulesApi.save — name dodá volající (jazyk UI).
export function buildRecurrenceRule(nodeId, freq, name) {
  return {
    name,
    node_id: nodeId,
    trigger: { type: 'node_status_changed', status: 'done' },
    conditions: [],
    actions: [
      { type: 'set_status', status: 'todo' },
      { type: 'set_deadline', advance: freq },
    ],
  };
}
