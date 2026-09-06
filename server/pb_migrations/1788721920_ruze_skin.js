/// <reference path="../pb_data/types.d.ts" />
// Nový vestavěný skin „Růže" (růžová s vínovou; Richard 6. 9. 2026) — rozšíření
// výčtů skin_id/builtin_id. Hodnoty sedí s KNOWN_SKIN_IDS ve skinValidator.js.
const OLD_USER = ["indigo", "contrast", "terminal", "sepia",
  "ocean", "les", "pulnoc", "svestka", "broskev", "grafit", "rubin", "custom"];
const NEW_USER = ["indigo", "contrast", "terminal", "sepia",
  "ocean", "les", "pulnoc", "svestka", "broskev", "grafit", "rubin", "ruze", "custom"];
const OLD_INST = ["indigo", "contrast", "terminal", "sepia",
  "ocean", "les", "pulnoc", "svestka", "broskev", "grafit", "rubin"];
const NEW_INST = ["indigo", "contrast", "terminal", "sepia",
  "ocean", "les", "pulnoc", "svestka", "broskev", "grafit", "rubin", "ruze"];

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
