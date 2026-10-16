/// <reference path="../pb_data/types.d.ts" />
// Kalendář „jen pro vybrané“ = jako soukromý projekt i pro správce (Richard 15. 10. 2026: „srovnat“):
// správce, který není členem ani zakladatelem, kalendář a jeho události nevidí. Do 1792080000
// měl správce výjimku (`@request.auth.role = "admin"`), u map ji nemá (1751900000 init).
migrate((app) => {
  const cal = app.findCollectionByNameOrId("calendars");
  const vidi = '@request.auth.id != "" && (visibility != "members" || members.id ?= @request.auth.id || created_by = @request.auth.id)';
  cal.listRule = vidi;
  cal.viewRule = vidi;
  app.save(cal);
  const events = app.findCollectionByNameOrId("events");
  const rule = '@request.auth.id != "" && (owner = @request.auth.id || participants.id ?= @request.auth.id || (calendar != "" && calendar.archived = false && (calendar.visibility != "members" || calendar.members.id ?= @request.auth.id || calendar.created_by = @request.auth.id))) && (status != "rejected" || owner = @request.auth.id || participants.id ?= @request.auth.id || @request.auth.role = "admin" || @request.auth.role = "manager")';
  events.listRule = rule;
  events.viewRule = rule;
  app.save(events);
}, (app) => {
  const cal = app.findCollectionByNameOrId("calendars");
  const vidi = '@request.auth.id != "" && (visibility != "members" || members.id ?= @request.auth.id || created_by = @request.auth.id || @request.auth.role = "admin")';
  cal.listRule = vidi;
  cal.viewRule = vidi;
  app.save(cal);
  const events = app.findCollectionByNameOrId("events");
  const rule = '@request.auth.id != "" && (owner = @request.auth.id || participants.id ?= @request.auth.id || (calendar != "" && calendar.archived = false && (calendar.visibility != "members" || calendar.members.id ?= @request.auth.id || calendar.created_by = @request.auth.id || @request.auth.role = "admin"))) && (status != "rejected" || owner = @request.auth.id || participants.id ?= @request.auth.id || @request.auth.role = "admin" || @request.auth.role = "manager")';
  events.listRule = rule;
  events.viewRule = rule;
  app.save(events);
});
