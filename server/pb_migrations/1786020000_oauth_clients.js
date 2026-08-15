/// <reference path="../pb_data/types.d.ts" />
// OAuth server pro MCP konektory (claude.ai a další MCP klienti s OAuth).
// Dvě systémové kolekce — VŠECHNA pravidla null, přístup jen přes serverové
// routy v oauth.pb.js (dynamic client registration RFC 7591 + authorization
// code s PKCE S256). Access tokeny se NEUKLÁDAJÍ sem: token endpoint mintuje
// záznam v existující kolekci `api_keys`, takže platí stejný apiKeyAuth,
// rate-limity i revokace v UI (uživatelské menu → API klíče).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  const clients = new Collection({
    type: "base",
    name: "oauth_clients",
    fields: [
      { name: "client_id", type: "text", required: true },       // veřejný identifikátor (public client, bez secretu — PKCE)
      { name: "client_name", type: "text", max: 200 },
      { name: "redirect_uris", type: "json", required: true, maxSize: 20000 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "last_used", type: "date" },                        // pro úklid mrtvých registrací
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_oauth_clients_cid ON oauth_clients (client_id)",
    ],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  });
  app.save(clients);

  const codes = new Collection({
    type: "base",
    name: "oauth_codes",
    fields: [
      { name: "code_hash", type: "text", required: true },        // sha256 kódu — kód samotný se neukládá
      { name: "client_id", type: "text", required: true },
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "scope", type: "select", values: ["read", "read_write"], maxSelect: 1, required: true },
      { name: "code_challenge", type: "text", required: true },   // PKCE S256
      { name: "redirect_uri", type: "text", required: true, max: 2000 },
      { name: "expires_at", type: "date", required: true },       // kód platí 5 minut, jednorázově
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_oauth_codes_hash ON oauth_codes (code_hash)",
    ],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  });
  app.save(codes);
}, (app) => {
  for (const n of ["oauth_codes", "oauth_clients"]) {
    try { const c = app.findCollectionByNameOrId(n); if (c) app.delete(c); } catch (err) { /* už není */ }
  }
});
