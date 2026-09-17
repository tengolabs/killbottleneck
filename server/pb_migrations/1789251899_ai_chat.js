/// <reference path="../pb_data/types.d.ts" />
// AI chat na boku (13. 9. 2026): rozhovory, paměť modelu o uživateli a log spotřeby.
// Všechno píše VÝHRADNĚ server (routy /api/kb/chat*) — uživatel svoje rozhovory
// a paměť jen čte; zápis přes PocketBase CRUD by obešel kontrolu nástrojů i
// potvrzování akcí. Razítko = aktuální čas (automigrate=0, starší by PB přeskočil).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const chats = new Collection({
    type: "base",
    name: "ai_chats",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "title", type: "text", max: 120 },
      { name: "messages", type: "json", maxSize: 200000 }, // [{role, content, cards…}] — historie pro UI i model
      { name: "pending", type: "json", maxSize: 20000 },   // akce čekající na potvrzení uživatelem
      { name: "model", type: "text", max: 120 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_ai_chats_user_updated ON ai_chats (user, updated)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null, // jen server
    updateRule: null,
    deleteRule: null,
  });
  app.save(chats);

  const memory = new Collection({
    type: "base",
    name: "ai_memory",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "text", type: "text", max: 8000 }, // markdown: co si asistent o uživateli pamatuje
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_ai_memory_user ON ai_memory (user)"],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(memory);

  const log = new Collection({
    type: "base",
    name: "ai_chat_log",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "chat", type: "text", max: 40 },
      { name: "provider", type: "text", max: 40 },
      { name: "model", type: "text", max: 120 },
      { name: "tokens_in", type: "number" },
      { name: "tokens_out", type: "number" },
      { name: "ms", type: "number" },
      { name: "calls", type: "number" },   // kolikrát se model v jednom kole volal
      { name: "tools", type: "text", max: 500 }, // jména vykonaných nástrojů, čárkami
      { name: "override", type: "bool" }, // model zvolený správcem v UI
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_ai_chat_log_created ON ai_chat_log (created)"],
    listRule: null, // jen server (spotřebu čte správce přes routu)
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(log);
}, (app) => {
  for (const n of ["ai_chat_log", "ai_memory", "ai_chats"]) {
    try { const c = app.findCollectionByNameOrId(n); if (c) app.delete(c); } catch (err) { /* už není */ }
  }
});
