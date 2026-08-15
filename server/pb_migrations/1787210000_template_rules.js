/// <reference path="../pb_data/types.d.ts" />
// Šablona s vestavěnými pravidly (Richard 2026-08-15): šablona mapy volitelně
// nese automatizační pravidla. Položka: {id:'r1', name, name_en?, node_id?:'d1',
// trigger, conditions, actions} — stejný tvar jako tělo /rules/save, jen s
// KRÁTKÝMI šablonovými id uzlů (d1…) místo reálných; při založení mapy se
// přemapují přes idMap (remapRuleIds/remapRuleIdsServer) a založí NORMÁLNÍ
// cestou přes validateRuleInput. `enabled` se nenese — instanciace zakládá
// vždy zapnuto. Prázdné pole = šablona bez pravidel.
migrate((app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.add(new JSONField({ name: "rules", maxSize: 512000 }));
  app.save(templates);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.removeByName("rules");
  app.save(templates);
});
