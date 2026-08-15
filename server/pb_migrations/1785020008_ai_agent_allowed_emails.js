/// <reference path="../pb_data/types.d.ts" />
// Kdo smí kterou automatizaci spustit. Dosud stačilo mít právo editace JAKÉKOLI
// mapy a napsat do uzlu jméno agenta ze seznamu — tím šlo spustit cizí n8n
// workflow a poslat do něj vlastní text (název a popis uzlu jdou do payloadu).
// Uvnitř jedné firmy to většinou nevadí, u instance se sdílením externistům je
// to cesta do n8n.
//
// `allowed_emails` = JSON pole e-mailů. PRÁZDNÉ = smí kdokoli z instance (dosavadní
// chování, ať upgrade nic nerozbije). Neprázdné = jen ti uvedení.
// Kontrolu dělá server v queueAgentRun; pole je součástí zamčené kolekce ai_agents,
// takže ho spravuje výhradně správce AI agentů přes /api/flowmap/ai-agents/save.
// Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("ai_agents");
  col.fields.add(new JSONField({ name: "allowed_emails", maxSize: 20000 }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("ai_agents");
  col.fields.removeByName("allowed_emails");
  app.save(col);
});
