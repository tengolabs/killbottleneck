/// <reference path="../pb_data/types.d.ts" />
// Zásobník uzlů — osobní buffer nápadů sdílený napříč mapami.
// Přísně per-user: vidí a spravuje jen vlastník.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  const buffer = new Collection({
    type: "base",
    name: "buffer_nodes",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "color", type: "text" },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: 'owner = @request.auth.id',
    viewRule: 'owner = @request.auth.id',
    createRule: '@request.auth.id != "" && owner = @request.auth.id',
    updateRule: 'owner = @request.auth.id',
    deleteRule: 'owner = @request.auth.id',
  });
  app.save(buffer);
}, (app) => {
  const c = app.findCollectionByNameOrId("buffer_nodes");
  if (c) app.delete(c);
});
