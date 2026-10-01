/// <reference path="../pb_data/types.d.ts" />
// Dokumenty asistenta (30. 9. 2026): poznámky, koncepty e-mailů a sumáře, které asistent
// napíše (draft_text); uživatel je v panelu Dokumenty vedle chatu upravuje.
// SOUKROMÉ (rozhodnutí Richarda 30. 9.): vidí je jen vlastník. Zapisují VÝHRADNĚ routy
// /api/kb/chat/dokument* a nástroje asistenta — přímé CRUD by obešlo stropy a vlastnictví.
// `predchozi` = text před poslední změnou (asistent i ruční úprava) → „Vrátit předchozí verzi“.
// `chat` = id rozhovoru, ve kterém dokument vznikl (text, ne relace: smazání rozhovoru dokument nechá).
// Razítko = aktuální čas (automigrate=0, starší by PB přeskočil).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const docs = new Collection({
    type: "base",
    name: "ai_documents",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "kind", type: "select", maxSelect: 1, required: true, values: ["note", "email", "summary", "meeting", "call", "other"] },
      { name: "title", type: "text", max: 200 },
      { name: "text", type: "text", max: 20000 },
      { name: "email_to", type: "text", max: 500 },
      { name: "email_subject", type: "text", max: 300 },
      { name: "map", type: "text", max: 40 },
      { name: "chat", type: "text", max: 40 },
      // {title, text, email_to, email_subject} před poslední změnou; JSON kóduje <>& jako \u003c… (6 B)
      // a CJK/€ mají 3 B → rezerva ~10× MAX_TEXT, jinak by dlouhý dokument nešel upravit
      { name: "predchozi", type: "json", maxSize: 250000 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_ai_documents_user_updated ON ai_documents (user, updated)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null, // jen server
    updateRule: null,
    deleteRule: null,
  });
  app.save(docs);
}, (app) => {
  try { const c = app.findCollectionByNameOrId("ai_documents"); if (c) app.delete(c); } catch (err) { /* už není */ }
});
