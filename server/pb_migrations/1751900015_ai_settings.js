/// <reference path="../pb_data/types.d.ts" />
// Runtime konfigurace AI providera z administrace (místo editace .env + restartu).
// Jediný záznam; kolekce je ZAMČENÁ (žádná pravidla) — token nesmí být čitelný
// z klienta, čtení/zápis jde výhradně přes admin routy /api/flowmap/ai-settings.
// Prázdný provider = použije se fallback na .env (zpětná kompatibilita).
migrate((app) => {
  const c = new Collection({
    type: "base",
    name: "ai_settings",
    fields: [
      { name: "provider", type: "select", values: ["none", "ollama", "api", "custom"], maxSelect: 1 },
      { name: "url", type: "text" },
      { name: "model", type: "text" },
      { name: "token", type: "text" },
      { name: "transcribe_url", type: "text" },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_settings");
  if (c) app.delete(c);
});
