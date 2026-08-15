/// <reference path="../pb_data/types.d.ts" />
// Záznamník změn (`map_changes`, migrace 1785138000) je jediná kolekce ve FlowMapu,
// která ROSTE SAMA a nikdy se sama nesmaže — každé uložení mapy do ní může přidat
// řádky. Bez tohohle by po roce provozu tiše nabobtnala a dotazy nad ní zpomalily.
//
// Přidává dvě věci, obě čistě provozní (schéma ani chování se nemění):
//
// 1) INDEXY na dotazy, které vznikly až po založení kolekce:
//    • „co jsem dnes odbavil" filtruje `actor_email + field + to + created`
//      (helpers.js:buildMyDay) — původní index (map, created) na to nesedí vůbec,
//      protože se v něm mapa nefiltruje.
//    • „nehýbe se" u UZLŮ hledá poslední pohyb podle `kind + map` seřazeně
//      podle času (tentýž soubor) — původní index nemá `kind`.
//
// 2) RETENCE: denní úklid řádků starších než 400 dní. Proč zrovna 400:
//    nejdelší okno, které rozhraní nabízí, je „vše", ale prakticky se souhrn
//    čte v oknech 7 / 30 dní; rok s rezervou pokryje i meziroční srovnání.
//    ⚠️ Je to ZTRÁTOVÉ a nevratné — historie starší než 400 dní zmizí.
//    Kdo ji potřebuje, musí si ji vyexportovat (v1 API / záloha pb_data).
//    Úklid je v `crons.js`? Ne — cron se v PocketBase registruje z hooků, takže
//    ho zakládá pb_hooks/main.pb.js. Tady je jen komentář, ať se to hledá.
migrate((app) => {
  const col = app.findCollectionByNameOrId("map_changes");
  const idx = col.indexes || [];
  const add = [
    // „hotovo dnes": nejdřív autor, pak čas — to je selektivita v tomhle pořadí
    "CREATE INDEX IF NOT EXISTS idx_map_changes_actor_created ON map_changes (actor_email, created)",
    // „nehýbe se" u uzlů: druh + mapa, řazeno časem
    "CREATE INDEX IF NOT EXISTS idx_map_changes_kind_map_created ON map_changes (kind, map, created)",
  ];
  for (const q of add) if (!idx.includes(q)) idx.push(q);
  col.indexes = idx;
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("map_changes");
  col.indexes = (col.indexes || []).filter((q) =>
    !q.includes("idx_map_changes_actor_created") && !q.includes("idx_map_changes_kind_map_created"));
  app.save(col);
});
