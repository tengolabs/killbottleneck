/// <reference path="../pb_data/types.d.ts" />
// C2: opakující se úkoly — pole recurrence na tasks (prázdné = neopakuje se).
// Při dokončení opakujícího se úkolu server vytvoří další výskyt s posunutým termínem
// (logika v pb_hooks/main.pb.js). Razítko = aktuální čas (starší by PocketBase přeskočil
// kvůli vlastním auto-migracím z 2026 — viz gotcha migrace guest-leak).
migrate((app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.fields.add(new SelectField({
    name: "recurrence",
    values: ["daily", "weekly", "monthly"],
    maxSelect: 1,
  }));
  app.save(tasks);
}, (app) => {
  const tasks = app.findCollectionByNameOrId("tasks");
  tasks.fields.removeByName("recurrence");
  app.save(tasks);
});
