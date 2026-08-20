/// <reference path="../pb_data/types.d.ts" />
// Model přepisu řeči do administrace. Do teď šel nastavit JEN přes env
// KB_AI_TRANSCRIBE_MODEL, takže admin, který si AI nastavil v aplikaci, ho
// neměl kde změnit — a „whisper-1" není univerzální jméno (Groq má
// „whisper-large-v3"). Nález panelu kontrolních agentů 20. 8. 2026.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_settings");
  c.fields.add(new Field({ name: "transcribe_model", type: "text" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_settings");
  c.fields.removeByName("transcribe_model");
  app.save(c);
});
