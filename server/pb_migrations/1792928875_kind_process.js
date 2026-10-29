/// <reference path="../pb_data/types.d.ts" />
// Typ mapy „process" (Richard 21. 10. 2026: dva styly projektu). Prázdné =
// projekt (cílem je dokončit), "process" = PROCES (zmapovaný provoz, kroky se
// opakují, cílem je nepřetržitý běh — žádné %, žádné „Vše hotovo"). Na rozdíl
// od "org" ho volí uživatel: při založení (create hook, v1, MCP, asistent)
// a přepnutím v menu editoru — jen vlastník a jen "" ↔ "process"; "org"
// zůstává výhradně serverové (main.pb.js).
//
// Šablona nese styl v `map_kind` ("" = projekt, "process" = proces) — projekt
// ze šablony procesu je proces. Systémová šablona procesu „Týdenní provoz
// kanceláře" (data/system_templates.json) se doseje tady: seed 1787827854 už
// na stávajících instancích proběhl a na nové instanci běží dřív, než pole
// map_kind existuje (hodnotu by zahodil) — proto se styl systémových šablon
// dorovná podle JSONu i u už založených záznamů.
migrate((app) => {
  const maps = app.findCollectionByNameOrId("goalmaps");
  maps.fields.getByName("kind").values = ["org", "process"];
  app.save(maps);

  const col = app.findCollectionByNameOrId("templates");
  if (!col.fields.getByName("map_kind")) {
    col.fields.add(new SelectField({ name: "map_kind", values: ["process"], maxSelect: 1 }));
    app.save(col);
  }
  const cesta = $filepath.join(__hooks, "..", "pb_migrations", "data", "system_templates.json");
  const sablony = JSON.parse(toString($os.readFile(cesta)));
  let zalozeno = 0;
  for (const t of sablony) {
    let rec = null;
    try { rec = app.findFirstRecordByFilter("templates", "title = {:title} && owner = ''", { title: t.title }); } catch (err) { rec = null; }
    if (!rec) {
      // zakládá se JEN nová šablona procesu — systémovou šablonu, kterou správce záměrně smazal (nebo ji pozdější
      // migrace přejmenovala), nevracet jako duplikát (/checkup 29. 10. 2026)
      if ((t.map_kind || "") !== "process") continue;
      rec = new Record(col);
      for (const k of Object.keys(t)) rec.set(k, t[k]);
      app.save(rec);
      zalozeno++;
    } else if ((t.map_kind || "") !== rec.getString("map_kind")) {
      rec.set("map_kind", t.map_kind || "");
      app.save(rec);
    }
  }
  if (zalozeno > 0) console.log("kind_process: založeno " + zalozeno + " systémových šablon");
}, (app) => {
  try {
    const r = app.findFirstRecordByFilter("templates", "title = {:title} && owner = ''", { title: "Týdenní provoz kanceláře" });
    app.delete(r);
  } catch (err) { /* už není */ }
  const col = app.findCollectionByNameOrId("templates");
  if (col.fields.getByName("map_kind")) { col.fields.removeByName("map_kind"); app.save(col); }
  // procesy se vrátí na běžné mapy, select zase jen "org"
  app.db().newQuery("UPDATE goalmaps SET kind = '' WHERE kind = 'process'").execute();
  const maps = app.findCollectionByNameOrId("goalmaps");
  maps.fields.getByName("kind").values = ["org"];
  app.save(maps);
});
