/// <reference path="../pb_data/types.d.ts" />
// ÚKOL MUSÍ BÝT V UZLU; NA VRCHOL LZE VĚŠET POUZE UZLY (Richard 13. 8. 2026).
//
// Vrchol se plní splněním svých uzlů — úkoly na něm nemají co dělat. Dřívější
// mezistav („úkol bez uzlu dostane vrchol", migrace 1785160000) se tímto ruší
// jako chybný, a to ZPĚTNĚ: žádné výjimky pro stará data.
//
// Každý úkol visící na vrcholu nebo bez uzlu se přesune do uzlu „Nezařazené
// úkoly" (titulek dle jazyka vlastníka mapy) pod vrcholem jeho mapy. Nic se
// nemaže, vše zůstává vidět v mapě; uživatel si úkoly rozebere na správné cíle.
// Stav kontejneru se ODVOZUJE z přesouvaných úkolů: všechny hotové → done
// (progress hotového projektu neklesne), jinak todo (nedodělaná práce se
// poctivě ukáže). Mapy bez jediného uzlu se přeskakují (kontejner by se sám
// stal vrcholem) — úkoly v nich zůstávají zamčené, žádné výjimky (Richard).
//
// Odolnost (nálezy panelu 13. 8.): poškozený JSON jedné mapy migraci neshodí
// (box musí nastartovat); pevná id se před použitím kontrolují na kolizi
// s klientskými id — cizí uzel se nerecykluje, id se dopočítá unikátní.
migrate((app) => {
  const apexOf = (nodes, edges) => {
    const targets = {};
    for (const ed of edges) targets[ed.target] = true;
    const roots = nodes.filter((n) => n && n.type !== "note" && !targets[n.id]);
    const apex = roots.find((n) => n.type === "apexNode") || roots[0] || nodes.find((n) => n && n.type !== "note");
    return apex || null;
  };
  const jazykVlastnika = (map) => {
    try {
      const u = app.findRecordById("users", map.getString("owner"));
      return (u.getString("language") || "").toLowerCase() === "en" ? "en" : "cs";
    } catch (err) { return "cs"; }
  };
  const TITULKY = { cs: "Nezařazené úkoly", en: "Unsorted tasks" };

  let rows = [];
  try {
    rows = app.findRecordsByFilter("tasks", 'map != ""', "", 100000, 0);
  } catch (err) { rows = []; }
  const dleMapy = {};
  for (const t of rows) {
    const mapId = t.getString("map");
    (dleMapy[mapId] = dleMapy[mapId] || []).push(t);
  }

  let presunuto = 0;
  let preskocenoMap = 0;
  for (const mapId of Object.keys(dleMapy)) {
    try {
      const map = app.findRecordById("goalmaps", mapId);
      const nodes = JSON.parse(map.get("nodes") || "[]");
      const edges = JSON.parse(map.get("edges") || "[]");
      const apex = apexOf(nodes, edges);
      // mapa bez jediného uzlu je poškozená jinak — kontejner by se sám stal
      // kořenem (= vrcholem); úkoly zůstávají zamčené, žádné výjimky
      if (!apex) continue;
      const hrisnici = dleMapy[mapId].filter((t) => {
        const nid = t.getString("node_id");
        return !nid || nid === apex.id;
      });
      if (hrisnici.length === 0) continue;

      // unikátní id: cizí uzel s tímhle id se NErecykluje (mohl by to být
      // i vrchol) — kolize posune sufix, dokud není volno (u uzlů i hran)
      const idUzlu = (n) => nodes.some((x) => x && x.id === n);
      const idHrany = (n) => edges.some((x) => x && x.id === n);
      let kontejnerId = "nezarazene-ukoly";
      let sufix = 1;
      while (idUzlu(kontejnerId) || idHrany("e-" + kontejnerId)) {
        sufix += 1;
        kontejnerId = "nezarazene-ukoly-" + sufix;
      }
      const vseHotovo = hrisnici.every((t) => t.getString("status") === "done");
      const pos = (apex.position && typeof apex.position.x === "number")
        ? { x: apex.position.x, y: (apex.position.y || 0) + 360 }
        : { x: 0, y: 360 };
      nodes.push({ id: kontejnerId, type: "goalNode", position: pos,
        data: { title: TITULKY[jazykVlastnika(map)], status: vseHotovo ? "done" : "todo" } });
      edges.push({ id: "e-" + kontejnerId, source: apex.id, target: kontejnerId, type: "deletable" });
      map.set("nodes", JSON.stringify(nodes));
      map.set("edges", JSON.stringify(edges));
      app.save(map);
      for (const t of hrisnici) {
        t.set("node_id", kontejnerId);
        app.save(t);
        presunuto++;
      }
    } catch (err) {
      // poškozená mapa nesmí shodit start boxu — přeskočit a přiznat v logu
      preskocenoMap++;
      try { app.logger().warn("migrace ukoly-jen-na-uzlech: mapa přeskočena", "map", mapId, "error", String(err)); } catch (e2) { /* log je bonus */ }
    }
  }
  if (presunuto > 0 || preskocenoMap > 0) {
    try { app.logger().info("migrace ukoly-jen-na-uzlech", "presunuto", presunuto, "preskoceno_map", preskocenoMap); } catch (err) { /* log je bonus */ }
  }
}, (app) => {
  // zpět není kam — úkoly zůstávají na uzlu „Nezařazené úkoly"; jejich vracení
  // na vrchol by znovu vyrobilo stav, kvůli kterému migrace vznikla
});
