/// <reference path="../pb_data/types.d.ts" />
// Bezpečnostní oprava RLS kalendářů a událostí (panel 15. 10. 2026, ověřeno spuštěním):
// pravidla z 1789820000 a 1792060000 NEMĚLA `@request.auth.id != ""`. Anonymní požadavek má
// `@request.auth.id` = "" a `participants.id ?= ""` / `members.id ?= ""` je u PRÁZDNÉ relace
// pravdivé → nepřihlášený četl z internetu celý firemní kalendář, nepřítomnosti i osobní
// události bez účastníků (ta část byla už před větví). Precedens správného tvaru:
// 1751900008_org_share.js `(@request.auth.id != "" && team_access != "")`.
// Zároveň RLS srovnána s routou listEvents: zamítnutou nepřítomnost vidí jen žadatel,
// dotyčný a správce/manažer (poznámka k rozhodnutí je důvěrná), události archivovaného
// kalendáře se přes přímé API nevracejí.
migrate((app) => {
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
}, (app) => {
  // down = tvar z 1792060000, ale s pojistkou na přihlášení (díru zpět neotvíráme)
  const cal = app.findCollectionByNameOrId("calendars");
  const vidi = '@request.auth.id != "" && (visibility != "members" || members.id ?= @request.auth.id || created_by = @request.auth.id || @request.auth.role = "admin")';
  cal.listRule = vidi;
  cal.viewRule = vidi;
  app.save(cal);
  const events = app.findCollectionByNameOrId("events");
  const rule = '@request.auth.id != "" && (owner = @request.auth.id || participants.id ?= @request.auth.id || (calendar != "" && (calendar.visibility != "members" || calendar.members.id ?= @request.auth.id || calendar.created_by = @request.auth.id || @request.auth.role = "admin")))';
  events.listRule = rule;
  events.viewRule = rule;
  app.save(events);
});
