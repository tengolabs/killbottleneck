// relativně, ne přes @ alias — tenhle soubor načítá node unit test (map-portable.js)
// a node vite alias nezná
import { saveBlob } from './saveFile.js';
// Přenositelný export projektu do JSON — aby si lidé mohli schémata posílat mezi
// instancemi. Skládá se na klientovi z dat, která editor stejně má v paměti;
// import je naopak serverová routa (nedůvěryhodný vstup, viz /api/kb/map-import).
//
// `map.nodes` je KANONICKÝ tvar z lib/cleanMap.js — tedy přesně to, co se ukládá
// do DB, včetně vykonavatele (executorKind/executorName).
// Co se ZÁMĚRNĚ neexportuje: sdílení, veřejnost, řada/číslování, klient, archivace
// (patří k instanci, ne ke schématu) a hlavně registr AI agentů — jméno agenta
// v uzlu je jen text, adresa webhooku ani klíč se ven nikdy nedostanou.

export const EXPORT_FORMAT = 'killbottleneck.map/1';
// PŘECHOD: soubory vyexportované před přejmenováním nesou starý identifikátor.
// Uživatel má ten soubor u sebe na disku roky — importovat MUSÍ jít pořád.
export const EXPORT_FORMATY_PRIJIMANE = [EXPORT_FORMAT, 'flowmap.map/1'];

// Bez osob: vyprázdní garanty uzlů, žadatele o automatizaci i řešitele úkolů.
// Jména automatizací zůstávají — je to popis procesu, ne osobní údaj.
const stripPeople = (nodes) => nodes.map((n) => (n.type === 'note'
  ? n
  : { ...n, data: { ...n.data, owner: '', automationRequestedBy: '' } }));

// Bez osob v PRAVIDLECH (checkup 15. 8.): e-mail se pozná podle „@" — role
// (node_owner, map_owner, zástupci, position:<id>) ho nemají a zůstávají.
// Akce s konkrétní osobou se DROPNE celá (set_owner s vyprázdněným garantem
// by změnil sémantiku na „smaž garanta"); garanti v checklistu
// create_subnodes.items se vyprázdní jako u uzlů; pravidlo s PODMÍNKOU na
// konkrétní osobu se vynechá CELÉ (vyhozením podmínky by pravidlo střílelo
// šířeji — to je horší než ho nepřenést). Pravidlo bez zbylých akcí se vynechá.
const stripItemsOwners = (items) => (Array.isArray(items) ? items : []).map((it) => (it
  ? {
    ...it,
    ...(it.owner ? { owner: '' } : {}),
    ...(Array.isArray(it.children) ? { children: stripItemsOwners(it.children) } : {}),
  }
  : it));
const stripPeopleFromRules = (rules) => rules
  .filter((r) => !(Array.isArray(r.conditions) ? r.conditions : []).some(
    (c) => c && c.field === 'owner' && String(c.value || '').includes('@')
  ))
  .map((r) => ({
    ...r,
    actions: (Array.isArray(r.actions) ? r.actions : [])
      .filter((a) => {
        if (!a) return false;
        if (a.type === 'set_owner' && String(a.owner || '').includes('@')) return false;
        if (a.type === 'notify' && String(a.to || '').includes('@')) return false;
        return true;
      })
      .map((a) => (a.type === 'create_subnodes' ? { ...a, items: stripItemsOwners(a.items) } : a)),
  }))
  .filter((r) => r.actions.length > 0);

export function buildMapExport({ map, nodes, edges, tasks = [], rules = [], includePeople = true, exportedBy = '' }) {
  const cleanNodes = includePeople ? nodes : stripPeople(nodes);
  // jen tvar pravidla (bez id, created_by, last_*) — ta patří k instanci
  const portableRules = (rules || []).map((r) => ({
    name: r.name || '',
    node_id: r.node_id || '',
    trigger: r.trigger,
    conditions: r.conditions || [],
    actions: r.actions || [],
    enabled: r.enabled !== false,
  }));
  return {
    format: EXPORT_FORMAT,
    exported_at: new Date().toISOString(),
    exported_by: includePeople ? exportedBy : '',
    map: {
      title: map?.title || '',
      description: map?.description || '',
      nodes: cleanNodes,
      edges: edges,
    },
    tasks: (tasks || []).map((t) => ({
      id: t.id, // jen pro navázání podúkolů uvnitř souboru; import id přegeneruje
      title: t.title || '',
      description: t.description || '',
      status: t.status || 'todo',
      deadline: t.deadline || '',
      recurrence: t.recurrence || '',
      assignee_email: includePeople ? (t.assignee_email || '') : '',
      node_id: t.node_id || '',
      parent_id: t.parent_id || '',
      sort_order: t.sort_order || 0,
    })),
    // automatizační pravidla mapy — id uzlů remapuje import; pole je optional,
    // starší soubory bez něj i starší čtenáři nového souboru fungují dál
    rules: includePeople ? portableRules : stripPeopleFromRules(portableRules),
  };
}

// Lehká prekontrola na klientovi — aby uživatel dostal srozumitelnou hlášku hned,
// bez čekání na server. Autoritativní kontrola je stejně na serveru.
export function looksLikeExport(obj) {
  return !!obj && EXPORT_FORMATY_PRIJIMANE.includes(obj.format) && !!obj.map && Array.isArray(obj.map.nodes);
}

// název souboru z názvu projektu (diakritika a lomítka pryč)
export function exportFilename(title) {
  const base = String(title || 'killbottleneck')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'killbottleneck';
  return `${base}.kb.json`;
}

export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json;charset=utf-8' });
  saveBlob(blob, filename);
}
