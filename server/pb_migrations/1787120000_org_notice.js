/// <reference path="../pb_data/types.d.ts" />
// Notifikační typ org_notice — zprávy organizační struktury adminům
// (dnes: „člen odešel, pozice se uvolnily" z after-delete hooku users).
// Vzor 1786694910. Uživatel si ho může v předvolbách vypnout (není ALWAYS).
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  if (f.values.indexOf("org_notice") < 0) f.values = f.values.concat(["org_notice"]);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  f.values = f.values.filter((v) => v !== "org_notice");
  app.save(col);
});
