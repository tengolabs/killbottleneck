/// <reference path="../pb_data/types.d.ts" />
// Faktury pro kohokoli na světě (Richard 27. 10. 2026): klient dostává NEPOVINNOU měnu faktur (`currency`, ISO 4217) —
// výchozí měna faktur pro tohoto klienta (německý klient v EUR, americký v USD), nad ní má přednost jen výslovná měna
// u vystavení; prázdná = měna z profilu dodavatele. Profil dodavatele (země, měna, BIC, název daně) je JSON → bez migrace.
// Razítko = aktuální čas (automigrate=0, starší by PocketBase přeskočil).
migrate((app) => {
  const c = app.findCollectionByNameOrId("clients");
  if (!c.fields.getByName("currency")) {
    c.fields.add(new TextField({ name: "currency", max: 3 }));
    app.save(c);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("clients");
  if (c.fields.getByName("currency")) { c.fields.removeByName("currency"); app.save(c); }
});
