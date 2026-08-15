/// <reference path="../pb_data/types.d.ts" />
// Zásobník: termín (deadline) — stejný formát YYYY-MM-DD jako v uzlech mapy.
migrate((app) => {
  const c = app.findCollectionByNameOrId("buffer_nodes");
  c.fields.add(new TextField({ name: "deadline" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("buffer_nodes");
  c.fields.removeByName("deadline");
  app.save(c);
});
