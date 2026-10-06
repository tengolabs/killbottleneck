// Žádosti o jiný termín přes asistenta: schémata, vykonání, kontroly před kartou a popisy karet.
// Vzniklo rozdělením chat.js po skupinách nástrojů (5. 10. 2026, bod 2 prověrky asistenta): kód přesunut DOSLOVA, chování beze změny.
// Sdílené resolvery (mapaId, uzelId, sDocasnymKlicem, …) jsou v chat-spolecne.js; chat.js skládá seznam nástrojů v PŮVODNÍM pořadí
// (PORADI_NASTROJU — pořadí schémat je součást prefixu promptu, cache musí držet) a podle `modul` u nástroje sem deleguje
// vykonej / overZapis / popisAkce. ⚠️ PocketBase JSVM: require() uvnitř funkcí (líné přístupové funkce níže).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname; // mimo PocketBase (testy v node) složka souboru
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);

const NASTROJE = [
  { name: "request_deadline_change", skupina: "terminy", kind: "write", description: "Ask the assigner for a different deadline on the user's OWN step in SOMEONE ELSE'S project — the deadline stays until the assigner agrees (the owner of a project changes deadlines directly with update_node). cancel=true withdraws the user's pending request. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" }, date: { type: "string", description: "wanted deadline YYYY-MM-DD" }, note: { type: "string", description: "short reason for the assigner" }, cancel: { type: "boolean" } }, required: ["map_id", "node_id"], additionalProperties: false } },
  { name: "decline_deadline_request", skupina: "terminy", kind: "write", description: "Decline a colleague's pending request for a different deadline on a step (the project owner or whoever assigned the step). To ACCEPT the request, set the wanted date with update_node deadline instead. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, node_id: { type: "string" } }, required: ["map_id", "node_id"], additionalProperties: false } },
];

function vykonej(app, auth, L, name, args, ktx) {
  const a = args || {};
  switch (name) {
    case "request_deadline_change": case "decline_deadline_request": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      const nid = SPOL().uzelId(app, auth, mid, a.node_id);
      const http = require(`${__hooks}/chat-nastaveni.js`).sVlastnimTokenem(ktx);
      if (!http) return require(`${__hooks}/chat-nastaveni.js`).BEZ_TOKENU;
      const body = { mapId: mid, nodeId: nid, action: name === "decline_deadline_request" ? "decline" : (a.cancel ? "cancel" : "request") };
      if (body.action === "request") { body.date = String(a.date); body.note = String(a.note || "").slice(0, 500); }
      const r = http("POST", "/api/kb/deadline-requests", body);
      if (r.status !== 200) return { text: `Error ${r.status}: ${((r.json || {}).error) || "request failed"}` };
      const t = body.action === "request" ? `Deadline change requested for ${a.date} on "${SPOL().titulUzlu(app, auth, a.map_id, a.node_id)}" — the assigner was notified; the deadline stays until they decide.`
        : body.action === "cancel" ? "The deadline request was withdrawn." : `The deadline request on "${SPOL().titulUzlu(app, auth, a.map_id, a.node_id)}" was declined; the requester was notified.`;
      return { text: t, karta: { type: "vysledek", map_id: mid, map_title: SPOL().titulMapy(app, auth, a.map_id), node_id: nid } };
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

function overZapis(app, auth, name, a) {
  const { chybaMapy } = SPOL().kontrolyZapisu(app, auth);
  switch (name) {
    case "request_deadline_change": case "decline_deadline_request": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      if (!mid) return chybaMapy(a.map_id);
      const nid = SPOL().uzelId(app, auth, mid, a.node_id);
      if (!nid) return `Error: node "${String(a.node_id || "")}" not found in the map (use get_map; pass the node id or its exact title).`;
      const p = SPOL().pravaMapy(app, auth, a.map_id);
      const { jsonVal, nodeIsMine } = require(`${__hooks}/helpers.js`);
      const node = jsonVal(p.map, "nodes", []).find((n) => n.id === nid) || { data: {} };
      const d = node.data || {};
      const email = String(auth.email() || "").toLowerCase();
      if (name === "request_deadline_change") {
        if (p.map.getString("owner") === auth.id) return "Error: this is the user's own project — change the deadline directly with update_node (deadline) instead of requesting it.";
        if (a.cancel) {
          if (!d.deadlineChangeWanted || String(d.deadlineChangeRequestedBy || "").toLowerCase() !== email) return "Error: the user has no pending deadline request on this step.";
          return null;
        }
        if (!d.deadline) return "Error: the step has no deadline, so there is nothing to change — ask the assigner directly.";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.date || ""))) return "Error: date must be YYYY-MM-DD.";
        if (String(a.date) === String(d.deadline)) return "Error: the wanted date equals the current deadline.";
        if (!["work", "edit"].includes(p.level) && !nodeIsMine(app, p.map.id, node, email)) return "Error: the user can ask for a different deadline only on their own step (where they are the owner or have the task).";
        if (d.deadlineChangeWanted && String(d.deadlineChangeRequestedBy || "").toLowerCase() !== email) return `Error: another request (${d.deadlineChangeWanted}) by ${d.deadlineChangeRequestedBy} is already pending on this step.`;
        return null;
      }
      if (!d.deadlineChangeWanted) return "Error: there is no pending deadline request on this step.";
      const assigner = String(d.assignedBy || p.map.getString("owner_email") || "").toLowerCase();
      if (p.map.getString("owner") !== auth.id && email !== assigner) return "Error: only the project owner or whoever assigned the step decides the request.";
      return null;
    }
    default: return null;
  }
}

function popisAkce(app, auth, L, name, a) {
  const cs = L !== "en";
  const { nazevUzlu } = SPOL().pojmenovani(app, auth);
  switch (name) {
    case "request_deadline_change": {
      if (a.cancel) return cs ? `Stáhnout žádost o jiný termín u kroku „${nazevUzlu(a.map_id, a.node_id)}“` : `Withdraw the deadline request on "${nazevUzlu(a.map_id, a.node_id)}"`;
      return cs ? `Požádat o jiný termín u kroku „${nazevUzlu(a.map_id, a.node_id)}“: ${SPOL().datumKratce(a.date, L)}${a.note ? ` („${SPOL().ocisti(a.note, 120)}“)` : ""} — termín se změní, až zadavatel souhlasí`
        : `Ask for a different deadline on "${nazevUzlu(a.map_id, a.node_id)}": ${SPOL().datumKratce(a.date, L)}${a.note ? ` ("${SPOL().ocisti(a.note, 120)}")` : ""} — the deadline changes once the assigner agrees`;
    }
    case "decline_deadline_request": {
      const p = SPOL().pravaMapy(app, auth, a.map_id);
      const { jsonVal } = require(`${__hooks}/helpers.js`);
      const n = p ? jsonVal(p.map, "nodes", []).find((x) => x.id === SPOL().uzelId(app, auth, p.map.id, a.node_id)) : null;
      const d = (n && n.data) || {};
      return cs ? `Zamítnout žádost o jiný termín u kroku „${nazevUzlu(a.map_id, a.node_id)}“${d.deadlineChangeWanted ? ` (${d.deadlineChangeRequestedBy || "?"} chce ${SPOL().datumKratce(d.deadlineChangeWanted, L)})` : ""}`
        : `Decline the deadline request on "${nazevUzlu(a.map_id, a.node_id)}"${d.deadlineChangeWanted ? ` (${d.deadlineChangeRequestedBy || "?"} wants ${SPOL().datumKratce(d.deadlineChangeWanted, L)})` : ""}`;
    }
    default: return "";
  }
}

module.exports = { NASTROJE, vykonej, overZapis, popisAkce };
