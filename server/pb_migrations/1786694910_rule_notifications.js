/// <reference path="../pb_data/types.d.ts" />
// Notifikační typy interního automatizačního motoru (vzor 1785020004):
//   rule_notice = akce „pošli notifikaci" z pravidla — uživatel si ji může
//                 v předvolbách vypnout (není v NOTIFY_ALWAYS),
//   rule_broken = rozbitá konfigurace pravidla → vlastníkovi mapy JEDNOU
//                 (flag automation_rules.error_notified), ne spam.
// Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  for (const v of ["rule_notice", "rule_broken"]) {
    if (f.values.indexOf(v) < 0) f.values = f.values.concat([v]);
  }
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  f.values = f.values.filter((v) => v !== "rule_notice" && v !== "rule_broken");
  app.save(col);
});
