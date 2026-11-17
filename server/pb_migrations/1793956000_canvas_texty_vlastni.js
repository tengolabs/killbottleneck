/// <reference path="../pb_data/types.d.ts" />
// Šablony Business Model Canvas a Lean Canvas: texty bloků přeformulované vlastními slovy
// + uvedení autorů rámce (Osterwalder / Maurya, CC BY-SA 3.0). Lean Canvas měl popisy bloků
// skoro doslova z originálu (licenční audit 14. 10. a 4. 11. 2026, nález L1). Seed
// (1787827854) existující šablony přeskakuje, proto existující instance dostanou nové
// texty tudy: systémová šablona (owner = '') se přepíše ze stejného JSON jako seed.
// Přepisuje se JEN šablona s původním zněním ze seedu — systémovou šablonu smí upravit
// i admin instance (updateRule v 1751900011) a jeho úpravy se nesmí potichu zahodit
// (/checkup 6. 11. 2026): upravená se ponechá a zaloguje. Osobní kopie uživatelů
// (owner ≠ '') se nemění. Idempotentní.
// LIMIT of the check (code analysis 4, S8-02): "original wording" is recognised by the DESCRIPTION only
// (Business Model Canvas: both descriptions; Lean Canvas: the end of the description + one English node).
// An administrator who edited the nodes of the template and left the description as it was gets the nodes
// replaced by this migration — it is logged below so that the change is at least visible.
// A fresh instance (the seed already wrote the new texts) is skipped without a line in the log.
const PUVODNI = {
  "Business Model Canvas": (r) => r.getString("description") === "9 stavebních bloků byznys modelu na jedné mapě."
    && r.getString("description_en") === "The 9 building blocks of a business model on one map.",
  // JSON pole vrací Goja jako surové bajty → toString(), ne JSON.stringify (to by dalo pole čísel).
  "Lean Canvas": (r) => /\(Ash Maurya\)\.$/.test(r.getString("description"))
    && /Top 3 features that solve the problem\./.test(toString(r.get("ai_nodes_en"))),
};
migrate((app) => {
  const cesta = $filepath.join(__hooks, "..", "pb_migrations", "data", "system_templates.json");
  const sablony = JSON.parse(toString($os.readFile(cesta)));
  for (const t of sablony) {
    if (!PUVODNI[t.title]) continue;
    let rec;
    try {
      rec = app.findFirstRecordByFilter("templates", "title = {:title} && owner = ''", { title: t.title });
    } catch (err) { continue; /* instance bez systémových šablon — seed to doplní */ }
    // already the new wording (fresh instance, or this migration ran before) — nothing to do, nothing to report
    if (rec.getString("description") === t.description && rec.getString("description_en") === t.description_en) continue;
    if (!PUVODNI[t.title](rec)) {
      console.log("canvas_texty_vlastni: šablona „" + t.title + "“ je upravená adminem — ponechána");
      continue;
    }
    for (const k of ["description", "description_en", "ai_nodes", "ai_nodes_en"]) rec.set(k, t[k]);
    app.save(rec);
    console.log("canvas_texts_rewritten: template \"" + t.title + "\" rewritten with the new wording (description and nodes)");
  }
}, () => { /* zpět netřeba — texty jsou jen jiná formulace */ });
