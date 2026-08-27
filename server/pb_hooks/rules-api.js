// Jádro pravidel a jejich šablon — JEDNO pro session routy (/rules*, /rule-templates*)
// i pro v1 API (/v1/maps/{id}/rules*, /v1/rule-templates*). Do 27. 8. 2026 byly obě
// větve opsané (~375 ř.), lišily se jen autentizací, nalezením mapy a stropem těla —
// a rozešly se v jednom chování: session editace bez `enabled` vypnuté pravidlo
// tiše ZAPNULA, v1 ho nechala (nález S8-05/S9-01 analýzy kódu). Platí v1: `enabled`
// se při editaci mění jen, když přijde; při založení je výchozí true.
//
// Každá funkce vrací { status, body } — routa jen `e.json(r.status, r.body)`.
// Autorizaci (kdo mapu edituje, kdo je admin) řeší volající, tady se předává hotová.
//
// ⚠️ PocketBase JSVM: soubor se načítá přes require() uvnitř handlerů.

// session: mapa z id + právo editovat (pravidla vidí a mění jen editor mapy)
function editableMapSession(app, e, mapId) {
  const { mapEditAccess } = require(`${__hooks}/helpers.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const lang = userLang(e.auth);
  let map;
  try {
    map = app.findRecordById("goalmaps", String(mapId || ""));
  } catch (err) {
    return { error: { status: 404, body: { error: t(lang, "err.mapNotFound") } } };
  }
  if (!mapEditAccess(app, map, e.auth)) return { error: { status: 403, body: { error: t(lang, "err.noWriteAccess") } } };
  return { map: map, lang: lang };
}

function listRules(app, map) {
  const { ruleDto } = require(`${__hooks}/helpers.js`);
  let rows = [];
  try { rows = app.findRecordsByFilter("automation_rules", "map = {:m}", "created", 200, 0, { m: map.id }); } catch (err) { /* žádná pravidla */ }
  return { status: 200, body: { rules: rows.map(ruleDto) } };
}

// najde pravidlo mapy; cizí mapa = 404 (neprozrazovat existenci)
function findRule(app, map, ruleId, lang) {
  const { t } = require(`${__hooks}/i18n.js`);
  let rec;
  try {
    rec = app.findRecordById("automation_rules", String(ruleId || ""));
  } catch (err) {
    return { error: { status: 404, body: { error: t(lang, "err.ruleNotFound") } } };
  }
  if (rec.getString("map") !== map.id) return { error: { status: 404, body: { error: t(lang, "err.ruleNotFound") } } };
  return { rec: rec };
}

// založení (rec = null) nebo úprava (rec) pravidla mapy
function saveRule(app, map, rec, info, ctx) {
  const { validateRuleInput, ruleDto, MAX_RULES_PER_MAP } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const lang = ctx.lang;
  // pouhé zapnutí/vypnutí: enabled je JEDINÉ datové pole. Když přijde i tvar
  // (name/trigger/actions/conditions/node_id), NESMÍ se tiše zahodit — spadne
  // to do plné validace níž (nález panelu 14. 8.: {enabled, actions} dřív
  // vrátil 200 a akce ztratil).
  const onlyToggle = rec && info.enabled !== undefined
    && info.name === undefined && info.trigger === undefined
    && info.actions === undefined && info.conditions === undefined && info.node_id === undefined;
  if (onlyToggle) {
    rec.set("enabled", !!info.enabled);
    app.save(rec);
    return { status: 200, body: { rule: ruleDto(rec) } };
  }
  const v = validateRuleInput(app, map, info);
  if (v.error) return { status: 400, body: { error: t(lang, "err.ruleInvalid", { reason: v.error }) } };
  if (!rec) {
    // strukturální limit à la Asana (50/mapa) je v pořádku; měsíční metr NIKDY
    let count = 0;
    try { count = app.findRecordsByFilter("automation_rules", "map = {:m}", "", 500, 0, { m: map.id }).length; } catch (err) { /* prázdno */ }
    if (count >= MAX_RULES_PER_MAP) return { status: 400, body: { error: t(lang, "err.ruleLimit", { max: MAX_RULES_PER_MAP }) } };
    rec = new Record(app.findCollectionByNameOrId("automation_rules"));
    rec.set("map", map.id);
    rec.set("enabled", info.enabled === undefined ? true : !!info.enabled);
  } else if (info.enabled !== undefined) {
    rec.set("enabled", !!info.enabled);
  }
  rec.set("name", v.data.name);
  rec.set("node_id", v.data.node_id);
  rec.set("trigger", v.data.trigger);
  rec.set("conditions", v.data.conditions);
  rec.set("actions", v.data.actions);
  rec.set("created_by", ctx.userEmail);
  // editace = nová šance: „už jsem si stěžoval" se resetuje (mail přijde znovu
  // jen pokud selže i opravená podoba)
  rec.set("last_error", "");
  rec.set("error_notified", false);
  app.save(rec);
  return { status: 200, body: { rule: ruleDto(rec) } };
}

function deleteRule(app, rec) {
  app.delete(rec);
  return { status: 200, body: { success: true } };
}

// log běhů — jednotný tvar pro UI i API (?rule= filtr na jedno pravidlo)
function listRuleRuns(app, map, q) {
  const { ruleRunDto } = require(`${__hooks}/helpers.js`);
  let filter = "map = {:m}";
  const params = { m: map.id };
  if (q && q.rule) { filter += " && rule = {:r}"; params.r = String(q.rule); }
  let rows = [];
  try { rows = app.findRecordsByFilter("rule_runs", filter, "-created", 100, 0, params); } catch (err) { /* prázdno */ }
  return { status: 200, body: { runs: rows.map(ruleRunDto) } };
}

// ---------- šablony pravidel (knihovna instance) ----------
// Šablona = tvar pravidla bez mapy a bez scope; načtením do mapy vzniká KOPIE
// (žádné bundly — úprava šablony existující kopie nemění; Richard 14. 8. 2026).
// Číst smí každý přihlášený, přepsat/smazat jen autor nebo admin.
function listRuleTemplates(app) {
  const { ruleTemplateDto } = require(`${__hooks}/helpers.js`);
  let rows = [];
  try { rows = app.findRecordsByFilter("rule_templates", "id != ''", "name", 200, 0); } catch (err) { /* prázdno */ }
  return { status: 200, body: { templates: rows.map(ruleTemplateDto) } };
}

// šablona podle id + kontrola autor/admin; ctx = { userEmail, isAdmin, lang }
function findOwnTemplate(app, id, ctx) {
  const { t } = require(`${__hooks}/i18n.js`);
  let rec;
  try {
    rec = app.findRecordById("rule_templates", String(id || ""));
  } catch (err) {
    return { error: { status: 404, body: { error: t(ctx.lang, "err.ruleNotFound") } } };
  }
  if (rec.getString("created_by") !== ctx.userEmail && !ctx.isAdmin) {
    return { error: { status: 403, body: { error: t(ctx.lang, "err.templateAuthorOnly") } } };
  }
  return { rec: rec };
}

function saveRuleTemplate(app, info, ctx) {
  const { validateRuleInput, ruleTemplateDto, MAX_TEMPLATES_PER_AUTHOR } = require(`${__hooks}/helpers.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  let rec = null;
  if (info.id) {
    const f = findOwnTemplate(app, info.id, ctx);
    if (f.error) return f.error;
    rec = f.rec;
  }
  const v = validateRuleInput(app, null, info); // null = šablonový režim (bez mapy/scope)
  if (v.error) return { status: 400, body: { error: t(ctx.lang, "err.ruleInvalid", { reason: v.error }) } };
  if (!rec) {
    let mine = 0;
    try { mine = app.findRecordsByFilter("rule_templates", "created_by = {:e}", "", 500, 0, { e: ctx.userEmail }).length; } catch (err) { /* prázdno */ }
    if (mine >= MAX_TEMPLATES_PER_AUTHOR) return { status: 400, body: { error: t(ctx.lang, "err.templateLimit", { max: MAX_TEMPLATES_PER_AUTHOR }) } };
    rec = new Record(app.findCollectionByNameOrId("rule_templates"));
    rec.set("created_by", ctx.userEmail);
  }
  rec.set("name", v.data.name);
  rec.set("trigger", v.data.trigger);
  rec.set("conditions", v.data.conditions);
  rec.set("actions", v.data.actions);
  try {
    app.save(rec);
  } catch (err) {
    return { status: 400, body: { error: t(ctx.lang, "err.templateNameTaken", { name: v.data.name }) } }; // UNIQUE jméno
  }
  return { status: 200, body: { template: ruleTemplateDto(rec) } };
}

function deleteRuleTemplate(app, id, ctx) {
  const f = findOwnTemplate(app, id, ctx);
  if (f.error) return f.error;
  app.delete(f.rec);
  return { status: 200, body: { success: true } };
}

module.exports = { editableMapSession, listRules, findRule, saveRule, deleteRule, listRuleRuns, listRuleTemplates, saveRuleTemplate, deleteRuleTemplate };
