/// <reference path="../pb_data/types.d.ts" />
// Měření tokenů asistenta (4. 10. 2026): které skupiny nástrojů se v tahu otevřely (podklad pro zúžení
// klíčových slov — každá otevřená skupina = tisíce tokenů schémat v KAŽDÉM volání) a jak dlouho trval
// přepis hlasovky Whisperem (podklad pro cenu hlasovky; audio_ms je jen délka nahrávky).
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.add(new Field({ name: "skupiny", type: "text", max: 300 }));
  c.fields.add(new Field({ name: "prepis_ms", type: "number", onlyInt: true, min: 0 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_chat_log");
  c.fields.removeByName("skupiny");
  c.fields.removeByName("prepis_ms");
  app.save(c);
});
