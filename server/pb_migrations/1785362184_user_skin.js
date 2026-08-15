/// <reference path="../pb_data/types.d.ts" />
// Grafický skin uživatele: skin_id = volba vestavěného ('custom' = vlastní
// importovaný JSON v skin_custom, formát kb-skin v1 — viz pb_hooks/skinValidator.js).
// Prázdné = žádná volba → platí instanční default, jinak výchozí Indigo.
//
// Záměrně POLE NA users, ne vlastní kolekce (vzor language + notify_prefs):
// preference cestuje s účtem mezi zařízeními zdarma, RLS je hotové (self/admin)
// a obsah skin_custom sanitizuje users update hook proti validátoru.
// Razítko = aktuální čas (starší by PocketBase přeskočil kvůli automigracím).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({
    name: "skin_id",
    values: ["indigo", "contrast", "terminal", "sepia", "custom"],
    maxSelect: 1,
  }));
  users.fields.add(new JSONField({ name: "skin_custom", maxSize: 8192 }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("skin_id");
  users.fields.removeByName("skin_custom");
  app.save(users);
});
