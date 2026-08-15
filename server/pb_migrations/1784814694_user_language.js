/// <reference path="../pb_data/types.d.ts" />
// Jazyk uživatele (cs/en) pro i18n — řídí jazyk notifikací, chybových hlášek,
// denního souhrnu a AI odpovědí. Prázdné = čeština (stávající účty se nemění).
// Razítko = aktuální čas (starší by PocketBase přeskočil kvůli vlastním
// auto-migracím z 2026 — viz gotcha migrace guest-leak / automigrate).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({
    name: "language",
    values: ["cs", "en"],
    maxSelect: 1,
  }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("language");
  app.save(users);
});
