/// <reference path="../pb_data/types.d.ts" />
// Průběh tahu asistenta (5. 10. 2026): jeden malý záznam na uživatele, do kterého server během tahu píše,
// co právě dělá (volá model / čte mapu / připravuje návrh). Panel ho odebírá přes PocketBase realtime,
// takže místo holého kolečka vidí „Přečetl jsem mapu projektu „X“ · Přemýšlím…“. Vlastní kolekce
// (ne pole u ai_chats): realtime posílá celý záznam a rozhovor má až 200 kB zpráv — tohle má pár set bajtů.
// Píše VÝHRADNĚ server; uživatel jen čte svůj záznam.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const c = new Collection({
    type: "base",
    name: "ai_chat_prubeh",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "chat", type: "text", max: 40 },           // id rozhovoru (prázdné u nového rozhovoru před prvním uložením)
      { name: "stav", type: "json", maxSize: 4000 },      // null = nic neběží; jinak {faze, krok, celkem, nastroj, kind, nazev, hotovo:[…], ts}
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_ai_chat_prubeh_user ON ai_chat_prubeh (user)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("ai_chat_prubeh")); } catch (err) { /* už není */ }
});
