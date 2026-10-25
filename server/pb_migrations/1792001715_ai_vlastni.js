/// <reference path="../pb_data/types.d.ts" />
// Vlastní model zákazníka na hostované instanci (14. 10. 2026, rozhodnutí Richarda: jakékoli OpenAI-kompatibilní
// API, tahy bez kvóty, všechny tarify, zatím jen textový chat). Jediný záznam; kolekce ZAMČENÁ (žádná pravidla) —
// klíč je navíc v DB šifrovaný klíčem instance (helpers.js sifrujTajemstvi), čtení/zápis jen přes /api/kb/ai-vlastni.
// Oddělené od ai_settings SCHVÁLNĚ: ai_settings přepisuje obecnou AI (rádce, objednávky přes bránu, /v1/status) —
// vlastní model zákazníka se týká jen asistenta (chatAiConfig).
migrate((app) => {
  const c = new Collection({
    type: "base",
    name: "ai_vlastni",
    fields: [
      { name: "enabled", type: "bool" },
      { name: "url", type: "text", max: 500 },
      { name: "model", type: "text", max: 120 },
      { name: "token_enc", type: "text", max: 2000 },
      { name: "extra", type: "text", max: 2000 },
      { name: "tested_otisk", type: "text", max: 640 }, // „ověřeno“ = otisk adresa|model z posledního úspěšného testu
      { name: "tested_at", type: "text", max: 40 },
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
  const c = app.findCollectionByNameOrId("ai_vlastni");
  if (c) app.delete(c);
});
