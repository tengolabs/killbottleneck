/// <reference path="../pb_data/types.d.ts" />
// Správce AI agentů — SAMOSTATNÝ PŘÍZNAK, ne čtvrtá hodnota `role`.
// Role (admin/manager/user) je exkluzivní a nese RLS pravidla (migrace 1751900007);
// správcovství AI je na ní kolmé — admin i běžný člen jím může být zároveň,
// a nová hodnota v `role` by znamenala projít a přepsat všechna pravidla.
// Tenhle příznak proto ŽÁDNÁ RLS pravidla nemění: řídí jen (a) komu chodí
// notifikace ai_request a (b) kdo smí spravovat registr ai_agents (server routa).
// Nastavuje ho výhradně admin (users update hook). Razítko = aktuální čas.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "is_ai_manager" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("is_ai_manager");
  app.save(users);
});
