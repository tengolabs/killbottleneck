/// <reference path="../pb_data/types.d.ts" />
// notifications.type: přibývá `new_version`.
//
// Oznámení o nové verzi do zvonečku (Richard 18. 8. 2026). Pole `type` je
// SELECT s pevným výčtem, takže bez téhle migrace zápis tiše selže na validaci
// — přesně to se stalo při vývoji: funkce hlásila „oznámeno", v kolekci nebylo
// nic a v logu ani řádek (save běželo pod catchem, který chybu spolkl).
//
// ⚠️ Kdo přidává nový typ notifikace, musí sáhnout na TŘI místa: sem, do
// NOTIFY_TYPES/META na frontendu (lib/notifyMeta.js) a do textů v pb_hooks/i18n.js.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const pole = col.fields.getByName("type");
  if (pole.values.indexOf("new_version") === -1) pole.values.push("new_version");
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const pole = col.fields.getByName("type");
  pole.values = pole.values.filter((v) => v !== "new_version");
  app.save(col);
});
