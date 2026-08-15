/// <reference path="../pb_data/types.d.ts" />
// Nový typ notifikace timer_autostop — pojistka zapomenutých stopek (záznam
// běžící přes 12 h cron automaticky zavře a dá vlastníkovi vědět, ať si ho
// opraví podle skutečnosti). Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const typeField = col.fields.getByName("type");
  typeField.values = ["task_assigned", "task_comment", "node_assigned", "node_unblocked", "map_created", "timer_autostop"];
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const typeField = col.fields.getByName("type");
  typeField.values = ["task_assigned", "task_comment", "node_assigned", "node_unblocked", "map_created"];
  app.save(col);
});
