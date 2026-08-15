/// <reference path="../pb_data/types.d.ts" />
// BEZPEČNOSTNÍ OPRAVA: pravidla `node_files` a `agent_runs` používala
// `map.shared_with ~ @request.auth.email`. V PocketBase je `~` PODŘETĚZEC, ne
// shoda prvku — mapa sdílená s `bob@firma.cz` byla tím pádem přístupná komukoli,
// kdo si zaregistruje `b@firma.cz`: četl přílohy, stahoval jejich obsah, četl cizí
// běhy, a hlavně mohl přílohu do cizí mapy NAHRÁT a tím spustit automatizaci na
// cizím uzlu.
//
// Přesně před tímhle varuje migrace 1751900001_map_shares.js („`~` je substring,
// tj. bezpečnostní riziko") a kvůli tomu existuje normalizovaná kolekce map_shares.
// JSON pole shared_with je jen zrcadlo pro frontend, NIKDY autorizace.
//
// Správný vzor (shodný s `tasks` po migracích 013 a 008):
//   čtení: map.map_shares_via_map.email ?= @request.auth.email
//   zápis: map.map_shares_via_map.email_edit ?= @request.auth.email
//          (email_edit drží e-mail jen u permission="edit" — e-mail i oprávnění
//           MUSÍ být na TÉMŽE řádku, dvě nezávislé `?=` by se cross-párovaly)
// + guard `@request.auth.id != ""` na začátku: `?=` nad PRÁZDNOU back-relací
//   matchuje prázdný e-mail nepřihlášeného hosta (guest leak, migrace 1784364752).
// + team_access: členové organizace se sdílenou mapou přílohy dosud NEVIDĚLI vůbec.
//
// Nahrání přílohy spouští automatizaci, proto create vyžaduje EDIT práva, ne jen čtení.
// Razítko = aktuální čas.
migrate((app) => {
  const READ = '@request.auth.id != "" && ('
    + 'map.owner = @request.auth.id'
    + ' || map.map_shares_via_map.email ?= @request.auth.email'
    + ' || map.team_access != ""'
    + ')';
  const EDIT = '@request.auth.id != "" && ('
    + 'map.owner = @request.auth.id'
    + ' || map.map_shares_via_map.email_edit ?= @request.auth.email'
    + ' || map.team_access = "edit"'
    + ')';

  const files = app.findCollectionByNameOrId("node_files");
  files.listRule = READ;
  files.viewRule = READ;
  files.createRule = EDIT;
  // mazat smí autor přílohy nebo vlastník mapy (beze změny významu, jen s guardem)
  files.deleteRule = '@request.auth.id != "" && (owner = @request.auth.id || map.owner = @request.auth.id)';
  app.save(files);

  const runs = app.findCollectionByNameOrId("agent_runs");
  runs.listRule = READ;
  runs.viewRule = READ;
  app.save(runs);
}, (app) => {
  const OLD_READ = 'map.owner = @request.auth.id || map.shared_with ~ @request.auth.email';
  const files = app.findCollectionByNameOrId("node_files");
  files.listRule = OLD_READ;
  files.viewRule = OLD_READ;
  files.createRule = '@request.auth.id != "" && (' + OLD_READ + ')';
  files.deleteRule = 'owner = @request.auth.id || map.owner = @request.auth.id';
  app.save(files);

  const runs = app.findCollectionByNameOrId("agent_runs");
  runs.listRule = OLD_READ;
  runs.viewRule = OLD_READ;
  app.save(runs);
});
