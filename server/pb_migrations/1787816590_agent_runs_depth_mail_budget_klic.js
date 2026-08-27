/// <reference path="../pb_data/types.d.ts" />
// Vlna B analýzy kódu (27. 8. 2026):
// - agent_runs.depth: hloubka řetězu pravidel, ze kterého běh vzešel — callback ji
//   vrací do v1SaveMapData, ať pojistka MAX_RULE_DEPTH platí i přes HTTP (S1-03).
// - mail_budget.day max 250: nese i závoru `n:<dedup klíč>` pro e-mail-only
//   příjemce notifikací (klíče obsahují e-mail a datum) (S2-02).
migrate((app) => {
  const runs = app.findCollectionByNameOrId("agent_runs");
  if (!runs.fields.getByName("depth")) {
    runs.fields.add(new NumberField({ name: "depth", onlyInt: true, min: 0 }));
    app.save(runs);
  }
  const mb = app.findCollectionByNameOrId("mail_budget");
  mb.fields.getByName("day").max = 250;
  app.save(mb);
}, (app) => {
  const runs = app.findCollectionByNameOrId("agent_runs");
  runs.fields.removeByName("depth");
  app.save(runs);
  const mb = app.findCollectionByNameOrId("mail_budget");
  mb.fields.getByName("day").max = 32;
  app.save(mb);
});
