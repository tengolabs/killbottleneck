/// <reference path="../pb_data/types.d.ts" />
// Faktury z asistenta (Richard 9. 10. 2026): klient = odběratel na faktuře. Adresář klientů
// (`clients`, instance-wide, vazba goalmaps.client a měření času) dostává NEPOVINNÁ fakturační pole —
// žádná nová tabulka kontaktů (anti-bloat, [[project-kb-slovnik-rozhodnout]]: duplicitní tabulky ne).
// `external_contacts` jsou řešitelé úkolů (pseudo-e-mail), fakturační subjekt není řešitel — nemíchat.
// Adresa je jeden víceřádkový text (tiskne se, jak je) — žádné povinné pole navíc.
// Razítko = aktuální čas (automigrate=0, starší by PocketBase přeskočil).
migrate((app) => {
  const c = app.findCollectionByNameOrId("clients");
  let save = false;
  const pole = [
    new TextField({ name: "address", max: 300 }),
    new TextField({ name: "ico", max: 20 }),
    new TextField({ name: "dic", max: 20 }),
    new EmailField({ name: "email" }),
  ];
  for (const f of pole) {
    if (!c.fields.getByName(f.name)) { c.fields.add(f); save = true; }
  }
  if (save) app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("clients");
  for (const n of ["address", "ico", "dic", "email"]) if (c.fields.getByName(n)) c.fields.removeByName(n);
  app.save(c);
});
