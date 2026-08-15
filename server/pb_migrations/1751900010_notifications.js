/// <reference path="../pb_data/types.d.ts" />
// In-app notifikace (přiřazení úkolu, komentář k mému úkolu…).
// Záznamy vytváří VÝHRADNĚ server (hooky) — createRule je null;
// uživatel svoje notifikace čte, označuje přečtené a maže.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const tasksId = app.findCollectionByNameOrId("tasks").id;
  const goalmapsId = app.findCollectionByNameOrId("goalmaps").id;

  const notifications = new Collection({
    type: "base",
    name: "notifications",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "type", type: "select", values: ["task_assigned", "task_comment"], maxSelect: 1, required: true },
      { name: "task", type: "relation", collectionId: tasksId, maxSelect: 1, cascadeDelete: true },
      { name: "map", type: "relation", collectionId: goalmapsId, maxSelect: 1, cascadeDelete: true },
      { name: "text", type: "text", required: true },
      { name: "read", type: "bool" },
      { name: "created", type: "autodate", onCreate: true },
    ],
    listRule: 'user = @request.auth.id',
    viewRule: 'user = @request.auth.id',
    createRule: null,
    updateRule: 'user = @request.auth.id',
    deleteRule: 'user = @request.auth.id',
  });
  app.save(notifications);
}, (app) => {
  const c = app.findCollectionByNameOrId("notifications");
  if (c) app.delete(c);
});
