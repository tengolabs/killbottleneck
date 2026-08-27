/// <reference path="../pb_data/types.d.ts" />
// Značka „souhrn dnes odešel" má tvar `digest:YYYY-MM-DD` (17 znaků), ale pole
// `day` mělo max 10 → app.save padal na validaci a tichý catch to spolkl, takže
// po každém restartu odešel digest podruhé (nález S2-01, analýza 27. 8. 2026).
migrate((app) => {
  const col = app.findCollectionByNameOrId("mail_budget");
  const f = col.fields.getByName("day");
  f.max = 32;
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("mail_budget");
  const f = col.fields.getByName("day");
  f.max = 10;
  app.save(col);
});
