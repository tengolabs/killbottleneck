/// <reference path="../pb_data/types.d.ts" />
// Rotace skinu (Richard 29. 10. 2026: „automatická změna skinu — rotace jako další možnost“):
// každý den jiný vestavěný skin. Samostatný bool, NE nová hodnota `skin_id` — výčet skin_id
// drží KNOWN_SKIN_IDS ve validátoru, jehož kopie je bajtově shodná s veřejným repem skinů
// (tengolabs/killbottleneck-skins); rotace s formátem skinu nemá nic společného.
// Který skin dnes platí, se počítá v prohlížeči z data (lib/skins.js skinDne) — na všech
// zařízeních stejný, bez denních zápisů na server. RLS hotové (self/admin, vzor align_lock).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new BoolField({ name: "skin_rotace" }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("skin_rotace");
  app.save(users);
});
