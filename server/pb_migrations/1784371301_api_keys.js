/// <reference path="../pb_data/types.d.ts" />
// B2: per-user API klíče (základ pro API/MCP přístup). Ukládá se JEN sha256 hash tokenu,
// nikdy plaintext (vzor gateway). Token vytváří i maže výhradně server přes routy
// /api/flowmap/api-keys (create/update rules = null). Razítko = aktuální čas (automigrate=0
// + starší by PocketBase přeskočil, viz gotcha guest-leak/recurrence).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const apiKeys = new Collection({
    type: "base",
    name: "api_keys",
    fields: [
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "token_hash", type: "text", required: true }, // sha256(fm_user_...); NIKDY plaintext
      { name: "label", type: "text" },
      { name: "last_used", type: "text" }, // ISO datum posledního použití (text, ať nepřepíše autodate)
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_api_keys_token_hash ON api_keys (token_hash)"],
    listRule: "owner = @request.auth.id",
    viewRule: "owner = @request.auth.id",
    createRule: null,   // jen server (routa generuje token serverově)
    updateRule: null,
    deleteRule: "owner = @request.auth.id",
  });
  app.save(apiKeys);
}, (app) => {
  const c = app.findCollectionByNameOrId("api_keys");
  if (c) app.delete(c);
});
