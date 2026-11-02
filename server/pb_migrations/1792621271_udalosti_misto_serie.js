/// <reference path="../pb_data/types.d.ts" />
// Z pozvánky do kalendáře (Richard 22. 10. 2026): událost dostane MÍSTO konání („místnost 214“,
// „hřiště Strahov“) a skryté ID SÉRIE — události založené najednou z jedné pozvánky (rozpis
// přednášek, tréninky „každé úterý“) nesou stejné `series`, ať jdou smazat celé a později převést
// na opakování. Místnost k REZERVACI zůstává sdíleným kalendářem typu resource (pole calendar).
migrate((app) => {
  const events = app.findCollectionByNameOrId("events");
  events.fields.add(new TextField({ name: "place", max: 200 }));
  events.fields.add(new TextField({ name: "series", max: 40 }));
  events.indexes = (events.indexes || []).concat(["CREATE INDEX idx_events_series ON events (series)"]);
  app.save(events);
}, (app) => {
  const events = app.findCollectionByNameOrId("events");
  events.indexes = (events.indexes || []).filter((i) => i.indexOf("idx_events_series") < 0);
  events.fields.removeByName("place");
  events.fields.removeByName("series");
  app.save(events);
});
