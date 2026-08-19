/// <reference path="../pb_data/types.d.ts" />
// ŽIVOTOPIS CÍLE (Richard 19. 8. 2026: „potřebuji tam ne jen datumy, ale i časy
// a všechny změny, takový log"). Záznamník `map_changes` dosud uměl jen čtyři
// pole — stav, termín, řešitele a název. Na otázku „co se s tímhle cílem dělo"
// to nestačí: změna zadání, ikony, barvy ani vykonavatele v něm nebyla vidět.
//
// Tři věci, všechny na existující kolekci:
//
// 1) NOVÉ HODNOTY VE `field`. ⚠️ `field` je SELECT s pevným výčtem — hodnota,
//    která v něm není, se NEULOŽÍ a řádek TIŠE ZMIZÍ, protože logMapChanges
//    polyká chyby záměrně (historie nikdy nesmí shodit uložení mapy). Přesně
//    na tohle doplatila migrace 1787200000 s hodnotou "parent". Proto tahle
//    migrace MUSÍ být nasazená DŘÍV, než se rozšíří TRACKED_NODE_FIELDS.
//
// 2) POLE `via` — kdo změnu doopravdy provedl. Dosud se u zásahu automatizačního
//    pravidla zapsal e-mail AUTORA pravidla, takže životopis tvrdil, že to
//    udělal člověk. To je v auditním logu lež. `actor_email` je typu `email`
//    a "rule:<id>" se do něj nevejde — stejný důvod, proč `rule_runs.actor`
//    (migrace 1786694909) je text. Prázdné = člověk, jinak "rule:<id>"
//    nebo "agent:<jméno>".
//
// 3) INDEX na dotaz „řádky JEDNOHO uzlu" (map + item_id, řazeno časem).
//    Žádný ze tří existujících indexů ho nepokrývá: (map, created),
//    (actor_email, created) ani (kind, map, created) nemají item_id.
//
// ⚠️ Razítko musí být VYŠŠÍ než poslední aplikovaná migrace (1787290000),
// jinak ji PocketBase tiše přeskočí.
const NOVE_FIELDY = ["description", "icon", "color", "executor", "waiting"];
const IDX_UZEL = "CREATE INDEX IF NOT EXISTS idx_map_changes_map_item ON map_changes (map, item_id, created)";

migrate((app) => {
  const col = app.findCollectionByNameOrId("map_changes");

  const f = col.fields.getByName("field");
  for (const v of NOVE_FIELDY) if (f.values.indexOf(v) < 0) f.values = f.values.concat([v]);

  if (!col.fields.getByName("via")) {
    col.fields.add(new TextField({ name: "via", max: 200 }));
  }

  const idx = col.indexes || [];
  if (!idx.includes(IDX_UZEL)) idx.push(IDX_UZEL);
  col.indexes = idx;

  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("map_changes");
  const f = col.fields.getByName("field");
  f.values = f.values.filter((v) => NOVE_FIELDY.indexOf(v) < 0);
  col.fields.removeByName("via");
  col.indexes = (col.indexes || []).filter((q) => !q.includes("idx_map_changes_map_item"));
  app.save(col);
});
