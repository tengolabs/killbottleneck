/// <reference path="../pb_data/types.d.ts" />
// Zdroj tahu asistenta (14. 10. 2026): "nas" = naše AI (kvóta, kredity), "vlastni" = vlastní model zákazníka
// (hostovaná instance, 0 kreditů, kvótu nečerpá). Starší řádky bez hodnoty = naše AI.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.add(new Field({ name: "zdroj", type: "text", max: 20 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.removeByName("zdroj");
  app.save(c);
});
