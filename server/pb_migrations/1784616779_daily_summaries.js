/// <reference path="../pb_data/types.d.ts" />
// Denní AI sumáře úkolů (dashboard na /tasks). Generuje výhradně server (cron
// daily_summaries + routa /api/flowmap/my-summary/refresh) — create/update rules
// = null, uživatel svůj sumář jen čte. Unique (user, date) = idempotence cronu
// i ručního refreshe (upsert). Razítko = aktuální čas (automigrate=0 + starší
// razítko by PocketBase přeskočil, viz gotcha guest-leak/recurrence).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const summaries = new Collection({
    type: "base",
    name: "daily_summaries",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "date", type: "text", required: true }, // YYYY-MM-DD (lokální TZ kontejneru)
      { name: "text", type: "text", max: 10000 }, // AI shrnutí (prostý text)
      { name: "provider", type: "text" }, // ollama/api/custom — pro ladění a UI popisek
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_daily_summaries_user_date ON daily_summaries (user, date)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null, // jen server
    updateRule: null,
    deleteRule: null,
  });
  app.save(summaries);
}, (app) => {
  const c = app.findCollectionByNameOrId("daily_summaries");
  if (c) app.delete(c);
});
