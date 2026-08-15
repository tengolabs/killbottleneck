/// <reference path="../pb_data/types.d.ts" />
// Šablony automatizačních pravidel (Richard 14. 8. 2026, upřesnění při klik-testu):
// „nechci nasazovat pravidlo do více map, chci mít pravidlo jako šablonu a tu si
// načíst v dané mapě." Šablona = uložený tvar pravidla (trigger + podmínky + akce)
// BEZ vazby na mapu a BEZ scope uzlu; načtením do mapy vzniká OBYČEJNÉ lokální
// pravidlo (kopie) — úprava šablony už existující kopie nemění (žádný bundle).
//
// Zamčená kolekce (vzor ai_agents/automation_rules): čtou a píší ji výhradně
// routy /api/kb/rule-templates* + v1 + MCP. Číst smí každý přihlášený (šablony
// jsou sdílená knihovna instance), mazat/přepisovat jen autor nebo admin —
// vynucují routy. Razítko = aktuální čas.
migrate((app) => {
  const col = new Collection({
    type: "base",
    name: "rule_templates",
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "trigger", type: "json", maxSize: 4000, required: true },
      { name: "conditions", type: "json", maxSize: 8000 },
      { name: "actions", type: "json", maxSize: 100000, required: true },
      { name: "created_by", type: "email" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      // knihovna se vypisuje podle názvu; duplicitní názvy matou při načítání
      "CREATE UNIQUE INDEX idx_rule_templates_name ON rule_templates (name)",
    ],
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(col);
}, (app) => {
  let c = null;
  try { c = app.findCollectionByNameOrId("rule_templates"); } catch (_) { /* není */ }
  if (c) app.delete(c);
});
