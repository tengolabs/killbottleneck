/// <reference path="../pb_data/types.d.ts" />
// Slovník (Richard 16.–17. 8. 2026): úkol = uzel s řešitelem nebo termínem,
// samostatné položky-úkoly ZANIKAJÍ („nebude jiná duplicitní tabulka").
// Rozhodnuto SMAZAT, nepřevádět na podcíle. Odpracovaný čas se NEZTRÁCÍ:
// záznam s položkou se přemapuje na její uzel (node_id + map), pak se smažou
// komentáře položek a položky samotné. Kolekce `tasks` zůstává prázdná jako
// detektor chyby (badge v UI) — vytváření blokuje hook v main.pb.js.
// Idempotentní: druhý běh nenajde nic ke smazání.
migrate((app) => {
  // 1) výkaz času: task → node_id/map z položky, ať čas zůstane u práce
  let remap = 0;
  try {
    const entries = app.findRecordsByFilter("time_entries", "task != ''", "", 0, 0);
    for (const rec of entries) {
      try {
        const task = app.findRecordById("tasks", rec.getString("task"));
        if (!rec.getString("node_id") && task.getString("node_id")) {
          rec.set("node_id", task.getString("node_id"));
        }
        if (!rec.getString("map") && task.getString("map")) {
          rec.set("map", task.getString("map"));
        }
      } catch (err) { /* položka už neexistuje — jen odpojit */ }
      rec.set("task", "");
      app.save(rec);
      remap++;
    }
  } catch (err) { /* kolekce času nemusí existovat (staré instance) */ }

  // 2) komentáře položek pryč (visí jen na položkách, bez nich nemají kontext)
  let delC = 0;
  const comments = app.findRecordsByFilter("task_comments", "id != ''", "", 0, 0);
  for (const c of comments) {
    try { app.delete(c); delC++; } catch (err) { /* už smazán */ }
  }

  // 3) položky pryč — nejdřív podúkoly (parent != ''), pak zbytek,
  //    ať mazání rodiče nenarazí na vazbu
  let delT = 0;
  for (const filtr of ["parent != ''", "id != ''"]) {
    const rows = app.findRecordsByFilter("tasks", filtr, "", 0, 0);
    for (const r of rows) {
      try { app.delete(r); delT++; } catch (err) { /* už smazán */ }
    }
  }
  app.logger().info("zruseni_ukolovych_polozek", "cas_premapovan", remap, "komentare", delC, "polozky", delT);
}, (app) => {
  // down: data se nevrací (smazání je rozhodnutí), jen bezpečný no-op
});
