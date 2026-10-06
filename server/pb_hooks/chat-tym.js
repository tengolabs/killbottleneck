// Čtečky pro porady a tým přes asistenta: týdenní revize, změny projektu, práce člověka, přehled týmu, Organizace, lidé.
// Vzniklo rozdělením chat.js po skupinách nástrojů (5. 10. 2026, bod 2 prověrky asistenta): kód přesunut DOSLOVA, chování beze změny.
// Sdílené resolvery (mapaId, uzelId, sDocasnymKlicem, …) jsou v chat-spolecne.js; chat.js skládá seznam nástrojů v PŮVODNÍM pořadí
// (PORADI_NASTROJU — pořadí schémat je součást prefixu promptu, cache musí držet) a podle `modul` u nástroje sem deleguje
// vykonej / overZapis / popisAkce. ⚠️ PocketBase JSVM: require() uvnitř funkcí (líné přístupové funkce níže).
const HOOKS = typeof __hooks !== "undefined" ? __hooks : __dirname; // mimo PocketBase (testy v node) složka souboru
const SPOL = () => require(`${HOOKS}/chat-spolecne.js`);

// Týdenní revize (fáze D, 1. 10. 2026): týden uživatele z buildMyDay (stejná sémantika „moje práce“ jako Můj den;
// `since` = před 7 dny, takže „hotovo“ = co sám označil hotové za týden — uzly nemají vlastní razítko, rozhoduje
// deník map_changes). Jen vlastní práce: buildMyDay bere jen mapy, které uživatel vidí, a jen jeho uzly.
function tydenData(d, dnes, za7) {
  const S = (d && d.sections) || {};
  const otevrene = [].concat(S.overdue || [], S.today || [], S.tomorrow || [], S.week || [], S.blocking || [], S.later || [], S.noDate || [], S.stuck || []);
  const jednou = (arr) => { const v = {}; return arr.filter((it) => { const k = it.kind + ":" + it.id; if (v[k]) return false; v[k] = true; return true; }); };
  return {
    hotovo: jednou(S.doneToday || []),
    poTerminu: jednou(otevrene.filter((it) => it.deadline && it.deadline < dnes)),
    tyden: jednou(otevrene.filter((it) => !(it.deadline && it.deadline < dnes) && ((it.deadline && it.deadline <= za7) || (it.planned && it.planned >= dnes && it.planned <= za7)))),
    stoji: jednou(S.stuck || []),
    blokuje: jednou(otevrene.filter((it) => it.blocks)),
    zadano: jednou((S.delegated || []).filter((it) => it.deadline && it.deadline < dnes)),
  };
}
function tydenText(d, dnes, za7) {
  const W = tydenData(d, dnes, za7);
  const MAX = 20;
  // nápad ze zásobníku s termínem: není v žádné mapě → update_node na něj nejde
  const radek = (it, navic) => `• ${it.title} (${it.kind === "idea" ? "an idea in the buffer, not in a project — it cannot be planned or changed with update_node; offer add_idea_to_map" : "map: " + (it.mapTitle || "?")}${it.deadline ? `, deadline ${it.deadline}` : ""}${it.planned ? `, planned ${it.planned}` : ""}${navic ? `, ${navic}` : ""})`;
  const sekce = (nadpis, arr, navic) => {
    if (!arr.length) return `${nadpis} (0): none`;
    return `${nadpis} (${arr.length}):\n` + arr.slice(0, MAX).map((it) => radek(it, navic ? navic(it) : "")).join("\n") + (arr.length > MAX ? `\n… and ${arr.length - MAX} more` : "");
  };
  return [
    `Week review for the user (today ${dnes}; next 7 days = until ${za7}). Only the user's own work.`,
    sekce("Done in the last 7 days", W.hotovo, (it) => (it.when ? `done ${String(it.when).slice(0, 10)}` : "")),
    sekce("Overdue", W.poTerminu),
    sekce("Due or planned in the next 7 days", W.tyden),
    sekce("Not moving for a long time (stuck)", W.stoji),
    sekce("Blocking other steps", W.blokuje, (it) => `blocks "${it.blocks}"`),
    sekce("Assigned by the user to others and overdue", W.zadano, (it) => `assignee ${it.assignee_label || it.assignee}`),
  ].join("\n\n");
}
// Fáze E: pohyb práce v projektu (sdílená logika s routou /map-changes)
function zmenyText(nazev, dni, d) {
  const MAX = 15;
  const nadpisy = { done: "Finished", started: "Started", added: "Added", deadline: "Deadline changed", owner: "Owner changed", moved: "Moved", removed: "Removed" };
  const casti = [`Changes in "${nazev}" over the last ${dni} days${d.since ? ` (since ${d.since.slice(0, 10)})` : ""}${d.truncated ? " — only the latest 500 changes" : ""}:`];
  for (const k of Object.keys(nadpisy)) {
    const arr = d.groups[k] || [];
    if (!arr.length) continue;
    casti.push(`${nadpisy[k]} (${arr.length}):\n` + arr.slice(0, MAX).map((it) => `• ${it.title}${(k === "deadline" || k === "owner") ? `: ${it.from || "—"} → ${it.to || "—"}` : ""} (${it.actor || "?"}, ${String(it.when || "").slice(0, 10)})`).join("\n") + (arr.length > MAX ? `\n… and ${arr.length - MAX} more` : ""));
  }
  if (casti.length === 1) casti.push("No movement in this period.");
  return casti.join("\n\n");
}
// člen instance podle e-mailu nebo jména (jak ho vypsal list_people)
function najdiCloveka(app, ref) {
  const H = require(`${__hooks}/helpers.js`);
  const r = String(ref || "").trim().toLowerCase();
  if (!r) return null;
  const lide = H.memberRows(app);
  return lide.find((m) => String(m.email || "").toLowerCase() === r)
    || lide.find((m) => [m.name, m.full_name].some((x) => x && String(x).trim().toLowerCase() === r)) || null;
}
// otevřená práce kolegy JEN v mapách, které vidí uživatel (vlastní, týmové, sdílené mu — ne veřejné)
function praceClovekaText(app, auth, kdo, dnes) {
  const { jsonVal } = require(`${__hooks}/helpers.js`);
  const email = String(kdo.email || "");
  const radky = [];
  let poTerminu = 0;
  for (const m of SPOL().mapyUzivatele(app, auth, false)) {
    let rec;
    try { rec = app.findRecordById("goalmaps", m.id); } catch (err) { continue; }
    for (const n of jsonVal(rec, "nodes", [])) {
      const d = (n && n.data) || {};
      if (!n || n.type === "note" || String(d.owner || "").toLowerCase() !== email.toLowerCase() || (d.status || "todo") === "done") continue;
      const pozde = d.deadline && d.deadline < dnes;
      if (pozde) poTerminu += 1;
      radky.push({ pozde, t: `• ${d.title || d.apexText || "?"} (map: ${m.title}${d.deadline ? `, deadline ${d.deadline}${pozde ? " OVERDUE" : ""}` : ""}${d.plannedOn ? `, planned ${d.plannedOn}` : ""}, ${d.status || "todo"})` });
    }
  }
  radky.sort((x, y) => (y.pozde ? 1 : 0) - (x.pozde ? 1 : 0));
  const kdoText = `${kdo.name || kdo.full_name || email} <${email}>`;
  if (!radky.length) return `${kdoText} has no open work in the projects the user can see.`;
  return `Open work of ${kdoText} in the projects the user can see (${radky.length}, overdue ${poTerminu}):\n` + radky.slice(0, 40).map((x) => x.t).join("\n") + (radky.length > 40 ? `\n… and ${radky.length - 40} more` : "");
}
// týmová porada: vytížení týmu z buildPortfolio — jen týmové a sdílené mapy; scope.excluded (názvy SOUKROMÝCH
// map) se NEvypisuje ani nepočítá
function tymText(d) {
  const S = (d && d.sections) || {};
  const MAX = 20;
  // externí kontakt: jménem (když ho uživatel smí vidět), jinak obecně — nikdy syrovou pseudo-adresou
  const { isExternalOwner } = require(`${__hooks}/helpers.js`);
  const clovek = (adresa, stitek) => stitek || (isExternalOwner(adresa) ? "an external contact" : adresa) || "—";
  const kdo = (it) => clovek(it.owner, it.owner_label);
  const sekce = (nadpis, arr, fn) => (!arr || !arr.length ? `${nadpis} (0): none` : `${nadpis} (${arr.length}):\n` + arr.slice(0, MAX).map(fn).join("\n") + (arr.length > MAX ? `\n… and ${arr.length - MAX} more` : ""));
  return [
    `Team work (today ${d.today}) — team and shared projects only; private projects are not included.`,
    sekce("People", S.people, (p) => `• ${clovek(p.email, p.owner_label)} — open ${p.open}, overdue ${p.overdue}, stuck ${p.stuck}`),
    sekce("Overdue", S.overdue, (it) => `• ${it.title} — ${kdo(it)}, deadline ${it.deadline}${it.daysOver ? ` (${it.daysOver} days over)` : ""}, project "${it.mapTitle}"`),
    sekce("Stuck", S.stuck, (it) => `• ${it.title} — ${kdo(it)}${it.daysIdle ? `, no change for ${it.daysIdle} days` : ""}, project "${it.mapTitle}"`),
    sekce("Bottlenecks", S.bottlenecks, (it) => `• ${it.title} — ${kdo(it)}${it.blocked ? `, holds ${it.blocked} open steps` : ""}, project "${it.mapTitle}"`),
    sekce("Projects", S.projects, (pr) => `• ${pr.title} — open ${pr.open}, overdue ${pr.overdue}, stuck ${pr.stuck} (${pr.team_access ? "team" : "shared"})`),
  ].join("\n\n");
}

const NASTROJE = [
  { name: "get_week_review", skupina: "tyden", kind: "read", description: "The user's OWN week (weekly review): what they finished in the last 7 days, what is overdue, what is due or planned in the next 7 days, what has not moved for a long time (stuck), what blocks others and what they assigned to others that is overdue. Only the user's own work, never other people's private projects.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_project_changes", skupina: "schuzka", kind: "read", description: "What happened in ONE project over the last days (default 14): finished, started, added, deadline changes, owner changes, moved and removed steps — for preparing a meeting or a status report.",
    parameters: { type: "object", properties: { map_id: { type: "string", description: "the exact map title" }, days: { type: "integer", enum: [7, 14, 30], description: "how many days back (default 14)" } }, required: ["map_id"], additionalProperties: false } },
  { name: "get_person_work", skupina: "schuzka", kind: "read", description: "Open work of ONE person (a colleague) in the projects the USER can see — for preparing a meeting with them. Never anything from projects the user cannot see.",
    parameters: { type: "object", properties: { person: { type: "string", description: "e-mail or name as listed by list_people" } }, required: ["person"], additionalProperties: false } },
  { name: "get_team_work", skupina: "tymporada", jenRezim: "tymova_porada", kind: "read", description: "Team workload for the team meeting: per person open / overdue / stuck work, overdue items, stuck items, bottlenecks and projects — team and shared projects only, never private ones.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "get_portfolio", skupina: "tym", kind: "read", description: "Overview across team and shared projects: progress, overdue, stuck items, people.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
  { name: "list_people", skupina: "tym", kind: "read", description: "Members of the instance (e-mail, name, role) — who can own a node.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false } },
];

function vykonej(app, auth, L, name, args, ktx) {
  const H = require(`${__hooks}/helpers.js`);
  const M = require(`${__hooks}/mcp-tools.js`);
  const { t } = require(`${__hooks}/i18n.js`);
  const a = args || {};
  switch (name) {
    case "get_project_changes": {
      const r = H.v1ReadableMap(app, SPOL().mapaId(app, auth, a.map_id), auth); // bez veřejných map (jako /map-changes)
      if (!r) return { text: "Error: map not found or not accessible." };
      const dni = [7, 14, 30].includes(Number(a.days)) ? Number(a.days) : 14;
      return { text: M.DATA_FENCE + "\n\n" + zmenyText(r.map.getString("title"), dni, H.mapChangeGroups(app, r.map.id, dni)) };
    }
    case "get_person_work": {
      const kdo = najdiCloveka(app, a.person);
      if (!kdo) return { text: `Error: "${SPOL().ocisti(a.person, 80)}" is not a member — use an e-mail or a name exactly as listed by list_people.` };
      return { text: M.DATA_FENCE + "\n\n" + praceClovekaText(app, auth, kdo, H.fmtDateLocal(new Date())) };
    }
    case "get_team_work": {
      if (!H.jeAdminNeboManazer(auth)) return { text: "Error: the team overview is only for administrators and managers." };
      const d = H.buildPortfolio(app, auth.id, auth.email(), { today: H.fmtDateLocal(new Date()), untitled: t(L, "misc.untitled") });
      return { text: M.DATA_FENCE + "\n\n" + tymText(d) };
    }
    case "get_week_review": {
      const ted = new Date();
      const dnes = H.fmtDateLocal(ted);
      const d = H.buildMyDay(app, auth.id, auth.email(), { today: dnes, since: H.pbDateString(new Date(ted.getTime() - 7 * 86400000)), untitled: t(L, "misc.untitled") });
      return { text: M.DATA_FENCE + "\n\n" + tydenText(d, dnes, H.addDaysStr(ted, 7)) };
    }
    case "get_portfolio": {
      const data = H.buildPortfolio(app, auth.id, auth.email(), { today: "", untitled: t(L, "misc.untitled") });
      return { text: M.renderPortfolio(data) };
    }
    case "list_people": {
      const rows = H.memberRows(app);
      // strop 150 řádků — výsledek jde modelu v každém dalším volání tahu (tokeny), víc lidí asistent stejně nepřiřazuje najednou
      const MAX_LIDI = 150;
      const radky = rows.slice(0, MAX_LIDI).map((m) => `• ${m.email}${m.name || m.full_name ? ` — ${m.name || m.full_name}` : ""} (${m.role || "member"})`);
      if (rows.length > MAX_LIDI) radky.push(`… and ${rows.length - MAX_LIDI} more members (ask the user for a name or e-mail to narrow it down)`);
      return { text: radky.join("\n") || "No members." };
    }
    default: return { text: "Error: unknown tool " + name };
  }
}

function overZapis() { return null; }

function popisAkce() { return ""; }

module.exports = { NASTROJE, vykonej, overZapis, popisAkce, tydenData, tydenText, zmenyText, najdiCloveka, praceClovekaText, tymText };
