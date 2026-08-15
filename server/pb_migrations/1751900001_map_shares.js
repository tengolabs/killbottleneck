/// <reference path="../pb_data/types.d.ts" />
// Sdílení map přes normalizovanou kolekci map_shares (PocketBase neumí bezpečně
// filtrovat prvky JSON pole v pravidlech — `?=` elementy nematchuje a `~` je
// substring, tj. bezpečnostní riziko). JSON pole shared_with/shared_with_edit
// na goalmaps zůstávají jako zrcadlo pro frontend; autorizace jde přes map_shares.
migrate((app) => {
  const goalmaps = app.findCollectionByNameOrId("goalmaps");

  const shares = new Collection({
    type: "base",
    name: "map_shares",
    fields: [
      { name: "map", type: "relation", collectionId: goalmaps.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "email", type: "email", required: true },
      { name: "permission", type: "select", values: ["read", "edit"], maxSelect: 1, required: true },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_map_shares_unique ON map_shares (map, email)"],
    // zápisy jen server-side (share routa přes $app); číst smí vlastník mapy a sám člen
    listRule: 'map.owner = @request.auth.id || email = @request.auth.email',
    viewRule: 'map.owner = @request.auth.id || email = @request.auth.email',
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(shares);

  // Base44 RLS: read = owner || shared || public; update = owner || shared_edit; delete = owner
  goalmaps.listRule = 'owner = @request.auth.id || is_public = true || (@collection.map_shares.map = id && @collection.map_shares.email = @request.auth.email)';
  goalmaps.viewRule = goalmaps.listRule;
  goalmaps.updateRule = 'owner = @request.auth.id || (@collection.map_shares.map = id && @collection.map_shares.email = @request.auth.email && @collection.map_shares.permission = "edit")';
  app.save(goalmaps);

  const comments = app.findCollectionByNameOrId("comments");
  const commentRead = 'goalmap.owner = @request.auth.id || goalmap.is_public = true || (@collection.map_shares.map = goalmap && @collection.map_shares.email = @request.auth.email)';
  comments.listRule = commentRead;
  comments.viewRule = commentRead;
  comments.createRule = '@request.auth.id != "" && (goalmap.owner = @request.auth.id || (@collection.map_shares.map = goalmap && @collection.map_shares.email = @request.auth.email))';
  app.save(comments);
}, (app) => {
  const c = app.findCollectionByNameOrId("map_shares");
  if (c) app.delete(c);
});
