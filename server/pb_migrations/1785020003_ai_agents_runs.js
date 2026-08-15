/// <reference path="../pb_data/types.d.ts" />
// Registr AI agentů (ai_agents) + jejich běhy (agent_runs).
//
// ai_agents = adresář automatizací, které umí vykonat krok procesu (n8n workflow,
// AI agent…). Spravuje ho SPRÁVCE AI AGENTŮ (users.is_ai_manager) nebo admin.
// V uzlu mapy se agent vybírá JMÉNEM (node.data.executorName), takže běžný člen
// nikdy nevidí `webhook_url` ani `secret` — kolekce je proto ZAMČENÁ (všechna
// pravidla null) a čte/píše se výhradně serverovými routami /api/flowmap/ai-agents*.
// Stejný vzor jako ai_settings (migrace 1751900015).
//
// agent_runs = jeden běh automatizace nad konkrétním uzlem. `token_hash` je sha256
// jednorázového tokenu, který FlowMap pošle v payloadu webhooku; agent ho vrátí
// na /api/flowmap/agent-callback. Token platí pro JEDEN uzel a JEDNO ohlášení
// (stav pending/running), takže uniklý token nikam jinam nepustí — vzor api_keys.
// Čtení běhů má vlastník mapy a lidé, se kterými je mapa sdílená; zapisuje jen server.
// Razítko = aktuální čas.
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  const mapsId = app.findCollectionByNameOrId("goalmaps").id;

  const agents = new Collection({
    type: "base",
    name: "ai_agents",
    fields: [
      { name: "name", type: "text", required: true, max: 100 },
      { name: "description", type: "text", max: 500 },
      { name: "webhook_url", type: "url", required: true },
      { name: "secret", type: "text", max: 200 }, // klíč pro HMAC podpis odchozího požadavku
      { name: "enabled", type: "bool" },
      { name: "owner", type: "relation", collectionId: usersId, maxSelect: 1 },
      { name: "owner_email", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      // jméno je to, čím se agent v uzlu odkazuje → musí být jednoznačné
      "CREATE UNIQUE INDEX idx_ai_agents_name ON ai_agents (name)",
    ],
    // ZAMČENO: i pouhé čtení kolekce by vydalo webhook_url + secret každému členovi.
    // Bezpečnou podmnožinu (id/name/description/enabled) vrací routa /ai-agents.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(agents);

  const runs = new Collection({
    type: "base",
    name: "agent_runs",
    fields: [
      { name: "agent", type: "relation", collectionId: agents.id, maxSelect: 1 },
      { name: "agent_name", type: "text", max: 100 }, // snapshot: běh přežije smazání agenta
      { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "node_id", type: "text", required: true },
      { name: "node_title", type: "text", max: 200 },
      { name: "status", type: "select", values: ["pending", "running", "done", "failed"], maxSelect: 1, required: true },
      { name: "request", type: "text", max: 4000 },
      { name: "result", type: "text", max: 4000 },
      { name: "token_hash", type: "text" },
      { name: "started", type: "date" },
      { name: "finished", type: "date" },
      { name: "triggered_by", type: "text", max: 200 }, // e-mail/„system" — kdo běh vyvolal
      { name: "attempt", type: "number", onlyInt: true, min: 0 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_agent_runs_token ON agent_runs (token_hash) WHERE token_hash != ''",
      "CREATE INDEX idx_agent_runs_node ON agent_runs (map, node_id, status)",
    ],
    // číst smí vlastník mapy a ti, s kým je sdílená; zápis výhradně server
    listRule: 'map.owner = @request.auth.id || map.shared_with ~ @request.auth.email',
    viewRule: 'map.owner = @request.auth.id || map.shared_with ~ @request.auth.email',
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(runs);
}, (app) => {
  for (const name of ["agent_runs", "ai_agents"]) {
    try {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    } catch (err) { /* kolekce nemusí existovat */ }
  }
});
