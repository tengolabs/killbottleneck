/// <reference path="../pb_data/types.d.ts" />
// Účel instance (dotazník při prvním přihlášení prvního admina, 25. 8. 2026):
// team / family / solo. Řídí obsah úvodní mapy (uvodni_mapa.js) — „sólo" se
// z počtu lidí poznat nedá, každý je při registraci sám. Prázdné = team.
migrate((app) => {
  const col = app.findCollectionByNameOrId("org_settings");
  col.fields.add(new SelectField({ name: "purpose", values: ["team", "family", "solo"], maxSelect: 1 }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("org_settings");
  col.fields.removeByName("purpose");
  app.save(col);
});
