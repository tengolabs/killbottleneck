/// <reference path="../pb_data/types.d.ts" />
// „Připoj svého AI agenta" — uvítací dialog při prvním přihlášení (vzor onboardingu
// Runpod, Richard 10. 10. 2026): jeden řádek ke zkopírování do Claude Code / Cursoru /
// Codexu, agent si přes /agent-setup.md zaregistruje MCP server instance sám.
// Dialog se ukáže každému uživateli JEDNOU (pak zůstává v menu pod jménem); tenhle
// bool říká „už viděl / přeskočil". Pole na users (vzor align_lock): příznak cestuje
// s účtem mezi zařízeními, RLS hotové (self/admin). Bez backfillu — i stávající
// uživatelé ho po aktualizaci uvidí jednou (záměr: největší dosah).
//
// Razítko = čas vzniku. PocketBase aplikuje každou dosud neaplikovanou migraci podle
// jména, i s nižším razítkem než poslední aplikovaná (ověřeno sondou 13. 10. 2026) —
// pořadí sloučení větví tedy migrace neztrácí.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "agent_setup_seen" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("agent_setup_seen");
  app.save(users);
});
