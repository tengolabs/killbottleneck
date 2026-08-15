/// <reference path="../pb_data/types.d.ts" />
// Odkaz jako plnohodnotná příloha uzlu (Richard 28. 7. 2026).
//
// Proč: soubor nahraný do instance je pro provozovatele hostingu ta nejdražší
// věc — platí za jeho místo, tahá se do každé zálohy, patří do DPA jako
// „zpracováváme dokumenty zákazníka" a ručí se za to, co kdo nahraje. Odkaz
// tohle všechno odpadá: soubor zůstává tam, kde je (Disk, OneDrive, SharePoint,
// firemní intranet, konkrétní e-mail), pracuje se na AKTUÁLNÍ verzi a přístup
// řeší to úložiště, ne my. V hostované verzi jsou proto odkazy JEDINÁ cesta.
//
// Nedělá se nová kolekce: je to pořád „příloha uzlu", jen místo souboru nese
// adresu. Jedna kolekce = jedna sada přístupových pravidel (ověřená v api-rls),
// jeden seznam v UI, žádný nový pojem v modelu.
migrate((app) => {
  const files = app.findCollectionByNameOrId("node_files");

  // soubor už není povinný — položka je buď soubor, NEBO odkaz (hlídá hook)
  const file = files.fields.find((f) => f.name === "file");
  if (file) file.required = false;

  if (!files.fields.find((f) => f.name === "url")) {
    files.fields.add(new Field({
      name: "url",
      type: "url",
      required: false,
      // jen web: file:// a spol. prohlížeč z https stránky stejně neotevře
      // a javascript:/data: by byly rovnou díra (uloží útočník, klikne kolega)
      onlyDomains: [],
      exceptDomains: [],
    }));
  }

  app.save(files);
}, (app) => {
  const files = app.findCollectionByNameOrId("node_files");
  const idx = files.fields.findIndex((f) => f.name === "url");
  if (idx >= 0) files.fields.removeByName("url");
  const file = files.fields.find((f) => f.name === "file");
  if (file) file.required = true;
  app.save(files);
});
