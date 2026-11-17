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
    value: { type: "string", description: "parent: the exact title of the parent step (also a step added in this same reply)" },
  },
  required: ["field", "op"],
  additionalProperties: false,
};
const RULE_ACTION = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["set_status", "set_owner", "set_deadline", "move_node", "create_subnodes", "notify", "run_agent", "offer_assistant", "reset_subtree"], description: "reset_subtree = sub-goals and tasks of the trigger node back to todo (checklist of a recurring step starts over). offer_assistant = notification whose link opens the AI assistant in the given package (mode) for the trigger node — nothing runs until the person clicks" },
    status: { type: "string", enum: ["todo", "in_progress", "done"] },
    target: { type: "string", description: "\"trigger_node\" (default), \"parent\" or the exact title of a step" },
    owner: { type: "string", description: "set_owner: member e-mail, or deputy_of_node_owner / position:<nodeId>" },
    date: { type: "string", description: "set_deadline: YYYY-MM-DD" },
    relative_days: { type: "integer" },
    advance: { type: "string", enum: ["daily", "weekly", "monthly"] },
    every: { type: "integer", description: "set_deadline with advance only: every N-th day/week/month (1-4, default 1)" },
    days: { type: "array", items: { type: "integer" }, description: "set_deadline with advance weekly only: weekdays 1 = Monday … 7 = Sunday (e.g. [2,4] = Tuesday and Thursday); default = the weekday of the current deadline" },
    parent: { type: "string", description: "create_subnodes: \"trigger_node\" (default) or the exact title of a step" },
    items: { type: "array", items: { $ref: "#/$defs/treeItem" } },
    to: { type: "string", description: "REQUIRED for notify and move_node. notify: node_owner (only if the node has an owner) / map_owner / an e-mail; move_node: the exact title of the new parent step (also a step added in this same reply)" },
    message: { type: "string" },
    agent_name: { type: "string" },
    mode: { type: "string", enum: ["porada", "nocni", "rozbor", "trideni", "po_schuzce", "revize", "priprava"], description: "offer_assistant only: rozbor | po_schuzce | priprava | revize | trideni | porada | nocni; `to` as in notify (default node_owner)" },
  },
  required: ["type"],
  additionalProperties: false,
};
// Step references in a rule (condition parent, move_node.to, create_subnodes.parent, action target) may be ids or
// exact step titles — the model is never shown node ids (chat-spolecne bezId), and a stage board ("done → next
// column", Richard 16. 11. 2026) took three attempts because the columns only got ids after a confirmation.
// `planned` = titles of steps proposed earlier in the same reply (add_nodes still waiting for the user): for the
// check before the card they stand in as the apex, at execution (after the earlier cards ran) they resolve for real.
function withNodeIds(app, auth, a, planned) {
  const mid = SPOL().mapaId(app, auth, a && a.map_id);
  if (!mid || !a) return a;
  const klic = SPOL().klicKroku;
  const plannedKeys = (planned || []).map(klic).filter(Boolean);
  let apex = null;
  const apexId = () => {
    if (apex === null) {
      const { v1ReadableMap, jsonVal } = require(`${__hooks}/helpers.js`);
      const r = v1ReadableMap(app, mid, auth);
      apex = r ? ((jsonVal(r.map, "nodes", []).find((n) => n && n.type === "apexNode") || {}).id || "") : "";
    }
    return apex;
  };
  const ref = (v) => {
    const s = String(v === undefined || v === null ? "" : v).trim();
    if (!s) return v;
    if (plannedKeys.includes(klic(s))) return apexId() || v; // checked as a placeholder, resolved at execution
    return SPOL().uzelId(app, auth, mid, s) || v; // unknown stays as it is — validation tells the model
  };
  const out = Object.assign({}, a);
  if (Array.isArray(a.conditions)) out.conditions = a.conditions.map((c) => (c && c.field === "parent" ? Object.assign({}, c, { value: ref(c.value) }) : c));
  if (Array.isArray(a.actions)) {
    out.actions = a.actions.map((x) => {
      if (!x || typeof x !== "object") return x;
      const b = Object.assign({}, x);
      if (b.type === "move_node" && b.to) b.to = ref(b.to);
      if (b.type === "create_subnodes" && b.parent && b.parent !== "trigger_node") b.parent = ref(b.parent);
      if (b.target && b.target !== "trigger_node" && b.target !== "parent") b.target = ref(b.target);
      return b;
    });
  }
  return out;
}
// Same rule twice: the assistant does not always look at the rules a map already has and offered the stage
// rules of an existing board again (Richard 16. 11. 2026, three duplicate cards). Compared after the v1
// normalisation (validateRuleInput), so ids vs titles and key order do not matter; planned steps cannot match.
function stabilni(v) {
  if (Array.isArray(v)) return "[" + v.map(stabilni).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined && v[k] !== null && v[k] !== "").map((k) => JSON.stringify(k) + ":" + stabilni(v[k])).join(",") + "}";
  return JSON.stringify(v === undefined ? null : v);
}
function chybaDuplicity(app, auth, a) {
  try {
    const { validateRuleInput, v1ReadableMap } = require(`${__hooks}/helpers.js`);
    const mid = SPOL().mapaId(app, auth, a.map_id);
    const r = mid ? v1ReadableMap(app, mid, auth) : null;
    if (!r) return null;
    // normalised like v1 does it; on a deep copy — validateRuleInput rewrites create_subnodes owners in place
    const normalizuj = (args) => {
      const x = JSON.parse(JSON.stringify(withNodeIds(app, auth, args, [])));
      const body = { name: String(args.name || "").trim() || "rule", trigger: x.trigger, actions: x.actions, conditions: x.conditions };
      if (args.node_id) body.node_id = SPOL().uzelId(app, auth, mid, args.node_id);
      const v = validateRuleInput(app, r.map, body, { strict: true, userId: auth.id });
      return v && !v.error && v.data ? v.data : null;
    };
    const klic = (d) => stabilni({ node_id: d.node_id || "", trigger: d.trigger || {}, conditions: d.conditions || [], actions: d.actions || [] });
    // the same rule already proposed on a card that still waits (this reply or an earlier one): "Do all" would create
    // both. Compared by the arguments as written — they may point at steps that exist only after "Do all", so the v1
    // normalisation (ids) cannot be used; step references compare by title without a leading emoji
    const kk = SPOL().klicKroku;
    const doslovne = (x) => stabilni({
      node_id: x.node_id ? kk(x.node_id) : "", trigger: x.trigger || {},
      conditions: (Array.isArray(x.conditions) ? x.conditions : []).map((c) => (c && c.field === "parent" ? Object.assign({}, c, { value: kk(c.value) }) : c)),
      actions: (Array.isArray(x.actions) ? x.actions : []).map((y) => (y && typeof y === "object" ? Object.assign({}, y, y.to ? { to: kk(y.to) } : {}, y.parent && y.parent !== "trigger_node" ? { parent: kk(y.parent) } : {}, y.target && y.target !== "trigger_node" && y.target !== "parent" ? { target: kk(y.target) } : {}) : y)),
    });
    const tento = doslovne(a);
    for (const p of (a.__pendingRules || [])) {
      if (p && SPOL().mapaId(app, auth, p.map_id) === mid && doslovne(p) === tento) return `Error: the same rule is already proposed on a card above ("${SPOL().ocisti(p.name, 120)}") — do not propose it twice.`;
    }
    const nove = normalizuj(a);
    if (!nove) return null;
    const novy = klic(nove);
    const R = require(`${__hooks}/rules-api.js`);
    const shoda = (((R.listRules(app, r.map) || {}).body || {}).rules || []).find((p) => klic(p) === novy);
    if (!shoda) return null;
    const jmeno = SPOL().ocisti(shoda.name, 120);
    return shoda.enabled
      ? `Error: this rule already exists in the map as "${jmeno}" and is switched on — nothing to create. Do not offer it again; tell the user it already works.`
      : `Error: the same rule already exists in the map as "${jmeno}" but is switched off — offer set_rule_enabled instead of a new rule.`;
  } catch (err) { return null; }
}

// Plain-language summary of a rule on the confirmation card. The card used to end with
// "(node_status_changed → set_status, move_node)" — Richard 16. 11. 2026: "mám to odkliknout a nevím co to udělá".
const STAV_NAZEV = { cs: { todo: "Založeno", in_progress: "Probíhá", done: "Hotovo" }, en: { todo: "To do", in_progress: "In progress", done: "Done" } };
const DNY_CS = ["", "každé pondělí", "každé úterý", "každou středu", "každý čtvrtek", "každý pátek", "každou sobotu", "každou neděli"];
const DNY_EN = ["", "every Monday", "every Tuesday", "every Wednesday", "every Thursday", "every Friday", "every Saturday", "every Sunday"];
function vetaPravidla(app, auth, a, cs) {
  const { nazevUzlu } = SPOL().pojmenovani(app, auth);
  const q = (s) => (cs ? `„${s}“` : `"${s}"`);
  const krok = (ref) => {
    const s = String(ref === undefined || ref === null ? "" : ref).trim();
    if (!s) return "";
    let t = "";
    // a step proposed in this reply: its own title — a lookup could hit a similar existing step by a partial match
    if ((a.__planned || []).some((x) => SPOL().klicKroku(x) === SPOL().klicKroku(s))) return SPOL().ocisti(s, 60);
    if (a.map_id) { try { t = nazevUzlu(a.map_id, s); } catch (err) { t = ""; } }
    return SPOL().ocisti(t && t.charAt(0) !== "?" ? t : s, 60);
  };
  const st = (s) => (cs ? STAV_NAZEV.cs : STAV_NAZEV.en)[s] || String(s || "");
  const t = a.trigger || {};
  const conds = Array.isArray(a.conditions) ? a.conditions.filter(Boolean) : [];
  const pod = conds.filter((c) => c.field === "parent" && c.op === "eq" && c.value).map((c) => krok(c.value))[0] || "";
  const dalsi = conds.filter((c) => !(c.field === "parent" && c.op === "eq")).length;
  // "u kroku …" (where) and "krok …" (subject)
  const u = a.node_id ? (cs ? `u kroku ${q(krok(a.node_id))}` : `on the step ${q(krok(a.node_id))}`)
    : pod ? (cs ? `u kroku pod ${q(pod)}` : `on a step under ${q(pod)}`) : (cs ? "u kteréhokoli kroku" : "on any step");
  const co = a.node_id ? (cs ? `krok ${q(krok(a.node_id))}` : `the step ${q(krok(a.node_id))}`)
    : pod ? (cs ? `krok pod ${q(pod)}` : `a step under ${q(pod)}`) : (cs ? "kterýkoli krok" : "any step");
  const hod = Number.isInteger(t.hour) ? `${t.hour}:00` : "";
  let kdy;
  switch (t.type) {
    case "node_status_changed": kdy = cs ? `Když ${u} dáte ${st(t.status)}` : `When you set ${st(t.status)} ${u}`; break;
    case "node_unblocked": kdy = cs ? `Když se ${co} uvolní (to, na co čekal, je hotové)` : `When ${co} is unblocked (what it waited for is done)`; break;
    case "deadline_approaching": kdy = t.when === "overdue"
      ? (cs ? `Když je ${co} ${t.days || 1} d po termínu` : `When ${co} is ${t.days || 1} d overdue`)
      : (!t.days ? (cs ? `V den termínu (${co})` : `On the deadline day (${co})`) : (cs ? `${t.days} d před termínem (${co})` : `${t.days} d before the deadline (${co})`)); break;
    case "node_created": kdy = cs ? `Když přibude nový krok${pod ? ` pod ${q(pod)}` : ""}` : `When a new step is added${pod ? ` under ${q(pod)}` : ""}`; break;
    case "file_uploaded": kdy = cs ? `Když se ${u} nahraje soubor` : `When a file is uploaded ${u}`; break;
    case "schedule": kdy = t.freq === "weekly"
      ? (cs ? `${(DNY_CS[t.weekday] || "každý týden").replace(/^./, (c) => c.toUpperCase())}${hod ? ` v ${hod}` : ""}` : `${(DNY_EN[t.weekday] || "every week").replace(/^./, (c) => c.toUpperCase())}${hod ? ` at ${hod}` : ""}`)
      : (cs ? `Každý den${hod ? ` v ${hod}` : ""}` : `Every day${hod ? ` at ${hod}` : ""}`); break;
    default: kdy = cs ? "Když nastane zvolená událost" : "When the chosen event happens";
  }
  if (dalsi) kdy += cs ? " (a platí další podmínky)" : " (and further conditions hold)";
  const cil = (x) => {
    const tg = x.target;
    if (!tg || tg === "trigger_node") return null;
    if (tg === "parent") return cs ? "nadřazený krok" : "the parent step";
    return q(krok(tg));
  };
  const komu = (to) => {
    const s = String(to || "");
    if (s === "node_owner") return cs ? "řešiteli kroku" : "the step owner";
    if (s === "map_owner") return cs ? "vlastníkovi projektu" : "the project owner";
    if (s === "deputy_of_node_owner") return cs ? "zástupci řešitele" : "the owner's deputy";
    if (/^deputy_of_position:/.test(s)) return cs ? "zástupci na pozici" : "the deputy of a position";
    if (/^position:/.test(s)) return cs ? "držiteli pozice" : "the holder of a position";
    return SPOL().ocisti(s, 80);
  };
  // nominative for "dostane řešitele: …" (komu() is the dative of "upozornění komu")
  const kdo = (to) => {
    const s = String(to || "");
    if (s === "node_owner") return "řešitel kroku";
    if (s === "map_owner") return "vlastník projektu";
    if (s === "deputy_of_node_owner") return "zástupce řešitele";
    if (/^deputy_of_position:/.test(s)) return "zástupce na pozici";
    if (/^position:/.test(s)) return "držitel pozice";
    return SPOL().ocisti(s, 80);
  };
  const akce = (Array.isArray(a.actions) ? a.actions.filter(Boolean) : []).slice()
    .sort((x, y) => (x.type === "move_node" ? 0 : 1) - (y.type === "move_node" ? 0 : 1))
    .map((x) => {
      const c = cil(x);
      switch (x.type) {
        case "move_node": return cs ? `přesune se pod ${q(krok(x.to))}` : `it moves under ${q(krok(x.to))}`;
        case "set_status": return c ? (cs ? `${c} dostane ${st(x.status)}` : `${c} gets ${st(x.status)}`)
          : (cs ? (x.status === "todo" ? `vrátí se na ${st(x.status)}` : `přepne se na ${st(x.status)}`) : `it is set to ${st(x.status)}`);
        case "set_owner": return cs ? `${c || "krok"} dostane řešitele: ${kdo(x.owner)}` : `${c || "the step"} gets the owner ${komu(x.owner)}`;
        case "set_deadline": return cs ? `${c ? c + ": " : ""}posune se termín` : `${c ? c + ": " : ""}the deadline moves`;
        case "create_subnodes": return cs ? `přibudou podkroky (${(x.items || []).length})` : `sub-steps are added (${(x.items || []).length})`;
        case "notify": return cs ? `přijde upozornění ${komu(x.to)}` : `${komu(x.to)} gets a notification`;
        case "run_agent": return cs ? `spustí se agent ${q(SPOL().ocisti(x.agent_name, 60))}` : `the agent ${q(SPOL().ocisti(x.agent_name, 60))} runs`;
        case "offer_assistant": return cs ? `přijde nabídka asistenta ${komu(x.to || "node_owner")}` : `${komu(x.to || "node_owner")} gets an assistant offer`;
        case "reset_subtree": return cs ? `jeho podkroky se vrátí na ${st("todo")}` : `its sub-steps go back to ${st("todo")}`;
        default: return "";
      }
    }).filter(Boolean);
  if (!akce.length) return `${kdy}.`;
  const spoj = akce.length === 1 ? akce[0] : akce.slice(0, -1).join(", ") + (cs ? " a " : " and ") + akce[akce.length - 1];
  return `${kdy}, ${spoj}.`;
}

const isPlanned = (a, ref) => !!ref && (a.__planned || []).some((t) => SPOL().klicKroku(t) === SPOL().klicKroku(ref));
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
    // the same view of people as the v1 route that will store it (rules-api.js saveRule)
    let prevActions = null;
    if (a.rule_id) {
      try { prevActions = JSON.parse(app.findRecordById("automation_rules", SPOL().pravidloId(app, mid, a.rule_id)).getString("actions") || "[]"); } catch (err) { prevActions = null; }
    }
    const v = validateRuleInput(app, r.map, body, { strict: true, userId: auth.id, prevActions: prevActions });
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
  { name: "create_rule", skupina: "pravidla", kind: "write", description: "Create an automation rule in a map (trigger → actions, optional conditions, optional node_id scope). Steps are referenced by their exact titles, also steps you add with add_nodes in this same reply — then propose add_nodes, move_node and the rules together, the user confirms them at once. Stages a step travels through (columns such as Lead → Offer → Deal, \"when I mark it done it jumps to the next one\"): one rule per stage that has a next stage — trigger node_status_changed done, condition parent eq <stage title>, actions set_status todo + move_node to <next stage title>; the last stage and any stage the user excluded get no rule; steps already in the map that should travel through the stages are moved into a stage with move_node in the same reply (the first stage unless the user said otherwise). The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string", description: "the exact map title" }, name: { type: "string" }, node_id: { type: "string", description: "the exact node title (omit = whole map)" }, trigger: RULE_TRIGGER, conditions: { type: "array", items: RULE_CONDITION }, actions: { type: "array", items: RULE_ACTION } }, required: ["map_id", "name", "trigger", "actions"], additionalProperties: false, $defs: { treeItem: SPOL().TREE_ITEM } } },
  { name: "set_rule_enabled", skupina: "pravidla", kind: "write", description: "Enable or disable a rule of a map. The user confirms first.",
    parameters: { type: "object", properties: { map_id: { type: "string" }, rule_id: { type: "string" }, enabled: { type: "boolean" } }, required: ["map_id", "rule_id", "enabled"], additionalProperties: false } },
  { name: "set_step_rhythm", skupina: "pravidla", kind: "write", description: "Make a step repeat, change its rhythm or stop it repeating — the same as the Recurrence switch in the step's window. A ticked-off step returns to To do and its deadline moves to the next occurrence (in a process map its sub-steps start over too); a step without a deadline gets its first occurrence. Use this, never create_rule, whenever a step should repeat (\"every Monday\", \"every weekday\", \"monthly on the 5th\"). One call per step; several steps = several calls side by side. The user confirms first.",
    parameters: { type: "object", properties: {
      map_id: { type: "string", description: "the exact map title" },
      node_id: { type: "string", description: "the exact step title" },
      freq: { type: "string", enum: ["none", "daily", "weekly", "monthly"], description: "none = stop repeating" },
      every: { type: "integer", description: "every N-th day/week/month, 1-4 (default 1)" },
      days: { type: "array", items: { type: "integer" }, description: "weekly only: weekdays 1 = Monday … 7 = Sunday; every weekday = [1,2,3,4,5]; default = the weekday of the deadline" },
      month_day: { type: "integer", description: "monthly only: day of the month 1-31 (moves the deadline to the nearest such day)" },
    }, required: ["map_id", "node_id", "freq"], additionalProperties: false } },
];

// Rytmus kroku přes asistenta (styl Proces, 25. 10. 2026): totéž co přepínač Opakování v okně kroku
// (RecurrenceSwitch.jsx) — čisté opakovací pravidlo jako buildRecurrenceRule (lib/recurrenceRule.js)
// a první výskyt jako firstOccurrence/terminProDen (lib/rhythm.js). Model z obecného create_rule tvar
// neposkládal (lokální model 25. 10.: schedule → set_deadline denně místo „každý všední den“).
const RYTMUS_TEXT = {
  cs: { daily: "každý den", dailyN: "každý {n}. den", workdays: "každý všední den", weekly: "každý týden", weeklyN: "každý {n}. týden", monthlyDay: "každý měsíc {d}.", monthlyNDay: "každý {n}. měsíc {d}.",
    each: { 1: "každé pondělí", 2: "každé úterý", 3: "každou středu", 4: "každý čtvrtek", 5: "každý pátek", 6: "každou sobotu", 7: "každou neděli" }, dow: { 1: "Po", 2: "Út", 3: "St", 4: "Čt", 5: "Pá", 6: "So", 7: "Ne" } },
  en: { daily: "every day", dailyN: "every {n} days", workdays: "every weekday", weekly: "every week", weeklyN: "every {n} weeks", monthlyDay: "every month on day {d}", monthlyNDay: "every {n} months on day {d}",
    each: { 1: "every Monday", 2: "every Tuesday", 3: "every Wednesday", 4: "every Thursday", 5: "every Friday", 6: "every Saturday", 7: "every Sunday" }, dow: { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" } },
};
const RYTMUS_PRAVIDLO = { cs: { daily: "Opakování (denně): ", weekly: "Opakování (týdně): ", monthly: "Opakování (měsíčně): " }, en: { daily: "Recurrence (daily): ", weekly: "Recurrence (weekly): ", monthly: "Recurrence (monthly): " } };
const DEN_MS = 86400000;
// „dnes“ serverového rytmu (helpers.js dnesRytmu) = den v pásmu instance (TZ kontejneru), ne UTC (/checkup 29. 10.)
const dnesUtc = () => { const n = new Date(); return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0") + "-" + String(n.getDate()).padStart(2, "0"); };
const plusDny = (s, k) => new Date(Date.parse(s + "T00:00:00Z") + k * DEN_MS).toISOString().slice(0, 10);
const denTydne = (s) => { const x = new Date(s + "T00:00:00Z").getUTCDay(); return x === 0 ? 7 : x; };
const jeDatum = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

function rytmusText(r, termin, L) {
  const T = RYTMUS_TEXT[L === "en" ? "en" : "cs"];
  const n = r.every > 1 ? r.every : 1;
  if (r.freq === "daily") return n === 1 ? T.daily : T.dailyN.replace("{n}", n);
  if (r.freq === "weekly") {
    const ds = (r.days && r.days.length ? r.days : (jeDatum(termin) ? [denTydne(termin)] : [])).slice().sort();
    if (n === 1 && ds.join() === "1,2,3,4,5") return T.workdays;
    if (n === 1 && ds.length === 7) return T.daily;
    if (n === 1 && ds.length === 1) return T.each[ds[0]];
    const hlava = n === 1 ? T.weekly : T.weeklyN.replace("{n}", n);
    return ds.length ? `${hlava}: ${ds.map((d) => T.dow[d]).join(", ")}` : hlava;
  }
  const md = Number.isInteger(r.day) ? r.day : (jeDatum(termin) ? Number(termin.slice(8, 10)) : 1);
  return n === 1 ? T.monthlyDay.replace("{d}", md) : T.monthlyNDay.replace("{n}", n).replace("{d}", md);
}

// argumenty → { rytmus, md } nebo { chyba }
function rytmusZArgumentu(a, termin) {
  const freq = String(a.freq || "");
  if (["daily", "weekly", "monthly"].indexOf(freq) < 0) return { chyba: "Error: freq must be none, daily, weekly or monthly." };
  const every = a.every === undefined || a.every === null ? 1 : Number(a.every);
  if (!Number.isInteger(every) || every < 1 || every > 4) return { chyba: "Error: every must be a whole number 1-4." };
  const r = { freq, every };
  if (freq === "weekly") {
    let days = Array.isArray(a.days) && a.days.length ? a.days.map(Number) : [denTydne(jeDatum(termin) ? termin : dnesUtc())];
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) return { chyba: "Error: days are weekdays 1 = Monday … 7 = Sunday." };
    r.days = days.filter((d, i) => days.indexOf(d) === i).sort();
  } else if (Array.isArray(a.days) && a.days.length) return { chyba: "Error: days work only with freq weekly." };
  let md = 0;
  if (a.month_day !== undefined && a.month_day !== null) {
    md = Number(a.month_day);
    if (freq !== "monthly") return { chyba: "Error: month_day works only with freq monthly." };
    if (!Number.isInteger(md) || md < 1 || md > 31) return { chyba: "Error: month_day must be 1-31." };
    r.day = md;   // kotva dne v pravidle (set_deadline.month_day): 31. po únoru zase 31.
  }
  return { rytmus: r, md };
}

// výskyt v den `s` při kotvě `kotva` (zrcadlo isOccurrence v lib/rhythm.js)
function jeVyskyt(s, r, kotva) {
  const n = r.every > 1 ? r.every : 1;
  const rozdil = Math.round((Date.parse(s + "T00:00:00Z") - Date.parse(kotva + "T00:00:00Z")) / DEN_MS);
  if (r.freq === "daily") return ((rozdil % n) + n) % n === 0;
  if (r.freq === "weekly") {
    if ((r.days || [denTydne(kotva)]).indexOf(denTydne(s)) < 0) return false;
    const tydnu = Math.round((Date.parse(plusDny(s, 1 - denTydne(s)) + "T00:00:00Z") - Date.parse(plusDny(kotva, 1 - denTydne(kotva)) + "T00:00:00Z")) / (7 * DEN_MS));
    return ((tydnu % n) + n) % n === 0;
  }
  return Number(s.slice(8, 10)) === Number(kotva.slice(8, 10));
}
// nový termín: den v měsíci → nejbližší takový den od dneška (v kratším měsíci poslední); krok s termínem ho drží;
// bez termínu první výskyt ode dneška — stejně jako přepínač v okně kroku
function novyTerminRytmu(r, md, termin) {
  const dnes = dnesUtc();
  if (md) {
    let s = dnes;
    for (let i = 0; i < 62; i++, s = plusDny(s, 1)) {
      const d = new Date(s + "T00:00:00Z");
      const posledni = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      if (d.getUTCDate() === Math.min(md, posledni)) return s;
    }
    return dnes;
  }
  if (jeDatum(termin)) return termin;
  let s = dnes;
  for (let i = 0; i < 800; i++, s = plusDny(s, 1)) if (jeVyskyt(s, r, dnes)) return s;
  return dnes;
}

// stav kroku pro set_step_rhythm: mapa, uzel, jeho termín a pravidla, která termínem hýbou
function stavRytmu(app, auth, a) {
  const H = require(`${__hooks}/helpers.js`);
  const R = require(`${__hooks}/rules-api.js`);
  const mid = SPOL().mapaId(app, auth, a.map_id);
  if (!mid) return { chyba: `Error: map "${String(a.map_id || "")}" not found or not accessible (use list_maps; pass the id or the exact title).` };
  const nid = SPOL().uzelId(app, auth, mid, a.node_id);
  if (!nid) return { chyba: `Error: step "${String(a.node_id || "")}" not found in the map (use get_map; pass the node id or its exact title).` };
  let map;
  try { map = app.findRecordById("goalmaps", mid); } catch (err) { return { chyba: "Error: map not found." }; }
  if (!H.mapEditAccess(app, map, auth)) return { chyba: "Error: only editors of the map can change how a step repeats." };
  const uzel = H.jsonVal(map, "nodes", []).find((n) => n && n.id === nid);
  if (!uzel || uzel.type === "apexNode") return { chyba: "Error: the apex of the map cannot repeat — pick one of its steps." };
  const rules = ((R.listRules(app, map) || {}).body || {}).rules || [];
  const posun = rules.filter((r) => r.node_id === nid && (r.actions || []).some((x) => x && x.type === "set_deadline" && x.advance !== undefined));
  const cisty = posun.find((r) => H.recurrenceOfRule(r)) || null;
  return { mid, nid, map, uzel, termin: String(((uzel.data || {}).deadline) || "").slice(0, 10), cisty, vlastni: !cisty && posun.length ? posun[0] : null };
}

function chybaRytmu(app, auth, a) {
  const st = stavRytmu(app, auth, a);
  if (st.chyba) return st.chyba;
  if (st.vlastni) return `Error: this step repeats by a manually edited rule "${st.vlastni.name}" — change it with update_rule (list_rules), set_step_rhythm does not touch it.`;
  if (String(a.freq) === "none") return st.cisty ? null : "Error: this step does not repeat — nothing to stop.";
  const v = rytmusZArgumentu(a, st.termin);
  return v.chyba || null;
}

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
        const ra = withNodeIds(app, auth, a);
        const body = { name: a.name, trigger: a.trigger, actions: ra.actions, conditions: ra.conditions || [] };
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
        const ra = withNodeIds(app, auth, a);
        const body = { name: a.name, trigger: a.trigger, actions: ra.actions };
        if (nid) body.node_id = nid;
        if (ra.conditions) body.conditions = ra.conditions;
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
    case "set_step_rhythm": {
      const st = stavRytmu(app, auth, a);
      if (st.chyba) return { text: st.chyba };
      const titul = SPOL().ocisti(((st.uzel.data || {}).title) || "", 60);
      return SPOL().sDocasnymKlicem(app, auth, (v1) => {
        const pravidla = `/v1/maps/${encodeURIComponent(st.mid)}/rules`;
        if (String(a.freq) === "none") {
          if (!st.cisty) return { text: "This step did not repeat." };
          const r = v1("POST", `${pravidla}/${encodeURIComponent(st.cisty.id)}/delete`, {});
          if (r.status !== 200) return { text: SPOL().chybaV1(r) };
          return { text: `"${titul}" no longer repeats (deadline unchanged).`, karta: { type: "vysledek", map_id: st.mid, map_title: "", node_id: st.nid } };
        }
        const v = rytmusZArgumentu(a, st.termin);
        if (v.chyba) return { text: v.chyba };
        const termin = novyTerminRytmu(v.rytmus, v.md, st.termin);
        if (termin !== st.termin) {
          const m = v1("GET", `/v1/maps/${encodeURIComponent(st.mid)}`);
          if (m.status !== 200) return { text: SPOL().chybaV1(m) };
          const u = v1("POST", `/v1/maps/${encodeURIComponent(st.mid)}/nodes/${encodeURIComponent(st.nid)}`, { base_updated: m.json.updated, deadline: termin });
          if (u.status !== 200) return { text: SPOL().chybaV1(u) };
        }
        // obnova podkroků: v procesu vždy; jinde jen když ji pravidlo už mělo (RecurrenceSwitch)
        const H = require(`${__hooks}/helpers.js`);
        const reset = st.map.getString("kind") === "process" || !!(st.cisty && (H.recurrenceOfRule(st.cisty) || {}).reset);
        const dl = { type: "set_deadline", advance: v.rytmus.freq };
        if (v.rytmus.every > 1) dl.every = v.rytmus.every;
        if (v.rytmus.days) dl.days = v.rytmus.days;
        if (v.rytmus.freq === "monthly") dl.month_day = v.rytmus.day || Number(termin.slice(8, 10));   // = přepínač (rytmusPro / den)
        const body = { name: RYTMUS_PRAVIDLO[L === "en" ? "en" : "cs"][v.rytmus.freq] + titul, node_id: st.nid, trigger: { type: "node_status_changed", status: "done" }, conditions: [],
          actions: [{ type: "set_status", status: "todo" }, dl].concat(reset ? [{ type: "reset_subtree" }] : []) };
        const r = v1("POST", st.cisty ? `${pravidla}/${encodeURIComponent(st.cisty.id)}` : pravidla, body);
        if (r.status !== 200) return { text: SPOL().chybaV1(r) };
        // názvy z UI v jazyce uživatele — model je opíše do odpovědi (lokální model 25. 10.: „vrátí do To do“)
        const en = L === "en";
        return { text: `"${titul}" now repeats ${rytmusText(v.rytmus, termin, L)} (wording shown in the app); deadline ${termin}${reset ? "; its sub-steps start over each time" : ""}. When ticked off it returns to the status "${en ? "To do" : "Založeno"}" and its deadline moves to the next occurrence.`,
          karta: { type: "vysledek", map_id: st.mid, map_title: "", node_id: st.nid } };
      });
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

function overZapis(app, auth, name, a) {
  const { chybaMapy, chybaUzlu } = SPOL().kontrolyZapisu(app, auth);
  switch (name) {
    // a deadline rule on a step proposed in this reply: the step (and its deadline) exists only after "Do all" —
    // checking it now would read some other step of the map
    case "create_rule": return chybaMapy(a.map_id) || (isPlanned(a, a.node_id) ? null : chybaUzlu(a.map_id, a.node_id)) || chybaTvaruPravidla(app, auth, withNodeIds(app, auth, a, a.__planned)) || chybaDuplicity(app, auth, a) || (isPlanned(a, a.node_id) ? null : chybaTerminovehoPravidla(app, auth, a));
    case "update_rule": case "delete_rule": {
      const mid = SPOL().mapaId(app, auth, a.map_id);
      const rid = SPOL().pravidloId(app, mid, a.rule_id);
      if (!rid) return `Error: rule "${String(a.rule_id || "")}" not found in "${SPOL().titulMapy(app, auth, a.map_id)}" (use list_rules; pass the id or the exact name).`;
      if (name === "delete_rule") return null;
      return (isPlanned(a, a.node_id) ? null : chybaUzlu(a.map_id, a.node_id)) || chybaTvaruPravidla(app, auth, withNodeIds(app, auth, a, a.__planned), "update_rule") || (isPlanned(a, a.node_id) ? null : chybaTerminovehoPravidla(app, auth, a));
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
    case "set_step_rhythm": return chybaMapy(a.map_id) || chybaRytmu(app, auth, a);
    case "set_rule_enabled": return chybaMapy(a.map_id) || (SPOL().pravidloId(app, SPOL().mapaId(app, auth, a.map_id), a.rule_id) ? null : `Error: rule "${String(a.rule_id || "")}" not found in "${SPOL().titulMapy(app, auth, a.map_id)}" (use list_rules; pass the id or the exact name).`);
    default: return null;
  }
}

function popisAkce(app, auth, L, name, a) {
  const cs = L !== "en";
  const { nazevMapy } = SPOL().pojmenovani(app, auth);
  switch (name) {
    case "create_rule": return cs
      ? `Nové pravidlo „${SPOL().ocisti(a.name, 120)}“ v projektu „${nazevMapy(a.map_id)}“: ${vetaPravidla(app, auth, a, cs)}`
      : `New rule "${SPOL().ocisti(a.name, 120)}" in "${nazevMapy(a.map_id)}": ${vetaPravidla(app, auth, a, cs)}`;
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
      ? `Změnit pravidlo „${SPOL().ocisti(a.name, 120)}“ v projektu „${nazevMapy(a.map_id)}“: ${vetaPravidla(app, auth, a, cs)}`
      : `Change the rule "${SPOL().ocisti(a.name, 120)}" in "${nazevMapy(a.map_id)}": ${vetaPravidla(app, auth, a, cs)}`;
    case "delete_rule": {
      const R = require(`${__hooks}/rules-api.js`);
      let nazev = String(a.rule_id || "");
      try { const rules = ((R.listRules(app, app.findRecordById("goalmaps", SPOL().mapaId(app, auth, a.map_id))) || {}).body || {}).rules || []; const r = rules.find((x) => x.id === SPOL().pravidloId(app, SPOL().mapaId(app, auth, a.map_id), a.rule_id)); if (r) nazev = r.name; } catch (err) { /* název zůstane z argumentu */ }
      return cs ? `Smazat pravidlo „${SPOL().ocisti(nazev, 120)}“ z projektu „${nazevMapy(a.map_id)}“ — nejde vrátit` : `Delete the rule "${SPOL().ocisti(nazev, 120)}" from "${nazevMapy(a.map_id)}" — cannot be undone`;
    }
    case "save_rule_template": return cs
      ? `${a.template_id ? "Změnit" : "Uložit"} šablonu pravidla „${SPOL().ocisti(a.name, 120)}“: ${vetaPravidla(app, auth, a, cs)}`
      : `${a.template_id ? "Change" : "Save"} the rule template "${SPOL().ocisti(a.name, 120)}": ${vetaPravidla(app, auth, a, cs)}`;
    case "set_step_rhythm": {
      const st = stavRytmu(app, auth, a);
      const uzel = SPOL().ocisti(st.uzel ? ((st.uzel.data || {}).title || "") : String(a.node_id || ""), 80);
      if (String(a.freq) === "none") return cs ? `Přestat opakovat „${uzel}“ v projektu „${nazevMapy(a.map_id)}“ (termín zůstane)` : `Stop repeating "${uzel}" in "${nazevMapy(a.map_id)}" (deadline stays)`;
      const v = rytmusZArgumentu(a, st.termin || "");
      if (v.chyba) return "";
      const termin = novyTerminRytmu(v.rytmus, v.md, st.termin || "");
      const kdy = termin !== st.termin ? (cs ? ` · první termín ${SPOL().datumKratce(termin, "cs")}` : ` · first due ${SPOL().datumKratce(termin, "en")}`) : "";
      return cs ? `Opakovat „${uzel}“ ${rytmusText(v.rytmus, termin, "cs")} (projekt „${nazevMapy(a.map_id)}“)${kdy}` : `Repeat "${uzel}" ${rytmusText(v.rytmus, termin, "en")} (in "${nazevMapy(a.map_id)}")${kdy}`;
    }
    case "delete_rule_template": {
      const t = SPOL().sablonaDto(app, a.template_id);
      return cs ? `Smazat šablonu pravidla „${SPOL().ocisti(t ? t.name : a.template_id, 120)}“ z knihovny` : `Delete the rule template "${SPOL().ocisti(t ? t.name : a.template_id, 120)}" from the library`;
    }
    default: return "";
  }
}

module.exports = { NASTROJE, vykonej, overZapis, popisAkce, withNodeIds, vetaPravidla, chybaDuplicity, rytmusText, novyTerminRytmu, RULE_TRIGGER, RULE_CONDITION, RULE_ACTION, chybaTvaruPravidla, terminovaPravidlaUzly, chybaTerminovehoPravidla, kdyVystreli };
