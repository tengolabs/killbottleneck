/// <reference path="../pb_data/types.d.ts" />
// MCP fáze 1: scope + expirace + počítadlo použití na API klíčích.
// scope: read | read_write; prázdné = read (bezpečný default pro klíče z doby
// před touto migrací — vzor users.language, prázdné = cs). Stávající klíče se
// backfillnou na "read" explicitně, ať je stav vidět i v UI.
// expires_at: ISO datum (text, nepovinné, prázdné = bez expirace).
// use_count: levný audit spolu s last_used (žádná audit kolekce).
// Razítko = aktuální čas (starší by PocketBase přeskočil, viz gotcha automigrate).
migrate((app) => {
  const c = app.findCollectionByNameOrId("api_keys");
  c.fields.add(new SelectField({ name: "scope", values: ["read", "read_write"], maxSelect: 1 }));
  c.fields.add(new TextField({ name: "expires_at" }));
  c.fields.add(new NumberField({ name: "use_count" }));
  app.save(c);
  const rows = app.findRecordsByFilter("api_keys", "id != ''", "", 1000, 0);
  for (const r of rows) {
    r.set("scope", "read");
    app.save(r);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("api_keys");
  c.fields.removeByName("scope");
  c.fields.removeByName("expires_at");
  c.fields.removeByName("use_count");
  app.save(c);
});
