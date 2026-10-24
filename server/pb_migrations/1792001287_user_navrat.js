/// <reference path="../pb_data/types.d.ts" />
// Návratové e-maily (Richard 14. 10. 2026): kdo se 3 / 7 / 14 / 30 dní nepřihlásí,
// dostane e-mail se shrnutím své rozdělané práce a nejmenšími kroky zpátky.
// Stav žebříku žije na users jako JSON `navrat`:
//   { cyklus:   "<users.last_login v době odeslání>"  — cyklus = jedno období bez přihlášení,
//     krok:     7,                                       — poslední odeslaný stupeň žebříku,
//     odeslano: "<ISO>",
//     odhlasit: "<sha256 odhlašovacího tokenu>"          — token sám je jen v odkazu v mailu,
//     odhlaseno: false }                                 — „už mi to neposílejte"
// Proč na users a ne v mail_budget: závory v mail_budget se po 40 dnech uklízejí
// a žebřík sahá na 30 dní — po úklidu by se stupeň poslal znovu. Pole píše jen
// server (zámek v users update hooku pouští z klienta JEN `odhlaseno`).
//
// Razítko = čas vzniku. PocketBase aplikuje každou dosud neaplikovanou migraci podle
// jména, i s nižším razítkem než poslední aplikovaná (ověřeno sondou 13. 10. 2026).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new JSONField({ name: "navrat", maxSize: 600 }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("navrat");
  app.save(users);
});
