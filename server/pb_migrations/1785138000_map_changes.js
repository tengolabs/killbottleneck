/// <reference path="../pb_data/types.d.ts" />
// A3 „Co se změnilo od minule" — ZÁZNAMNÍK ZMĚN projektu.
//
// Proč vůbec: uzly nemají vlastní razítko změny, protože žijí v jednom JSON blobu
// mapy. Ze samotných dat se tedy nedá poznat, co se pohnulo — a přesně to člověk
// potřebuje, když jde na poradu. Bez tohohle se stav musí opsat ručně do chatu,
// což je hlavní nález rešerše konkurence (nástroj = práce navíc).
//
// Proč záznamník a ne pravidelný otisk mapy (rozhodnutí Richarda 27. 7. 2026):
//   • zná PŘESNÝ čas a autora, ne jen „někdy za posledních 7 dní",
//   • umí libovolné okno (7 dní / 30 dní / vše) místo jednoho pevného,
//   • dá razítko změny i UZLŮM → odemyká detekci zaseknutých uzlů (bod A4),
//     která dosud uměla jen úkoly.
// A hlavně je skoro zadarmo: hook `goalmaps` update ten rozdíl UŽ POČÍTÁ kvůli
// notifikacím „můžete začít" — přibude jen zápis pár řádků.
//
// ⚠️ Logují se JEN status/deadline/owner/title. Posun uzlu po plátně ne — autosave
// editoru by jinak záznamník zaplavil šumem a souhrn by byl k ničemu.
//
// RLS: čte, kdo vidí mapu (vzor po bezpečnostní opravě 1785020006 — `?=` nad
// normalizovanou map_shares, NIKDY `~` nad JSON zrcadlem shared_with, to je
// podřetězec a tedy díra). Zapisuje VÝHRADNĚ server, proto create/update/delete
// = null. Razítko = aktuální čas (automigrate=0).
migrate((app) => {
  const mapsId = app.findCollectionByNameOrId("goalmaps").id;

  const READ = '@request.auth.id != "" && ('
    + 'map.owner = @request.auth.id'
    + ' || map.map_shares_via_map.email ?= @request.auth.email'
    + ' || map.team_access != ""'
    + ')';

  const changes = new Collection({
    type: "base",
    name: "map_changes",
    fields: [
      { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1, required: true, cascadeDelete: true },
      // co se změnilo: "node" = uzel mapy (id v JSON), "task" = záznam v tasks
      { name: "kind", type: "select", values: ["node", "task"], maxSelect: 1, required: true },
      { name: "item_id", type: "text", required: true },
      // název v době změny — uzel/úkol může později zmizet, ale souhrn musí zůstat čitelný
      { name: "title", type: "text", max: 500 },
      { name: "field", type: "select", values: ["status", "deadline", "owner", "title", "created", "deleted"], maxSelect: 1, required: true },
      { name: "from", type: "text", max: 500 },
      { name: "to", type: "text", max: 500 },
      { name: "actor_email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [
      // dotaz je vždy „změny téhle mapy od data X" → složený index přesně na to
      "CREATE INDEX idx_map_changes_map_created ON map_changes (map, created)",
    ],
    listRule: READ,
    viewRule: READ,
    createRule: null, // píše jen server z hooků
    updateRule: null, // záznam historie se needituje — jinak by přestal být historií
    deleteRule: null,
  });
  app.save(changes);
}, (app) => {
  let c = null;
  try { c = app.findCollectionByNameOrId("map_changes"); } catch (_) { /* není */ }
  if (c) app.delete(c);
});
