/// <reference path="../pb_data/types.d.ts" />
// `token_hash` vracel výpis kolekce jeho vlastníkovi (pole nebylo hidden) —
// test to zakrýval `|| true` (nález T1-01, analýza 27. 8. 2026). Hooky hidden
// pole čtou dál (apiKeyAuth přes findFirstRecordByFilter).
migrate((app) => {
  const col = app.findCollectionByNameOrId("api_keys");
  col.fields.getByName("token_hash").hidden = true;
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("api_keys");
  col.fields.getByName("token_hash").hidden = false;
  app.save(col);
});
