/// <reference path="../pb_data/types.d.ts" />
// Navazující migrace k 1787830245_users_email_lowercase.js (kontrolní panel 31. 8. 2026).
// První migrace přepsala users.email, textová pole kolekcí (owner_email, deputy…),
// shared_with* a nodes[].data.owner — jenže e-mail v JSON uzlů mapy nese i pět dalších
// polí kanonického tvaru (frontend/src/lib/cleanMap.js ↔ helpers.js:canonicalNodeData):
// assignedBy, holder, deputy, automationRequestedBy, deadlineChangeRequestedBy.
// Mixed-case hodnota se po lowercase účtů už nikdy nespáruje (Můj den, org struktura,
// žádosti o termín). Users jsou po migraci 1 lowercase, takže: hodnota, která se
// od e-mailu NĚKTERÉHO účtu liší jen velikostí písmen → lowercase. Hodnoty bez
// odpovídajícího účtu (externisté, volný text) se NEMĚNÍ. Dvojčata neřešíme (users
// srovnala migrace 1). Idempotentní: druhý běh nenajde co přepsat.
// ⚠️ Goja pasti (viz migrace 1787830245): JSON pole číst přes record.getString()
// (r.get vrací syrové bajty); schéma tu nečteme, takže `field.type()` nehrozí.
// Stránkuje se po dávkách (sort `created` se zápisem nemění → offset drží),
// žádný tichý strop 5000.
const POLE = ["assignedBy", "holder", "deputy", "automationRequestedBy", "deadlineChangeRequestedBy"];
const DAVKA = 200;

migrate((app) => {
  // 1) e-maily účtů (po migraci 1 už lowercase) — stránkovaně
  const ucty = {};
  let pocetUctu = 0;
  for (let offset = 0; ; offset += DAVKA) {
    let davka = [];
    try { davka = app.findRecordsByFilter("users", "id != ''", "created", DAVKA, offset); } catch (err) { console.log("users_email_lowercase_2: čtení users selhalo: " + err); break; }
    for (const u of davka) { const e = u.getString("email").trim().toLowerCase(); if (e) ucty[e] = true; }
    pocetUctu += davka.length;
    if (davka.length < DAVKA) break;
  }
  // 2) projít VŠECHNY mapy a přepsat mixed-case hodnoty e-mailových polí uzlů
  let map = 0; let zmenenychMap = 0; let poli = 0;
  for (let offset = 0; ; offset += DAVKA) {
    let davka = [];
    try { davka = app.findRecordsByFilter("goalmaps", "id != ''", "created", DAVKA, offset); } catch (err) { console.log("users_email_lowercase_2: čtení goalmaps selhalo: " + err); break; }
    for (const r of davka) {
      map++;
      let nodes = [];
      try { nodes = JSON.parse(r.getString("nodes") || "[]"); } catch (err) { nodes = []; }
      if (!Array.isArray(nodes)) continue;
      let dirty = false;
      for (const n of nodes) {
        if (!n || !n.data) continue;
        for (const p of POLE) {
          const v = n.data[p];
          if (typeof v !== "string" || !v) continue;
          const maly = v.toLowerCase();
          if (maly !== v && ucty[maly]) { n.data[p] = maly; dirty = true; poli++; }
        }
      }
      if (dirty) { r.set("nodes", nodes); app.save(r); zmenenychMap++; }
    }
    if (davka.length < DAVKA) break;
  }
  console.log("users_email_lowercase_2: účtů " + pocetUctu + ", map " + map + ", přepsáno polí " + poli + " ve " + zmenenychMap + " mapách");
}, (app) => { /* nevratné — původní velikost písmen se neuchovává */ });
