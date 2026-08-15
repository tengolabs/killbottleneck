/// <reference path="../pb_data/types.d.ts" />
// Šablony jsou generické vzory (ne uživatelská data) — zpřístupnit je ke čtení i
// nepřihlášeným návštěvníkům, aby fungovala demo galerie „vyzkoušejte šablonu".
// Zápis (create/update/delete) zůstává jen pro admina.
migrate((app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.listRule = "";
  templates.viewRule = "";
  app.save(templates);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.listRule = '@request.auth.id != ""';
  templates.viewRule = '@request.auth.id != ""';
  app.save(templates);
});
