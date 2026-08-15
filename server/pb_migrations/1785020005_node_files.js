/// <reference path="../pb_data/types.d.ts" />
// Přílohy u uzlu mapy. Motivace (Richard 26.7.): u kroku „vytvořit titulky" chci
// nahrát hotový soubor a tím rovnou spustit automatizaci, která ho zpracuje —
// místo vyplňování formuláře někde jinde.
//
// Vlastní kolekce, NE stávající `uploads`: ta má viewRule "" (kdokoli s odkazem)
// a slouží logu organizace. Přílohy uzlů můžou nést citlivá data, takže se řídí
// přístupem k MAPĚ a soubor je `protected` — URL bez tokenu nic nevydá.
// Agent se k souboru dostane jen přes /api/flowmap/agent-file s tokenem SVÉHO běhu.
//
// Uzly nemají DB identitu (žijí v JSON mapy), takže vazba je textové `node_id` —
// stejný vzor jako comments/tasks/time_entries. Razítko = aktuální čas.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const mapsId = app.findCollectionByNameOrId("goalmaps").id;

  const files = new Collection({
    type: "base",
    name: "node_files",
    fields: [
      { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "node_id", type: "text", required: true },
      { name: "file", type: "file", required: true, maxSize: 26214400, maxSelect: 1, protected: true },
      { name: "name", type: "text", max: 255 },   // původní název od uživatele
      { name: "size", type: "number", onlyInt: true, min: 0 },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1, cascadeDelete: true },
      { name: "owner_email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [
      "CREATE INDEX idx_node_files_node ON node_files (map, node_id)",
    ],
    // vidí a nahrává ten, kdo má přístup k mapě (vlastník nebo sdílený);
    // maže autor přílohy nebo vlastník mapy
    listRule: 'map.owner = @request.auth.id || map.shared_with ~ @request.auth.email',
    viewRule: 'map.owner = @request.auth.id || map.shared_with ~ @request.auth.email',
    createRule: '@request.auth.id != "" && (map.owner = @request.auth.id || map.shared_with ~ @request.auth.email)',
    updateRule: null, // příloha se needituje, jen nahradí novou
    deleteRule: 'owner = @request.auth.id || map.owner = @request.auth.id',
  });
  app.save(files);
}, (app) => {
  const c = app.findCollectionByNameOrId("node_files");
  if (c) app.delete(c);
});
