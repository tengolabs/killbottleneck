/// <reference path="../pb_data/types.d.ts" />
// Marker původu instančního skinu. Nález z checkupu: klient poznával vestavěný
// skin podle `name` — custom skin pojmenovaný „Indigo" se adminovi zobrazil jako
// vestavěná volba a Uložit mu tiše přepsalo JSON definicí vestavěného (ztráta dat).
// builtin_id = id vestavěného skinu, prázdné = vlastní JSON v poli skin.
migrate((app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  c.fields.add(new SelectField({
    name: "builtin_id",
    values: ["indigo", "contrast", "terminal", "sepia"],
    maxSelect: 1,
  }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("instance_settings");
  c.fields.removeByName("builtin_id");
  app.save(c);
});
