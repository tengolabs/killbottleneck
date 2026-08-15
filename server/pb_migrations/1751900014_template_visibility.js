/// <reference path="../pb_data/types.d.ts" />
// Osobní šablony: templates.visibility ("org" = celá organizace, "personal" =
// vidí jen autor). Existující záznamy mají prázdný string, který se chová jako
// org (podmínka visibility != "personal") — plná zpětná kompatibilita.
// Guest dál vidí jen systémové šablony (owner = "").
migrate((app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.add(new SelectField({
    name: "visibility",
    values: ["org", "personal"],
    maxSelect: 1,
  }));
  const rule = 'owner = "" || (@request.auth.id != "" && (visibility != "personal" || owner = @request.auth.id))';
  templates.listRule = rule;
  templates.viewRule = rule;
  app.save(templates);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.removeByName("visibility");
  const rule = 'owner = "" || @request.auth.id != ""'; // stav z migrace 1751900011
  templates.listRule = rule;
  templates.viewRule = rule;
  app.save(templates);
});
