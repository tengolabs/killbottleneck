/// <reference path="../pb_data/types.d.ts" />
// Denní sumář e-mailem (fáze 5 obrázků, 29. 10. 2026): volitelné (opt-in) — users.sumar_email zapne uživatel
// SÁM v Nastavení notifikací (správce ho za člena nezapne, users update hook); daily_summaries.odeslano = mail
// s tímto sumářem odešel (žádný druhý mail po restartu ani při ručním běhu). Razítko = aktuální čas.
migrate((app) => {
  const u = app.findCollectionByNameOrId("users");
  u.fields.add(new Field({ name: "sumar_email", type: "bool" }));
  app.save(u);
  const d = app.findCollectionByNameOrId("daily_summaries");
  d.fields.add(new Field({ name: "odeslano", type: "bool" }));
  app.save(d);
}, (app) => {
  const u = app.findCollectionByNameOrId("users");
  u.fields.removeByName("sumar_email");
  app.save(u);
  const d = app.findCollectionByNameOrId("daily_summaries");
  d.fields.removeByName("odeslano");
  app.save(d);
});
