/// <reference path="../pb_data/types.d.ts" />
// Měření času jde přiřadit i ke konkrétnímu UZLU mapy (hodinky na uzlu,
// panel záznamů v editoru). Uzel nemá DB identitu (žije v JSON goalmaps.nodes),
// proto text — stejný vzor jako tasks.node_id. Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("time_entries");
  col.fields.add(new TextField({ name: "node_id", max: 100 }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("time_entries");
  col.fields.removeByName("node_id");
  app.save(col);
});
