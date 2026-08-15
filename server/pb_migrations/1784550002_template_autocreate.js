/// <reference path="../pb_data/types.d.ts" />
// Opakované šablony (Richard 2026-07-20): šablona se sama v daný den instancuje
// na nový projekt („spusť každé pondělí / první den v měsíci"). `auto_create`
// weekly|monthly (prázdné = vypnuto), `auto_day` = den (weekly 1=Po…7=Ne;
// monthly 1–31 s clampem na konec měsíce), `auto_last` = YYYY-MM-DD posledního
// spuštění (server-managed guard proti dvojímu založení). Spouští denní cron
// auto_templates v pb_hooks. Razítko = aktuální čas.
migrate((app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.add(new SelectField({
    name: "auto_create",
    values: ["weekly", "monthly"],
    maxSelect: 1,
  }));
  templates.fields.add(new NumberField({ name: "auto_day", onlyInt: true, min: 0, max: 31 }));
  templates.fields.add(new TextField({ name: "auto_last", max: 10 }));
  app.save(templates);
}, (app) => {
  const templates = app.findCollectionByNameOrId("templates");
  templates.fields.removeByName("auto_create");
  templates.fields.removeByName("auto_day");
  templates.fields.removeByName("auto_last");
  app.save(templates);
});
