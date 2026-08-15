/// <reference path="../pb_data/types.d.ts" />
// Uživatelské šablony organizace: každý člen smí uložit šablonu (owner z hooku),
// upravit/smazat autor nebo admin. Systémové (seed) šablony mají owner prázdný
// a zůstávají veřejné (guest galerie); uživatelské vidí jen přihlášení členové.
// ai_nodes položky se rozšiřují o {owner, deadline_offset_days, wait_for_children}
// bez migrace — JSON pole, staré šablony jsou zpětně kompatibilní.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.add(new RelationField({
    name: "owner", collectionId: usersId, maxSelect: 1, cascadeDelete: true,
  }));
  templates.fields.add(new TextField({ name: "owner_email" }));
  templates.listRule = 'owner = "" || @request.auth.id != ""';
  templates.viewRule = templates.listRule;
  templates.createRule = '@request.auth.id != ""';
  templates.updateRule = 'owner = @request.auth.id || @request.auth.role = "admin"';
  templates.deleteRule = 'owner = @request.auth.id || @request.auth.role = "admin"';
  app.save(templates);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.removeByName("owner");
  templates.fields.removeByName("owner_email");
  templates.listRule = "";
  templates.viewRule = "";
  templates.createRule = '@request.auth.role = "admin"';
  templates.updateRule = '@request.auth.role = "admin"';
  templates.deleteRule = '@request.auth.role = "admin"';
  app.save(templates);
});
