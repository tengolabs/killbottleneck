/// <reference path="../pb_data/types.d.ts" />
// Logo organizace: SVG mezi povolenými typy končí.
//
// Soubory se servírují NECHRÁNĚNĚ (`protected: false`) z /api/files/… , tedy
// ze STEJNÉHO PŮVODU jako aplikace. V <img> se skript uvnitř SVG nespustí, ale
// otevřený přímo v adresním řádku ano — a pak sahá na localStorage, kde leží
// přihlašovací token. Nahrát logo smí jen admin (createRule/updateRule), takže
// to není cesta pro běžného uživatele; je to past na admina samotného a na
// phishing („nahrajte si tohle hezké logo"). Rastr nic z toho neumí.
//
// Nález bezpečnostního agenta v panelu /checkup 18. 8. 2026.
// Už nahraná SVG loga se nemažou — validace platí na nové nahrání.
migrate((app) => {
  const org = app.findCollectionByNameOrId("org_settings");
  const pole = org.fields.getByName("logo");
  pole.mimeTypes = ["image/png", "image/jpeg", "image/webp"];
  app.save(org);
}, (app) => {
  const org = app.findCollectionByNameOrId("org_settings");
  const pole = org.fields.getByName("logo");
  pole.mimeTypes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
  app.save(org);
});
