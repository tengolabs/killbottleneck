/// <reference path="../pb_data/types.d.ts" />
// Zamčený styl zarovnání mapy: prázdné = žádný zámek, jinak zvolený styl.
//
// Záměrně POLE NA users (vzor skin_id / language / notify_prefs): preference
// cestuje s účtem mezi zařízeními zdarma a RLS je hotové (self/admin).
// Richard 12. 8. 2026: „ten zámeček zarovnání udělej stejně jako skin" —
// první verze ho držela jen v prohlížeči (localStorage), takže zámek zapnutý
// na počítači na mobilu neplatil, ačkoli nápověda slibovala „pro všechny mapy".
//
// Hodnoty musí odpovídat ALIGN_STYLES ve frontend/src/lib/alignStyles.js.
//
// ⚠️ RAZÍTKO MUSÍ BÝT VYŠŠÍ NEŽ POSLEDNÍ APLIKOVANÁ MIGRACE. První verze měla
// 1785999000, tedy míň než 1786140000_externi_kontakty — PocketBase ji TIŠE
// PŘESKOČIL a pole nevzniklo (ověřeno spuštěním proti existující databázi,
// 12. 8. 2026). Nic to nenahlásí, projeví se to až chybějícím polem.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({
    name: "align_lock",
    values: ["classic", "compact", "bands"],
    maxSelect: 1,
  }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("align_lock");
  app.save(users);
});
