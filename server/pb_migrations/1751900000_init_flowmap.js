/// <reference path="../pb_data/types.d.ts" />
// FlowMap Local — inicializace kolekcí.
// Pravidla věrně kopírují Base44 RLS (viz app/base44/entities/*.jsonc):
//   GoalMap read:   created_by || shared_with.includes(email) || is_public
//   GoalMap update: created_by || shared_with_edit.includes(email)
//   GoalMap delete: created_by
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({
    name: "role",
    values: ["admin", "user"],
    maxSelect: 1,
  }));
  users.fields.add(new TextField({ name: "full_name" }));
  // admin (UserAdmin stránka) potřebuje vidět seznam uživatelů
  users.listRule = '@request.auth.role = "admin"';
  users.viewRule = 'id = @request.auth.id || @request.auth.role = "admin"';
  users.updateRule = 'id = @request.auth.id || @request.auth.role = "admin"';
  users.deleteRule = '@request.auth.role = "admin"';
  app.save(users);

  const usersId = users.id;

  const goalmaps = new Collection({
    type: "base",
    name: "goalmaps",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "nodes", type: "json", maxSize: 5242880 },
      { name: "edges", type: "json", maxSize: 5242880 },
      { name: "shared_with", type: "json", maxSize: 102400 },
      { name: "shared_with_edit", type: "json", maxSize: 102400 },
      { name: "is_public", type: "bool" },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, cascadeDelete: true },
      { name: "owner_email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: 'owner = @request.auth.id || shared_with ?= @request.auth.email || is_public = true',
    viewRule: 'owner = @request.auth.id || shared_with ?= @request.auth.email || is_public = true',
    createRule: '@request.auth.id != ""',
    updateRule: 'owner = @request.auth.id || shared_with_edit ?= @request.auth.email',
    deleteRule: 'owner = @request.auth.id',
  });
  app.save(goalmaps);

  const comments = new Collection({
    type: "base",
    name: "comments",
    fields: [
      { name: "goalmap", type: "relation", collectionId: goalmaps.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "node_id", type: "text", required: true },
      { name: "text", type: "text", required: true },
      { name: "author_email", type: "email" },
      { name: "author", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    // přístup ke komentářům = přístup k mapě (Base44: default read + RLS mapy)
    listRule: 'goalmap.owner = @request.auth.id || goalmap.shared_with ?= @request.auth.email || goalmap.is_public = true',
    viewRule: 'goalmap.owner = @request.auth.id || goalmap.shared_with ?= @request.auth.email || goalmap.is_public = true',
    createRule: '@request.auth.id != "" && (goalmap.owner = @request.auth.id || goalmap.shared_with ?= @request.auth.email)',
    updateRule: 'author = @request.auth.id',
    deleteRule: 'author = @request.auth.id',
  });
  app.save(comments);

  const templates = new Collection({
    type: "base",
    name: "templates",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "description", type: "text" },
      { name: "category", type: "text" },
      { name: "icon", type: "text" },
      { name: "goal", type: "text" },
      { name: "node_type", type: "text" },
      { name: "ai_nodes", type: "json", maxSize: 1048576 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.role = "admin"',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: '@request.auth.role = "admin"',
  });
  app.save(templates);

  const loginlogs = new Collection({
    type: "base",
    name: "loginlogs",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
    ],
    listRule: '@request.auth.role = "admin" || user = @request.auth.id',
    viewRule: '@request.auth.role = "admin" || user = @request.auth.id',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.role = "admin"',
    deleteRule: '@request.auth.role = "admin"',
  });
  app.save(loginlogs);

  const uploads = new Collection({
    type: "base",
    name: "uploads",
    fields: [
      { name: "file", type: "file", required: true, maxSize: 26214400, maxSelect: 1 },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    listRule: 'owner = @request.auth.id',
    viewRule: "",
    createRule: '@request.auth.id != ""',
    updateRule: null,
    deleteRule: 'owner = @request.auth.id',
  });
  app.save(uploads);
}, (app) => {
  for (const name of ["uploads", "loginlogs", "templates", "comments", "goalmaps"]) {
    const c = app.findCollectionByNameOrId(name);
    if (c) app.delete(c);
  }
});
