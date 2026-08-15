/// <reference path="../pb_data/types.d.ts" />
// Barva projektu — pole `color` na goalmaps (prázdné = bez barvy). Čistě vizuální
// odlišení projektů: lišta u projektu v /Úkoly, karty na titulní straně, rámeček
// plátna mapy. Emoji projektu žije přímo v názvu (title), zvláštní pole nepotřebuje.
// Razítko = aktuální čas (starší by PocketBase přeskočil kvůli vlastním
// auto-migracím z 2026 — viz gotcha migrace guest-leak / automigrate).
migrate((app) => {
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.fields.add(new TextField({ name: "color", max: 16 }));
  app.save(goalmaps);
}, (app) => {
  const goalmaps = app.findCollectionByNameOrId("goalmaps");
  goalmaps.fields.removeByName("color");
  app.save(goalmaps);
});
