/// <reference path="../pb_data/types.d.ts" />
// TÝMOVÝ KALENDÁŘ (Richard 14. 10. 2026): sdílené kalendáře, které NEJSOU osoba —
// firemní kalendář (společné akce), zasedací místnost (zdroj, nesmí se překrývat),
// nepřítomnosti (dovolené; kdo je kdy pryč). Prodejní linka „za lidi se neplatí
// nikde“: týmový kalendář v ceně, žádná sedadla.
//
// `calendars` = kalendář jako entita. kind: shared | resource | absence.
//   write_access: all = každý člen zapisuje, admins = jen správce/manažer.
//   needs_approval: jen u absence — nová nepřítomnost čeká na schválení
//   (VÝCHOZÍ VYPNUTO: „nechceme přidělávat práci, ale kdo chce, může“).
//   Archivace drží historii; smazání (Richard 15. 10.) bere i všechny události (routa /calendars/delete).
//   Zakládá/mění jen admin a manager, VÝHRADNĚ routami (CRUD zamčený).
//
// `events` dostává: calendar (prázdné = osobní položka jako dosud), end_day +
// end_time (konec: dovolená 20.–24., obsazenost místnosti 10–11), status +
// decided_by + decision_note (jen absence se schvalováním).
//
// RLS čtení: událost ve SDÍLENÉM kalendáři vidí každý přihlášený člen instance
// (precedens: map.team_access != "" v 1751900008_org_share.js) — realtime v
// kalendáři tak doručuje i firemní akce. Osobní události zůstávají osobní.
// Zápis dál jen routami (events-api.js: práva, kolize, schvalování).
//
// Razítko = čas vzniku (automigrate=0).
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;

  const calendars = new Collection({
    type: "base",
    name: "calendars",
    fields: [
      { name: "name", type: "text", required: true, max: 80 },
      { name: "kind", type: "select", values: ["shared", "resource", "absence"], maxSelect: 1, required: true },
      { name: "color", type: "text", pattern: "^(#[0-9a-fA-F]{6})?$" },
      { name: "description", type: "text", max: 500 },
      { name: "write_access", type: "select", values: ["all", "admins"], maxSelect: 1 },
      { name: "needs_approval", type: "bool" },
      { name: "archived", type: "bool" },
      { name: "created_by", type: "relation", collectionId: usersId, maxSelect: 1, cascadeDelete: false },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      // jméno jednoznačné bez ohledu na velikost písmen („Firemní“ = „firemní“)
      "CREATE UNIQUE INDEX idx_calendars_name ON calendars (name COLLATE NOCASE)",
    ],
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: null, // jen server (routy /api/kb/calendars*)
    updateRule: null,
    deleteRule: null,
  });
  app.save(calendars);
  const calendarsId = app.findCollectionByNameOrId("calendars").id;

  const events = app.findCollectionByNameOrId("events");
  events.fields.add(new RelationField({ name: "calendar", collectionId: calendarsId, maxSelect: 1, cascadeDelete: false }));
  events.fields.add(new TextField({ name: "end_day", pattern: "^(\\d{4}-\\d{2}-\\d{2})?$" }));
  events.fields.add(new TextField({ name: "end_time", pattern: "^((?:[01]\\d|2[0-3]):[0-5]\\d)?$" }));
  // "" = bez schvalování (výchozí); requested/approved/rejected jen u absence s needs_approval
  events.fields.add(new SelectField({ name: "status", values: ["requested", "approved", "rejected"], maxSelect: 1 }));
  events.fields.add(new RelationField({ name: "decided_by", collectionId: usersId, maxSelect: 1, cascadeDelete: false }));
  events.fields.add(new TextField({ name: "decision_note", max: 500 }));
  events.indexes = (events.indexes || []).concat(["CREATE INDEX idx_events_calendar_day ON events (calendar, day)"]);
  const rule = 'owner = @request.auth.id || participants.id ?= @request.auth.id || calendar != ""';
  events.listRule = rule;
  events.viewRule = rule;
  app.save(events);

  // notifikace: žádost o nepřítomnost (správcům a manažerům) + rozhodnutí (žadateli)
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  for (const v of ["absence_requested", "absence_decided"]) {
    if (f.values.indexOf(v) < 0) f.values = f.values.concat([v]);
  }
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  f.values = f.values.filter((v) => v !== "absence_requested" && v !== "absence_decided");
  app.save(col);
  const events = app.findCollectionByNameOrId("events");
  for (const n of ["calendar", "end_day", "end_time", "status", "decided_by", "decision_note"]) {
    try { events.fields.removeByName(n); } catch (err) { /* už není */ }
  }
  events.indexes = (events.indexes || []).filter((i) => String(i).indexOf("idx_events_calendar_day") < 0);
  const rule = "owner = @request.auth.id || participants.id ?= @request.auth.id";
  events.listRule = rule;
  events.viewRule = rule;
  app.save(events);
  try { app.delete(app.findCollectionByNameOrId("calendars")); } catch (err) { /* už není */ }
});
