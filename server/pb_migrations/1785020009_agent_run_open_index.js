/// <reference path="../pb_data/types.d.ts" />
// Tvrdá závora proti dvojímu spuštění téže automatizace. Guard v queueAgentRun je
// jen DOTAZ („neběží už něco na tomhle uzlu?"), takže dva souběžné zápisy mapy
// mohly obě projít kontrolou a spustit n8n workflow dvakrát.
// Partial UNIQUE index to řeší na úrovni DB — druhý zápis prostě neprojde a
// queueAgentRun ho odchytí (vrátí null, běh se nezaloží).
// Vzor: idx_time_entries_running (jeden běžící timer na uživatele).
// Razítko = aktuální čas.
migrate((app) => {
  const col = app.findCollectionByNameOrId("agent_runs");
  col.indexes = col.indexes.concat([
    "CREATE UNIQUE INDEX idx_agent_runs_open ON agent_runs (map, node_id) WHERE status = 'pending' OR status = 'running'",
  ]);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("agent_runs");
  col.indexes = col.indexes.filter((i) => i.indexOf("idx_agent_runs_open") < 0);
  app.save(col);
});
