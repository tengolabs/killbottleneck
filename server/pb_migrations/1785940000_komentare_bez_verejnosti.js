/// <reference path="../pb_data/types.d.ts" />
// Veřejná mapa nesmí vydávat KOMENTÁŘE ani adresy jejich autorů.
//
// ⚠️ Migrace 1785930000 opravila jen kolekci `goalmaps` — a tím opravila půlku
// problému. Kolekce `comments` má od 1751900001 v pravidlech `goalmap.is_public
// = true` a nese `author_email` + text. Anonym si tedy ID veřejné mapy vytáhl
// z /api/kb/public-maps a k němu stáhl diskusi včetně adres lidí. Ověřeno
// reprodukcí (kontrolní panel 6. 8. 2026):
//   GET /api/collections/comments/records → {"author_email":"…","text":"…"}
//
// Sdílení mapy odkazem má zveřejnit OBSAH MAPY, ne lidi kolem ní. Komentáře se
// veřejnou cestou nevydávají vůbec — publicMapDto je neposílá a po téhle migraci
// je nevydá ani surová kolekce.
migrate((app) => {
  const c = app.findCollectionByNameOrId("comments");
  for (const pravidlo of ["listRule", "viewRule"]) {
    const p = c[pravidlo] || "";
    c[pravidlo] = p.split(" || goalmap.is_public = true").join("");
  }
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("comments");
  for (const pravidlo of ["listRule", "viewRule"]) {
    if (c[pravidlo] && c[pravidlo].indexOf("goalmap.is_public = true") < 0) {
      c[pravidlo] += " || goalmap.is_public = true";
    }
  }
  app.save(c);
});
