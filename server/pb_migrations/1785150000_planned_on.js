/// <reference path="../pb_data/types.d.ts" />
// „Připnuto na dnešek" → „KDY TO CHCI ŘEŠIT" (rozhodnutí Richarda 27. 7. 2026
// po vyzkoušení lite režimu naostro).
//
// Původní pole `pinned_on` umělo jen dnešek a odložení („zítra", „příští týden")
// místo něj přepisovalo TERMÍN. To bylo špatně: termín je dohoda s někým jiným
// a nemá se měnit tichým kliknutím v seznamu. Richard: „termín je termín a měl
// by se měnit vědomě dotykem na datum a kalendářem."
//
// Nově tedy JEDNO pole = den, kdy to chci řešit, a tři akce nad ním (dnes /
// zítra / příští týden). Termínu se nedotýkají vůbec. Proto i přejmenování:
// „pinned" svádělo k tomu, že jde jen o dnešek.
//
// Rename zachovává data. Dvojče v uzlech mapy je `node.data.plannedOn`
// (JSON blob — starý `pinnedOn` se čte jako záloha, viz helpers.js).
migrate((app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  const f = tasks.fields.getByName("pinned_on");
  if (f) {
    f.name = "planned_on";
    app.save(tasks);
  }
  // Nápad ze zásobníku jde naplánovat taky („tohle chci promyslet zítra") —
  // v přehledu se pak chová stejně jako úkol, jen se nedá odbavit jako hotový.
  const buffer = app.findCollectionByNameOrId("buffer_nodes");
  if (!buffer.fields.getByName("planned_on")) {
    buffer.fields.add(new TextField({ name: "planned_on" })); // YYYY-MM-DD nebo ""
    app.save(buffer);
  }
}, (app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  const f = tasks.fields.getByName("planned_on");
  if (f) {
    f.name = "pinned_on";
    app.save(tasks);
  }
  const buffer = app.findCollectionByNameOrId("buffer_nodes");
  buffer.fields.removeByName("planned_on");
  app.save(buffer);
});
