/// <reference path="../pb_data/types.d.ts" />
// BEZPEČNOSTNÍ OPRAVA: `notifications.dedup_key` měl GLOBÁLNÍ unique index, přitom
// je to pole na záznamu, který uživatel smí updatovat (označení přečteno).
// Útočník proto mohl PATCHnout vlastní notifikaci na klíč odvozený pro někoho
// jiného (formát „due:<kbelík>:<e-mail>:<datum>" je z chování aplikace odvoditelný)
// a tím CIZÍMU člověku umlčet termínová upozornění — cron narazil na kolizi,
// notify() ji podle návrhu tiše spolkne jako „už odesláno".
//
// Dvě vrstvy obrany:
//   1) index se zužuje na (user, dedup_key) — squatting cizího klíče nic neudělá,
//      protože unikátnost platí jen v rámci příjemce (a to je i sémanticky správně:
//      „tenhle souhrn už tenhle člověk dneska dostal")
//   2) notifications update hook (main.pb.js) nechá uživateli měnit VÝHRADNĚ `read`
//
// Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  col.indexes = [
    "CREATE UNIQUE INDEX idx_notifications_dedup ON notifications (`user`, dedup_key) WHERE dedup_key != ''",
    "CREATE INDEX idx_notifications_user_created ON notifications (`user`, created)",
    "CREATE INDEX idx_notifications_user_read ON notifications (`user`, `read`)",
  ];
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  col.indexes = [
    "CREATE UNIQUE INDEX idx_notifications_dedup ON notifications (dedup_key) WHERE dedup_key != ''",
    "CREATE INDEX idx_notifications_user_created ON notifications (`user`, created)",
    "CREATE INDEX idx_notifications_user_read ON notifications (`user`, `read`)",
  ];
  app.save(col);
});
