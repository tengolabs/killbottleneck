/// <reference path="../pb_data/types.d.ts" />
// Guard for 1793956000_canvas_texty_vlastni (code analysis 4, S8-02 / T1-01).
//
// That migration promises to rewrite only a system template that still has the seeded
// wording, but it recognises "seeded" by the description alone (Business Model Canvas) or
// by the end of the description plus the English blocks (Lean Canvas). An instance admin
// who edited the blocks (`ai_nodes`) and left the description, or who only prefixed the
// Lean Canvas description, lost the edit on upgrade without a line in the log.
//
// 1793956000 is released and already applied on existing instances, so it is not changed.
// This file has an EARLIER stamp on purpose: on an instance that upgrades from before
// v0.101 it runs first and takes the edited template out of the old predicate's reach — it
// writes the new texts into the fields the admin did NOT touch and keeps the edited ones.
// On an instance where 1793956000 already ran (PocketBase applies any unapplied file
// regardless of order) and on a fresh install nothing matches and nothing is written.
//
// "Edited" = differs from the only wording ever seeded (the same in every release from
// v0.33-beta to v0.100-beta; SHA-256 of the canonical JSON, keys sorted). The English
// fields cannot be edited by an admin (the templates hook restores them), so they always
// take the new text.
// (fingerprints carry the "sha256:" prefix so that tests/bez-tajemstvi.sh does not take them for tokens)
const SEEDED = {
  "Business Model Canvas": {
    description: "9 stavebních bloků byznys modelu na jedné mapě.",
    ai_nodes: "sha256:ac82cff4f4468d36a9faabdff61f1a87a8a2b216cf1469ffd84733e56e2e13b9",
    // what 1793956000 tests — when this is false it leaves the template alone
    oldPredicate: (r) => r.getString("description") === "9 stavebních bloků byznys modelu na jedné mapě."
      && r.getString("description_en") === "The 9 building blocks of a business model on one map.",
  },
  "Lean Canvas": {
    description: "9 bloků pro rychlé ověření startupu/produktu (Ash Maurya).",
    ai_nodes: "sha256:342c9d7e6465f3b7ebf4ab8cf75fc03434f55f74ba1084f77aa73bf498a951d1",
    oldPredicate: (r) => /\(Ash Maurya\)\.$/.test(r.getString("description"))
      && /Top 3 features that solve the problem\./.test(toString(r.get("ai_nodes_en"))),
  },
};
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : (v && typeof v === "object") ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"
    : JSON.stringify(v);
migrate((app) => {
  const file = $filepath.join(__hooks, "..", "pb_migrations", "data", "system_templates.json");
  const templates = JSON.parse(toString($os.readFile(file)));
  for (const t of templates) {
    const seeded = SEEDED[t.title];
    if (!seeded) continue;
    let rec;
    try {
      rec = app.findFirstRecordByFilter("templates", "title = {:title} && owner = ''", { title: t.title });
    } catch (err) { continue; /* no system templates yet — the seed creates the new wording */ }
    if (!seeded.oldPredicate(rec)) continue; // already rewritten, or 1793956000 keeps it anyway
    let nodesEdited = true;
    // A JSON field comes from Goja as raw bytes → toString(), then parse.
    try { nodesEdited = "sha256:" + $security.sha256(canon(JSON.parse(toString(rec.get("ai_nodes"))))) !== seeded.ai_nodes; } catch (err) { /* unreadable = not the seed */ }
    const descriptionEdited = rec.getString("description") !== seeded.description;
    if (!nodesEdited && !descriptionEdited) continue; // untouched seed — 1793956000 rewrites it whole
    if (!descriptionEdited) rec.set("description", t.description);
    if (!nodesEdited) rec.set("ai_nodes", t.ai_nodes);
    rec.set("description_en", t.description_en);
    rec.set("ai_nodes_en", t.ai_nodes_en);
    app.save(rec);
    console.log("canvas_keep_admin_edits: template \"" + t.title + "\" was edited by the admin — kept "
      + [descriptionEdited ? "description" : "", nodesEdited ? "blocks" : ""].filter(Boolean).join(" and ")
      + ", the rest takes the new wording");
  }
}, () => { /* nothing to revert — the texts are only a different wording */ });
