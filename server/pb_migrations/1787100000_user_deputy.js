/// <reference path="../pb_data/types.d.ts" />
// Zástupce člena — OSOBNÍ fallback pro dynamické cíle pravidel („zástupce
// zodpovědné osoby"). Přesnější zdroj je organizační struktura (zástupce per
// POZICE, vlna org mapy) — tam se hledá dřív; tohle pole platí, když člověk
// žádnou pozici se zástupcem nedrží. Nastavuje výhradně admin (users update
// hook, vzor is_ai_manager); hodnota = e-mail JINÉHO člena instance, prázdné
// = bez zástupce. ŽÁDNÁ RLS pravidla nemění — čte se jen serverem (motor
// pravidel) a routou /api/kb/members.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "deputy", max: 200 }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("deputy");
  app.save(users);
});
