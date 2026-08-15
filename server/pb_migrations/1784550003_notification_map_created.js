/// <reference path="../pb_data/types.d.ts" />
// Nový typ notifikace `map_created` — automaticky založený projekt z opakované
// šablony (cron auto_templates) oznámí vlastníkovi šablony. Razítko = aktuální čas.
migrate((app) => {
  const notifications = app.findCollectionByNameOrId("notifications");
  const typeField = notifications.fields.getByName("type");
  typeField.values = ["task_assigned", "task_comment", "node_assigned", "node_unblocked", "map_created"];
  app.save(notifications);
}, (app) => {
  const notifications = app.findCollectionByNameOrId("notifications");
  const typeField = notifications.fields.getByName("type");
  typeField.values = ["task_assigned", "task_comment", "node_assigned", "node_unblocked"];
  app.save(notifications);
});
