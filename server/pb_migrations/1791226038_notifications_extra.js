/// <reference path="../pb_data/types.d.ts" />
// Pobídka asistenta z pravidla (5. 10. 2026, bod 4 prověrky): notifikace nese `extra` (JSON) — zatím jen
// {asistent: <režim>} pro akci pravidla offer_assistant. Klient podle toho sestaví odkaz, který otevře asistenta
// rovnou v daném balíčku (Po schůzce, Rozbor…). Nic se nespouští bez kliknutí → 0 kreditů do kliknutí.
migrate((app) => {
  const c = app.findCollectionByNameOrId("notifications");
  c.fields.add(new Field({ name: "extra", type: "json", maxSize: 2000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("notifications");
  c.fields.removeByName("extra");
  app.save(c);
});
