/// <reference path="../pb_data/types.d.ts" />
// SYSTÉMOVÉ ŠABLONY — jeden zdroj pravdy: data/system_templates.json (40 šablon,
// CS + EN texty, kanban varianty s pravidly). Do 27. 8. 2026 vznikal konečný stav
// řetězem šesti migrací (CS seed → EN překlad → EN korekce 18 → goal_en 19 →
// kanban seed → kategorie kanbanu, 6 369 ř.), takže nikde neexistoval jako zdroj
// (nález M1-04 analýzy kódu). Staré migrace jsou smazané; PocketBase osiřelé řádky
// v `_migrations` ignoruje (migrations_runner.go), takže:
//   • existující instance: každá šablona už existuje (owner = '') → přeskočí se,
//   • nová instance: založí se rovnou v konečném stavu,
//   • instance, které řetěz dokončily jen zčásti (starší než v0.3x): doplní chybějící.
// Dedup je podle title A owner = '' — osobní šablona uživatele se stejným názvem
// systémový seed neblokuje (nález M1-10). Idempotentní, jde spouštět opakovaně.
migrate((app) => {
  const col = app.findCollectionByNameOrId("templates");
  // EN pole zakládala migrace 1785519076 (smazána) — na nové instanci je tu
  if (!col.fields.getByName("title_en")) {
    col.fields.add(new TextField({ name: "title_en", max: 200 }));
    col.fields.add(new TextField({ name: "description_en", max: 1000 }));
    col.fields.add(new TextField({ name: "goal_en", max: 200 }));
    col.fields.add(new JSONField({ name: "ai_nodes_en", maxSize: 1048576 }));
    app.save(col);
  }
  const cesta = $filepath.join(__hooks, "..", "pb_migrations", "data", "system_templates.json");
  const sablony = JSON.parse(toString($os.readFile(cesta)));
  let zalozeno = 0;
  for (const t of sablony) {
    let existuje = false;
    try {
      app.findFirstRecordByFilter("templates", "title = {:title} && owner = ''", { title: t.title });
      existuje = true;
    } catch (err) { /* není → založit */ }
    if (existuje) continue;
    const rec = new Record(col);
    for (const k of Object.keys(t)) rec.set(k, t[k]);
    app.save(rec);
    zalozeno++;
  }
  if (zalozeno > 0) console.log("seed_system_templates: založeno " + zalozeno + " systémových šablon");
}, (app) => {
  const cesta = $filepath.join(__hooks, "..", "pb_migrations", "data", "system_templates.json");
  const sablony = JSON.parse(toString($os.readFile(cesta)));
  for (const t of sablony) {
    try {
      const r = app.findFirstRecordByFilter("templates", "title = {:title} && owner = ''", { title: t.title });
      app.delete(r);
    } catch (err) { /* už není */ }
  }
});
