/// <reference path="../pb_data/types.d.ts" />
// Index node_reminders(map): syncNodeReminders běží po KAŽDÉM uložení mapy s filtrem
// `map = …` a unikátní index (owner, map, node_id) mu nepomůže → bez indexu sken
// tabulky v horké cestě ukládání mapy (panel /checkup 19. 9. 2026). Samostatná
// migrace, ať ji dostane i instance, kde 1789820000 už proběhla (staging).
// Razítko = aktuální čas.
migrate((app) => {
  const c = app.findCollectionByNameOrId("node_reminders");
  if (!c.indexes.some((i) => /idx_node_reminders_map\b/.test(String(i)))) {
    c.indexes = c.indexes.concat(["CREATE INDEX idx_node_reminders_map ON node_reminders (map)"]);
    app.save(c);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("node_reminders");
  c.indexes = c.indexes.filter((i) => !/idx_node_reminders_map\b/.test(String(i)));
  app.save(c);
});
