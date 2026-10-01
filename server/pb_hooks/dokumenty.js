// Dokumenty asistenta (30. 9. 2026) — poznámky, koncepty e-mailů a sumáře v panelu
// vedle chatu (jako plán/artefakt v Claude). Rozhodnutí Richarda 30. 9.:
//  · SOUKROMÉ: dokument vidí a mění jen jeho vlastník (cizí id = 404, ne 403).
//  · E-mail je jen koncept (Kopírovat / Otevřít v poště) — nic se neodesílá.
//  · Uživatel upravuje v panelu; asistent přepíše na požádání (update_document).
//  · Každá změna si nechá předchozí verzi (`predchozi`) → „Vrátit předchozí verzi“.
// Zakládá je JEN asistent (draft_text v chat.js); panel (routy /chat/dokument*) je upravuje,
// vrací a maže (Richard 1. 10. 2026: ruční poznámky by se tloukly se zásobníkem nápadů).
// Samostatný modul, ať chat.js nebobtná a routy i nástroje mají jedny stropy a jednu
// kontrolu vlastníka.
//
// ⚠️ PocketBase JSVM: require() uvnitř funkcí (moduly se nevidí navzájem).

const MAX_TEXT = 20000;
const MAX_TITLE = 200;
const MAX_TO = 500;
const MAX_SUBJECT = 300;
// na uživatele; nad strop se nic tiše nemaže — model i uživatel dostanou hlášku. Strop = kolik
// panel ukáže a asistent dohledá podle názvu (checkup 1. 10.: 500 slibovalo víc, než šlo vidět)
const MAX_DOKUMENTU = 200;
const MAX_SEZNAM = MAX_DOKUMENTU;
const NAHLED = 160;
const DRUHY = ["note", "email", "summary", "meeting", "call", "other"];
// filtr v panelu: Poznámky = vše kromě e-mailů a sumářů (body k poradě/telefonátu jsou poznámky)
const SKUPINY = {
  poznamky: ["note", "meeting", "call", "other"],
  emaily: ["email"],
  sumare: ["summary"],
};

function chybaS(status, klic, params) {
  const e = new Error(klic);
  e.status = status;
  e.klic = klic;
  e.params = params || {};
  return e;
}
function ocisti(s, max) {
  return String(s == null ? "" : s).replace(/\u0000/g, "").slice(0, max);
}
// jednořádková pole (název, adresát, předmět): bez CR/LF — jdou do mailto a do hlaviček pošty
function radek(s, max) {
  return ocisti(s, max * 2).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function jsonPole(rec, pole) {
  const { jsonVal } = require(`${__hooks}/helpers.js`);
  return jsonVal(rec, pole, null);
}

// Název, když ho model ani uživatel nedal: první neprázdný řádek textu.
function nazevZTextu(text) {
  const r = String(text || "").split("\n").map((x) => x.replace(/^[#\s\-–•*]+/, "").trim()).find(Boolean) || "";
  return r.slice(0, 80);
}

// E-mail od modelu často nese „Předmět: …“ na prvním řádku textu (dřívější prompt to tak chtěl).
// Když předmět nepřišel zvlášť, vytáhnout ho — do pošty jde předmět i tělo odděleně.
function rozdelPredmet(text) {
  const m = String(text || "").match(/^\s*(?:předmět|predmet|subject)\s*:\s*(.+)\n+/i);
  if (!m) return { subject: "", text: String(text || "") };
  return { subject: m[1].trim(), text: String(text).slice(m[0].length) };
}

function dto(rec, cely) {
  const text = rec.getString("text");
  const out = {
    id: rec.id,
    kind: rec.getString("kind"),
    title: rec.getString("title"),
    email_to: rec.getString("email_to"),
    email_subject: rec.getString("email_subject"),
    map: rec.getString("map"),
    chat: rec.getString("chat"),
    ma_predchozi: !!jsonPole(rec, "predchozi"),
    created: rec.getString("created"),
    updated: rec.getString("updated"),
  };
  if (cely) out.text = text;
  else out.nahled = text.replace(/\s+/g, " ").trim().slice(0, NAHLED);
  return out;
}

// Zástupný text místo obsahu („placeholder“, „…“, „TODO“, „[text]“) — celý text je jen tohle.
const ZASTUPNY = /^[\[(<{"„]?\s*(placeholder|todo|tbd|tba|lorem ipsum.*|x{3,}|\.{2,}|…|text|zde text|sem text|text here|your text|obsah|content|draft|koncept)\s*[\])>}"“]?[.!]?$/i;
function jeZastupny(text) {
  const t = String(text || "").trim();
  return !t || ZASTUPNY.test(t);
}

// Název projektu, ke kterému dokument patří (pole `map`) — pro odkaz „Otevřít projekt“ v panelu
// (Richard 1. 10. 2026: ze sumáře kliknout na mapu jako v asistentovi). Jen mapy, které uživatel
// pořád VIDÍ: smazaná nebo odebraná mapa = bez odkazu (a bez prozrazení názvu). Jedno čtení na mapu.
function sProjekty(app, auth, dtos) {
  const { v1ReadableMap } = require(`${__hooks}/helpers.js`);
  const nazvy = {};
  for (const d of dtos) {
    if (!d.map || d.map in nazvy) continue;
    const r = v1ReadableMap(app, d.map, auth);
    nazvy[d.map] = r ? r.map.getString("title") : "";
  }
  for (const d of dtos) {
    d.map_title = d.map ? nazvy[d.map] || "" : "";
    if (d.map && !d.map_title) d.map = ""; // nedostupná mapa → žádný odkaz
  }
  return dtos;
}

// dokument uživatele podle id; cizí nebo neexistující → null
function najdi(app, userId, id) {
  if (!id) return null;
  let rec;
  try { rec = app.findRecordById("ai_documents", String(id)); } catch (err) { return null; }
  return rec.getString("user") === userId ? rec : null;
}

function seznam(app, userId, opt) {
  const o = opt || {};
  const params = { u: userId };
  let filtr = "user = {:u}";
  const druhy = SKUPINY[o.skupina] || null;
  if (druhy) {
    filtr += " && (" + druhy.map((d, i) => { params["k" + i] = d; return `kind = {:k${i}}`; }).join(" || ") + ")";
  }
  const q = String(o.q || "").trim().slice(0, 100);
  if (q) { params.q = q; filtr += " && (title ~ {:q} || text ~ {:q} || email_to ~ {:q} || email_subject ~ {:q})"; }
  const limit = Math.max(1, Math.min(MAX_SEZNAM, parseInt(o.limit, 10) || MAX_SEZNAM));
  try {
    return app.findRecordsByFilter("ai_documents", filtr, "-updated", limit, 0, params);
  } catch (err) { return []; }
}

// Odkaz od modelu: id NEBO název (modely si id pletou — viz chat.js bezId); nejednoznačné → null
// `presne` = jen id nebo přesný název (bez ohledu na velikost písmen a diakritiku) — pro PŘEPIS:
// podřetězec by mohl potichu trefit jiný dokument (checkup 1. 10.: karta ukazovala jiný název)
function podleOdkazu(app, userId, ref, presne) {
  const byId = najdi(app, userId, ref);
  if (byId) return byId;
  const n = norm(ref);
  if (!n) return null;
  const rows = seznam(app, userId, { limit: MAX_SEZNAM });
  const stejne = rows.filter((r) => norm(r.getString("title")) === n);
  if (stejne.length) return stejne[0]; // nejnovější se stejným názvem (seznam je od nejnovějšího)
  if (presne) return null;
  const cast = rows.filter((r) => { const t = norm(r.getString("title")); return t && (t.includes(n) || n.includes(t)); });
  return cast.length === 1 ? cast[0] : null;
}

function snimek(rec) {
  return { title: rec.getString("title"), text: rec.getString("text"), email_to: rec.getString("email_to"), email_subject: rec.getString("email_subject") };
}

// Nový dokument nebo změna existujícího. `data` = {kind, title, text, email_to, email_subject, map};
// u změny se mění jen pole, která přišla (undefined = beze změny). Vrací záznam.
function uloz(app, userId, data, opt) {
  const o = opt || {};
  const d = data || {};
  for (const [k, max] of [["text", MAX_TEXT], ["title", MAX_TITLE], ["email_to", MAX_TO], ["email_subject", MAX_SUBJECT]]) {
    if (d[k] != null && String(d[k]).length > max) throw chybaS(400, "err.docTooLong", { max: max });
  }
  let rec = null;
  if (o.id) {
    rec = najdi(app, userId, o.id);
    if (!rec) throw chybaS(404, "err.docNotFound");
  }
  if (!rec) {
    const text = ocisti(d.text, MAX_TEXT);
    if (!text.trim() && !String(d.title || "").trim()) throw chybaS(400, "err.docEmpty");
    let pocet = 0;
    try { pocet = app.countRecords("ai_documents", $dbx.hashExp({ user: userId })); } catch (err) { pocet = 0; }
    if (pocet >= MAX_DOKUMENTU) throw chybaS(400, "err.docLimit", { max: MAX_DOKUMENTU });
    rec = new Record(app.findCollectionByNameOrId("ai_documents"));
    rec.set("user", userId);
    rec.set("kind", DRUHY.includes(d.kind) ? d.kind : "note");
    rec.set("title", radek(d.title, MAX_TITLE) || nazevZTextu(text) || "—");
    rec.set("text", text);
    rec.set("email_to", radek(d.email_to, MAX_TO));
    rec.set("email_subject", radek(d.email_subject, MAX_SUBJECT));
    rec.set("map", ocisti(d.map, 40));
    rec.set("chat", ocisti(o.chat, 40));
    app.save(rec);
    return rec;
  }
  const pred = snimek(rec);
  const nove = {
    title: d.title != null ? (radek(d.title, MAX_TITLE) || pred.title) : pred.title,
    text: d.text != null ? ocisti(d.text, MAX_TEXT) : pred.text,
    email_to: d.email_to != null ? radek(d.email_to, MAX_TO) : pred.email_to,
    email_subject: d.email_subject != null ? radek(d.email_subject, MAX_SUBJECT) : pred.email_subject,
  };
  if (!nove.text.trim() && !nove.title.trim()) throw chybaS(400, "err.docEmpty");
  const zmena = Object.keys(nove).some((k) => nove[k] !== pred[k]);
  if (!zmena) return rec; // uložení beze změny nesmí přepsat předchozí verzi sama sebou
  // o.predchozi: "zachovat" = druhá změna v TÉMŽ tahu asistenta nepřepíše verzi ze začátku tahu
  // (checkup 1. 10.: dvojí přepis vloženým pokynem by originál smazal nevratně);
  // "smazat" = dvojník konceptu v tahu (první verzi model sám nahradil, nemá co vracet)
  if (o.predchozi === "smazat") rec.set("predchozi", null);
  else if (o.predchozi !== "zachovat") rec.set("predchozi", pred);
  for (const k of Object.keys(nove)) rec.set(k, nove[k]);
  if (d.kind != null && DRUHY.includes(d.kind)) rec.set("kind", d.kind);
  if (o.mapa) rec.set("map", ocisti(d.map, 40)); // jen asistent (draft_text dvojník), routa map nepřijímá
  app.save(rec);
  return rec;
}

// „Vrátit předchozí verzi“: prohodí aktuální a předchozí → druhé kliknutí vrátí zpět
function vratit(app, userId, id) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.docNotFound");
  const pred = jsonPole(rec, "predchozi");
  if (!pred || typeof pred !== "object") throw chybaS(400, "err.docNoPrevious");
  const ted = snimek(rec);
  for (const k of ["title", "text", "email_to", "email_subject"]) rec.set(k, String(pred[k] == null ? "" : pred[k]));
  rec.set("predchozi", ted);
  app.save(rec);
  return rec;
}

function smazat(app, userId, id) {
  const rec = najdi(app, userId, id);
  if (!rec) throw chybaS(404, "err.docNotFound");
  app.delete(rec);
}

// dokumenty vzniklé v novém rozhovoru dřív, než měl rozhovor id (chatRun ukládá až na konci)
function doplnChat(app, ids, chatId) {
  for (const id of ids || []) {
    try {
      const rec = app.findRecordById("ai_documents", id);
      if (!rec.getString("chat")) { rec.set("chat", chatId); app.save(rec); }
    } catch (err) { /* smazaný mezitím — nevadí */ }
  }
}

// Hybrid: lehký model tah předal hlavnímu → co lehký v dokumentech udělal, vrátit,
// jinak by hlavní model stejný koncept založil podruhé (dva stejné dokumenty).
function vratitTah(app, zmeny) {
  for (const z of (zmeny || []).slice().reverse()) {
    try {
      const rec = app.findRecordById("ai_documents", z.id);
      if (z.novy) { app.delete(rec); continue; }
      for (const k of ["title", "text", "email_to", "email_subject"]) rec.set(k, z.pred[k]);
      rec.set("predchozi", z.predPredchozi);
      app.save(rec);
    } catch (err) { /* nic k vrácení */ }
  }
}

// chyba z uloz/vratit/smazat → JSON odpověď v jazyce uživatele; cizí výjimka letí dál (500)
function odpovedChyby(e, err) {
  const { t, userLang } = require(`${__hooks}/i18n.js`);
  if (err && err.klic) return e.json(err.status || 400, { error: t(userLang(e.auth), err.klic, err.params || {}) });
  throw err;
}

// ---------- nástroje asistenta ----------
const DRUH_TEXT = { note: "note", email: "e-mail", summary: "summary", meeting: "meeting points", call: "call points", other: "text" };

function nastrojSeznam(app, userId) {
  const rows = seznam(app, userId, { limit: 30 });
  if (!rows.length) return "The user has no documents yet.";
  return rows.map((r) => `• ${r.getString("title")} (${DRUH_TEXT[r.getString("kind")] || "text"}, updated ${r.getString("updated").slice(0, 10)})`).join("\n");
}
function nastrojCteni(app, userId, ref) {
  const rec = podleOdkazu(app, userId, ref);
  if (!rec) return `Error: document "${String(ref || "")}" not found (use list_documents; pass the exact title).`;
  const hlavicka = [`Title: ${rec.getString("title")}`, `Kind: ${DRUH_TEXT[rec.getString("kind")] || "text"}`];
  if (rec.getString("email_to")) hlavicka.push(`To: ${rec.getString("email_to")}`);
  if (rec.getString("email_subject")) hlavicka.push(`Subject: ${rec.getString("email_subject")}`);
  return hlavicka.join("\n") + "\n\n" + rec.getString("text");
}

module.exports = {
  MAX_TEXT, MAX_TITLE, MAX_DOKUMENTU, DRUHY, SKUPINY,
  dto, sProjekty, najdi, seznam, podleOdkazu, uloz, vratit, smazat, doplnChat, vratitTah, snimek,
  rozdelPredmet, nazevZTextu, odpovedChyby, jeZastupny, norm, radek, nastrojSeznam, nastrojCteni,
};
