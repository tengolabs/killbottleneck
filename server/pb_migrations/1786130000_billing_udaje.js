/// <reference path="../pb_data/types.d.ts" />
// Fakturační údaje organizace (Richard 8. 8. 2026): při registraci zkušebky se
// NEVYŽADUJÍ (registrace musí zůstat krátká), povinné jsou až při objednávce
// členství. Bydlí v instance_settings (jediný zamčený záznam, vzor skinu) —
// zápis jen přes admin routu /api/kb/billing.
migrate((app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  c.fields.add(new Field({ name: "billing", type: "json", maxSize: 4096 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  c.fields.removeByName("billing");
  app.save(c);
});
