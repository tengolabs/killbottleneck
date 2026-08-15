/// <reference path="../pb_data/types.d.ts" />
// Kanban šablony mají VLASTNÍ kategorii „kanban" (Richard 15. 8.: „šablony
// kanban by měly mít svojí sekci"). Seed 1787220000 ji od téhle vlny sází
// rovnou; tahle migrace srovná instance, kde seed stihl proběhnout ještě
// s kategorií „kvalita" (náhled :2054). Idempotentní.
migrate((app) => {
  for (const title of ["8D report — kanban", "FMEA — kanban"]) {
    try {
      const r = app.findFirstRecordByFilter("templates", "title = {:title}", { title });
      if (r.getString("category") !== "kanban") {
        r.set("category", "kanban");
        app.save(r);
      }
    } catch (e) { /* šablona tu není → nic */ }
  }
}, (app) => {
  for (const title of ["8D report — kanban", "FMEA — kanban"]) {
    try {
      const r = app.findFirstRecordByFilter("templates", "title = {:title}", { title });
      r.set("category", "kvalita");
      app.save(r);
    } catch (e) { /* šablona tu není → nic */ }
  }
});
