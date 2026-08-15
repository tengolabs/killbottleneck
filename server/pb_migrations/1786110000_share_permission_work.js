/// <reference path="../pb_data/types.d.ts" />
// Třetí úroveň sdílení mapy: „spolupracovník" (work) — mezi čtením a editací
// (Richard 7. 8. 2026). Vidí mapu, označuje splněné JEN u svých úkolů (routou
// /node-status), komentuje a (výhledově) žádá o změnu termínu. Nic jiného nemění.
//
// ZÁMĚRNĚ ŽÁDNÁ ZMĚNA RLS PRAVIDEL: work NENÍ v email_edit, takže goalmaps
// updateRule ho dál nepouští — přesně to je pointa (edit-práva na celý JSON
// nodes byla zdrojem děr, viz deadlineChangeDenied). Čtení má z map_shares.email,
// komentáře pouští read-share, tasky větev assignee_email. team_access zůstává
// dvouúrovňové (read/edit) — org-wide „work" bez přiřazení nedává smysl.
migrate((app) => {
  const shares = app.findCollectionByNameOrId("map_shares");
  const pf = shares.fields.getByName("permission");
  if (pf.values.indexOf("work") < 0) pf.values = ["read", "work", "edit"];
  app.save(shares);

  // JSON zrcadlo pro frontend (paralela shared_with_edit) — NIKDY autorizace,
  // tu drží výhradně map_shares (invariant migrace 1785020006)
  const maps = app.findCollectionByNameOrId("goalmaps");
  if (!maps.fields.getByName("shared_with_work")) {
    maps.fields.add(new JSONField({ name: "shared_with_work", maxSize: 100000 }));
  }
  app.save(maps);
}, (app) => {
  // down: work řádky překlopit na read (bezpečnější než na edit), pak hodnotu odebrat
  const rows = app.findRecordsByFilter("map_shares", "permission = 'work'", "", 0, 0);
  for (const r of rows) {
    r.set("permission", "read");
    app.save(r);
  }
  const shares = app.findCollectionByNameOrId("map_shares");
  const pf = shares.fields.getByName("permission");
  pf.values = ["read", "edit"];
  app.save(shares);
  const maps = app.findCollectionByNameOrId("goalmaps");
  if (maps.fields.getByName("shared_with_work")) maps.fields.removeByName("shared_with_work");
  app.save(maps);
});
