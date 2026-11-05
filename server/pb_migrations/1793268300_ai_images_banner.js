/// <reference path="../pb_data/types.d.ts" />
// Banner ranního sumáře pozná server podle příznaku `banner`, NE podle názvu (checkup 5. 11. 2026: název „sumar:<den>“
// si mohl dát kdokoli → jeho obrázek by šel všem v ranním mailu a úklid by mu ho schoval / smazal). Příznak nastavuje
// jen server (sumarMail.js); kolekce ai_images nemá create/update pravidla pro uživatele. Stávající bannery = podle názvu.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_images");
  if (!c.fields.getByName("banner")) c.fields.add(new Field({ name: "banner", type: "bool" }));
  app.save(c);
  try {
    for (const r of app.findRecordsByFilter("ai_images", "title ~ 'sumar:%'", "", 5000, 0)) {
      if (/^sumar:\d{4}-\d{2}-\d{2}$/.test(r.getString("title"))) { r.set("banner", true); app.save(r); }
    }
  } catch (err) { /* žádné */ }
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_images");
  c.fields.removeByName("banner");
  app.save(c);
});
