/// <reference path="../pb_data/types.d.ts" />
// Profil DODAVATELE pro faktury z asistenta (9. 10. 2026): jméno/firma, adresa, IČO, DIČ, plátce DPH a sazba,
// bankovní účet (+ dopočítaný IBAN pro QR platbu), e-mail, předpona číselné řady, splatnost. Jeden profil
// na INSTANCI (sólo = správce je ten člověk; malý tým fakturuje jako jedna firma s jednou číselnou řadou).
// ⚠️ NEPLÉST s `instance_settings.billing` = fakturační údaje ODBĚRATELE killBottlenecku (jen hostované).
// Zápis jen přes admin routu /api/kb/invoicing-profile (whitelist + validace v faktury.js).
migrate((app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  if (!c.fields.getByName("invoicing")) {
    c.fields.add(new Field({ name: "invoicing", type: "json", maxSize: 4096 }));
    app.save(c);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  if (c.fields.getByName("invoicing")) { c.fields.removeByName("invoicing"); app.save(c); }
});
