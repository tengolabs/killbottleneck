/// <reference path="../pb_data/types.d.ts" />
// Defense-in-depth k invariantě „úkol vždy patří do projektu": dosud ji vynucoval
// jen create hook (main.pb.js), createRule pořád povoloval map="". Nově pravidlo
// pouští prázdnou mapu JEN podúkolům (parent != "" — mapu jim dosadí hook z rodiče).
migrate((app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.createRule = '@request.auth.id != "" && ((map = "" && parent != "") || map.owner = @request.auth.id || (@collection.map_shares.map = map && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit"))';
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("tasks");
  c.createRule = '@request.auth.id != "" && (map = "" || map.owner = @request.auth.id || (@collection.map_shares.map = map && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit"))';
  app.save(c);
});
