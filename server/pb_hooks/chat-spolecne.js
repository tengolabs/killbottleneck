// Sdílené pomocníky asistenta (5. 10. 2026, rozdělení chat.js po skupinách): resolvery map/uzlů/nápadů podle čísla, názvu i id,
// zápis přes vlastní v1 API dočasným klíčem, formát dat, očištění textů a továrny kontrol/pojmenování pro karty.
// Kód přesunut z chat.js DOSLOVA. Používá je chat.js i moduly skupin (chat-pravidla.js, chat-udalosti.js, …).
// ⚠️ PocketBase JSVM: require() uvnitř funkcí.

const MAX_ZN = 3000;        // ořez jedné zprávy
// search_projects (2. 10. 2026): stropy výsledku hledání, ať nevyhodí kontext ani neprotekne do ai_chats.messages
const RE_CISLO_PROJEKTU = /^#?(\d{1,9})$/; // „#12“ / „12“ = číslo projektu (search_projects, mapaId)
const MAX_MAP_ZAZNAMU = 200;       // map na stav (aktivní / archiv) pro seznamy a hledání; dosažený strop výsledek přizná
const V1_BASE = "http://127.0.0.1:8090";
function ocisti(s, max) {
  return String(s == null ? "" : s).replace(/\u0000/g, "").trim().slice(0, max || MAX_ZN);
}
// místní datum (TZ kontejneru) — stejně jako spouštění pravidel; UTC by mezi půlnocí a 2:00 posunulo „zítra“ na „dnes“
function dnes() { const { fmtDateLocal } = require(`${__hooks}/helpers.js`); return fmtDateLocal(new Date()); }
function dosad(s, params) {
  let out = s;
  for (const k of Object.keys(params || {})) out = out.split("{" + k + "}").join(String(params[k]));
  return out;
}
const TREE_ITEM = {
  type: "object",
  properties: {
    title: { type: "string", description: "Node title (required)" },
    description: { type: "string" },
    planned_on: { type: "string", description: "YYYY-MM-DD, today to +7 days — when the owner plans to work on it" },
    deadline: { type: "string", description: "YYYY-MM-DD — a date agreed with someone (meeting, delivery). Set it when the material or the user states such a date." },
    owner: { type: "string", description: "E-mail of an instance member (see list_people), \"me\" for the user themself, or \"none\" when the user said nobody. A step with a deadline must have one." },
    status: { type: "string", enum: ["todo", "in_progress", "done"] },
    children: { type: "array", items: { $ref: "#/$defs/treeItem" } },
  },
  required: ["title"],
  additionalProperties: false,
};
const bezDiakritiky = (t) => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// záznamy map, které uživatel vidí (vlastní, týmové, sdílené mu; ne veřejné cizí, ne org), aktivní NEBO archivované
// — práva ověřuje mapAccessLevel; vrací [{rec, access}] pro hledání i souhrny
function zaznamyMap(app, auth, archived) {
  const { mapAccessLevel, shareRowsFor } = require(`${__hooks}/helpers.js`);
  const email = auth.email();
  const rows = app.findRecordsByFilter("goalmaps",
    '(owner = {:o} || team_access != "" || map_shares_via_map.email ?= {:e}) && archived = {:ar} && kind != "org"', "-updated", MAX_MAP_ZAZNAMU, 0,
    { o: auth.id, e: email, ar: !!archived });
  const shareRows = shareRowsFor(app, email);
  const out = [];
  for (const mp of rows) {
    const level = mapAccessLevel(app, mp, auth.id, email, { shareRows: shareRows });
    if (!level) continue;
    out.push({ rec: mp, access: mp.getString("owner") === auth.id ? "owner" : level });
  }
  return out;
}
function mapyUzivatele(app, auth, archived) {
  const { jsonVal } = require(`${__hooks}/helpers.js`);
  return zaznamyMap(app, auth, archived).map((z) => {
    const mp = z.rec;
    const nodes = jsonVal(mp, "nodes", []);
    const open = nodes.filter((n) => n.type !== "note" && n.type !== "apexNode" && ((n.data || {}).status || "todo") !== "done").length;
    return { id: mp.id, title: mp.getString("title"), number: Number(mp.get("project_number")) || 0, archived: mp.getBool("archived"),
      updated: mp.getString("updated").slice(0, 10), access: z.access, nodes: nodes.length, open: open };
  });
}
function napadyUzivatele(app, userId) {
  try {
    return app.findRecordsByFilter("buffer_nodes", "owner = {:u}", "-updated", 100, 0, { u: userId });
  } catch (err) { return []; }
}
// Klíč žije 2 minuty, maže se hned po použití; scope read_write; vlastník = uživatel.
// Díky tomu platí přesně to, co u MCP: klíč nikdy neumí víc než člověk v aplikaci.
function sDocasnymKlicem(app, auth, fn) {
  const token = "kb_user_" + $security.randomString(40);
  const rec = new Record(app.findCollectionByNameOrId("api_keys"));
  rec.set("owner", auth.id);
  rec.set("token_hash", $security.sha256(token));
  rec.set("label", "ai-asistent"); // štítek čte apiKeyAuth → via "asistent:<email>" do životopisu uzlu
  rec.set("scope", "read_write");
  rec.set("expires_at", new Date(Date.now() + 2 * 60 * 1000).toISOString());
  app.save(rec);
  const v1 = (method, path, body) => {
    const res = $http.send({
      url: V1_BASE + "/api/kb" + path, method: method,
      body: body === undefined ? "" : JSON.stringify(body),
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      timeout: 60,
    });
    let j = null;
    try { j = res.json || null; } catch (err) { j = null; }
    return { status: res.statusCode, json: j };
  };
  try {
    return fn(v1);
  } finally {
    try { app.delete(rec); } catch (err) { /* klíč vyprší sám za 2 min */ }
  }
}
function chybaV1(r) {
  const j = r.json || {};
  return `Error ${r.status}: ${j.error || j.message || "request failed"}`;
}
// Nápad podle id NEBO názvu. Modely (i gemma4:26b) si id nápadů pletou a
// vymýšlejí (Richard 13. 9.: „34iccqosxr5t7h"), názvy drží spolehlivě —
// proto každý odkaz na nápad/mapu/uzel bere obojí. Název se porovnává bez
// ohledu na velikost písmen a diakritiku; při nejednoznačnosti null.
function norm(s) { return require(`${__hooks}/helpers.js`).normText(s); }
function podleNazvu(rows, ref, nazev) {
  const n = norm(ref);
  if (!n) return null;
  const presne = rows.filter((r) => norm(nazev(r)) === n);
  if (presne.length === 1) return presne[0];
  if (presne.length > 1) return null;
  // částečná shoda: název obsahuje odkaz, nebo odkaz obsahuje název — druhý směr jen u názvů od 3 znaků
  // (jednoznakový název je podřetězcem skoro každého id i věty: 1. 10. 2026 se tak při mazání trefil nápad „c“
  // místo nápadu, který mezitím zmizel)
  const cast = rows.filter((r) => { const x = norm(nazev(r)); return x.includes(n) || (x.length >= 3 && n.includes(x)); });
  return cast.length === 1 ? cast[0] : null;
}
// nápad jen podle id a vlastníka (vykonání mazání: smí zmizet jen to, co ukázala karta)
function napadPodleId(app, auth, ref) {
  try {
    const rec = app.findRecordById("buffer_nodes", String(ref || ""));
    return rec.getString("owner") === auth.id ? rec : null;
  } catch (err) { return null; }
}
// odkaz pro MAZÁNÍ → všechny nápady, kterých se týká: id (vlastní) = ten jeden; přesný název = všechny se
// stejným názvem (duplicity mají zmizet obě a karta je ukáže obě); jinak jednoznačná částečná shoda
function napadyProSmazani(app, auth, ref) {
  const id = String(ref || "");
  let rec = null;
  try { rec = app.findRecordById("buffer_nodes", id); } catch (err) { rec = null; }
  if (rec) return rec.getString("owner") === auth.id ? [rec] : [];
  const vse = napadyUzivatele(app, auth.id);
  const n = norm(id);
  if (!n) return [];
  const presne = vse.filter((r) => norm(r.getString("title")) === n);
  if (presne.length) return presne;
  const jeden = podleNazvu(vse, id, (r) => r.getString("title"));
  return jeden ? [jeden] : [];
}
function napadZaznam(app, auth, ref) {
  const id = String(ref || "");
  let rec = null;
  try { rec = app.findRecordById("buffer_nodes", id); } catch (err) { rec = null; /* není to id → zkusit název */ }
  // id cizího nápadu se NEhledá dál jako název (jinak by z něj vypadl vlastní nápad s krátkým názvem)
  if (rec) return rec.getString("owner") === auth.id ? rec : null;
  return podleNazvu(napadyUzivatele(app, auth.id), id, (r) => r.getString("title"));
}
// mapa podle čísla projektu („#12“ / „12“), id nebo názvu (jen mapy, které uživatel vidí) → id mapy nebo "".
// Název se hledá nejdřív v aktivních, až když nic nesedí, v ARCHIVOVANÝCH (aktivní má přednost; 2. 10. 2026 —
// dřív archivovaná mapa podle názvu nešla otevřít vůbec). Číslo platí napříč oběma stavy.
function mapaId(app, auth, ref) {
  const id = String(ref || "").trim();
  const { v1ReadableMap } = require(`${__hooks}/helpers.js`);
  const cislo = RE_CISLO_PROJEKTU.exec(id);
  if (cislo) {
    // číslo je unikátní (částečný index) → jeden dotaz bez stropu zaznamyMap; práva ověří v1ReadableMap jako u id.
    // Když takové číslo není nebo mapa není vidět, pokračuje se podle NÁZVU — mapa se smí jmenovat „2027“.
    let rec = null;
    try { rec = app.findFirstRecordByFilter("goalmaps", "project_number = {:n} && kind != 'org'", { n: Number(cislo[1]) }); } catch (err) { rec = null; }
    if (rec && v1ReadableMap(app, rec.id, auth)) return rec.id;
  }
  if (v1ReadableMap(app, id, auth)) return id;
  let aktivni = [];
  try { aktivni = mapyUzivatele(app, auth, false); } catch (err) { aktivni = []; }
  const m = podleNazvu(aktivni, id, (x) => x.title);
  if (m) return m.id;
  let archiv = [];
  try { archiv = mapyUzivatele(app, auth, true); } catch (err) { archiv = []; }
  const ma = podleNazvu(archiv, id, (x) => x.title);
  return ma ? ma.id : "";
}
// název mapy / uzlu pro texty mimo popisAkce (tam jsou lokální nazevMapy/nazevUzlu)
function titulMapy(app, auth, ref) {
  try { const { v1ReadableMap } = require(`${__hooks}/helpers.js`); const r = v1ReadableMap(app, mapaId(app, auth, ref) || String(ref || ""), auth); return r ? r.map.getString("title") : String(ref || "?"); } catch (err) { return String(ref || "?"); }
}
function titulUzlu(app, auth, mapRef, ref) {
  try {
    const { v1ReadableMap, jsonVal } = require(`${__hooks}/helpers.js`);
    const mid = mapaId(app, auth, mapRef); const r = mid ? v1ReadableMap(app, mid, auth) : null; if (!r) return String(ref || "?");
    const nid = uzelId(app, auth, mid, ref); const n = jsonVal(r.map, "nodes", []).find((x) => x.id === nid);
    return n ? ((n.data || {}).title || (n.data || {}).apexText || String(ref || "?")) : String(ref || "?");
  } catch (err) { return String(ref || "?"); }
}
// pravidlo mapy podle id nebo názvu → id nebo ""; šablona z knihovny podle id nebo názvu → záznam DTO nebo null
function pravidloId(app, mapId, ref) {
  const R = require(`${__hooks}/rules-api.js`);
  let map; try { map = app.findRecordById("goalmaps", String(mapId || "-")); } catch (err) { return ""; }
  const rules = ((R.listRules(app, map) || {}).body || {}).rules || [];
  const id = String(ref || "").trim();
  if (rules.some((r) => r.id === id)) return id;
  const r = podleNazvu(rules, id, (x) => x.name);
  return r ? r.id : "";
}
function sablonaDto(app, ref) {
  const R = require(`${__hooks}/rules-api.js`);
  const tpl = ((R.listRuleTemplates(app) || {}).body || {}).templates || [];
  const id = String(ref || "").trim();
  return tpl.find((t) => t.id === id) || podleNazvu(tpl, id, (x) => x.name) || null;
}
// připomínky uživatele k uzlu (DTO z events-api)
function pripominkyUzlu(app, auth, mapId, nodeId) {
  const E = require(`${__hooks}/events-api.js`);
  return ((E.listNodeReminders(app, auth, mapId, nodeId) || {}).body || {}).reminders || [];
}
// uzel mapy podle id nebo názvu → id uzlu nebo ""
function uzelId(app, auth, mapId, ref) {
  const id = String(ref || "");
  if (!id || id.toLowerCase() === "apex") return "";
  const { v1ReadableMap, jsonVal } = require(`${__hooks}/helpers.js`);
  const r = v1ReadableMap(app, mapId, auth);
  if (!r) return "";
  const nodes = jsonVal(r.map, "nodes", []).filter((n) => n.type !== "note");
  if (nodes.some((n) => n.id === id)) return id;
  const n = podleNazvu(nodes, id, (x) => (x.data || {}).title || (x.data || {}).apexText || "");
  return n ? n.id : "";
}
function napadNaPolozku(rec) {
  const it = { title: ocisti(rec.getString("title"), 200) };
  const d = ocisti(rec.getString("description"), 2000);
  if (d) it.description = d;
  return it;
}
// Modelu se id map, uzlů a nápadů NEUKAZUJÍ. Porovnání 13. 9. 2026: qwen3.8
// i gemma4:26b v textu správně řekly „pod Obchod a marketing", ale do nástroje
// přepsaly id uzlu ručně — a protože id jsou `node-<čas>-<pořadí>`, trefily
// existující, ale JINÝ uzel. Bez id zbývají jen názvy, které drží (resolvery
// podleNazvu). Id pravidel zůstávají (set_rule_enabled je potřebuje).
function bezId(text) {
  return String(text || "")
    .replace(/\(id: [^,)]*, /g, "(")
    .replace(/\(id: [^,)]*\)/g, "")
    .replace(/, id: [^,)]*/g, "")
    .replace(/ \(\)/g, "")
    .replace(/[ \t]+\n/g, "\n");
}
// Práva se ověří PŘED kartou: řešitel (work) / čtenář (read) smí přes API jen stav
// VLASTNÍHO uzlu (zrcadlo v1 a aplikace) — plán, vkládání, pravidla chtějí edit.
// Bez toho uživatel potvrdil kartu a teprve pak viděl 403 (tengo 13. 9. 2026).
function pravaMapy(app, auth, mapRef) {
  const { mapAccessLevel, v1ReadableMap } = require(`${__hooks}/helpers.js`);
  const r = v1ReadableMap(app, mapaId(app, auth, mapRef), auth);
  if (!r) return null;
  return { map: r.map, level: r.isOwner ? "edit" : mapAccessLevel(app, r.map, auth.id, auth.email()) };
}
function chybaPrav(app, auth, name, a) {
  const p = pravaMapy(app, auth, a.map_id);
  if (!p || p.level === "edit") return null;
  if (name === "update_node") {
    const jen = Object.keys(a).filter((k) => !["map_id", "node_id", "note"].includes(k) && a[k] !== undefined);
    if (jen.length === 1 && jen[0] === "status") {
      const { nodeIsMine, jsonVal } = require(`${__hooks}/helpers.js`);
      const nid = uzelId(app, auth, p.map.id, a.node_id);
      const n = jsonVal(p.map, "nodes", []).find((x) => x.id === nid);
      if (n && nodeIsMine(app, p.map.id, n, auth.email())) return null;
      return `Error: in the map "${p.map.getString("title")}" the user has only "${p.level}" access — the status can be changed only on the user's OWN node (this node is not theirs). Do not offer other changes there.`;
    }
    return `Error: in the map "${p.map.getString("title")}" the user has only "${p.level}" access — only the status of their own node can be changed there, not ${jen.join("/")}. Tell the user plainly and do not offer it again.`;
  }
  return `Error: in the map "${p.map.getString("title")}" the user has only "${p.level}" access — adding nodes, ideas or rules needs edit rights (the map owner can grant them). Tell the user plainly and do not offer it again.`;
}
// krátké datum pro kartu: cs „21. 9.“, en „21 Sep“ (do 19. 9. 2026 šlo v EN ISO — nález Richarda 17. 9.)
const MESICE_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// uvozovky podle jazyka karty: cs „…“, en "…" (dluh ze 17. 9. 2026 — en karty měly české)
const uvoz = (text, L) => (L === "en" ? `"${text}"` : `„${text}“`);
function datumKratce(d, L) {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(d || "");
  return L === "en" ? `${Number(m[3])} ${MESICE_EN[Number(m[2]) - 1] || m[2]}` : `${Number(m[3])}. ${Number(m[2])}.`;
}
// ⚠️ toLocaleDateString("en-CA") v goja vrací „09/17/2026“, ne ISO → data přes fmtDateLocal/addDaysStr
// z helpers.js, podle kterých se pravidla spouštějí (jedna pravda)
const ymdLocal = (d) => require(`${__hooks}/helpers.js`).fmtDateLocal(d);
function posunDatum(ymd, dni) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return require(`${__hooks}/helpers.js`).addDaysStr(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])), dni);
}

// Kontroly před kartou (dřív uzávěry v overZapisZaklad) — jedna definice pro chat.js i moduly skupin.
function kontrolyZapisu(app, auth) {
  const chybaMapy = (ref) => (mapaId(app, auth, ref) ? null : `Error: map "${String(ref || "")}" not found or not accessible (use list_maps; pass the id or the exact title).`);
  const chybaUzlu = (mapRef, ref) => (!ref || uzelId(app, auth, mapaId(app, auth, mapRef), ref) || String(ref).toLowerCase() === "apex" ? null : `Error: node "${String(ref)}" not found in the map (use get_map; pass the node id or its exact title).`);
  const chybaNapadu = (ref) => (napadZaznam(app, auth, ref) ? null : `Error: idea "${String(ref || "")}" not found in the user's buffer (use list_ideas; pass the id or the exact title).`);
  return { chybaMapy, chybaUzlu, chybaNapadu };
}

// Pojmenování pro popisy karet (dřív uzávěry v popisAkce).
function pojmenovani(app, auth) {
  const nazevMapy = (id) => {
    try {
      const { v1ReadableMap } = require(`${__hooks}/helpers.js`);
      const r = v1ReadableMap(app, mapaId(app, auth, id) || String(id || ""), auth);
      return r ? r.map.getString("title") : String(id || "?");
    } catch (err) { return String(id || "?"); }
  };
  const nazevNapadu = (ref) => { const r = napadZaznam(app, auth, ref); return r ? r.getString("title") : `?${String(ref || "")}`; };
  const uzelData = (mapRef, ref) => {
    try {
      const { v1ReadableMap, jsonVal } = require(`${__hooks}/helpers.js`);
      const mid = mapaId(app, auth, mapRef);
      const nid = uzelId(app, auth, mid, ref);
      const r = v1ReadableMap(app, mid, auth);
      const n = r ? jsonVal(r.map, "nodes", []).find((x) => x.id === nid) : null;
      return (n && n.data) || {};
    } catch (err) { return {}; }
  };
  const nazevUzlu = (mapRef, ref) => {
    try {
      const { v1ReadableMap, jsonVal } = require(`${__hooks}/helpers.js`);
      const mid = mapaId(app, auth, mapRef);
      const nid = uzelId(app, auth, mid, ref);
      const r = v1ReadableMap(app, mid, auth);
      const n = r ? jsonVal(r.map, "nodes", []).find((x) => x.id === nid) : null;
      return n ? ((n.data || {}).title || (n.data || {}).apexText || "") : `?${String(ref || "")}`;
    } catch (err) { return String(ref || "?"); }
  };
  return { nazevMapy, nazevNapadu, uzelData, nazevUzlu };
}

module.exports = { MAX_ZN, RE_CISLO_PROJEKTU, MAX_MAP_ZAZNAMU, V1_BASE, ocisti, dnes, dosad, TREE_ITEM, bezDiakritiky, zaznamyMap, mapyUzivatele, napadyUzivatele, sDocasnymKlicem, chybaV1, norm, podleNazvu, napadPodleId, napadyProSmazani, napadZaznam, mapaId, titulMapy, titulUzlu, pravidloId, sablonaDto, pripominkyUzlu, uzelId, napadNaPolozku, bezId, pravaMapy, chybaPrav, MESICE_EN, uvoz, datumKratce, ymdLocal, posunDatum, kontrolyZapisu, pojmenovani };
