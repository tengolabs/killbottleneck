/// <reference path="../pb_data/types.d.ts" />
// E-maily účtů malými písmeny (Richard 27. 8. 2026; dluh 1+2 po v0.46 / nálezy S4-01,
// S6-02, S3-04 analýzy kódu). PocketBase unikát je case-sensitive a sdílení, práva
// i Můj den párují PŘESNĚ — účet `Jan.Novak@firma.cz` sdílený projekt nikdy neviděl.
//
// Co dělá: pro každý účet s velkými písmeny v e-mailu (a) přepíše users.email, (b) tutéž
// adresu přepíše VŠUDE, kde je uložená jako text (owner_email, created_by, deputy,
// assignee_email, triggered_by, invited_by, actor(_email), author_email, map_shares.email/
// email_edit — podle živého schématu, ne podle seznamu natvrdo) a v JSON mapy
// (shared_with*, nodes[].data.owner). Přeskočí kolekce clients a externi_kontakty
// (nejsou to účty).
// DVOJČATA (existuje jiný účet, který se liší jen velikostí písmen): kolidující
// účet se NEMĚNÍ, jen se hlasitě zaloguje — instance nesmí spadnout při startu
// kvůli datům zákazníka; rozhodne člověk (sloučit/smazat). ⚠️ Poctivě: u páru
// Jan@ + JAN@ BEZ existujícího jan@ převezme malou adresu STARŠÍ z páru (jde
// první, kolizi nevidí) a teprve mladší se zaloguje jako dvojče — deterministické
// a většinou správně (dvojče vzniká později překlepem), potvrzeno panelem 1. 9.
// a rozhodnutím vlastníka. Idempotentní.
const POLE_TEXT = ["owner_email", "created_by", "deputy", "assignee_email", "triggered_by", "invited_by", "email", "email_edit", "author_email", "actor_email", "actor"];
const PRESKOCIT = ["clients", "externi_kontakty", "_superusers", "_authOrigins", "_externalAuths", "_mfas", "_otps"];
const POLE_JSON_SEZNAM = ["shared_with", "shared_with_edit", "shared_with_work"];

function prepisVsude(app, stary, novy) {
  let zmen = 0;
  for (const col of app.findAllCollections()) {
    const nazev = col.name;
    if (PRESKOCIT.includes(nazev) || nazev.startsWith("_")) continue;
    const pole = [];
    // ⚠️ v Goja je `f.type` METODA (Go Field.Type()), ne vlastnost — `f.type === "text"` bylo vždy false
    for (const f of col.fields) { const typ = typeof f.type === "function" ? f.type() : f.type; if (POLE_TEXT.includes(f.name) && (typ === "text" || typ === "email")) pole.push(f.name); }
    for (const p of pole) {
      if (nazev === "users" && p === "email") continue; // řeší volající
      let rows = [];
      try { rows = app.findRecordsByFilter(nazev, p + " = {:e}", "", 5000, 0, { e: stary }); } catch (err) { console.log("users_email_lowercase: filtr " + nazev + "." + p + " selhal: " + err); continue; }
      for (const r of rows) { r.set(p, novy); app.save(r); zmen++; }
      if (rows.length) console.log("users_email_lowercase: " + nazev + "." + p + " přepsáno " + rows.length + "×");
    }
    if (nazev === "goalmaps") {
      let rows = [];
      // prosté `~` nad JSON (LIKE nad textem) — ověřeno v kontejneru; kombinace s back-relací vracela 0 řádků
      try { rows = app.findRecordsByFilter("goalmaps", "shared_with ~ {:e} || shared_with_edit ~ {:e} || shared_with_work ~ {:e} || nodes ~ {:e}", "", 5000, 0, { e: stary }); } catch (err) { console.log("users_email_lowercase: filtr goalmaps selhal: " + err); rows = []; }
      console.log("users_email_lowercase: goalmaps kandidátů " + rows.length);
      for (const r of rows) {
        let dirty = false;
        for (const p of POLE_JSON_SEZNAM) {
          let list = [];
          try { list = JSON.parse(r.getString(p) || "[]"); } catch (err) { list = []; } // JSON pole číst přes getString (r.get vrací syrové bajty)
          if (Array.isArray(list) && list.includes(stary)) { r.set(p, list.map((x) => (x === stary ? novy : x))); dirty = true; }
        }
        let nodes = [];
        try { nodes = JSON.parse(r.getString("nodes") || "[]"); } catch (err) { nodes = []; }
        if (Array.isArray(nodes) && nodes.some((n) => n && n.data && n.data.owner === stary)) {
          r.set("nodes", nodes.map((n) => (n && n.data && n.data.owner === stary ? Object.assign({}, n, { data: Object.assign({}, n.data, { owner: novy }) }) : n)));
          dirty = true;
        }
        if (dirty) { app.save(r); zmen++; }
      }
    }
  }
  return zmen;
}

migrate((app) => {
  let users = [];
  try { users = app.findRecordsByFilter("users", "id != ''", "created", 10000, 0); } catch (err) { return; }
  let opraveno = 0, dvojcat = 0;
  for (const u of users) {
    const stary = u.getString("email");
    const novy = stary.trim().toLowerCase();
    if (!novy || novy === stary) continue;
    let dvojce = null;
    try { dvojce = app.findFirstRecordByFilter("users", "email = {:e} && id != {:id}", { e: novy, id: u.id }); } catch (err) { dvojce = null; }
    if (dvojce) {
      dvojcat++;
      console.log("users_email_lowercase: ⚠️ DVOJČE — účet " + stary + " (" + u.id + ") ponechán beze změny; adresu " + novy + " drží účet " + dvojce.id + " (starší z páru ji převzal, nebo existovala) — sloučit/smazat ručně");
      continue;
    }
    const zmen = prepisVsude(app, stary, novy);
    u.set("email", novy);
    app.save(u);
    opraveno++;
    console.log("users_email_lowercase: " + stary + " → " + novy + " (" + zmen + " odkazů přepsáno)");
  }
  if (opraveno || dvojcat) console.log("users_email_lowercase: opraveno " + opraveno + " účtů, dvojčat " + dvojcat);
}, (app) => { /* nevratné — původní velikost písmen se neuchovává */ });
