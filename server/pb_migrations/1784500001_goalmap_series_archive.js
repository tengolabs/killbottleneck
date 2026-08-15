/// <reference path="../pb_data/types.d.ts" />
// Série a archiv map. `series` = id šablony jako TEXT (záměrně ne relace — smazání
// šablony nesmí rozpadnout seskupení v archivu), `series_number` pořadové číslo,
// `series_title` snapshot názvu šablony (nadpis skupiny v archivu). Všechna tři pole
// spravuje výhradně server (create/update hooky). `archived` + `archived_at` — archiv
// dokončených map; smí měnit jen vlastník, archived_at nastavuje server. RLS beze
// změny: archiv viditelnost nemění, filtruje frontend. Razítko = aktuální čas
// (starší by PocketBase přeskočil — viz gotcha automigrate).
migrate((app) => {
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.fields.add(new TextField({ name: "series" }));
  goalmaps.fields.add(new NumberField({ name: "series_number", onlyInt: true, min: 0 }));
  goalmaps.fields.add(new TextField({ name: "series_title", max: 200 }));
  goalmaps.fields.add(new BoolField({ name: "archived" }));
  goalmaps.fields.add(new DateField({ name: "archived_at" }));
  app.save(goalmaps);
}, (app) => {
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.fields.removeByName("series");
  goalmaps.fields.removeByName("series_number");
  goalmaps.fields.removeByName("series_title");
  goalmaps.fields.removeByName("archived");
  goalmaps.fields.removeByName("archived_at");
  app.save(goalmaps);
});
