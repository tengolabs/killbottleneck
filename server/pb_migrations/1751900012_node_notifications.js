/// <reference path="../pb_data/types.d.ts" />
// Notifikace i pro uzly map: přiřazení uzlů ze šablony (node_assigned)
// a odblokování čekajícího uzlu (node_unblocked). node_id = uzel v JSON mapy.
migrate((app) => {
  const notifications = app.findCollectionByNameOrId("notifications");
  const typeField = notifications.fields.getByName("type");
  typeField.values = ["task_assigned", "task_comment", "node_assigned", "node_unblocked"];
  notifications.fields.add(new TextField({ name: "node_id" }));
  app.save(notifications);
}, (app) => {
  const notifications = app.findCollectionByNameOrId("notifications");
  const typeField = notifications.fields.getByName("type");
  typeField.values = ["task_assigned", "task_comment"];
  notifications.fields.removeByName("node_id");
  app.save(notifications);
});
