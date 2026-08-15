/// <reference path="../pb_data/types.d.ts" />
// 6 nových vestavěných skinů (Oceán, Les, Půlnoc, Švestka, Broskev, Grafit) —
// rozšíření výčtů SelectField na users.skin_id a instance_settings.builtin_id.
// Hodnoty musí sedět s KNOWN_SKIN_IDS v pb_hooks/skinValidator.js.
const OLD_USER = ["indigo", "contrast", "terminal", "sepia", "custom"];
const NEW_USER = ["indigo", "contrast", "terminal", "sepia",
  "ocean", "les", "pulnoc", "svestka", "broskev", "grafit", "custom"];
const OLD_INST = ["indigo", "contrast", "terminal", "sepia"];
const NEW_INST = ["indigo", "contrast", "terminal", "sepia",
  "ocean", "les", "pulnoc", "svestka", "broskev", "grafit"];

migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.getByName("skin_id").values = NEW_USER;
  app.save(users);
  const inst = app.findCollectionByNameOrId("instance_settings");
  inst.fields.getByName("builtin_id").values = NEW_INST;
  app.save(inst);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.getByName("skin_id").values = OLD_USER;
  app.save(users);
  const inst = app.findCollectionByNameOrId("instance_settings");
  inst.fields.getByName("builtin_id").values = OLD_INST;
  app.save(inst);
});
