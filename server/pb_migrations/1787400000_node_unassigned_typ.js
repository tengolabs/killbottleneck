/// <reference path="../pb_data/types.d.ts" />
// Notifikační typ node_unassigned — komu se práce odebrala nebo předala jinému
// (nález P3-02, analýza 20. 8. 2026: dřív dostal +0 zpráv). Vzor 1787120000.
// Uživatel si ho může v předvolbách vypnout (není ALWAYS).
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  if (f.values.indexOf("node_unassigned") < 0) f.values = f.values.concat(["node_unassigned"]);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  f.values = f.values.filter((v) => v !== "node_unassigned");
  app.save(col);
});
