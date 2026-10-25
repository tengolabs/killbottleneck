/// <reference path="../pb_data/types.d.ts" />
// Stránky asistenta (14. 10. 2026): jednoduchá HTML stránka (prezentace, přehled, mini-appka),
// kterou napíše asistent (create_page → „page writer“) nebo připojený agent přes MCP/v1 API.
// Rozhodnutí Richarda 14. 10.: staví asistent + MCP; sdílení = tajný odkaz pro kohokoli
// (share_token, jde zrušit/obnovit) + přepínač „vidí tým“ (team_visible = všichni členové
// instance); funguje všude vč. Lite (limity env KB_PAGES_MAX / KB_PAGE_KB); V1 bez příloh.
// Zapisují VÝHRADNĚ routy /api/kb/chat/strank*, /v1/pages a nástroje asistenta — přímé CRUD
// by obešlo stropy, vlastnictví a sandbox. Pravidla list/view jen pro vlastníka = PocketBase
// realtime (panel čeká na stav „hotovo“); týmové stránky jdou JEN přes vlastní routu s DTO
// (record API by vydalo share_token a zadání). Předchozí verze je text, ne JSON (HTML by se
// v JSONu escapováním nafouklo). Razítko = aktuální čas (automigrate=0).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const c = new Collection({
    type: "base",
    name: "ai_pages",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "title", type: "text", max: 200 },
      // tvrdý strop pole; provozní strop = KB_PAGE_KB (bajty UTF-8) v stranky.js
      { name: "html", type: "text", max: 400000 },
      // zadání pro page writer (brief + fakta od modelu nebo pokyny k přepisu)
      { name: "zadani", type: "text", max: 16000 },
      { name: "stav", type: "select", maxSelect: 1, required: true, values: ["ceka", "pise", "hotovo", "chyba"] },
      { name: "chyba", type: "text", max: 300 },
      { name: "predchozi_html", type: "text", max: 400000 },
      { name: "predchozi_title", type: "text", max: 200 },
      { name: "share_token", type: "text", max: 64 }, // "" = nesdíleno
      { name: "team_visible", type: "bool" },
      { name: "map", type: "text", max: 40 },
      { name: "chat", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_ai_pages_user_updated ON ai_pages (user, updated)",
      "CREATE UNIQUE INDEX idx_ai_pages_token ON ai_pages (share_token) WHERE share_token != ''",
      "CREATE INDEX idx_ai_pages_team ON ai_pages (team_visible, updated)",
    ],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null, // jen server
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  try { const c = app.findCollectionByNameOrId("ai_pages"); if (c) app.delete(c); } catch (err) { /* už není */ }
});
