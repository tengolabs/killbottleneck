/// <reference path="../pb_data/types.d.ts" />
// Kancelář v asistentovi (14. 10. 2026): dokumenty nových druhů — osnova PREZENTACE (presentation) a PŘÁNÍ /
// pozvánka / plakát / diplom (card). Text zůstává text (uživatel ho v panelu upravuje jako každý dokument);
// `meta` nese, co je mimo text: šablona, barva, podtitul, datum a místo, odkaz (QR), podpis, publikum, jazyk.
// Soubory (PPTX / PDF / Word) vznikají v prohlížeči z textu + meta — server je nikdy nedrží. Vzor guardu 1787400000.
migrate((app) => {
  const col = app.findCollectionByNameOrId("ai_documents");
  const f = col.fields.getByName("kind");
  for (const v of ["presentation", "card"]) if (f.values.indexOf(v) < 0) f.values = f.values.concat([v]);
  if (!col.fields.getByName("meta")) col.fields.add(new JSONField({ name: "meta", maxSize: 4000 }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("ai_documents");
  const f = col.fields.getByName("kind");
  f.values = f.values.filter((v) => v !== "presentation" && v !== "card");
  if (col.fields.getByName("meta")) col.fields.removeByName("meta");
  app.save(col);
});
