/// <reference path="../pb_data/types.d.ts" />
// Číslo projektu (Richard 2. 10. 2026: „každý projekt musí mít specifické číslo“).
// goalmaps.project_number = celočíselná řada pro celou instanci, přiděluje ji
// výhradně server (model hook onRecordCreate v main.pb.js → helpers.assignProjectNumber),
// nikdy se nemění a nerecykluje. Čítač příštího čísla drží instance_settings
// (next_project_number, sémantika jako templates.next_number = PŘÍŠTÍ přidělované).
// Částečný unikátní index WHERE project_number > 0: org mapa (kind = "org") a
// případné neočíslované řádky mají 0 a index je nehlídá.
//
// Backfill existujících map ZÁMĚRNĚ přímým SQL, ne app.save(record):
//  - app.save by posunul autodate `updated` → otevřené editory by hlásily konflikt
//    (base_updated) a seznamy řazené -updated by se přeházely;
//  - app.save by spustil model hooky z pb_hooks (číslo by přidělil hook místo pořadí
//    podle data vzniku).
// Pořadí čísel = pořadí `created` (nejstarší = #1). Guard `project_number = 0` =
// idempotence (druhý běh nic nepřepíše). Razítko souboru = aktuální čas.
migrate((app) => {
  const g = app.findCollectionByNameOrId("goalmaps");
  let saveG = false;
  if (!g.fields.getByName("project_number")) {
    g.fields.add(new NumberField({ name: "project_number", onlyInt: true, min: 0 }));
    saveG = true;
  }
  if (!g.indexes.some((i) => /idx_goalmaps_project_number\b/.test(String(i)))) {
    g.indexes = g.indexes.concat(["CREATE UNIQUE INDEX idx_goalmaps_project_number ON goalmaps (project_number) WHERE project_number > 0"]);
    saveG = true;
  }
  if (saveG) app.save(g);

  const s = app.findCollectionByNameOrId("instance_settings");
  if (!s.fields.getByName("next_project_number")) {
    s.fields.add(new NumberField({ name: "next_project_number", onlyInt: true, min: 0 }));
    app.save(s);
  }

  // backfill podle data vzniku (ROW_NUMBER = SQLite ≥ 3.25, PocketBase ho má)
  app.db().newQuery(
    "UPDATE goalmaps SET project_number = (" +
    "  SELECT rn FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created, id) AS rn FROM goalmaps" +
    "                  WHERE IFNULL(kind, '') != 'org' AND IFNULL(project_number, 0) = 0) t" +
    "  WHERE t.id = goalmaps.id) " +
    "WHERE IFNULL(kind, '') != 'org' AND IFNULL(project_number, 0) = 0"
  ).execute();

  // řádek nastavení musí existovat, aby měl čítač kam psát (routy ho zakládají líně)
  let rec;
  try {
    rec = app.findFirstRecordByFilter("instance_settings", "id != ''");
  } catch (err) {
    rec = new Record(s);
    app.save(rec);
  }
  app.db().newQuery(
    "UPDATE instance_settings SET next_project_number = (SELECT IFNULL(MAX(project_number), 0) + 1 FROM goalmaps)"
  ).execute();

  try {
    const row = new DynamicModel({ c: 0, m: 0 });
    app.db().newQuery("SELECT COUNT(*) AS c, IFNULL(MAX(project_number), 0) AS m FROM goalmaps WHERE project_number > 0").one(row);
    console.log("goalmaps_project_number: očíslováno map " + row.c + ", nejvyšší číslo " + row.m);
  } catch (err) { /* výpis je bonus */ }
}, (app) => {
  const g = app.findCollectionByNameOrId("goalmaps");
  g.indexes = g.indexes.filter((i) => !/idx_goalmaps_project_number\b/.test(String(i)));
  g.fields.removeByName("project_number");
  app.save(g);
  const s = app.findCollectionByNameOrId("instance_settings");
  s.fields.removeByName("next_project_number");
  app.save(s);
});
