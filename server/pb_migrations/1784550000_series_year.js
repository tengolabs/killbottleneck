/// <reference path="../pb_data/types.d.ts" />
// Roční rollover číselných řad (Richard 2026-07-20): nový rok = čítač znovu od 1,
// rok je součástí názvu ({nazev} {rok}-{n} → „Nabídka 2027-1"). `number_year` = rok,
// ke kterému patří aktuální čítač šablony; `series_year` = snapshot roku na mapě
// (seskupení archivu po letech). Obojí spravuje server. Razítko = aktuální čas.
migrate((app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.add(new NumberField({ name: "number_year", onlyInt: true, min: 0 }));
  app.save(templates);
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.fields.add(new NumberField({ name: "series_year", onlyInt: true, min: 0 }));
  app.save(goalmaps);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.removeByName("number_year");
  app.save(templates);
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.fields.removeByName("series_year");
  app.save(goalmaps);
});
