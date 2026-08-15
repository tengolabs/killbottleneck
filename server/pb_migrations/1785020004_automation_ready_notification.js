/// <reference path="../pb_data/types.d.ts" />
// Uzavření smyčky požadavku na automatizaci: uživatel u uzlu zaškrtne „tady by se
// hodila automatizace" → správce AI agentů dostane `ai_request` → až ji postaví
// a zapíše k uzlu, žadatel dostane `automation_ready`. Bez toho se člověk nikdy
// nedozví, že se jeho přání splnilo, a odznak čekajícího požadavku by visel dál.
// Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  if (f.values.indexOf("automation_ready") < 0) f.values = f.values.concat(["automation_ready"]);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const f = col.fields.getByName("type");
  f.values = f.values.filter((v) => v !== "automation_ready");
  app.save(col);
});
