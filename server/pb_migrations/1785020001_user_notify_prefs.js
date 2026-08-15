/// <reference path="../pb_data/types.d.ts" />
// Per-uživatelské nastavení notifikací: { "<typ>": { in_app: bool, email: bool } }.
// Prázdné/chybějící = VŠE ZAPNUTO in-app (default zůstává dnešní chování), e-mail
// vypnutý — kanál se rozsvítí až bude vyřešené SMTP (příští kolo).
//
// Záměrně POLE NA users, ne vlastní kolekce: notify() si uživatele stejně načítá
// (dohledání podle e-mailu), takže preference nestojí ani jeden dotaz navíc —
// u termínového cronu jde o stovky volání v jednom běhu. RLS máme zdarma
// (users.viewRule už je self/admin) a nepřibývá nový povrch pravidel.
//
// Obsah sanitizuje server (users update hook) proti whitelistu typů — uživatel si
// sem nesmí uložit libovolný JSON. Razítko = aktuální čas.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new JSONField({ name: "notify_prefs", maxSize: 4096 }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("notify_prefs");
  app.save(users);
});
