/// <reference path="../pb_data/types.d.ts" />
// Číslované série map ze šablon — nastavení na šabloně. `number_format` (prázdné =
// číslování vypnuto) s tokeny {n}, {n:2..4}, {rok}, {nazev}; `next_number` je čítač
// spravovaný výhradně serverem (inkrement v create hooku goalmaps, klientský zápis
// hook vrací). Razítko = aktuální čas (starší by PocketBase přeskočil kvůli vlastním
// auto-migracím z 2026 — viz gotcha migrace guest-leak / automigrate).
migrate((app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.add(new TextField({ name: "number_format", max: 120 }));
  templates.fields.add(new NumberField({ name: "next_number", onlyInt: true, min: 0 }));
  app.save(templates);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.removeByName("number_format");
  templates.fields.removeByName("next_number");
  app.save(templates);
});
