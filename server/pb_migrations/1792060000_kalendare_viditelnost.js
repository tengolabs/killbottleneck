/// <reference path="../pb_data/types.d.ts" />
// Viditelnost sdílených kalendářů (Richard 15. 10. 2026: „sdílené kalendáře musí jít
// nastavovat i pouze pro některé členy jako naše projekty“).
//
// `visibility`: all = celý tým (dosavadní chování), members = jen vybraní členové
// (`members`) + zakladatel + správce (ten kalendáře spravuje; manažer bez členství
// kalendář nevidí — jako u soukromého projektu). RLS to drží na obou kolekcích:
// kalendář sám i jeho události (precedens map_shares u map; tady členství je
// relace přímo na kalendáři, protože kalendářů je pár a práva jsou jen „vidí“).
// Zápis dál jen routami (events-api.js), které viditelnost ověřují stejně.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const cal = app.findCollectionByNameOrId("calendars");
  cal.fields.add(new SelectField({ name: "visibility", values: ["all", "members"], maxSelect: 1 }));
  cal.fields.add(new RelationField({ name: "members", collectionId: usersId, maxSelect: 200, cascadeDelete: false }));
  const vidi = 'visibility != "members" || members.id ?= @request.auth.id || created_by = @request.auth.id || @request.auth.role = "admin"';
  cal.listRule = vidi;
  cal.viewRule = vidi;
  app.save(cal);

  const events = app.findCollectionByNameOrId("events");
  const rule = 'owner = @request.auth.id || participants.id ?= @request.auth.id || (calendar != "" && (calendar.visibility != "members" || calendar.members.id ?= @request.auth.id || calendar.created_by = @request.auth.id || @request.auth.role = "admin"))';
  events.listRule = rule;
  events.viewRule = rule;
  app.save(events);
}, (app) => {
  const events = app.findCollectionByNameOrId("events");
  const rule = 'owner = @request.auth.id || participants.id ?= @request.auth.id || calendar != ""';
  events.listRule = rule;
  events.viewRule = rule;
  app.save(events);
  const cal = app.findCollectionByNameOrId("calendars");
  cal.listRule = '@request.auth.id != ""';
  cal.viewRule = '@request.auth.id != ""';
  for (const n of ["visibility", "members"]) { try { cal.fields.removeByName(n); } catch (err) { /* už není */ } }
  app.save(cal);
});
