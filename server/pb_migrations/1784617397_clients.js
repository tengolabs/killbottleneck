/// <reference path="../pb_data/types.d.ts" />
// Číselník klientů pro měření času (a přiřazení projektů klientovi). Instance-wide
// adresář: číst/zakládat smí každý přihlášený (sdílená mapa musí umět ukázat jméno
// klienta), upravovat/mazat autor nebo admin. Razítko = aktuální čas (automigrate=0
// + starší razítko by PocketBase přeskočil).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const clients = new Collection({
    type: "base",
    name: "clients",
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "color", type: "text", max: 16 },
      { name: "note", type: "text", max: 2000 },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "owner_email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
    deleteRule: 'owner = @request.auth.id || @request.auth.role = "admin"',
  });
  app.save(clients);
}, (app) => {
  const c = app.findCollectionByNameOrId("clients");
  if (c) app.delete(c);
});
