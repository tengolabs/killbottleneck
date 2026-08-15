/// <reference path="../pb_data/types.d.ts" />
// Oprava dvou regresí createRule z 1784910604 (přepsala pravidlo celé a vrátila
// starší tvary):
// 1. multi-match vzor @collection.map_shares.… — s plným "=" musí podmínku
//    splnit VŠECHNY joinované řádky, takže na mapě se 2+ sdílenými nemohl
//    edit-share založit úkol (přesně to opravovala 1751900013, via-vzor s ?=).
// 2. zmizela větev map.team_access = "edit" (z 1751900008) — člen týmu mohl
//    úkoly měnit i odškrtávat, ale ne zakládat.
// Guard @request.auth.id != "" u email_edit brání guestovi (prázdný e-mail)
// matchnout prázdné email_edit read řádků — stejně jako v 1751900013.
migrate((app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.createRule = '@request.auth.id != "" && ((map = "" && parent != "") || map.owner = @request.auth.id || (@request.auth.id != "" && map.map_shares_via_map.email_edit ?= @request.auth.email) || map.team_access = "edit")';
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.createRule = '@request.auth.id != "" && ((map = "" && parent != "") || map.owner = @request.auth.id || (@collection.map_shares.map = map && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit"))';
  app.save(c);
});
