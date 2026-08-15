/// <reference path="../pb_data/types.d.ts" />
// Úkoly (Asana-style) + komentáře k úkolům.
// Samostatné kolekce MIMO JSON blob mapy — auto-save mapy je last-write-wins
// celého nodes/edges, úkoly v node.data by se při souběžné editaci přepisovaly.
// Vazba na mapu je volitelná relace `map`; uzel je textové `node_id` (uzly
// nemají DB identitu — stejný vzor jako comments). Autorizace přes map_shares.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const goalmapsId = app.findCollectionByNameOrId("goalmaps").id;

  // Číst smí: vlastník úkolu, přiřazený, vlastník mapy, sdílení mapy, veřejná mapa.
  // Prázdná relace map → map.* vyhodnotí false; map_shares.map je required,
  // takže volný úkol (map = "") přes @collection větev nikdy nematchne.
  const taskRead =
    'owner = @request.auth.id || assignee_email = @request.auth.email' +
    ' || map.owner = @request.auth.id || map.is_public = true' +
    ' || (@collection.map_shares.map = map && @collection.map_shares.email = @request.auth.email)';

  const tasks = new Collection({
    type: "base",
    name: "tasks",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "status", type: "select", values: ["todo", "in_progress", "done"], maxSelect: 1, required: true },
      { name: "deadline", type: "text" }, // YYYY-MM-DD, konzistentní s node.data.deadline
      { name: "assignee_email", type: "email" },
      { name: "map", type: "relation", collectionId: goalmapsId, maxSelect: 1, cascadeDelete: true },
      { name: "node_id", type: "text" }, // id uzlu v JSON mapy; může osiřet (řeší UI)
      { name: "sort_order", type: "number" }, // pořadí v kanban sloupci
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "owner_email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: taskRead,
    viewRule: taskRead,
    // volný úkol smí založit každý přihlášený; úkol na mapě jen vlastník mapy / edit-share
    createRule: '@request.auth.id != "" && (map = "" || map.owner = @request.auth.id || (@collection.map_shares.map = map && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit"))',
    // stav smí měnit i přiřazený (Asana chování); read-share a veřejnost jen čtou
    updateRule: 'owner = @request.auth.id || assignee_email = @request.auth.email || map.owner = @request.auth.id || (@collection.map_shares.map = map && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit")',
    deleteRule: 'owner = @request.auth.id || map.owner = @request.auth.id',
  });
  app.save(tasks);

  // podúkoly: self-relace jde přidat až po prvním uložení (potřebuje id kolekce)
  tasks.fields.add(new RelationField({
    name: "parent", collectionId: tasks.id, maxSelect: 1, cascadeDelete: true,
  }));
  app.save(tasks);

  const tcRead =
    'task.owner = @request.auth.id || task.assignee_email = @request.auth.email' +
    ' || task.map.owner = @request.auth.id || task.map.is_public = true' +
    ' || (@collection.map_shares.map = task.map && @collection.map_shares.email = @request.auth.email)';

  const taskComments = new Collection({
    type: "base",
    name: "task_comments",
    fields: [
      { name: "task", type: "relation", collectionId: tasks.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "text", type: "text", required: true },
      { name: "author_email", type: "email" },
      { name: "author", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: tcRead,
    viewRule: tcRead,
    // komentovat smí přihlášený, kdo úkol vidí (veřejnost jen čte — jako comments)
    createRule: '@request.auth.id != "" && (task.owner = @request.auth.id || task.assignee_email = @request.auth.email || task.map.owner = @request.auth.id || (@collection.map_shares.map = task.map && @collection.map_shares.email = @request.auth.email))',
    updateRule: 'author = @request.auth.id',
    deleteRule: 'author = @request.auth.id',
  });
  app.save(taskComments);
}, (app) => {
  for (const name of ["task_comments", "tasks"]) {
    let c = null;
    try { c = app.findCollectionByNameOrId(name); } catch (_) { /* není */ }
    if (c) app.delete(c);
  }
});
