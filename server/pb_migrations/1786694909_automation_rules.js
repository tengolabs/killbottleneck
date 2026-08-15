/// <reference path="../pb_data/types.d.ts" />
// Interní automatizační motor „když X → udělej Y" (styl Asana Rules) — datový základ.
//
// automation_rules = pravidlo mapy: trigger (kdy) + conditions (AND řetěz) + actions
// (co udělat, popořadě). Pravidla spravuje EDITOR MAPY (vlastník / shared_with_edit /
// team_access=edit) — rozhodnutí Richarda 14. 8. 2026. Kolekce je ZAMČENÁ (všechna
// pravidla null) jako ai_agents (1785020003): configy akcí nesou e-maily a jména
// agentů a čtou/píší se výhradně serverovými routami /api/kb/rules* + v1 API + MCP.
//
// Návrhová rozhodnutí (STRATEGIE.md 14. 8. 2026 — poučení z Asany/ClickUp/Monday):
//   • ŽÁDNÝ měsíční metr na běhy — limity jen strukturální (50 pravidel/mapa,
//     vynucuje routa save). Metry zavedla celá trojice konkurentů a Asana je
//     musela pod tlakem uživatelů rušit.
//   • Edity pravidel platí JEN DO BUDOUCNA — motor čte pravidlo v okamžiku
//     vyhodnocení a nikdy neskenuje historii; retroaktivita je vyloučená konstrukcí.
//   • trigger = {type, …config} — výčet typů drží server (RULE_TRIGGERS v helpers),
//     NE databáze; v2 strukturální triggery („celá větev hotová/stojí") přibudou
//     bez migrace, scope pro ně už nese node_id.
//   • error_notified: rozbité pravidlo pošle vlastníkovi mail JEDNOU, ne spam;
//     flag resetuje editace pravidla a první úspěšný běh.
//
// rule_runs = log běhů (jeden řádek = jedno vyhodnocení pravidla, které něco
// udělalo nebo bylo přeskočeno pojistkou). VLASTNÍ kolekce, NE rozšíření agent_runs:
// agent_runs nese webhook lifecycle (token_hash, pending/running, watchdog) a běh
// pravidla je synchronní — jiný stavový model i retence (prune_rule_runs, 60 dní).
// Akce run_agent naopak agent_runs záznam ZALOŽÍ a rule_runs.agent_run drží stopu.
// dedup_key (partial UNIQUE) = tvrdá závora idempotence časových/termínových
// triggerů — vzor notifications.dedup_key (uzly nemají kam razítko zapsat).
//
// RLS rule_runs: čte, kdo vidí mapu — vzor map_changes (1785138000): `?=` nad
// normalizovanou map_shares, NIKDY `~` nad JSON zrcadlem shared_with (podřetězec
// = díra). Log neobsahuje tajemství. Zápis výhradně server. Razítko = aktuální čas.
migrate((app) => {
  const mapsId = app.findCollectionByNameOrId("goalmaps").id;

  const rules = new Collection({
    type: "base",
    name: "automation_rules",
    fields: [
      { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "name", type: "text", required: true, max: 120 },
      { name: "enabled", type: "bool" },
      // "" = pravidlo celé mapy; jinak scope na uzel (předvyplní okno uzlu,
      // v2 strukturální triggery se váží právě sem)
      { name: "node_id", type: "text" },
      { name: "trigger", type: "json", maxSize: 4000, required: true },
      { name: "conditions", type: "json", maxSize: 8000 },
      { name: "actions", type: "json", maxSize: 100000, required: true }, // create_subnodes nese TREE_ITEM šablonku
      { name: "created_by", type: "email" }, // kdo pravidlo založil / naposledy editoval
      { name: "last_fired", type: "date" },  // serverové razítko — levná zkratka časových triggerů
      { name: "last_error", type: "text", max: 1000 },
      { name: "error_notified", type: "bool" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      // motor se ptá „pravidla téhle mapy" při každém uložení mapy → index přesně na to
      "CREATE INDEX idx_automation_rules_map ON automation_rules (map)",
    ],
    // ZAMČENO: configy akcí nesou e-maily/jména agentů; UI pravidel je jen pro
    // editory mapy a tvar drží routy — stejný vzor jako ai_agents.
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(rules);

  const READ = '@request.auth.id != "" && ('
    + 'map.owner = @request.auth.id'
    + ' || map.map_shares_via_map.email ?= @request.auth.email'
    + ' || map.team_access != ""'
    + ')';

  const agentRunsId = app.findCollectionByNameOrId("agent_runs").id;

  const runs = new Collection({
    type: "base",
    name: "rule_runs",
    fields: [
      // NErequired + snapshot jména: log běhu přežije smazání pravidla (vzor
      // agent_runs) — cascadeDelete BY audit log smazal, proto FALSE
      { name: "rule", type: "relation", collectionId: rules.id, maxSelect: 1, cascadeDelete: false },
      { name: "rule_name", type: "text", max: 120 },
      { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "node_id", type: "text" }, // "" u mapových/časových triggerů
      { name: "node_title", type: "text", max: 200 },
      { name: "trigger_type", type: "text", max: 40 },
      // ok = akce proběhly · failed = akce spadla (→ last_error + rule_broken mail)
      // · skipped = pojistka (smyčka/limit/vypnuto) — přiznaný, ne tichý stav
      { name: "status", type: "select", values: ["ok", "failed", "skipped"], maxSelect: 1, required: true },
      { name: "detail", type: "text", max: 2000 },
      { name: "actions_done", type: "json", maxSize: 8000 },
      { name: "agent_run", type: "relation", collectionId: agentRunsId, maxSelect: 1 },
      { name: "depth", type: "number", onlyInt: true, min: 0 }, // hloubka řetězu — diagnostika smyček
      { name: "actor", type: "text", max: 200 }, // e-mail / "rule:<id>" / "schedule"
      { name: "dedup_key", type: "text", max: 200 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: [
      "CREATE INDEX idx_rule_runs_map_created ON rule_runs (map, created)",
      "CREATE INDEX idx_rule_runs_rule_created ON rule_runs (rule, created)",
      // idempotence cronových triggerů: druhé vyhodnocení téhož dne narazí na UNIQUE
      "CREATE UNIQUE INDEX idx_rule_runs_dedup ON rule_runs (dedup_key) WHERE dedup_key != ''",
    ],
    listRule: READ,
    viewRule: READ,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(runs);
}, (app) => {
  for (const name of ["rule_runs", "automation_rules"]) {
    try {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    } catch (err) { /* kolekce nemusí existovat */ }
  }
});
