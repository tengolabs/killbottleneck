/// <reference path="../pb_data/types.d.ts" />
// Záznamy odpracovaného času (stopky + ruční zápis). Prázdné `ended` = běžící
// timer; partial unique index drží NEJVÝŠ JEDEN běžící záznam na uživatele
// (server hook při startu nového zavře starý — index je závora proti souběhu).
// `duration_min` počítá výhradně server (hook), `client` je denormalizovaný
// (čas je účetní fakt — smazání/přeřazení mapy ho nemění); relace na mapu/úkol/
// klienta bez cascadeDelete, aby úklid projektů nemazal odpracovaný čas.
// Záznamy vidí jen vlastník. Razítko = aktuální čas; závisí na migraci clients.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const mapsId = app.findCollectionByNameOrId("goalmaps").id;
  const tasksId = app.findCollectionByNameOrId("tasks").id;
  const clientsId = app.findCollectionByNameOrId("clients").id;
  const entries = new Collection({
    type: "base",
    name: "time_entries",
    fields: [
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "owner_email", type: "email" },
      { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1 },
      { name: "task", type: "relation", collectionId: tasksId, maxSelect: 1 },
      { name: "client", type: "relation", collectionId: clientsId, maxSelect: 1 },
      { name: "label", type: "text", max: 200 }, // popisek pro widget/přehled (název úkolu/projektu při startu)
      { name: "started", type: "date", required: true },
      { name: "ended", type: "date" }, // prázdné = běží
      { name: "duration_min", type: "number", onlyInt: true, min: 0 },
      { name: "note", type: "text", max: 2000 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_time_entries_owner_started ON time_entries (owner, started)",
      "CREATE UNIQUE INDEX idx_time_entries_running ON time_entries (owner) WHERE ended = ''",
    ],
    listRule: "owner = @request.auth.id",
    viewRule: "owner = @request.auth.id",
    createRule: '@request.auth.id != ""',
    updateRule: "owner = @request.auth.id",
    deleteRule: "owner = @request.auth.id",
  });
  app.save(entries);
}, (app) => {
  const c = app.findCollectionByNameOrId("time_entries");
  if (c) app.delete(c);
});
