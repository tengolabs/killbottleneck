/// <reference path="../pb_data/types.d.ts" />
// Oprava sdílení map s VÍCE sdílenými osobami. Vzor
//   @collection.map_shares.map = X && @collection.map_shares.email = @request.auth.email
// s plným operátorem "=" má v PocketBase multi-match sémantiku: podmínku musí
// splnit VŠECHNY joinované řádky map_shares. S jedním share řádkem to (náhodou)
// fungovalo, druhý přidaný člověk přístup všem rozbil. Náhrada je back-relace
// map_shares_via_map s ?= — joinuje se ON map = id, takže se páruje správně.
// Pro edit-práva přibývá map_shares.email_edit (e-mail vyplněný jen u
// permission = "edit"): email i permission tak sedí na TOMTÉŽ řádku a nehrozí
// cross-párování dvou nezávislých ?= podmínek. Guard @request.auth.id != ""
// brání guestovi (prázdný auth email) matchnout prázdné email_edit read řádků.
migrate((app) => {
  const shares = app.findCollectionByNameOrId("map_shares");
  shares.fields.add(new TextField({ name: "email_edit" }));
  app.save(shares);

  const rows = app.findRecordsByFilter("map_shares", "permission = 'edit'", "", 0, 0);
  for (const r of rows) {
    r.set("email_edit", r.getString("email"));
    app.save(r);
  }

  const READ = (x) => `(@collection.map_shares.map = ${x} && @collection.map_shares.email = @request.auth.email)`;
  const EDIT = (x) => `(@collection.map_shares.map = ${x} && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit")`;
  const readVia = (p) => `${p}map_shares_via_map.email ?= @request.auth.email`;
  const editVia = (p) => `(@request.auth.id != "" && ${p}map_shares_via_map.email_edit ?= @request.auth.email)`;

  const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];
  const fix = (name, prefix, x) => {
    const c = app.findCollectionByNameOrId(name);
    for (const f of RULES) {
      if (!c[f]) continue;
      c[f] = c[f].split(EDIT(x)).join(editVia(prefix)).split(READ(x)).join(readVia(prefix));
    }
    app.save(c);
  };
  fix("goalmaps", "", "id");
  fix("comments", "goalmap.", "goalmap");
  fix("tasks", "map.", "map");
  fix("task_comments", "task.map.", "task.map");
}, (app) => {
  const READ = (x) => `(@collection.map_shares.map = ${x} && @collection.map_shares.email = @request.auth.email)`;
  const EDIT = (x) => `(@collection.map_shares.map = ${x} && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit")`;
  const readVia = (p) => `${p}map_shares_via_map.email ?= @request.auth.email`;
  const editVia = (p) => `(@request.auth.id != "" && ${p}map_shares_via_map.email_edit ?= @request.auth.email)`;

  const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];
  const unfix = (name, prefix, x) => {
    const c = app.findCollectionByNameOrId(name);
    for (const f of RULES) {
      if (!c[f]) continue;
      c[f] = c[f].split(editVia(prefix)).join(EDIT(x)).split(readVia(prefix)).join(READ(x));
    }
    app.save(c);
  };
  unfix("goalmaps", "", "id");
  unfix("comments", "goalmap.", "goalmap");
  unfix("tasks", "map.", "map");
  unfix("task_comments", "task.map.", "task.map");

  const shares = app.findCollectionByNameOrId("map_shares");
  shares.fields.removeByName("email_edit");
  app.save(shares);
});
