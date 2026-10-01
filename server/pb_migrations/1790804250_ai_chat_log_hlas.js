/// <reference path="../pb_data/types.d.ts" />
// Délka hlasovky v logu spotřeby asistenta (1. 10. 2026): podklad pro případnou cenu za minutu přepisu.
// Tahy se zatím strhávají jen za odpověď asistenta — cenu za minutu rozhodne Richard po měření.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.add(new Field({ name: "audio_ms", type: "number", onlyInt: true, min: 0 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.removeByName("audio_ms");
  app.save(c);
});
