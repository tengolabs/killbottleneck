/// <reference path="../pb_data/types.d.ts" />
// ai_chat_log.stav (ok|chyba) + chyba (text výjimky) — tahy, které selhaly (502, timeout),
// dřív v logu nebyly vůbec; testovací firmy tengo/DUVE mají měřit i „kdy to nestíhalo“ (14. 9. 2026).
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.add(new SelectField({ name: "stav", values: ["ok", "chyba"], maxSelect: 1 }));
  c.fields.add(new TextField({ name: "chyba", max: 300 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.removeByName("stav");
  c.fields.removeByName("chyba");
  app.save(c);
});
