/// <reference path="../pb_data/types.d.ts" />
// Opravy po /checkup 24. 10. 2026 (Richard: „faktury nemazat“):
//  · `invoices.user` BEZ cascadeDelete — smazání člena ve Správě organizace dřív smazalo i jeho faktury (díry ve
//    společné řadě, ztráta daňových dokladů). Osiřelé faktury dál vidí správce (RLS `role = admin`, seznam bez filtru);
//    `required` musí být false, jinak PocketBase smazání uživatele odmítne (required relation reference).
//  · `invoices.items` maxSize 16 kB nestačil na povolených 50 položek × 200 znaků s diakritikou (UTF-8 ≈ 25 kB) →
//    zápis po potvrzení karty spadl. Nově 32 kB.
migrate((app) => {
  const inv = app.findCollectionByNameOrId("invoices");
  const user = inv.fields.getByName("user");
  if (user) { user.cascadeDelete = false; user.required = false; } // required=true by PocketBase smazání člena ZAKÁZAL („part of a required relation“)
  const items = inv.fields.getByName("items");
  if (items) { items.maxSize = 32768; }
  app.save(inv);
}, (app) => {
  const inv = app.findCollectionByNameOrId("invoices");
  const user = inv.fields.getByName("user");
  if (user) { user.cascadeDelete = true; user.required = true; }
  const items = inv.fields.getByName("items");
  if (items) { items.maxSize = 16384; }
  app.save(inv);
});
