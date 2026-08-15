/// <reference path="../pb_data/types.d.ts" />
// „Co se změnilo" umí zaznamenat PŘESUN uzlu pod jiného rodiče (kanban posun
// pravidlem move_node i ruční přeřazení přes API). Bez hodnoty v SELECTu se
// řádek s field="parent" tiše zahodil — logMapChanges polyká chyby záměrně
// (historie nesmí shodit uložení mapy), takže to neprozradil žádný log.
// from/to nesou NÁZVY rodičů, ne id (historie se čte lidsky).
// ⚠️ Razítko musí být VYŠŠÍ než poslední aplikovaná migrace (1787120000),
// jinak ji PocketBase tiše přeskočí (past z 12. 8.).
migrate((app) => {
  const col = app.findCollectionByNameOrId("map_changes");
  const f = col.fields.getByName("field");
  if (f.values.indexOf("parent") < 0) f.values = f.values.concat(["parent"]);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("map_changes");
  const f = col.fields.getByName("field");
  f.values = f.values.filter((v) => v !== "parent");
  app.save(col);
});
