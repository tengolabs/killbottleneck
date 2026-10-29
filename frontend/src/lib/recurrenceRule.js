// Opakování na cílech (v0.35, Richard 17. 8. 2026): žádný nový pojem v modelu —
// opakovaný cíl je OBYČEJNÉ automatizační pravidlo „když Hotovo → vrať na
// Založeno + posuň termín o interval (rytmus od původního termínu)".
// Přepínač v detailu cíle takové pravidlo zakládá/mění/maže a poznává ho
// STRUKTUROU (ne jménem ani skrytým polem) — ručně upravené pravidlo se
// přizná jako „vlastní" a přepínač na něj nesahá.
// Styl Proces (21. 10. 2026) přidal rytmus „každý N-tý" + dny v týdnu
// (set_deadline.every / .days) a obnovu podkroků (akce reset_subtree) —
// čistý tvar je i s nimi; zrcadlo serverového recurrenceOfRule (helpers.js).

export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'];

const naUzlu = (a) => a.target === undefined || a.target === '' || a.target === 'trigger_node';

// rytmus z akce set_deadline s advance, nebo null (neplatné every/days)
function rytmusAkce(a) {
  if (!a || a.type !== 'set_deadline' || !RECURRENCE_FREQS.includes(a.advance)) return null;
  const every = a.every === undefined ? 1 : a.every;
  if (!Number.isInteger(every) || every < 1 || every > 4) return null;
  const r = { freq: a.advance, every };
  if (a.days !== undefined) {
    if (a.advance !== 'weekly' || !Array.isArray(a.days) || !a.days.length) return null;
    if (a.days.some((d) => !Number.isInteger(d) || d < 1 || d > 7) || new Set(a.days).size !== a.days.length) return null;
    r.days = [...a.days].sort();
  }
  if (a.month_day !== undefined) {
    if (a.advance !== 'monthly' || !Number.isInteger(a.month_day) || a.month_day < 1 || a.month_day > 31) return null;
    r.day = a.month_day;
  }
  return r;
}

// Vrátí { freq, every, days?, reset, rule } pro čisté opakovací pravidlo,
// { custom: true, rule } pro strukturálně podobné-ale-upravené (nebo vypnuté),
// null když uzel opakování nemá.
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
    const st = acts.filter((a) => a && a.type === 'set_status');
    const dl = acts.filter((a) => a && a.type === 'set_deadline');
    const rs = acts.filter((a) => a && a.type === 'reset_subtree');
    const rytmus = dl.length === 1 ? rytmusAkce(dl[0]) : null;
    const cisty = (acts.length === 2 || acts.length === 3)
      && st.length === 1 && dl.length === 1 && rs.length <= 1 && st.length + dl.length + rs.length === acts.length
      && (r.trigger || {}).type === 'node_status_changed' && (r.trigger || {}).status === 'done'
      && (r.conditions || []).length === 0
      && st[0].status === 'todo' && acts.every(naUzlu) && !!rytmus;
    if (cisty && r.enabled !== false) return { ...rytmus, reset: rs.length === 1, rule: r };
    if (!custom) custom = { custom: true, rule: r };
  }
  return custom;
}

// Payload pro rulesApi.save — name dodá volající (jazyk UI). `rytmus` je buď
// řetězec freq (starší volání), nebo { freq, every, days, day }. `reset` = obnovit
// při opakování i podkroky (styl Proces).
export function buildRecurrenceRule(nodeId, rytmus, name, { reset = false } = {}) {
  const r = typeof rytmus === 'string' ? { freq: rytmus } : (rytmus || {});
  const dl = { type: 'set_deadline', advance: r.freq };
  if (Number.isInteger(r.every) && r.every > 1) dl.every = r.every;
  if (r.freq === 'weekly' && Array.isArray(r.days) && r.days.length) dl.days = [...r.days].sort();
  if (r.freq === 'monthly' && Number.isInteger(r.day) && r.day >= 1 && r.day <= 31) dl.month_day = r.day;
  return {
    name,
    node_id: nodeId,
    trigger: { type: 'node_status_changed', status: 'done' },
    conditions: [],
    actions: [
      { type: 'set_status', status: 'todo' },
      dl,
      ...(reset ? [{ type: 'reset_subtree' }] : []),
    ],
  };
}
