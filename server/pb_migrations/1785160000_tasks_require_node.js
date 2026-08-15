/// <reference path="../pb_data/types.d.ts" />
// ⚠️ HISTORICKÁ MIGRACE — chování „úkol bez uzlu dostane vrchol" bylo 13. 8. 2026
// ZRUŠENO jako chybné (migrace 1786640000: vrchol úkoly nepřijímá, doplňování
// vrcholu nahradilo odmítnutí assertTaskNode). Text níže platil v době vzniku.
// PROJEKT → UZEL → ÚKOL, a nic nesmí stát samo (Richard, potvrzeno 27. 7. 2026).
//
// Ve v0.7 (migrace 1784910604) padly volné úkoly BEZ PROJEKTU. Zbyla ale
// skulina o patro níž: úkol mohl být v projektu a přitom bez uzlu — dialog
// nabízel volbu „celá mapa" a v1 API `node_id` nevyžadovalo. Takový úkol se
// v mapě nevykreslí a nedá se z ní k němu dostat.
//
// Vrchol projektu JE projekt, takže pověšení na něj nic nemění významově —
// jen zavírá stav, ve kterém úkol nikam nepatří.
//
// Tahle migrace:
//   1) dopočítá uzel existujícím úkolům bez něj (vrchol jejich projektu),
//   2) zpřísní databázové pravidlo, aby úkol bez uzlu nešlo vůbec založit.
// Vynucení v aplikaci dělá helpers.js:ensureTaskNode (doplní vrchol), takže
// běžný klient ani API tuhle chybu nedostane — pravidlo je poslední pojistka.
migrate((app) => {
  // --- 1) doplnit uzel existujícím úkolům ---
  const apexOf = (map) => {
    const nodes = JSON.parse(map.get("nodes") || "[]");
    const edges = JSON.parse(map.get("edges") || "[]");
    const targets = {};
    for (const ed of edges) targets[ed.target] = true;
    const roots = nodes.filter((n) => n && n.type !== "note" && !targets[n.id]);
    const apex = roots.find((n) => n.type === "apexNode") || roots[0] || nodes.find((n) => n && n.type !== "note");
    return apex ? apex.id : "";
  };
  const apexCache = {};
  let rows = [];
  try {
    rows = app.findRecordsByFilter("tasks", 'node_id = "" && map != ""', "", 5000, 0);
  } catch (err) { rows = []; }
  for (const t of rows) {
    const mapId = t.getString("map");
    if (apexCache[mapId] === undefined) {
      try { apexCache[mapId] = apexOf(app.findRecordById("goalmaps", mapId)); } catch (err) { apexCache[mapId] = ""; }
    }
    // projekt bez jediného uzlu (nemělo by nastat) — úkol necháme být,
    // ať migrace kvůli jednomu poškozenému projektu nespadne
    if (!apexCache[mapId]) continue;
    t.set("node_id", apexCache[mapId]);
    app.save(t);
  }

  // --- 2) databázové pravidlo se ZÁMĚRNĚ NEZPŘÍSŇUJE ---
  // Zkusil jsem do `createRule` přidat `node_id != ""`. Nefunguje to: pravidlo
  // se vyhodnocuje proti ODESLANÝM datům, tedy DŘÍV, než serverový hook uzel
  // doplní — takže by odmítlo i požadavky, které server sám umí srovnat
  // (ověřeno, celá sada api-rls spadla na 404).
  // Vynucení proto drží aplikační vrstva, která to umí OPRAVIT místo odmítnutí:
  //   • helpers.js:ensureTaskNode volaný z create i update hooku (pokryje UI
  //     i každé přímé volání kolekce přes REST),
  //   • v1 API si vrchol doplňuje samo (request hooky se u $app.save nespouští).
  // U projektu to jde přes pravidlo proto, že tam je `map` součástí payloadu.
}, (app) => {
  // zpět není co vracet — pravidlo se neměnilo, doplněné uzly se nechávají
  // (jejich odebrání by data jen rozbilo)
});
