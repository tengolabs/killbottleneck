/// <reference path="../pb_data/types.d.ts" />
// Veřejná mapa NESMÍ vydávat osobní údaje (Richardův nález 6. 8. 2026).
//
// Kolekce goalmaps měla v list/view pravidlech `is_public = true`, takže
// kdokoli bez přihlášení dostal SUROVÝ záznam z /api/collections/goalmaps/
// records/:id — a v něm `owner_email`, `shared_with`, `shared_with_edit`,
// `team_access` i uzly s `data.owner` (e-mail garanta). Sdílení mapy odkazem
// tak zveřejňovalo adresy lidí, kteří o tom nevěděli.
//
// Veřejná cesta zůstává JEDINÁ: routa `/api/kb/public-maps`, která vrací
// sanitizovaný `publicMapDto` (obsah mapy bez osob). Tahle migrace jen zavírá
// obcházení té routy přes kolekci — přesně jako 1751900009 u úkolů.
//
// ⚠️ Neruší veřejné sdílení: přihlášení uživatelé (majitel, sdílení, tým) mají
// přístup dál, veřejný odkaz funguje přes routu.
migrate((app) => {
  const c = app.findCollectionByNameOrId("goalmaps");
  c.listRule = (c.listRule || "").split(" || is_public = true").join("");
  c.viewRule = (c.viewRule || "").split(" || is_public = true").join("");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("goalmaps");
  if (c.listRule && c.listRule.indexOf("is_public = true") < 0) c.listRule += " || is_public = true";
  if (c.viewRule && c.viewRule.indexOf("is_public = true") < 0) c.viewRule += " || is_public = true";
  app.save(c);
});
