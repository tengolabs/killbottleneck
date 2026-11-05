/// <reference path="../pb_data/types.d.ts" />
// Záložka Obrázky + úklid (4. 11. 2026, rozhodnutí Richarda): nepoužitý obrázek se po 90 dnech smaže, pokud ho
// uživatel nenechal „natrvalo“ (trvale = true). Použité v dokumentu / stránce se nemažou nikdy (obrazky.js uklid).
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_images");
  if (!c.fields.getByName("trvale")) c.fields.add(new Field({ name: "trvale", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_images");
  c.fields.removeByName("trvale");
  app.save(c);
});
