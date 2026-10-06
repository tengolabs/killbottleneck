// Práce na kroku přes asistenta — komentáře a stopky: schémata, vykonání, kontroly před kartou a popisy karet.
// Vzniklo rozdělením chat.js po skupinách nástrojů (5. 10. 2026, bod 2 prověrky asistenta): kód přesunut DOSLOVA, chování beze změny.
// Sdílené resolvery (mapaId, uzelId, sDocasnymKlicem, …) jsou v chat-spolecne.js; chat.js skládá seznam nástrojů v PŮVODNÍM pořadí
// (PORADI_NASTROJU — pořadí schémat je součást prefixu promptu, cache musí držet) a podle `modul` u nástroje sem deleguje
// vykonej / overZapis / popisAkce. ⚠️ PocketBase JSVM: require() uvnitř funkcí (líné přístupové funkce níže).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname; // mimo PocketBase (testy v node) složka souboru
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);

// běžící záznam stopek uživatele (time_entries s prázdným ended) nebo null
function beziciStopky(app, auth) {
  try { return app.findFirstRecordByFilter("time_entries", "owner = {:o} && ended = ''", { o: auth.id }); } catch (err) { return null; }
}

const NASTROJE = [
  { name: "add_comment", skupina: "prace", kind: "write", description: "Add a comment to a step (node) of a map — everyone who sees the map can read it; the step's owner and the map owner get a notification. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string", description: "the exact node title (from get_map)" }, text: { type: "string" } }, required: ["map_id", "node_id", "text"], additionalProperties: false } },
  { name: "get_timer", skupina: "prace", kind: "read", description: "Is the user's work timer (stopwatch) running? Returns since when, the label and the step, or that nothing runs.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "start_timer", skupina: "prace", kind: "write", description: "Start the user's work timer (stopwatch), optionally on a step of a map (map_id + node_id) or just with a label — a timer already running is stopped first (one at a time, like in the app header). The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" }, label: { type: "string" } }, required: [], additionalProperties: false } },
  { name: "stop_timer", skupina: "prace", kind: "write", description: "Stop the user's running work timer; optional note (as in the app, a note on a timer that has no step becomes an idea in the buffer). The user confirms first.",
    parameters: { type: "object", properties: { note: { type: "string" } }, required: [], additionalProperties: false } },
];

function vykonej(app, auth, L, name, args, ktx) {
  const a = args || {};
  switch (name) {
    case "add_comment": {
      const p = SPOL().pravaMapy(app, auth, a.map_id);
      if (!p) return { text: "Error: map not found." };
      const N2 = require(`${__hooks}/chat-nastaveni.js`);
      const http = N2.sVlastnimTokenem(ktx);
      if (!http) return N2.BEZ_TOKENU;
      const nid = SPOL().uzelId(app, auth, p.map.id, a.node_id);
      const r = http("POST", "/api/collections/comments/records", { goalmap: p.map.id, node_id: nid, text: String(a.text).trim() });
      if (r.status !== 200) return { text: `Error ${r.status}: ${((r.json || {}).message) || "comment failed"}${r.status === 400 || r.status === 403 ? " (comments need named access to the map — the owner shares it)" : ""}` };
      return { text: `Comment added to "${SPOL().titulUzlu(app, auth, a.map_id, a.node_id)}" in "${p.map.getString("title")}"; the step's owner and the project owner were notified.`, karta: { type: "vysledek", map_id: p.map.id, map_title: p.map.getString("title"), node_id: nid } };
    }
    case "get_timer": {
      const b = beziciStopky(app, auth);
      if (!b) return { text: "No work timer is running." };
      return { text: `Work timer running since ${b.getString("started")}${b.getString("label") ? ` — "${b.getString("label")}"` : ""}${b.getString("node_id") ? ` (step ${b.getString("node_id")} in map ${b.getString("map")})` : ""}.` };
    }
    case "start_timer": {
      const N2 = require(`${__hooks}/chat-nastaveni.js`);
      const http = N2.sVlastnimTokenem(ktx);
      if (!http) return N2.BEZ_TOKENU;
      const mid = a.map_id ? SPOL().mapaId(app, auth, a.map_id) : "";
      const nid = mid && a.node_id ? SPOL().uzelId(app, auth, mid, a.node_id) : "";
      const label = String(a.label || (nid ? SPOL().titulUzlu(app, auth, a.map_id, a.node_id) : "")).slice(0, 200);
      const r = http("POST", "/api/collections/time_entries/records", { started: new Date().toISOString(), ended: "", map: mid || "", node_id: nid || "", label: label });
      if (r.status !== 200) return { text: `Error ${r.status}: ${((r.json || {}).message) || "timer failed"}` };
      return { text: `Work timer started${label ? ` on "${label}"` : ""}; any previous timer was stopped. It shows in the app header.` };
    }
    case "stop_timer": {
      const N2 = require(`${__hooks}/chat-nastaveni.js`);
      const http = N2.sVlastnimTokenem(ktx);
      if (!http) return N2.BEZ_TOKENU;
      const b = beziciStopky(app, auth);
      if (!b) return { text: "Error: no work timer is running." };
      const body = { ended: new Date().toISOString() };
      if (a.note !== undefined) body.note = String(a.note).slice(0, 2000);
      const r = http("PATCH", `/api/collections/time_entries/records/${encodeURIComponent(b.id)}`, body);
      if (r.status !== 200) return { text: `Error ${r.status}: ${((r.json || {}).message) || "timer failed"}` };
      const j = r.json || {};
      return { text: `Work timer stopped: ${j.duration_min !== undefined ? `${j.duration_min} min` : "done"}${b.getString("label") ? ` on "${b.getString("label")}"` : ""}.${a.note && !b.getString("map") && !b.getString("node_id") ? " The note was saved as an idea in the buffer (as in the app)." : ""}` };
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

function overZapis(app, auth, name, a) {
  const { chybaMapy } = SPOL().kontrolyZapisu(app, auth);
  switch (name) {
    case "add_comment": {
      const p = SPOL().pravaMapy(app, auth, a.map_id);
      if (!p) return chybaMapy(a.map_id);
      const nid = SPOL().uzelId(app, auth, p.map.id, a.node_id);
      if (!nid) return `Error: node "${String(a.node_id || "")}" not found in the map (use get_map; pass the node id or its exact title).`;
      const t = String(a.text || "").trim();
      if (!t) return "Error: text is required.";
      if (t.length > 2000) return "Error: the comment is too long (max 2000 characters).";
      return null;
    }
    case "start_timer": {
      if (a.map_id) {
        const mid = SPOL().mapaId(app, auth, a.map_id);
        if (!mid) return chybaMapy(a.map_id);
        if (a.node_id && !SPOL().uzelId(app, auth, mid, a.node_id)) return `Error: node "${String(a.node_id || "")}" not found in the map (use get_map).`;
      } else if (a.node_id) return "Error: node_id needs map_id.";
      if (a.label !== undefined && String(a.label).length > 200) return "Error: label is too long (max 200).";
      return null;
    }
    case "stop_timer": return beziciStopky(app, auth) ? null : "Error: no work timer is running; nothing to stop.";
    default: return null;
  }
}

function popisAkce(app, auth, L, name, a) {
  const cs = L !== "en";
  const { nazevMapy, nazevUzlu } = SPOL().pojmenovani(app, auth);
  switch (name) {
    case "add_comment": return cs
      ? `Přidat komentář ke kroku „${nazevUzlu(a.map_id, a.node_id)}“ (projekt „${nazevMapy(a.map_id)}“): „${SPOL().ocisti(a.text, 100)}“`
      : `Add a comment to "${nazevUzlu(a.map_id, a.node_id)}" (project "${nazevMapy(a.map_id)}"): "${SPOL().ocisti(a.text, 100)}"`;
    case "start_timer": {
      const na = a.map_id && a.node_id ? (cs ? ` na krok „${nazevUzlu(a.map_id, a.node_id)}“` : ` on "${nazevUzlu(a.map_id, a.node_id)}"`) : (a.label ? ` („${SPOL().ocisti(a.label, 80)}“)` : "");
      return cs ? `Spustit stopky${na} — běžící stopky se zastaví` : `Start the work timer${na} — a running timer is stopped first`;
    }
    case "stop_timer": return cs ? `Zastavit stopky${a.note ? ` s poznámkou „${SPOL().ocisti(a.note, 80)}“` : ""}` : `Stop the work timer${a.note ? ` with the note "${SPOL().ocisti(a.note, 80)}"` : ""}`;
    default: return "";
  }
}

module.exports = { NASTROJE, vykonej, overZapis, popisAkce, beziciStopky };
