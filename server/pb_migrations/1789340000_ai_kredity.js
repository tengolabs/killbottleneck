/// <reference path="../pb_data/types.d.ts" />
// AI kredity organizace (Richard 14. 9. 2026): týdenní kvóta kreditů a podíl,
// který z ní připadá správcům (zbytek sdílí ostatní členové). Jedno JSON pole
// {kvota_tyden, podil_admin} — chybějící = výchozí (bez stropu, 30 %); číselná
// pole by neodlišila „0 %“ od „nenastaveno“. Spotřeba = ai_chat_log, viz kredity.js.
migrate((app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  c.fields.add(new JSONField({ name: "ai_kredity", maxSize: 512 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  c.fields.removeByName("ai_kredity");
  app.save(c);
});
