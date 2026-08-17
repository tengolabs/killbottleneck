/// <reference path="../pb_data/types.d.ts" />
// Druhá vrstva zákazu vytváření položek (nález bezpečnostního panelu 17. 8. 2026):
// dosud zákaz držel jen request hook v main.pb.js — kdyby se pb_hooks nenačetly,
// permisivní createRule by create tiše otevřel, a to už bez validací. createRule
// = null → create smí jen superuser i na holé datové vrstvě. Ostatní pravidla
// (list/view/update/delete) zůstávají — kolekce slouží jako detektor zbytků.
migrate((app) => {
  const col = app.findCollectionByNameOrId("tasks");
  col.createRule = null;
  app.save(col);
}, (app) => {
  // down: nevracíme — zákaz vytváření je rozhodnutí, ne experiment
});
