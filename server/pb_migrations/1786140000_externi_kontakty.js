/// <reference path="../pb_data/types.d.ts" />
// Adresář EXTERNÍCH kontaktů (Richard 11. 8. 2026): lidé mimo systém — účetní,
// dodavatelé — kterým jde zadat uzel/úkol s termínem, ale NIKDY jim nic nechodí
// a o ničem nevědí (čistě interní evidence; notify() neregistrovaný e-mail tiše
// přeskakuje a řešitel se ukládá jako pseudo-e-mail ext-<id>@kontakt.invalid,
// který žádného uživatele nikdy nematchne).
//
// Viditelnost: výchozí pro CELOU instanci (precedens clients — účetní firmy je
// jedna, nemá smysl ji zakládat 5×). Checkbox `private` = kontakt vidí a používá
// JEN zakladatel (osobní soukromé mapy). „Privátní je privátní" — drží RLS na
// serveru, privátní kontakt nesmí číst ani upravit ani admin.
// Pole `email` je ČISTĚ evidenční (nepovinné) — nikdy se na něj nic neposílá.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const contacts = new Collection({
    type: "base",
    name: "external_contacts",
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "note", type: "text", max: 2000 },
      { name: "email", type: "email" },
      { name: "private", type: "bool" },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "owner_email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: '@request.auth.id != "" && (private != true || owner = @request.auth.id)',
    viewRule: '@request.auth.id != "" && (private != true || owner = @request.auth.id)',
    createRule: '@request.auth.id != ""',
    updateRule: 'owner = @request.auth.id || (private != true && @request.auth.role = "admin")',
    deleteRule: 'owner = @request.auth.id || (private != true && @request.auth.role = "admin")',
  });
  app.save(contacts);
}, (app) => {
  const c = app.findCollectionByNameOrId("external_contacts");
  if (c) app.delete(c);
});
