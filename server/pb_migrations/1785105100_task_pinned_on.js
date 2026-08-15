/// <reference path="../pb_data/types.d.ts" />
// „Připnout na dnešek" — náhrada priority úkolu (rozhodnutí Richarda 27. 7. 2026).
//
// Proč NE klasické pole priorita (vysoká/střední/nízká): tříhodnotové pole je
// rozhodnutí, které produkt vyžaduje po uživateli PŘI ZAKLÁDÁNÍ, a nikdo ho
// neudržuje aktuální — přesně ten typ přírůstku, který zakazuje anti-bloat
// pravidlo v product/CONTRIBUTING.md. Připnutí je naopak jedno kliknutí přímo
// z řádku a nese jen jedinou otázku, která má v denním provozu smysl:
// „chci to řešit dnes?".
//
// Formát YYYY-MM-DD (text, jako `deadline` a `node.data.deadline`) — NE bool.
// Díky datu připnutí SAMO VYPRŠÍ změnou dne: čte se jen tehdy, když se rovná
// dnešku, takže po půlnoci se seznam nevleče včerejškem a není potřeba žádný
// úklidový cron. Uzly map mají dvojče v node.data.pinnedOn (JSON blob mapy) —
// viz helpers.js:canonicalNodeData a frontend/src/lib/cleanMap.js.
//
// Žádná RLS pravidla se nemění: pole se zapisuje běžným update úkolu, který už
// dnes smí vlastník, přiřazený a edit-share (viz 1751900006_tasks.js).
// Razítko = aktuální čas (automigrate=0; starší by PocketBase přeskočil).
migrate((app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.fields.add(new TextField({ name: "pinned_on" })); // YYYY-MM-DD nebo ""
  app.save(tasks);
}, (app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.fields.removeByName("pinned_on");
  app.save(tasks);
});
