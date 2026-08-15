/// <reference path="../pb_data/types.d.ts" />
// Projekt (goalmap) jde přiřadit klientovi — nové záznamy času pak klienta dědí
// z mapy (server hook time_entries). Bez cascadeDelete: smazání klienta nesmí
// mazat mapy. Pole smí měnit jen vlastník mapy (goalmaps update hook). Razítko
// = aktuální čas; závisí na migraci clients (musí mít nižší razítko).
migrate((app) => {
  const clientsId = app.findCollectionByNameOrId("clients").id;
  const col = app.findCollectionByNameOrId("goalmaps");
  col.fields.add(new RelationField({ name: "client", collectionId: clientsId, maxSelect: 1 }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("goalmaps");
  col.fields.removeByName("client");
  app.save(col);
});
