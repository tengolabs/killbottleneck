// Pravidla automatizace přes asistenta: schémata nástrojů (list/create/update/delete_rule, šablony, zapnutí), vykonání, kontroly před kartou a popisy karet.
// Vzniklo rozdělením chat.js po skupinách nástrojů (5. 10. 2026, bod 2 prověrky asistenta): kód přesunut DOSLOVA, chování beze změny.
// Sdílené resolvery (mapaId, uzelId, sDocasnymKlicem, …) jsou v chat-spolecne.js; chat.js skládá seznam nástrojů v PŮVODNÍM pořadí
// (PORADI_NASTROJU — pořadí schémat je součást prefixu promptu, cache musí držet) a podle `modul` u nástroje sem deleguje
// vykonej / overZapis / popisAkce. ⚠️ PocketBase JSVM: require() uvnitř funkcí (líné přístupové funkce níže).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname; // mimo PocketBase (testy v node) složka souboru
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);

const RULE_TRIGGER = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["node_status_changed", "node_unblocked", "deadline_approaching", "node_created", "file_uploaded", "schedule"] },
    status: { type: "string", enum: ["todo", "in_progress", "done"], description: "node_status_changed only" },
    when: { type: "string", enum: ["before", "overdue"], description: "deadline_approaching only" },
    days: { type: "integer", description: "deadline_approaching only, 0-365" },
    freq: { type: "string", enum: ["daily", "weekly"], description: "schedule only" },
    weekday: { type: "integer", description: "schedule weekly: 1 = Monday … 7 = Sunday" },
    hour: { type: "integer", description: "schedule: 0-23" },
  },
  required: ["type"],
  additionalProperties: false,
};
const RULE_CONDITION = {
  type: "object",
  properties: {
    field: { type: "string", enum: ["status", "owner", "deadline", "executor_kind", "parent"] },
    op: { type: "string", enum: ["eq", "ne", "empty", "not_empty", "before", "after"] },
    value: { type: "string" },
  },
  required: ["field", "op"],
  additionalProperties: false,
};
const RULE_ACTION = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["set_status", "set_owner", "set_deadline", "move_node", "create_subnodes", "notify", "run_agent", "offer_assistant"], description: "offer_assistant = notification whose link opens the AI assistant in the given package (mode) for the trigger node — nothing runs until the person clicks" },
    status: { type: "string", enum: ["todo", "in_progress", "done"] },
    target: { type: "string", description: "\"trigger_node\" (default), \"parent\" or a node id" },
    owner: { type: "string", description: "set_owner: member e-mail, or deputy_of_node_owner / position:<nodeId>" },
    date: { type: "string", description: "set_deadline: YYYY-MM-DD" },
    relative_days: { type: "integer" },
    advance: { type: "string", enum: ["daily", "weekly", "monthly"] },
    parent: { type: "string" },
    items: { type: "array", items: { $ref: "#/$defs/treeItem" } },
    to: { type: "string", description: "REQUIRED for notify and move_node. notify: node_owner (only if the node has an owner) / map_owner / an e-mail; move_node: new parent node id" },
    message: { type: "string" },
    agent_name: { type: "string" },
    mode: { type: "string", enum: ["porada", "nocni", "rozbor", "trideni", "po_schuzce", "revize", "priprava"], description: "offer_assistant only: rozbor | po_schuzce | priprava | revize | trideni | porada | nocni; `to` as in notify (default node_owner)" },
  },
  required: ["type"],
  additionalProperties: false,
};
// Pravidlo „blíží se termín“, které by nikdy nevystřelilo nebo by nikomu nepřišlo, se nezaloží —
// model by jinak slíbil připomenutí, které nepřijde (Richard 16. 9. 2026: uzel s plánem, bez termínu
// i bez vlastníka, „upozornění 16. 9. večer“). Spouštění: helpers.js runScheduledRules — hodinově od
// deadlineHour(), before = PŘESNĚ den termín − N, uzly ve stavu done se přeskakují.
// Stejná validace jako v1 POST /rules, ale PŘED kartou — jinak uživatel potvrdí pravidlo, které
// v1 zamítne (chybějící notify.to), a model zkouší další a další karty (měření 16. 9.: 6 karet za sebou).
function chybaTvaruPravidla(app, auth, a, nazev) {
  try {
    const { validateRuleInput, v1ReadableMap } = require(`${__hooks}/helpers.js`);
    const mid = SPOL().mapaId(app, auth, a.map_id);
    const r = mid ? v1ReadableMap(app, mid, auth) : null;
    if (!r) return null;
    const body = { name: a.name, trigger: a.trigger, actions: a.actions, conditions: a.conditions };
    if (a.node_id) body.node_id = SPOL().uzelId(app, auth, mid, a.node_id);
    const v = validateRuleInput(app, r.map, body, { strict: true });
    return v && v.error ? `Error: invalid rule — ${v.error}. Fix the arguments and call ${nazev || "create_rule"} again (the user has not been asked yet).` : null;
  } catch (err) { return null; }
}
function terminovaPravidlaUzly(app, auth, a) {
  const { v1ReadableMap, jsonVal } = require(`${__hooks}/helpers.js`);
  const mid = SPOL().mapaId(app, auth, a.map_id);
  const r = mid ? v1ReadableMap(app, mid, auth) : null;
  if (!r) return null;
  const nid = a.node_id ? SPOL().uzelId(app, auth, mid, a.node_id) : "";
  return jsonVal(r.map, "nodes", []).filter((n) => n && n.type === "goalNode" && (!nid || n.id === nid) && (n.data || {}).status !== "done");
}
function chybaTerminovehoPravidla(app, auth, a) {
  const t = a.trigger || {};
  if (t.type !== "deadline_approaching" || t.when === "overdue") return null;
  const uzly = terminovaPravidlaUzly(app, auth, a);
  if (!uzly) return null;
  if (a.node_id && !uzly.length) return `Error: the node "${String(a.node_id)}" is already done, so a deadline_approaching rule would never fire for it.`;
  const sTerminem = uzly.filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(String((n.data || {}).deadline || "")));
  const kde = a.node_id ? `the node "${String(a.node_id)}"` : "this map";
  if (!sTerminem.length) return `Error: ${kde} has no deadline, so a deadline_approaching rule would NEVER fire (a plan/planned_on is not a deadline). First set the deadline with update_node (deadline; the user confirms), and only after it is confirmed create the rule. Tell the user plainly.`;
  const dni = Number.isInteger(t.days) ? Math.max(0, Math.min(365, t.days)) : 1;
  const dnesStr = SPOL().ymdLocal(new Date());
  const pujde = sTerminem.filter((n) => SPOL().posunDatum(n.data.deadline, -dni) >= dnesStr);
  if (!pujde.length) return `Error: the reminder day (deadline minus ${dni} day(s)) has already passed for ${kde} — the rule would never fire. Offer a smaller number of days (0 = on the deadline day) or tell the user plainly.`;
  const komu = (a.actions || []).filter((x) => x && x.type === "notify");
  if (a.node_id && komu.some((x) => x.to === "node_owner") && !String((uzly[0].data || {}).owner || "")) {
    return `Error: the node "${String(a.node_id)}" has no owner, so notify to node_owner would reach NOBODY. Use notify.to = the user's e-mail (${auth.email()}) or map_owner, or set the owner first.`;
  }
  return null;
}
// Pro model do výsledku create_rule: kdy a komu pravidlo skutečně pošle upozornění — ať nic nedomýšlí.
function kdyVystreli(app, auth, a) {
  try {
    const { deadlineHour } = require(`${__hooks}/helpers.js`);
    const t = a.trigger || {};
    if (t.type !== "deadline_approaching") return "";
    const hod = deadlineHour();
    if (t.when === "overdue") return ` It is checked every hour from ${hod}:00 local time and fires once per deadline when a node is at least ${Number.isInteger(t.days) ? Math.max(1, t.days) : 1} day(s) overdue.`;
    const dni = Number.isInteger(t.days) ? Math.max(0, Math.min(365, t.days)) : 1;
    const dnes = SPOL().ymdLocal(new Date());
    const kdy = (terminovaPravidlaUzly(app, auth, a) || []).filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(String((n.data || {}).deadline || "")))
      .map((n) => ({ t: (n.data || {}).title || "?", d: SPOL().posunDatum(n.data.deadline, -dni) })).filter((x) => x.d >= dnes).slice(0, 3)
      .map((x) => `"${x.t}" on ${x.d}${x.d === dnes ? " (today — within the next hour if it is already past " + hod + ":00)" : " from " + hod + ":00 local time"}`);
    const komu = (a.actions || []).filter((x) => x && x.type === "notify").map((x) => x.to).join(", ");
    return kdy.length ? ` Exact timing: the notification${komu ? " (to " + komu + ")" : ""} arrives for ${kdy.join("; ")}. Tell the user only this, nothing more precise.` : "";
  } catch (err) { return ""; }
}

const NASTROJE = [
  { name: "list_rules", skupina: "pravidla", kind: "read", description: "Automation rules of a map (the user must be an editor of the map).",
    parameters: { type: "object", properties: { map_id: { type: "string" } }, required: ["map_id"], additionalProperties: false } },
  { name: "list_rule_templates", skupina: "pravidla", kind: "read", description: "Rule templates of the instance (reusable rule shapes).",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "update_rule", skupina: "pravidla", kind: "write", description: "Change an automation rule of a map: pass the FULL new shape (name, trigger, actions, optional conditions and node_id) — fields are not merged; to only switch it on/off use set_rule_enabled. rule_id = the id from list_rules or the exact rule name. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, rule_id: { type: "string" }, name: { type: "string" }, node_id: { type: "string", description: "the exact node title (omit = whole map)" }, trigger: RULE_TRIGGER, conditions: { type: "array", items: RULE_CONDITION }, actions: { type: "array", items: RULE_ACTION } }, required: ["map_id", "rule_id", "name", "trigger", "actions"], additionalProperties: false, $defs: { treeItem: SPOL().TREE_ITEM } } },
  { name: "delete_rule", skupina: "pravidla", kind: "write", description: "Delete an automation rule of a map for good. rule_id = the id from list_rules or the exact rule name. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, rule_id: { type: "string" } }, required: ["map_id", "rule_id"], additionalProperties: false } },
  { name: "save_rule_template", skupina: "pravidla", kind: "write", description: "Save a rule shape as an instance-wide template in the template library (name unique; template_id = change an existing template, author or administrator only). Templates have no map and no node scope. The user confirms first.",
    parameters: { type: "object", properties: { template_id: { type: "string" }, name: { type: "string" }, trigger: RULE_TRIGGER, conditions: { type: "array", items: RULE_CONDITION }, actions: { type: "array", items: RULE_ACTION } }, required: ["name", "trigger", "actions"], additionalProperties: false, $defs: { treeItem: SPOL().TREE_ITEM } } },
  { name: "delete_rule_template", skupina: "pravidla", kind: "write", description: "Delete a rule template from the library (author or administrator). template_id = the id from list_rule_templates or the exact name. The user confirms first.",
    parameters: { type: "object", properties: { template_id: { type: "string" } }, required: ["template_id"], additionalProperties: false } },
  { name: "create_rule", skupina: "pravidla", kind: "write", description: "Create an automation rule in a map (trigger → actions, optional conditions, optional node_id scope). The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string", description: "the exact map title" }, name: { type: "string" }, node_id: { type: "string", description: "the exact node title (omit = whole map)" }, trigger: RULE_TRIGGER, conditions: { type: "array", items: RULE_CONDITION }, actions: { type: "array", items: RULE_ACTION } }, required: ["map_id", "name", "trigger", "actions"], additionalProperties: false, $defs: { treeItem: SPOL().TREE_ITEM } } },
  { name: "set_rule_enabled", skupina: "pravidla", kind: "write", description: "Enable or disable a rule of a map. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, rule_id: { type: "string" }, enabled: { type: "boolean" } }, required: ["map_id", "rule_id", "enabled"], additionalProperties: false } },
];

function vykonej(app, auth, L, name, args, ktx) {
  const H = require(`${__hooks}/helpers.js`);
  const M = require(`${__hooks}/mcp-tools.js`);
  const a = args || {};
  switch (name) {
    case "list_rules": {
      const R = require(`${__hooks}/rules-api.js`);
      let map;
      try { map = app.findRecordById("goalmaps", SPOL().mapaId(app, auth, a.map_id) || "-"); } catch (err) { return { text: "Error: map not found (use list_maps; pass the id or the exact title)." }; }
      if (!H.mapEditAccess(app, map, auth)) return { text: "Error: rules are visible only to editors of the map." };
      const r = R.listRules(app, map);
      const rules = (r.body && r.body.rules) || [];
      return { text: rules.length ? rules.map(M.renderRule).join("\n") : "No rules in this map." };
    }
    case "list_rule_templates": {
      const R = require(`${__hooks}/rules-api.js`);
      const r = R.listRuleTemplates(app);
      const tpl = (r.body && r.body.templates) || [];
      return { text: tpl.length ? tpl.map((x) => `• ${x.name} (id: ${x.id}, when ${(x.trigger || {}).type}, do ${(x.actions || []).map((y) => y.type).join("+")})`).join("\n") : "No rule templates." };
    }
    case "update_rule": case "delete_rule": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      const rid = SPOL().pravidloId(app, mid, a.rule_id);
      if (!mid || !rid) return { text: "Error: map or rule not found." };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        if (name === "delete_rule") {
          const r = v1("POST", `/v1/maps/${encodeURIComponent(mid)}/rules/${encodeURIComponent(rid)}/delete`, {});
          if (r.status !== 200) return { text: SPOL().chybaV1(r) };
          return { text: `Rule deleted from "${SPOL().titulMapy(app, auth, a.map_id)}".` };
        }
        const body = { name: a.name, trigger: a.trigger, actions: a.actions, conditions: a.conditions || [] };
        body.node_id = a.node_id ? SPOL().uzelId(app, auth, mid, a.node_id) : "";
        const r = v1("POST", `/v1/maps/${encodeURIComponent(mid)}/rules/${encodeURIComponent(rid)}`, body);
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        return { text: `Rule updated: ${M.renderRule(r.json.rule || {})}${kdyVystreli(app, auth, a)}`, karta: { type: "vysledek", map_id: mid, map_title: "" } };
      });
    }
    case "save_rule_template": case "delete_rule_template": {
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        if (name === "delete_rule_template") {
          const t = SPOL().sablonaDto(app, a.template_id);
          if (!t) return { text: "Error: template not found." };
          const r = v1("POST", `/v1/rule-templates/${encodeURIComponent(t.id)}/delete`, {});
          if (r.status !== 200) return { text: SPOL().chybaV1(r) };
          return { text: `Template "${t.name}" deleted.` };
        }
        const body = { name: String(a.name).trim(), trigger: a.trigger, actions: a.actions, conditions: a.conditions || [] };
        if (a.template_id) { const t = SPOL().sablonaDto(app, a.template_id); if (!t) return { text: "Error: template not found." }; body.id = t.id; }
        const r = v1("POST", "/v1/rule-templates", body);
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        return { text: `Template saved: ${M.renderRule(Object.assign({ enabled: true }, r.json.template || {}))}` };
      });
    }
    case "create_rule": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      if (!mid) return { text: `Error: map "${String(a.map_id || "")}" not found or not accessible (use list_maps; pass the id or the exact title).` };
      const nid = a.node_id ? SPOL().uzelId(app, auth, mid, a.node_id) : "";
      if (a.node_id && !nid) return { text: `Error: node "${String(a.node_id)}" not found in the map (use get_map; pass the node id or its exact title).` };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const body = { name: a.name, trigger: a.trigger, actions: a.actions };
        if (nid) body.node_id = nid;
        if (a.conditions) body.conditions = a.conditions;
        const r = v1("POST", `/v1/maps/${encodeURIComponent(mid)}/rules`, body);
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        return { text: `Rule created: ${M.renderRule(r.json.rule || {})}${kdyVystreli(app, auth, a)}`, karta: { type: "vysledek", map_id: mid, map_title: "" } };
      });
    }
    case "set_rule_enabled": {
      const midE = SPOL().mapaId(app, auth, a.map_id);
      const ridE = SPOL().pravidloId(app, midE, a.rule_id);
      if (!midE || !ridE) return { text: "Error: map or rule not found." };
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const r = v1("POST", `/v1/maps/${encodeURIComponent(midE)}/rules/${encodeURIComponent(ridE)}`, { enabled: !!a.enabled });
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        return { text: `Rule ${a.enabled ? "enabled" : "disabled"}: ${M.renderRule(r.json.rule || {})}` };
      });
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

function overZapis(app, auth, name, a) {
  const { chybaMapy, chybaUzlu } = SPOL().kontrolyZapisu(app, auth);
  switch (name) {
    case "create_rule": return chybaMapy(a.map_id) || chybaUzlu(a.map_id, a.node_id) || chybaTvaruPravidla(app, auth, a) || chybaTerminovehoPravidla(app, auth, a);
    case "update_rule": case "delete_rule": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      const rid = SPOL().pravidloId(app, mid, a.rule_id);
      if (!rid) return `Error: rule "${String(a.rule_id || "")}" not found in "${SPOL().titulMapy(app, auth, a.map_id)}" (use list_rules; pass the id or the exact name).`;
      if (name === "delete_rule") return null;
      return chybaUzlu(a.map_id, a.node_id) || chybaTvaruPravidla(app, auth, a, "update_rule") || chybaTerminovehoPravidla(app, auth, a);
    }
    case "save_rule_template": {
      const H = require(`${__hooks}/helpers.js`);
      if (a.template_id && !SPOL().sablonaDto(app, a.template_id)) return `Error: template "${String(a.template_id)}" not found (list_rule_templates).`;
      const t = String(a.name || "").trim();
      if (!t || t.length > 120) return "Error: name is required (max 120 characters).";
      if (!a.template_id && SPOL().sablonaDto(app, t) && SPOL().sablonaDto(app, t).name === t) return `Error: a template named "${t}" already exists — pass its template_id to change it.`;
      try {
        const v = H.validateRuleInput(app, null, { name: t, trigger: a.trigger, actions: a.actions, conditions: a.conditions }, { strict: true, template: true });
        if (v && v.error) return `Error: invalid template — ${v.error}.`;
      } catch (err) { /* validace šablony bez mapy není dostupná — zkontroluje routa v1 */ }
      return null;
    }
    case "delete_rule_template": return SPOL().sablonaDto(app, a.template_id) ? null : `Error: template "${String(a.template_id || "")}" not found (list_rule_templates; pass the id or the exact name).`;
    case "set_rule_enabled": return chybaMapy(a.map_id) || (SPOL().pravidloId(app, SPOL().mapaId(app, auth, a.map_id), a.rule_id) ? null : `Error: rule "${String(a.rule_id || "")}" not found in "${SPOL().titulMapy(app, auth, a.map_id)}" (use list_rules; pass the id or the exact name).`);
    default: return null;
  }
}

function popisAkce(app, auth, L, name, a) {
  const cs = L !== "en";
  const { nazevMapy } = SPOL().pojmenovani(app, auth);
  switch (name) {
    case "create_rule": return cs
      ? `Vytvořit pravidlo „${a.name}“ v projektu „${nazevMapy(a.map_id)}“ (${(a.trigger || {}).type} → ${(a.actions || []).map((x) => x.type).join(", ")})`
      : `Create the rule "${a.name}" in "${nazevMapy(a.map_id)}" (${(a.trigger || {}).type} → ${(a.actions || []).map((x) => x.type).join(", ")})`;
    case "set_rule_enabled": {
      // název pravidla na kartě (podle id i názvu) — dřív karta říkala jen „Vypnout pravidlo v projektu“ (panel 4. 10. 2026)
      const R = require(`${__hooks}/rules-api.js`);
      let nazev = String(a.rule_id || "");
      try { const mid = SPOL().mapaId(app, auth, a.map_id); const rules = ((R.listRules(app, app.findRecordById("goalmaps", mid)) || {}).body || {}).rules || []; const r = rules.find((x) => x.id === SPOL().pravidloId(app, mid, a.rule_id)); if (r) nazev = r.name; } catch (err) { /* název = odkaz modelu */ }
      return cs
        ? `${a.enabled ? "Zapnout" : "Vypnout"} pravidlo „${SPOL().ocisti(nazev, 120)}“ v projektu „${nazevMapy(a.map_id)}“`
        : `${a.enabled ? "Enable" : "Disable"} the rule "${SPOL().ocisti(nazev, 120)}" in "${nazevMapy(a.map_id)}"`;
    }
    case "update_rule": return cs
      ? `Změnit pravidlo „${a.name}“ v projektu „${nazevMapy(a.map_id)}“ (${(a.trigger || {}).type} → ${(a.actions || []).map((x) => x.type).join(", ")})`
      : `Change the rule "${a.name}" in "${nazevMapy(a.map_id)}" (${(a.trigger || {}).type} → ${(a.actions || []).map((x) => x.type).join(", ")})`;
    case "delete_rule": {
      const R = require(`${__hooks}/rules-api.js`);
      let nazev = String(a.rule_id || "");
      try { const rules = ((R.listRules(app, app.findRecordById("goalmaps", SPOL().mapaId(app, auth, a.map_id))) || {}).body || {}).rules || []; const r = rules.find((x) => x.id === SPOL().pravidloId(app, SPOL().mapaId(app, auth, a.map_id), a.rule_id)); if (r) nazev = r.name; } catch (err) { /* název zůstane z argumentu */ }
      return cs ? `Smazat pravidlo „${SPOL().ocisti(nazev, 120)}“ z projektu „${nazevMapy(a.map_id)}“ — nejde vrátit` : `Delete the rule "${SPOL().ocisti(nazev, 120)}" from "${nazevMapy(a.map_id)}" — cannot be undone`;
    }
    case "save_rule_template": return cs
      ? `${a.template_id ? "Změnit" : "Uložit"} šablonu pravidla „${SPOL().ocisti(a.name, 120)}“ (${(a.trigger || {}).type} → ${(a.actions || []).map((x) => x.type).join(", ")})`
      : `${a.template_id ? "Change" : "Save"} the rule template "${SPOL().ocisti(a.name, 120)}" (${(a.trigger || {}).type} → ${(a.actions || []).map((x) => x.type).join(", ")})`;
    case "delete_rule_template": {
      const t = SPOL().sablonaDto(app, a.template_id);
      return cs ? `Smazat šablonu pravidla „${SPOL().ocisti(t ? t.name : a.template_id, 120)}“ z knihovny` : `Delete the rule template "${SPOL().ocisti(t ? t.name : a.template_id, 120)}" from the library`;
    }
    default: return "";
  }
}

module.exports = { NASTROJE, vykonej, overZapis, popisAkce, RULE_TRIGGER, RULE_CONDITION, RULE_ACTION, chybaTvaruPravidla, terminovaPravidlaUzly, chybaTerminovehoPravidla, kdyVystreli };
