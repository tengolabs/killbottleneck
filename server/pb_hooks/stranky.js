// Stránky asistenta (14. 10. 2026) — jednoduchá HTML stránka (prezentace, přehled, mini-appka),
// kterou pro uživatele napíše asistent nebo připojený agent (MCP / v1 API); uživatel ji vidí
// v panelu vedle chatu a sdílí odkazem nebo s týmem. Rozhodnutí Richarda 14. 10. 2026:
//  · staví asistent v aplikaci + externí agent přes MCP (stejné nástroje);
//  · sdílení: tajný odkaz pro kohokoli (share_token, jde zrušit/obnovit) + „vidí tým“ + od 15. 10.
//    jmenovitě vybraní členové (shared_with) — „jako při sdílení mapy“ (klik-test Richarda);
//  · všude vč. Lite (limity env), V1 = jedna HTML stránka BEZ příloh.
// Bezpečnost = SANDBOX, ne sanitizace: veřejná routa /p/{token} posílá CSP `sandbox` a náhled
// v aplikaci je iframe sandbox bez allow-same-origin → stránka běží jako cizí původ a nedosáhne
// na přihlášení (localStorage) ani API instance. HTML se proto nepřepisuje (jen \u0000 pryč).
//
// Velké HTML NEJDE přes argumenty nástroje v tahu chatu (strop 1500 tokenů, historie, pending
// 19 kB, Cloudflare utne odpověď ~100 s): nástroj jen zadá (stav „ceka“), prohlížeč pak zavolá
// POST /chat/stranka/napsat a server v samostatném požadavku nechá model bez nástrojů napsat
// celý dokument („page writer“, napsat()); výsledek přijde panelu přes PocketBase realtime.
//
// ⚠️ PocketBase JSVM: require() uvnitř funkcí (moduly se nevidí navzájem).

const MAX_TITLE = 200;
const MAX_ZADANI = 16000;
const MAX_HTML_POLE = 400000; // tvrdý strop pole v DB; provozní strop = KB_PAGE_KB
const MAX_SEZNAM = 200;
const NAHLED = 160;
const TOKEN_DELKA = 32;
const TOKEN_ABECEDA = "abcdefghijklmnopqrstuvwxyz0123456789";
const TOKEN_RE = /^[a-z0-9]{32}$/;
const STAVY = ["ceka", "pise", "hotovo", "chyba"];
const MAX_TEXT_PRO_MODEL = 1500; // get_page: model dostane jen text stránky bez tagů, nikdy HTML

function env(j) { return require(`${__hooks}/helpers.js`).env(j); }
// Limity z prostředí (KB_PAGES=0 vypne funkci; Lite má v tenant-add.sh přísnější hodnoty)
function limity() {
  const cislo = (j, vych) => { const n = parseInt(env(j), 10); return n > 0 ? n : vych; };
  return {
    zapnuto: String(env("PAGES") == null ? "1" : env("PAGES")).trim() !== "0",
    max: cislo("PAGES_MAX", 100),
    kb: cislo("PAGE_KB", 300),
    numPredict: cislo("PAGE_NUM_PREDICT", 12000),
    timeout: cislo("PAGE_TIMEOUT", 280),
  };
}

function chybaS(status, klic, params) {
  const e = new Error(klic);
  e.status = status;
  e.klic = klic;
  e.params = params || {};
  return e;
}
function ocisti(s, max) { return String(s == null ? "" : s).replace(/\u0000/g, "").slice(0, max); }
function radek(s, max) { return ocisti(s, max * 2).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function norm(s) { return require(`${__hooks}/helpers.js`).normText(s); }
// délka v bajtech UTF-8 (goja nemá Buffer/TextEncoder); strop KB_PAGE_KB je v bajtech, ne znacích
function utf8Delka(s) {
  const str = String(s || "");
  // regexy běží nativně — smyčka po znacích v goja je u 300 kB stránky (a seznamu stránek) pomalá (/checkup 25. 10. 2026):
  // 2 B pro U+0080–U+07FF (+1 ke kódové jednotce), 3 B pro zbytek BMP (+2), 4 B na pár surrogátů (2 jednotky → +2)
  const dvoj = (str.match(/[\u0080-\u07ff]/g) || []).length;
  const troj = (str.match(/[\u0800-\ud7ff\ue000-\uffff]/g) || []).length;
  const pary = (str.match(/[\ud800-\udbff][\udc00-\udfff]/g) || []).length;
  return str.length + dvoj + 2 * troj + 2 * pary;
}
function overVelikost(html) {
  const l = limity();
  if (utf8Delka(html) > l.kb * 1024 || html.length > MAX_HTML_POLE) throw chybaS(400, "err.pageTooLong", { max: l.kb });
}

// ---------- čtení ----------
function dto(rec, cely, opt) {
  const o = opt || {};
  const vlastnik = o.vlastnik !== false;
  const html = rec.getString("html");
  const token = rec.getString("share_token");
  const out = {
    id: rec.id,
    title: rec.getString("title"),
    stav: rec.getString("stav"),
    chyba: vlastnik ? rec.getString("chyba") : "",
    ma_predchozi: vlastnik && !!rec.getString("predchozi_html"),
    shared: !!token,
    team_visible: !!rec.get("team_visible"),
    map: vlastnik ? rec.getString("map") : "",
    chat: vlastnik ? rec.getString("chat") : "",
    size_kb: Math.round(utf8Delka(html) / 1024 * 10) / 10,
    mine: vlastnik,
    created: rec.getString("created"),
    updated: rec.getString("updated"),
  };
  if (vlastnik) out.share_token = token; // tajemství jen vlastníkovi (tým ho nikdy nedostane)
  out.lide = vlastnik ? lideIds(rec).length : 0; // kolika lidem je jmenovitě nasdílená
  if (cely) out.html = html;
  // během psaní (a po chybě) i rozpracované HTML a kroky writeru — panel ukazuje, co se právě děje
  if (vlastnik && cely && out.stav !== "hotovo") {
    const pr = jsonPole(rec, "prubeh");
    out.prubeh = pr && typeof pr === "object" && Array.isArray(pr.kroky) ? pr : null;
    out.rozepsano = rec.getString("rozepsano");
  }
  return out;
}
// JSON pole záznamu: v goja vrací rec.get() u JSON pole surové bajty, ne objekt → číst přes getString + parse (vzor helpers.jsonVal)
function jsonPole(rec, pole) {
  try { const s = rec.getString(pole); return s ? JSON.parse(s) : null; } catch (err) { return null; }
}
// jmenovitě nasdílení lidé: id uživatelů v JSON poli shared_with
function lideIds(rec) {
  const arr = jsonPole(rec, "shared_with");
  return Array.isArray(arr) ? arr.map(String).filter(Boolean) : [];
}
// {id, name, email} vybraných lidí (jen vlastníkovi — detail a seznam v dialogu sdílení)
function lideDto(app, rec) {
  const out = [];
  for (const id of lideIds(rec)) {
    try { const u = app.findRecordById("users", id); out.push({ id: u.id, name: String(u.getString("name") || u.getString("full_name") || "").trim(), email: u.getString("email") }); }
    catch (err) { /* smazaný účet — v seznamu nebude, při příštím zápisu vypadne */ }
  }
  return out;
}
// Jmenovité sdílení: pridat / odebrat člena (id nebo e-mail účtu na této instanci; sebe ne)
function sdilejS(app, userId, id, akce, clen) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  const ref = String(clen || "").trim();
  let u = null;
  if (ref) {
    try { u = ref.indexOf("@") >= 0 ? app.findAuthRecordByEmail("users", ref.toLowerCase()) : app.findRecordById("users", ref); } catch (err) { u = null; }
  }
  if (!u) throw chybaS(400, "err.pageUserNotFound");
  if (u.id === userId) throw chybaS(400, "err.pageShareSelf");
  const ids = lideIds(rec).filter((x) => x !== u.id);
  const a = String(akce || "");
  if (a === "pridat") ids.push(u.id);
  else if (a !== "odebrat") throw chybaS(400, "err.pageBadAction");
  rec.set("shared_with", ids);
  app.save(rec);
  return rec;
}
// jméno autora u týmových stránek (jen `name`, ne e-mail)
function sAutory(app, dtos) {
  const jmena = {};
  for (const d of dtos) {
    if (d.mine) continue;
    if (!(d.owner in jmena)) {
      try { jmena[d.owner] = String(app.findRecordById("users", d.owner).getString("name") || "").trim(); } catch (err) { jmena[d.owner] = ""; }
    }
    d.owner_name = jmena[d.owner];
  }
  for (const d of dtos) delete d.owner;
  return dtos;
}
function najdiZaznam(app, id) {
  if (!id) return null;
  try { return app.findRecordById("ai_pages", String(id)); } catch (err) { return null; }
}
// stránka uživatele podle id; cizí nebo neexistující → null (404, ne 403 — neprozrazovat)
function najdi(app, userId, id) {
  const rec = najdiZaznam(app, id);
  return rec && rec.getString("user") === userId ? rec : null;
}
// vlastník vidí vše; člen týmu / jmenovitě nasdílený jen stránky, které už mají HTML — i během přepisu (stav ceka/pise/chyba
// se starým html) platí poslední hotová verze, jako mapa při úpravě (/checkup 25. 10. 2026: odkaz dřív na minuty zhasl)
function najdiCitelnou(app, userId, id) {
  const rec = najdiZaznam(app, id);
  if (!rec) return null;
  if (rec.getString("user") === userId) return rec;
  return (rec.get("team_visible") || lideIds(rec).includes(userId)) && rec.getString("html") ? rec : null;
}
function seznam(app, userId, opt) {
  const o = opt || {};
  const params = { u: userId };
  let filtr = "user = {:u}";
  const q = String(o.q || "").trim().slice(0, 100);
  if (q) { params.q = q; filtr += " && title ~ {:q}"; }
  const limit = Math.max(1, Math.min(MAX_SEZNAM, parseInt(o.limit, 10) || MAX_SEZNAM));
  try { return app.findRecordsByFilter("ai_pages", filtr, "-updated", limit, 0, params); } catch (err) { return []; }
}
function seznamTymu(app, userId, opt) {
  const o = opt || {};
  // „sdílené se mnou“ = celý tým NEBO já jmenovitě (shared_with je JSON pole id → podřetězec "id")
  const params = { u: userId, j: `"${userId}"` };
  let filtr = "(team_visible = true || shared_with ~ {:j}) && html != '' && user != {:u}";
  const q = String(o.q || "").trim().slice(0, 100);
  if (q) { params.q = q; filtr += " && title ~ {:q}"; }
  try { return app.findRecordsByFilter("ai_pages", filtr, "-updated", MAX_SEZNAM, 0, params); } catch (err) { return []; }
}
function dtoSeznamu(rec, userId) {
  const d = dto(rec, false, { vlastnik: rec.getString("user") === userId });
  d.owner = rec.getString("user");
  return d;
}
// Odkaz od modelu: id NEBO název (přesný; `presne`=false dovolí i jednoznačný podřetězec)
function podleOdkazu(app, userId, ref, presne) {
  const byId = najdi(app, userId, ref);
  if (byId) return byId;
  const n = norm(ref);
  if (!n) return null;
  const rows = seznam(app, userId, { limit: MAX_SEZNAM });
  const stejne = rows.filter((r) => norm(r.getString("title")) === n);
  if (stejne.length) return stejne[0];
  if (presne) return null;
  const cast = rows.filter((r) => { const t = norm(r.getString("title")); return t && (t.includes(n) || n.includes(t)); });
  return cast.length === 1 ? cast[0] : null;
}
function pocet(app, userId) {
  try { return app.countRecords("ai_pages", $dbx.hashExp({ user: userId })); } catch (err) { return 0; }
}

// ---------- zápis ----------
// Nová stránka. data = {title, zadani, html?, map, team_visible?}; s `html` (MCP/v1) je hned hotová,
// bez něj čeká na page writer (zadani povinné). opt = {chat}
function zaloz(app, userId, data, opt) {
  const o = opt || {};
  const d = data || {};
  const l = limity();
  if (!l.zapnuto) throw chybaS(404, "err.pagesOff");
  const title = radek(d.title, MAX_TITLE);
  const zadani = ocisti(d.zadani, MAX_ZADANI);
  const html = d.html != null ? ocisti(d.html, MAX_HTML_POLE + 1) : "";
  if (!title) throw chybaS(400, "err.pageNoTitle");
  if (html) overVelikost(html);
  else if (!zadani.trim()) throw chybaS(400, "err.pageNoBrief");
  if (pocet(app, userId) >= l.max) throw chybaS(400, "err.pageLimit", { max: l.max });
  const rec = new Record(app.findCollectionByNameOrId("ai_pages"));
  rec.set("user", userId);
  rec.set("title", title);
  rec.set("zadani", zadani);
  rec.set("html", html);
  rec.set("stav", html ? "hotovo" : "ceka");
  rec.set("chyba", "");
  rec.set("team_visible", !!d.team_visible);
  rec.set("map", ocisti(d.map, 40));
  rec.set("chat", ocisti(o.chat, 40));
  app.save(rec);
  return rec;
}
// Asistent chce stránku přepsat: pokyny do `zadani`, stav „ceka“ (HTML zůstává jako náhled,
// writer dostane současné HTML + pokyny a vrátí celý nový dokument)
function zadejPrepis(app, userId, id, data) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  const d = data || {};
  const zadani = ocisti(d.zadani, MAX_ZADANI);
  if (!zadani.trim()) throw chybaS(400, "err.pageNoBrief");
  if (d.title != null && radek(d.title, MAX_TITLE)) rec.set("title", radek(d.title, MAX_TITLE));
  rec.set("zadani", zadani);
  rec.set("stav", "ceka");
  rec.set("chyba", "");
  rec.set("prubeh", null);
  rec.set("rozepsano", "");
  app.save(rec);
  return rec;
}
// Nové HTML (writer, v1 API). Předchozí verze se schová („Vrátit“); opt.predchozi="zachovat" =
// druhý zápis v témž tahu nepřepíše verzi ze začátku tahu (vzor dokumenty.js)
function ulozHtml(app, userId, id, data, opt) {
  const o = opt || {};
  const d = data || {};
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  const html = ocisti(d.html, MAX_HTML_POLE + 1);
  if (!html.trim()) throw chybaS(400, "err.pageNoHtml");
  overVelikost(html);
  const stare = rec.getString("html");
  if (stare && stare !== html && o.predchozi !== "zachovat") {
    rec.set("predchozi_html", stare);
    rec.set("predchozi_title", rec.getString("title"));
  }
  if (d.title != null && radek(d.title, MAX_TITLE)) rec.set("title", radek(d.title, MAX_TITLE));
  rec.set("html", html);
  rec.set("stav", "hotovo");
  rec.set("chyba", "");
  rec.set("rozepsano", "");
  app.save(rec);
  return rec;
}
function nastavStav(app, rec, stav, chyba) {
  rec.set("stav", STAVY.includes(stav) ? stav : "chyba");
  rec.set("chyba", radek(chyba || "", 300));
  app.save(rec);
  return rec;
}
function prejmenuj(app, userId, id, title) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  const t = radek(title, MAX_TITLE);
  if (!t) throw chybaS(400, "err.pageNoTitle");
  rec.set("title", t);
  app.save(rec);
  return rec;
}
// „Vrátit předchozí verzi“: prohodí aktuální a předchozí → druhé kliknutí vrátí zpět
function vratit(app, userId, id) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  if (rec.getString("stav") === "pise" || rec.getString("stav") === "ceka") throw chybaS(409, "err.pageWriting"); // writer by vrácenou verzi hned přepsal
  const pred = rec.getString("predchozi_html");
  if (!pred) throw chybaS(400, "err.pageNoPrevious");
  const ted = rec.getString("html"), tedTitle = rec.getString("title");
  rec.set("html", pred);
  rec.set("title", rec.getString("predchozi_title") || tedTitle);
  rec.set("predchozi_html", ted);
  rec.set("predchozi_title", tedTitle);
  rec.set("stav", "hotovo");
  rec.set("chyba", "");
  app.save(rec);
  return rec;
}
function smazat(app, userId, id) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  app.delete(rec);
}
// Sdílení odkazem: zapnout (nový token, když ještě není) / vypnout / obnovit (nový token, starý hned neplatí)
function sdileni(app, userId, id, akce) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  const a = String(akce || "");
  if (a === "vypnout") rec.set("share_token", "");
  else if (a === "zapnout" || a === "obnovit") {
    if (a === "obnovit" || !rec.getString("share_token")) rec.set("share_token", $security.randomStringWithAlphabet(TOKEN_DELKA, TOKEN_ABECEDA));
  } else throw chybaS(400, "err.pageBadAction");
  app.save(rec);
  return rec;
}
function nastavTym(app, userId, id, viditelna) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.pageNotFound");
  rec.set("team_visible", !!viditelna);
  app.save(rec);
  return rec;
}
// veřejná routa: jen hotové stránky, token přesného tvaru (cokoli jiného = 404 bez dotazu do DB)
function podleTokenu(app, token) {
  const t = String(token || "");
  if (!TOKEN_RE.test(t)) return null;
  let rec;
  try { rec = app.findFirstRecordByFilter("ai_pages", "share_token = {:t}", { t: t }); } catch (err) { return null; }
  return rec && rec.getString("html") ? rec : null; // poslední hotová verze platí i během přepisu
}
function verejnaAdresa(app, e, rec) {
  const { publicBaseUrlFromRequest } = require(`${__hooks}/helpers.js`);
  const token = rec.getString("share_token");
  // adresa, kterou uživatel právě používá (jako odkaz na mapu); KB_PUBLIC_URL až bez použitelného hostu
  return token ? publicBaseUrlFromRequest(app, e, { prednostPozadavku: true }).replace(/\/+$/, "") + "/p/" + token : "";
}

// stránky vzniklé v novém rozhovoru dřív, než měl rozhovor id (chatRun ukládá až na konci)
function doplnChat(app, ids, chatId) {
  for (const id of ids || []) {
    try {
      const rec = app.findRecordById("ai_pages", id);
      if (!rec.getString("chat")) { rec.set("chat", chatId); app.save(rec); }
    } catch (err) { /* smazaná mezitím */ }
  }
}
// Hybrid: lehký model tah předal hlavnímu → nové stránky lehkého smazat, přepisy vrátit
function vratitTah(app, zmeny) {
  for (const z of (zmeny || []).slice().reverse()) {
    try {
      const rec = app.findRecordById("ai_pages", z.id);
      if (z.novy) { app.delete(rec); continue; }
      rec.set("zadani", z.pred.zadani); rec.set("title", z.pred.title); rec.set("stav", z.pred.stav); rec.set("chyba", z.pred.chyba);
      app.save(rec);
    } catch (err) { /* nic k vrácení */ }
  }
}

// chyba → JSON odpověď v jazyce uživatele; cizí výjimka letí dál (500)
function odpovedChyby(e, err) {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  if (err && err.klic) return e.json(err.status || 400, { error: t(userLang(e.auth), err.klic, err.params || {}) });
  throw err;
}

// ---------- HTML z odpovědi modelu ----------
// poslední ```html blok; jinak od <!doctype / <html po </html>; jinak null (model psal text)
function vytahniHtml(text) {
  const s = String(text || "").replace(/\u0000/g, "");
  const bloky = [...s.matchAll(/```(?:html|HTML)?\s*\n([\s\S]*?)\n```/g)].map((m) => m[1]).filter((b) => /<html[\s>]/i.test(b) || /<!doctype/i.test(b));
  let html = bloky.length ? bloky[bloky.length - 1] : "";
  if (!html) {
    const m = s.match(/<!doctype\s+html[\s\S]*<\/html>/i) || s.match(/<html[\s\S]*<\/html>/i);
    html = m ? m[0] : "";
  }
  html = html.trim();
  if (!html || !/<body[\s>]/i.test(html) && !/<html[\s>]/i.test(html)) return null;
  return html;
}
// text stránky bez tagů (pro model i náhled) — skripty a styly pryč
function textBezTagu(html, max) {
  const t = String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
  return t.slice(0, max || NAHLED);
}

// ---------- page writer ----------
// Psaní PO ČÁSTECH (Richard 15. 10. 2026: „chci vidět, jak to streamuje, co dělá“). PocketBase volá
// model synchronně ($http.send vrátí až celou odpověď) — tokeny streamovat NEJDE. Místo toho writer
// skládá stránku z několika menších volání a po každém uloží rozpracované HTML (`rozepsano`) a kroky
// (`prubeh`) do záznamu → panel dostane realtime událost a náhled roste před očima:
//   1. osnova  — model vrátí JSON {style, sections:[{id, heading, content}]}
//   2. kostra  — celý dokument (CSS, hlavička, navigace, patička) se zástupnými značkami <!--SEKCE:id-->
//   3. části   — každá část zvlášť = vnitřní HTML sekce, vloží se mezi <!--sekce:id--> … <!--/sekce:id-->
// Menší volání vyhovují i místním modelům (strop tokenů na výstup). Když model místo osnovy rovnou
// napíše celou stránku (```html blok), bere se tak, jak je (robustnost + staré sady). Přepis: osnova
// přepisu řekne, které části nechat / přepsat / přidat / smazat a jestli přepsat kostru; stránky bez
// značek (napsal je agent přes MCP nebo starší writer) se přepisují vcelku.
const W = {
  system: [
    "You are a web page writer inside the killBottleneck app. You produce ONE complete, self-contained HTML document.",
    "Rules:",
    "- Output ONLY one fenced block starting with ```html and ending with ``` — no explanation before or after.",
    "- Start with <!doctype html>, use <html lang>, <meta charset=\"utf-8\">, a viewport meta, a <title>, CSS inside <style>, JavaScript inside <script>.",
    "- Everything inline in this single file. External libraries only from https CDNs (unpkg, jsdelivr, cdnjs) and only when really needed (charts, maps).",
    "- No fetch/XHR to any server, no forms that submit data, no tracking, no cookies, no localStorage.",
    "- Must look good on a phone and on a desktop (responsive, readable contrast, system fonts).",
    "- Use ONLY the facts and content given below — never invent numbers, names or claims. If something is missing, leave a clear placeholder like [doplnit].",
    "- Write all visible text in the requested language.",
    "- Keep the document under the size limit; prefer clean, modern, simple design.",
    "- VISUAL FIRST: a page is never a wall of text. Draw charts from the facts — progress bars, a Gantt / timeline by dates, stat cards with the key numbers, a donut or bar chart, a traffic light — as inline SVG or pure CSS (preferred; a chart library from a https CDN only when inline really cannot do it). Put an icon (emoji or a small inline SVG) next to every section heading and in status badges. Charts show ONLY the given facts (dates, counts, amounts); no external images.",
  ].join("\n"),
  // 1. osnova
  systemOsnova: [
    "You plan a single-page HTML document (presentation, overview, dashboard or small interactive app) that another step will write section by section.",
    "Reply ONLY with one JSON object, no prose, no code fence:",
    "{\"style\": \"one sentence: look & feel (light/dark, colours, mood)\", \"sections\": [{\"id\": \"short-slug\", \"heading\": \"Section heading in the page language\", \"icon\": \"one emoji for the heading\", \"visual\": \"stat-cards | bars | gantt | timeline | donut | traffic-light | table | checklist | none\", \"content\": \"what exactly goes into this section — copy the relevant facts, numbers, names and lists from the brief verbatim\"}]}",
    "3 to 8 sections, ids are lowercase a-z0-9 and dashes, unique. The first section is the opening (title/summary) — with stat-cards when there are counts or amounts. Use ONLY the facts given — never invent.",
    "Visuals are mandatory, not optional: whenever the facts contain dates give one section a gantt or timeline, whenever they contain counts/amounts/statuses give one section stat-cards, bars, donut or traffic-light; at most two sections may be plain table/none.",
  ].join("\n"),
  osnova: (p) => [
    `Title: ${p.title}`,
    `What the page is (brief):\n${p.brief}`,
    `Facts and content to use:\n${p.content || "(none given — use only the title and brief)"}`,
    `Language of the page: ${p.lang === "en" ? "English" : "Czech"}`,
  ].join("\n\n"),
  // 2. kostra
  systemKostra: (sys) => sys + "\n\n" + [
    "THIS STEP: write the page SKELETON only. The sections' contents are written later by another step.",
    "- Full document: <style> with the whole design (layout, typography, colours, cards, tables, responsive rules), header with the title, optional navigation linking to #sec-<id>, <main>, footer, and any <script> the shell needs.",
    "- Inside <main> put EXACTLY one element per section, in order, with NOTHING inside except the marker:",
    "  <section id=\"sec-<id>\"><!--SEKCE:<id>--></section>",
    "- Do not write any section content, headings or placeholders inside the sections — only the marker comment.",
    "- The <style> MUST include a small visual toolkit the sections will reuse: .cards/.card (stat cards with a big number), .bar/.bar > i (progress bar with a filled part), .gantt (rows with a label and a bar positioned by dates on a shared scale + ONE vertical 'today' line placed by today's date on the same scale, never at the row start), .timeline (vertical line with dots), .badge with status colours (done / running / late / waiting), .light (traffic light dot), .icon (emoji before a heading), responsive table styles.",
  ].join("\n"),
  kostra: (p, sekce) => [
    `Title: ${p.title}`,
    `What the page is (brief):\n${p.brief}`,
    `Style: ${p.style || "clean, modern"}`,
    "Sections (id — heading — planned visual):\n" + sekce.map((s) => `- ${s.id} — ${s.heading}${s.visual ? ` — ${s.visual}` : ""}`).join("\n"),
    `Language of the page: ${p.lang === "en" ? "English" : "Czech"}`,
    `Size limit of the whole page: ${p.kb} kB of HTML.`,
  ].join("\n\n"),
  // 3. jedna část
  systemSekce: [
    "You write ONE section of an existing single-page HTML document. The page skeleton (with its CSS) is given — reuse its classes and look.",
    "Rules:",
    "- Output ONLY one fenced block starting with ```html and ending with ``` containing the INNER HTML of the section: start with its heading (<h2>), then the content. No <section> wrapper, no <html>/<head>/<body>, no <!doctype>.",
    "- You may add a small <style> block scoped to #sec-<id> and a <script> if the section is interactive; no fetch/XHR, no forms that submit, no tracking, no cookies, no localStorage.",
    "- Use ONLY the facts given — never invent numbers, names or claims; missing data = placeholder like [doplnit].",
    "- Write all visible text in the requested language. Keep it compact.",
    "- Start the heading with the section icon (emoji). DRAW the planned visual from the facts as inline SVG or CSS using the skeleton's toolkit classes (stat cards, bars, gantt with bars and the today line on the same date scale, timeline, donut via SVG stroke-dasharray, traffic-light dots, badges) — a chart or cards first, text after. No external images, no chart library unless the skeleton already loads one.",
  ].join("\n"),
  sekce: (p, s, doc, dalsi, stare) => [
    `Page title: ${p.title}`,
    "Page skeleton (reuse its CSS classes):\n```html\n" + doc + "\n```",
    `Section to write: id "${s.id}", heading "${s.heading}"`,
    s.icon ? `Icon for the heading: ${s.icon}` : "",
    s.visual ? `Planned visual: ${s.visual}` : "Planned visual: pick the best fit (cards, bars, gantt, timeline, donut, traffic light) — plain text only if nothing fits",
    `What goes in:\n${s.content || "(see facts)"}`,
    `All facts and content of the page (use what belongs to this section):\n${p.content || p.brief}`,
    stare ? "Current content of this section (rewrite it according to the instructions):\n```html\n" + stare + "\n```" : "",
    p.zmeny ? `Requested changes:\n${p.zmeny}` : "",
    dalsi.length ? "Other sections of the page (do not repeat their content): " + dalsi.join("; ") : "",
    `Language: ${p.lang === "en" ? "English" : "Czech"}`,
  ].filter(Boolean).join("\n\n"),
  // osnova přepisu
  systemOsnovaPrepis: [
    "You plan CHANGES to an existing single-page HTML document that is built from sections marked <!--sekce:id--> … <!--/sekce:id-->.",
    "Reply ONLY with one JSON object, no prose, no code fence:",
    "{\"skeleton\": \"keep\" | \"rewrite\", \"sections\": [{\"id\": \"existing-or-new-slug\", \"action\": \"keep\" | \"rewrite\" | \"new\" | \"delete\", \"heading\": \"…\", \"icon\": \"emoji\", \"visual\": \"stat-cards | bars | gantt | timeline | donut | traffic-light | table | checklist | none\", \"content\": \"what the section must contain after the change (facts verbatim)\"}]}",
    "List ALL sections of the page in the final order (kept ones too). skeleton = \"rewrite\" only when the design/layout/colours/navigation must change. Keep ids of existing sections. Use ONLY the facts given.",
  ].join("\n"),
  // modelu nejde celé HTML (300 kB ≈ 100k tokenů, lokální model by prompt tiše ořízl): kostra bez obsahu částí + textové výtahy
  osnovaPrepis: (p) => [
    `Title: ${p.title}`,
    "Current page SKELETON (each section's content replaced by its marker):\n```html\n" + p.kostra + "\n```",
    "Current sections (id — text excerpt):\n" + (p.casti || []).map((c) => `- ${c.id} — ${c.text || "(empty)"}`).join("\n"),
    `Requested changes:\n${p.zadani}`,
    `Language of the page: ${p.lang === "en" ? "English" : "Czech"}`,
  ].join("\n\n"),
  kostraPrepis: (p, sekce) => [
    `Title: ${p.title}`,
    "Current page SKELETON (sections as markers) — keep what works, apply the requested changes to the design:\n```html\n" + p.kostra + "\n```",
    `Requested changes:\n${p.zadani}`,
    "Sections the new skeleton must contain (id — heading), each ONLY as <section id=\"sec-<id>\"><!--SEKCE:<id>--></section>:\n" + sekce.map((s) => `- ${s.id} — ${s.heading}`).join("\n"),
    `Language of the page: ${p.lang === "en" ? "English" : "Czech"}`,
    `Size limit of the whole page: ${p.kb} kB of HTML.`,
  ].join("\n\n"),
  // celá stránka jedním voláním (záloha, když osnova nevyjde / stránka bez značek)
  nova: (p) => [
    `Title: ${p.title}`,
    `What the page is (brief):\n${p.brief}`,
    `Facts and content to use:\n${p.content || "(none given — use only the title and brief)"}`,
    `Language of the page: ${p.lang === "en" ? "English" : "Czech"}`,
    `Size limit: ${p.kb} kB of HTML.`,
  ].join("\n\n"),
  prepis: (p) => [
    `Title: ${p.title}`,
    "Current page (HTML):\n```html\n" + p.html + "\n```",
    `Requested changes:\n${p.zadani}`,
    `Language of the page: ${p.lang === "en" ? "English" : "Czech"}`,
    `Size limit: ${p.kb} kB of HTML.`,
    "Apply the changes and return the WHOLE updated document in one ```html block.",
  ].join("\n\n"),
};
// zadání od nástroje create_page: brief + fakta v jednom textu (oddělovač drží writer rozdělení)
const ODDELOVAC = "\n\n---FAKTA---\n";
function slozZadani(brief, content) {
  const b = String(brief || "").trim(), c = String(content || "").trim();
  return c ? b + ODDELOVAC + c : b;
}

const MAX_SEKCI = 10;
// Vlastní model zákazníka (bod 7 po v0.89, Richard 26. 10. 2026: stránky píše i jeho model): strop výstupu na volání
// a timeout jako tah chatu (cfg.timeout = 120 s) — Cloudflare Tunnel k domácímu počítači utne odpověď kolem 100 s
// Záloha „celá stránka jedním voláním“ smí víc (ostrý průchod 26. 10.: na 4 000 se usekla bez </html> → chyba; Strata ~105 tok/s
// stihne 8 000 za ~76 s, pomalejší stroj utne timeout); kostra jako na naší AI 6 000 (na 4 000 se taky usekla) — schválil Richard 26. 10. 2026
const VLASTNI_PAGE_NUM_PREDICT = 4000, VLASTNI_PAGE_CELA = 8000;
const MAX_CELKEM_MS = 15 * 60 * 1000;   // celkový rozpočet jednoho psaní (až 22 volání × KB_PAGE_TIMEOUT by jinak dalo hodiny)
const MAX_SOUBEH_NA_UZIVATELE = 2;      // souběžné writery jednoho uživatele (každý = až 22 volání modelu)
const MAX_PREPIS_VCELKU = 100 * 1024;   // stránka bez značek (od agenta) se modelu posílá celá → nad tohle odmítnout
const MAX_VYTAH_CASTI = 800;            // znaků textu z části pro osnovu přepisu
const MAX_NADPIS = 80;
const MAX_OBSAH_SEKCE = 3000;
const ZNACKA = (id) => `<!--SEKCE:${id}-->`;
const slug = (s, n) => {
  const t = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return t || `cast-${n}`;
};
// JSON z odpovědi modelu (první { … poslední }); null když to JSON není
function parsujJson(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch (err) { return null; }
}
// osnova → seznam částí [{id, heading, content, action}] (id unikátní, nejvýš MAX_SEKCI)
// grafika částí (25. 10. 2026, Richard: „ať rovnou dělá grafiku, grafy, ikonky“): osnova každé části přidělí typ vizuálu
// a ikonu, kostra pro ně připraví CSS, část je nakreslí inline SVG/CSS z faktů — žádné externí obrázky
const VISUALY = ["stat-cards", "bars", "gantt", "timeline", "donut", "traffic-light", "table", "checklist", "none"];
function sekceZOsnovy(o, sPrepisem) {
  if (!o || !Array.isArray(o.sections) || !o.sections.length) return null;
  const out = [], uz = {};
  o.sections.slice(0, MAX_SEKCI).forEach((s, i) => {
    if (!s || typeof s !== "object") return;
    let id = slug(s.id, i + 1);
    while (uz[id]) id += "-" + (i + 1);
    uz[id] = true;
    const akce = sPrepisem ? String(s.action || "rewrite").toLowerCase() : "new";
    const visual = String(s.visual || "").toLowerCase().trim();
    out.push({ id: id, heading: radek(s.heading || s.title || id, MAX_NADPIS), content: ocisti(s.content || "", MAX_OBSAH_SEKCE),
      visual: VISUALY.includes(visual) ? visual : "", icon: radek(s.icon || "", 8),
      action: ["keep", "rewrite", "new", "delete"].includes(akce) ? akce : "rewrite" });
  });
  return out.length ? out : null;
}
// fragment části z odpovědi (```html blok nebo holé HTML); obaly <html>/<body>/<section> pryč
function vytahniFragment(text) {
  const s = String(text || "").replace(/\u0000/g, "");
  const bloky = [...s.matchAll(/```(?:html|HTML)?\s*\n([\s\S]*?)\n?```/g)].map((m) => m[1]);
  let f = bloky.length ? bloky[bloky.length - 1] : (/<[a-z][\s\S]*>/i.test(s) ? s : "");
  f = f.trim();
  if (!f) return null;
  const telo = f.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (telo) f = telo[1];
  f = f.replace(/<!doctype[^>]*>/gi, "").replace(/<\/?html[^>]*>/gi, "").replace(/<head[\s\S]*?<\/head>/gi, "");
  const sekce = f.match(/^\s*<section[^>]*>([\s\S]*)<\/section>\s*$/i);
  if (sekce) f = sekce[1];
  f = f.trim();
  return /<[a-z]/i.test(f) ? f : null;
}
// zástupné značky chybějících částí doplnit před </main> (nebo </body>)
function doplnZnacky(doc, sekce) {
  let d = doc;
  for (const s of sekce) {
    if (d.indexOf(ZNACKA(s.id)) >= 0) continue;
    const blok = `\n<section id="sec-${s.id}">${ZNACKA(s.id)}</section>\n`;
    const i = d.search(/<\/main>/i);
    const j = i >= 0 ? i : d.search(/<\/body>/i);
    d = j >= 0 ? d.slice(0, j) + blok + d.slice(j) : d + blok;
  }
  return d;
}
// obsah existující části (mezi <!--sekce:id--> a <!--/sekce:id-->)
function obsahSekce(doc, id) {
  const m = String(doc || "").match(new RegExp(`<!--sekce:${id}-->([\\s\\S]*?)<!--/sekce:${id}-->`));
  return m ? m[1].trim() : null;
}
const maZnacky = (doc) => /<!--sekce:[a-z0-9-]+-->/.test(String(doc || ""));
const idsZnacek = (doc) => [...String(doc || "").matchAll(/<!--sekce:([a-z0-9-]+)-->/g)].map((m) => m[1]).filter((id, i, a) => a.indexOf(id) === i);
// kostra = dokument s hotovými částmi nahrazenými zpět značkou (vstup pro psaní dalších částí)
const kostraZ = (doc) => String(doc || "").replace(/<!--sekce:([a-z0-9-]+)-->[\s\S]*?<!--\/sekce:\1-->/g, (m, id) => ZNACKA(id));
function vlozSekci(doc, id, fragment) {
  return doc.replace(ZNACKA(id), () => `<!--sekce:${id}-->\n${fragment}\n<!--/sekce:${id}-->`);
}
// přepis se zachovanou kostrou: smazané části pryč, přepisované zpět na značku, nové značky dovnitř
function pripravKostruPrepisu(doc, sekce) {
  let d = doc;
  for (const s of sekce) {
    const cely = new RegExp(`\\s*<section\\b[^>]*>\\s*<!--sekce:${s.id}-->[\\s\\S]*?<!--/sekce:${s.id}-->\\s*</section>`);
    const vnitrek = new RegExp(`<!--sekce:${s.id}-->[\\s\\S]*?<!--/sekce:${s.id}-->`);
    if (s.action === "delete") d = cely.test(d) ? d.replace(cely, "") : d.replace(vnitrek, "");
    else if (s.action === "rewrite") d = d.replace(vnitrek, () => ZNACKA(s.id));
  }
  return doplnZnacky(d, sekce.filter((s) => s.action === "new" || (s.action === "rewrite" && d.indexOf(ZNACKA(s.id)) < 0)));
}

// Po startu PocketBase (deploy, OOM): zámky ve store zmizely, záznamy „pise“ by zůstaly bez cesty ven → chyba s vysvětlením,
// panel nabídne Zkusit znovu (/checkup 25. 10. 2026)
function poRestartu(app) {
  let rows = [];
  try { rows = app.findRecordsByFilter("ai_pages", "stav = 'pise'", "", 500, 0); } catch (err) { rows = []; }
  for (const rec of rows) {
    try {
      const { t, userLang } = require(`${__hooks}/i18n.js`);
      let L = "cs"; try { L = userLang(app.findRecordById("users", rec.getString("user"))); } catch (err) { L = "cs"; }
      nastavStav(app, rec, "chyba", t(L, "err.pageInterrupted"));
    } catch (err) { /* další záznam */ }
  }
  return rows.length;
}

// POST /chat/stranka/napsat — napíše stránku ve stavu ceka/chyba (nebo přepis). Vrací {status, body}
// (odpověď píše routa — dvojí e.json() by slepilo tělo). Běží jako samostatný požadavek, ne v tahu.
function napsat(app, e, body) {
  const C = require(`${__hooks}/chat.js`);
  const { llmChat } = require(`${__hooks}/llm.js`);
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  const L = userLang(e.auth);
  const l = limity();
  if (!l.zapnuto) return { status: 404, body: { error: t(L, "err.pagesOff") } };
  const rec = najdi(app, e.auth.id, body && body.id);
  if (!rec) return { status: 404, body: { error: t(L, "err.pageNotFound") } };
  if (rec.getString("stav") === "hotovo") return { status: 200, body: { stranka: dto(rec, false) } }; // nic k psaní
  if (rec.getString("stav") === "pise") {
    const od = Date.parse(rec.getString("updated").replace(" ", "T")) || 0;
    if (Date.now() - od < (l.timeout + 30) * 1000) return { status: 409, body: { error: t(L, "err.pageWriting") } };
  }
  // zámek proti dvojímu psaní (dva prohlížeče / klik „Zkusit znovu“ během psaní) — atomicky ve store, PŘED brzdou
  // (druhý požadavek končí 409 a nesmí z hodinového limitu odečíst váhu stránky); obnovuje se po každém kroku
  const store = app.store();
  const klic = "page:pise:" + rec.id;
  let obsazeno = false;
  store.setFunc(klic, (stary) => {
    const od = Number(stary) || 0;
    if (od && Date.now() - od < (l.timeout + 30) * 1000) { obsazeno = true; return stary; }
    return Date.now();
  });
  if (obsazeno) return { status: 409, body: { error: t(L, "err.pageWriting") } };
  // strop souběžných writerů na uživatele (/checkup 25. 10. 2026: N stránek ve stavu ceka = N × 22 volání naráz)
  const klicU = "page:bezi:" + e.auth.id;
  let moc = false;
  store.setFunc(klicU, (n) => { const c = Number(n) || 0; if (c >= MAX_SOUBEH_NA_UZIVATELE) { moc = true; return n; } return c + 1; });
  const uvolni = () => { store.set(klic, 0); store.setFunc(klicU, (n) => Math.max(0, (Number(n) || 0) - 1)); };
  if (moc) { store.set(klic, 0); return { status: 429, body: { error: t(L, "err.pageTooManyWriting", { max: MAX_SOUBEH_NA_UZIVATELE }) } }; }
  // konfigurace PŘED brzdou: na vlastním modelu zákazníka stránka kvótu nečerpá (jako tah chatu), hodinová brzda zůstává
  const cfgR = C.chatCfg(e, body || {}, L);
  if (cfgR.chyba) { uvolni(); return cfgR.chyba; }
  const cfg = cfgR.cfg;
  const brzda = C.chatBrzda(e, L, { _stranka: true }, cfg);
  if (brzda) { uvolni(); return brzda; }
  const timeout = cfg.vlastni ? Math.min(l.timeout, Number(cfg.timeout) || l.timeout) : l.timeout;
  const numPredict = cfg.vlastni ? Math.min(l.numPredict, VLASTNI_PAGE_NUM_PREDICT) : l.numPredict;
  const numPredictCela = cfg.vlastni ? Math.min(l.numPredict, VLASTNI_PAGE_CELA) : l.numPredict;

  const prepis = !!rec.getString("html");
  const stats = { calls: 0, in: 0, out: 0, cached: 0, tools: ["page_writer"], skupiny: ["stranky"], modely: [], volani: [] };
  const t0 = Date.now();
  let chyba = null;
  let padVlastniho = false; // selhalo spojení s vlastním modelem zákazníka (ne obsah odpovědi) → code ai_vlastni
  const kroky = [];
  let doc = "";
  // krok = {k: osnova|kostra|sekce|cela, t: nadpis části, s: ceka|bezi|hotovo|chyba, ms}
  const krok = (k, nazev, id) => { const x = { k: k, t: nazev || "", s: "ceka" }; if (id) x.id = id; kroky.push(x); return x; };
  const uloz = () => {
    rec.set("prubeh", { kroky: kroky, od: t0 });
    rec.set("rozepsano", doc);
    app.save(rec);
    store.set(klic, Date.now());
  };
  const zavolej = (system, user, nVolani, krokRec) => {
    const s = {};
    if (Date.now() - t0 > MAX_CELKEM_MS) throw chybaS(504, "err.pageBudget", { min: Math.round(MAX_CELKEM_MS / 60000) });
    krokRec.s = "bezi"; krokRec.od = Date.now();
    uloz();
    let out;
    try {
      out = llmChat(cfg, system, user, {
        numPredict: nVolani + (cfg.think ? 4000 : 0), timeout: timeout, lang: L, stats: s, temperature: 0.4,
        think: cfg.think === undefined ? false : cfg.think,
      });
    } finally {
      stats.calls += 1; stats.in += s.in || 0; stats.out += s.out || 0; stats.cached += s.cached || 0;
      stats.model = s.model || cfg.model || ""; if (!stats.modely.includes(stats.model)) stats.modely.push(stats.model);
      stats.volani.push({ model: stats.model, provider: cfg.provider || "", in: s.in || 0, cached: s.cached || 0, out: s.out || 0, tier: "heavy", druh: "stranka", vlastni: !!cfg.vlastni }); // vlastní model = 0 kreditů (kredity.js)
      krokRec.ms = Date.now() - krokRec.od;
    }
    return out;
  };
  const hotovKrok = (k) => { k.s = "hotovo"; };
  const nPlan = Math.min(numPredict, 2000), nKostra = Math.min(numPredictCela, 6000), nSekce = Math.min(numPredict, 4000);
  nastavStav(app, rec, "pise", "");
  // do ai_chat_prubeh (ukazatel průběhu TAHU) writer nezapisuje: uživatel mezitím chatuje a tah i writer by si ukazatel
  // navzájem nulovaly; panel Stránek má vlastní `prubeh` v záznamu (/checkup 25. 10. 2026)
  try {
    const zadani = rec.getString("zadani");
    const i = zadani.indexOf(ODDELOVAC);
    const p = { title: rec.getString("title"), lang: L, kb: l.kb, html: rec.getString("html"), zadani: zadani,
      brief: i >= 0 ? zadani.slice(0, i) : zadani, content: i >= 0 ? zadani.slice(i + ODDELOVAC.length) : "" };
    if (prepis) {
      if (maZnacky(p.html)) {
        p.kostra = kostraZ(p.html);
        p.casti = idsZnacek(p.html).map((id) => ({ id: id, text: textBezTagu(obsahSekce(p.html, id) || "", MAX_VYTAH_CASTI) }));
      } else if (utf8Delka(p.html) > MAX_PREPIS_VCELKU) throw chybaS(400, "err.pageTooBigRewrite", { max: Math.round(MAX_PREPIS_VCELKU / 1024) });
    }
    // celá stránka jedním voláním (záloha)
    const cela = () => {
      const k = krok("cela", "");
      const html = vytahniHtml(zavolej(W.system, prepis ? W.prepis(p) : W.nova(p), numPredictCela, k));
      if (!html) { k.s = "chyba"; throw chybaS(502, "err.pageNoHtml"); }
      hotovKrok(k);
      return html;
    };
    // jedna část (jeden opakovaný pokus)
    const napisSekci = (s, sekce, stare) => {
      const k = kroky.find((x) => x.k === "sekce" && x.id === s.id) || krok("sekce", s.heading, s.id);
      const dalsi = sekce.filter((x) => x.id !== s.id && x.action !== "delete").map((x) => x.heading);
      let frag = null;
      // model dostává kostru BEZ už napsaných částí (menší vstup, stejný prefix → cache)
      for (let pokus = 0; pokus < 2 && !frag; pokus++) frag = vytahniFragment(zavolej(W.systemSekce, W.sekce(p, s, kostraZ(doc), dalsi, stare), nSekce, k));
      if (!frag) { k.s = "chyba"; throw chybaS(502, "err.pageSectionFailed", { heading: s.heading }); }
      doc = vlozSekci(doc, s.id, frag);
      overVelikost(doc); // hned, ne až po poslední části (rozepsané zůstane v záznamu)
      hotovKrok(k);
      uloz();
    };
    if (!prepis) {
      const kO = krok("osnova", "");
      const outO = zavolej(W.systemOsnova, W.osnova(p), nPlan, kO);
      const primo = vytahniHtml(outO);
      const osnova = primo ? null : parsujJson(outO);
      const sekce = osnova ? sekceZOsnovy(osnova, false) : null;
      if (primo) { hotovKrok(kO); kroky.pop(); doc = primo; krok("cela", "").s = "hotovo"; }
      else if (!sekce) { kO.s = "chyba"; doc = cela(); }
      else {
        kO.info = sekce.length; p.style = radek(osnova.style || "", 200); hotovKrok(kO);
        const kK = krok("kostra", "");
        for (const s of sekce) krok("sekce", s.heading, s.id); // dopředu, ať panel ukáže, co přijde
        const kostra = vytahniHtml(zavolej(W.systemKostra(W.system), W.kostra(p, sekce), nKostra, kK));
        if (!kostra) { kK.s = "chyba"; kroky.splice(kroky.indexOf(kK) + 1); doc = cela(); }
        else {
          doc = doplnZnacky(kostra, sekce); hotovKrok(kK); uloz();
          for (const s of sekce) napisSekci(s, sekce, null);
        }
      }
    } else {
      p.zmeny = p.zadani;
      const kO = krok("osnova", "");
      const outO = maZnacky(p.html) ? zavolej(W.systemOsnovaPrepis, W.osnovaPrepis(p), nPlan, kO) : "";
      const primo = outO ? vytahniHtml(outO) : null;
      const osnova = outO && !primo ? parsujJson(outO) : null;
      const sekce = osnova ? sekceZOsnovy(osnova, true) : null;
      if (primo) { hotovKrok(kO); kroky.pop(); doc = primo; krok("cela", "").s = "hotovo"; }
      else if (!sekce) { if (outO) kO.s = "chyba"; else kroky.pop(); doc = cela(); }
      else {
        kO.info = sekce.filter((s) => s.action !== "keep").length; hotovKrok(kO);
        // zachované části musí v původní stránce existovat; jinak se napíšou znovu
        for (const s of sekce) if (s.action === "keep" && obsahSekce(p.html, s.id) == null) s.action = "new";
        const zive = sekce.filter((s) => s.action !== "delete");
        const prepsat = zive.filter((s) => s.action !== "keep");
        const kostruZnovu = String(osnova.skeleton || "keep").toLowerCase() === "rewrite";
        const kK = kostruZnovu ? krok("kostra", "") : null;
        for (const s of prepsat) krok("sekce", s.heading, s.id);
        if (kostruZnovu) {
          const kostra = vytahniHtml(zavolej(W.systemKostra(W.system), W.kostraPrepis(p, zive), nKostra, kK));
          if (!kostra) { kK.s = "chyba"; throw chybaS(502, "err.pageNoHtml"); }
          doc = doplnZnacky(kostra, zive);
          for (const s of zive) if (s.action === "keep") doc = vlozSekci(doc, s.id, obsahSekce(p.html, s.id));
          hotovKrok(kK); uloz();
        } else {
          doc = pripravKostruPrepisu(p.html, sekce); uloz();
        }
        for (const s of prepsat) napisSekci(s, zive, s.action === "rewrite" ? obsahSekce(p.html, s.id) : null);
      }
    }
    if (!doc) throw chybaS(502, "err.pageNoHtml");
    ulozHtml(app, e.auth.id, rec.id, { html: doc });
  } catch (err) {
    chyba = err && err.klic ? t(L, err.klic, err.params || {}) : String(err && err.message ? err.message : err);
    // obecná chyba dopravy k modelu nese URL brány → člen dostane krátkou hlášku, správce plné znění (jako chatChyba)
    // vlastní model zákazníka: selhal jeho stroj/tunel → říct to rovnou (jako chatChyba), bez přepnutí na naši AI
    padVlastniho = !(err && err.klic) && !!cfg.vlastni;
    if (padVlastniho) chyba = cfg.podrobneChyby ? t(L, "err.aiVlastniDownAdmin", { msg: chyba }) : t(L, "err.aiVlastniDown");
    else if (!(err && err.klic) && !cfg.podrobneChyby) chyba = t(L, "err.chatFailedShort");
    for (const k of kroky) if (k.s === "bezi") k.s = "chyba";
    try { rec.set("prubeh", { kroky: kroky, od: t0 }); rec.set("rozepsano", doc); nastavStav(app, rec, "chyba", chyba); } catch (e2) { /* záznam mezitím smazán */ }
  } finally {
    uvolni();
  }
  C.zapisLog(app, e.auth, { id: rec.getString("chat") }, cfg, stats, Date.now() - t0, chyba);
  const fresh = najdi(app, e.auth.id, rec.id) || rec;
  return { status: chyba ? 502 : 200, body: chyba ? Object.assign({ error: chyba, stranka: dto(fresh, false) }, padVlastniho ? { code: "ai_vlastni" } : {}) : { stranka: dto(fresh, true) } };
}

// ---------- texty pro model (nástroje list_pages / get_page) ----------
const STAV_TEXT = { ceka: "queued", pise: "being written", hotovo: "ready", chyba: "failed" };
function nastrojSeznam(app, userId) {
  const rows = seznam(app, userId, { limit: 30 });
  if (!rows.length) return "The user has no pages yet.";
  return rows.map((r) => {
    const sdil = r.getString("share_token") ? "shared by link" : "not shared";
    const n = lideIds(r).length;
    return `• ${r.getString("title")} (${STAV_TEXT[r.getString("stav")] || r.getString("stav")}, ${sdil}${r.get("team_visible") ? ", visible to team" : ""}${n ? `, shared with ${n} ${n === 1 ? "person" : "people"}` : ""}, updated ${r.getString("updated").slice(0, 10)})`;
  }).join("\n");
}
function nastrojCteni(app, userId, ref) {
  const rec = podleOdkazu(app, userId, ref);
  if (!rec) return `Error: page "${String(ref || "")}" not found (use list_pages; pass the exact title).`;
  const stav = rec.getString("stav");
  const hl = [`Title: ${rec.getString("title")}`, `Status: ${STAV_TEXT[stav] || stav}`,
    `Sharing: ${rec.getString("share_token") ? "public link ON" : "no public link"}${rec.get("team_visible") ? ", visible to team" : ""}${lideDto(app, rec).length ? ", shared with: " + lideDto(app, rec).map((u) => u.name ? `${u.name} (${u.email})` : u.email).join(", ") : ""}`,
    `Size: ${Math.round(utf8Delka(rec.getString("html")) / 1024)} kB`];
  if (stav === "chyba" && rec.getString("chyba")) hl.push(`Error: ${rec.getString("chyba")}`);
  const txt = textBezTagu(rec.getString("html"), MAX_TEXT_PRO_MODEL);
  return hl.join("\n") + "\n\nPage text (without markup, truncated):\n" + (txt || "(empty)");
}

// ---------- v1 API (MCP) ----------
function v1Dto(app, e, rec, cely) {
  const lide = lideDto(app, rec);
  const out = {
    id: rec.id, title: rec.getString("title"), status: rec.getString("stav"),
    share_url: verejnaAdresa(app, e, rec), team_visible: !!rec.get("team_visible"),
    shared_with: lide.map((u) => u.email),
    size_kb: Math.round(utf8Delka(rec.getString("html")) / 1024 * 10) / 10,
    created: rec.getString("created"), updated: rec.getString("updated"),
  };
  if (cely) out.html = rec.getString("html");
  return out;
}
function v1Chyba(e, user, err) {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  if (err && err.klic) return e.json(err.status || 400, { error: t(userLang(user), err.klic, err.params || {}) });
  throw err;
}

module.exports = {
  poRestartu,
  MAX_TITLE, MAX_ZADANI, MAX_SEZNAM, STAVY, TOKEN_RE, ODDELOVAC, W,
  limity, dto, dtoSeznamu, sAutory, najdi, najdiCitelnou, seznam, seznamTymu, podleOdkazu, pocet,
  zaloz, zadejPrepis, ulozHtml, nastavStav, prejmenuj, vratit, smazat, sdileni, nastavTym, sdilejS, lideIds, lideDto, podleTokenu, verejnaAdresa,
  doplnChat, vratitTah, odpovedChyby, vytahniHtml, textBezTagu, slozZadani, napsat, nastrojSeznam, nastrojCteni, utf8Delka, radek, ocisti, v1Dto, v1Chyba,
};
