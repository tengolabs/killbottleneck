/// <reference path="../pb_data/types.d.ts" />
// Typ mapy: prázdné = běžná mapa, "org" = ORGANIZAČNÍ STRUKTURA (uzly = pozice
// a funkce, drží je členové, mají zástupce — pole positionKind/holder/deputy
// v node.data). Jedna na instanci; zakládá ji výhradně routa POST /api/kb/org-map
// (admin, idempotentní). SERVER-SPRAVOVANÉ POLE: create/update hooky i v1 API
// hodnotu z klientského requestu zahazují — „obyčejná mapa se prohlásí za org"
// nesmí jít žádnou cestou. RLS se nemění: org mapa se sdílí standardně
// (team_access='read' nastaví zakládací routa).
migrate((app) => {
  const maps = app.findCollectionByNameOrId("goalmaps");
  maps.fields.add(new SelectField({ name: "kind", values: ["org"], maxSelect: 1 }));
  app.save(maps);
}, (app) => {
  const maps = app.findCollectionByNameOrId("goalmaps");
  maps.fields.removeByName("kind");
  app.save(maps);
});
