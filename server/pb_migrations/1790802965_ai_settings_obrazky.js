/// <reference path="../pb_data/types.d.ts" />
// Obrázky v asistentovi z Administrace (30. 9. 2026). Dosud jen přes KB_VISION_* v prostředí, takže
// self-host s klíčem OpenAI zadaným v Administraci obrázky neměl, i když jeho model obrázky umí.
// vision_ok = poslední „Otestovat obrázek“ (vestavěný obrázek se známým textem) prošel — bez toho se
// obrázky nezapnou: model, který obrázek nevidí, by si přepis vymyslel.
migrate((app) => {
  const c = app.findCollectionByNameOrId("ai_settings");
  c.fields.add(new Field({ name: "vision_enabled", type: "bool" }));
  c.fields.add(new Field({ name: "vision_model", type: "text" }));
  c.fields.add(new Field({ name: "vision_ok", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ai_settings");
  for (const f of ["vision_enabled", "vision_model", "vision_ok"]) c.fields.removeByName(f);
  app.save(c);
});
