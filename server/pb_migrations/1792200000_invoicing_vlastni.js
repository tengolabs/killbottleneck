/// <reference path="../pb_data/types.d.ts" />
// Vlastní údaje dodavatele na uživatele (Richard 24. 10. 2026: „chci, aby každý mohl mít svoji fakturu …
// ve Správě organizace společná + ať může mít uživatel svoje“).
//
// `invoicing_profiles`: jeden záznam na uživatele (`user` unikátní), `profil` = tentýž json jako
// `instance_settings.invoicing` (stejná validace faktury.profilOcisti). Má-li uživatel vlastní profil,
// jeho faktury nesou JEHO dodavatele a jedou ve VLASTNÍ číselné řadě; bez něj platí společný profil
// organizace a společná řada. Čtení jen vlastník (RLS), zápis jen server (routy /invoicing-profile/me
// a nástroj set_invoicing_profile scope=me).
//
// `invoices.serie`: "" = společná řada instance, jinak id uživatele = jeho vlastní řada. Unikátní index
// (serie, year, number) = jediná pravda o číslování bez děr (MAX+1 v transakci + opakování zůstává).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  let col;
  try { col = app.findCollectionByNameOrId("invoicing_profiles"); } catch (err) { col = null; }
  if (!col) {
    col = new Collection({
      type: "base",
      name: "invoicing_profiles",
      fields: [
        { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
        { name: "profil", type: "json", maxSize: 4096 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_invoicing_profiles_user ON invoicing_profiles (user)"],
      listRule: "user = @request.auth.id",
      viewRule: "user = @request.auth.id",
      createRule: null,
      updateRule: null,
      deleteRule: null,
    });
    app.save(col);
  }

  const inv = app.findCollectionByNameOrId("invoices");
  if (!inv.fields.getByName("serie")) {
    inv.fields.add(new TextField({ name: "serie", max: 40 }));
  }
  inv.indexes = [
    "CREATE UNIQUE INDEX idx_invoices_rada ON invoices (serie, year, number)",
    "CREATE INDEX idx_invoices_user_created ON invoices (user, created)",
  ];
  app.save(inv);
  // dosavadní faktury = společná řada; NULL by v unikátním indexu SQLite nebyl porovnáván (NULL ≠ NULL)
  app.db().newQuery("UPDATE invoices SET serie = '' WHERE serie IS NULL").execute();
}, (app) => {
  const inv = app.findCollectionByNameOrId("invoices");
  inv.indexes = [
    "CREATE UNIQUE INDEX idx_invoices_rada ON invoices (year, number)",
    "CREATE INDEX idx_invoices_user_created ON invoices (user, created)",
  ];
  try { inv.fields.removeByName("serie"); } catch (err) { /* už není */ }
  app.save(inv);
  try { app.delete(app.findCollectionByNameOrId("invoicing_profiles")); } catch (err) { /* už není */ }
});
