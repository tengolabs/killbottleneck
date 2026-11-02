/// <reference path="../pb_data/types.d.ts" />
// S13 (audit 14. 10. 2026): kolekce `uploads` (zbytek Base44 kompat vrstvy) měla
// viewRule "" a soubor BEZ `protected` → kdokoli přihlášený do ní nahrál a kdokoli
// (i anonym) stáhl obsah i metadata podle URL, mimo RLS mapy a bez revokace.
// Ověřeno stažením bez přihlášení. Reálné přílohy uzlů v aplikaci jsou `node_files`
// (ty už protected jsou); tahle kolekce je v produktu nevyužitá, ale zapisovatelná,
// takže ji stačí zpřísnit: čtení jen vlastník, soubor chráněný (file-token + view),
// a zápis zamknout (checkup 2. 11. 2026): createRule null = jen superuser — jinak by
// kdokoli přihlášený plnil disk 25MB soubory do kolekce, kterou aplikace nepoužívá
// (Cloud Lite nahrávání nemá, tohle by ho obešlo).
migrate((app) => {
  const c = app.findCollectionByNameOrId("uploads");
  c.viewRule = "owner = @request.auth.id";
  c.createRule = null;
  const f = c.fields.getByName("file");
  f.protected = true;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("uploads");
  c.viewRule = "";
  c.createRule = '@request.auth.id != ""';
  const f = c.fields.getByName("file");
  f.protected = false;
  app.save(c);
});
