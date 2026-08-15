/// <reference path="../pb_data/types.d.ts" />
// Účetnictví odeslaných e-mailů — MIMO kolekci notifications.
//
// Proč vlastní kolekce: denní e-mailový strop se dosud počítal z příznaku
// `emailed` na notifikacích, jenže ty si uživatel podle `deleteRule` SMÍ MAZAT.
// Smazáním si tedy vynuloval počítadlo a posílal dál — kontrola z 5. 8. 2026 to
// reprodukovala: při stropu 2 prošly 4 maily (2 → smazat → 2). Dopad je ten,
// kvůli kterému strop vznikl: hostované instance sdílejí jednu poštovní kvótu,
// takže jeden účet vyčerpá limit celé flotile a přestanou chodit resety hesel.
//
// Tady se nedá mazat ani číst z klienta (všechna pravidla null = jen server).
// Řádek na (uživatel, den); starší než 40 dní uklidí cron prune_mail_budget.
migrate((app) => {
  const col = new Collection({
    type: "base",
    name: "mail_budget",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "user", type: "relation", required: true, collectionId: app.findCollectionByNameOrId("users").id, maxSelect: 1, cascadeDelete: true },
      { name: "day", type: "text", required: true, max: 10 },
      { name: "sent", type: "number", onlyInt: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_mail_budget_user_day ON mail_budget (user, day)",
    ],
  });
  app.save(col);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("mail_budget"));
});
