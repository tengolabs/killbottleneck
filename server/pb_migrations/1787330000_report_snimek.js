/// <reference path="../pb_data/types.d.ts" />
// K hlášení chyby/nápadu jde přiložit snímek obrazovky (podnět z bety
// 21. 8. 2026: „blbě se to popisuje, obrázek řekne víc").
//
// Soubor se ukládá k záznamu v `reports`: pisatel ho vidí v „Už jste
// nahlásili" a při výpadku pošty se snímek neztratí. Maže ho stávající
// úklid prune_reports spolu s celým záznamem (30 dnů). Jen rastr — SVG
// je past na toho, kdo přílohu otevře (viz 1787270000_org_logo_bez_svg).
// Limit 2 MB stačí: dialog snímek před odesláním zmenšuje na ~250 kB.
migrate((app) => {
  const reports = app.findCollectionByNameOrId("reports");
  reports.fields.add(new FileField({
    name: "image",
    maxSelect: 1,
    maxSize: 2 * 1024 * 1024,
    mimeTypes: ["image/png", "image/jpeg", "image/webp"],
    // ⚠️ protected: bez něj PocketBase servíruje soubor z /api/files/… KOMUKOLI
    // se znalostí URL — a snímek obrazovky je přesně to, co „vidíte jen vy"
    // ze zásad soukromí. Čtení jde přes krátkodobý file token (vzor node_files).
    protected: true,
  }));
  app.save(reports);
}, (app) => {
  const reports = app.findCollectionByNameOrId("reports");
  reports.fields.removeByName("image");
  app.save(reports);
});
