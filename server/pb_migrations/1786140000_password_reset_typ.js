/// <reference path="../pb_data/types.d.ts" />
// Typ notifikace `password_reset` — poplach „NĚKDO JINÝ ti právě změnil heslo".
//
// ⚠️ Bez téhle migrace se notifikace NEULOŽÍ: `notifications.type` je select
// s pevným seznamem hodnot, zápis skončí `validation_invalid_value` a výjimku
// spolkne `catch` v routě (`main.pb.js`, „oznámení je bonus, heslo je změněné").
// Výsledkem je přesně to, čemu má funkce bránit — TICHÁ výměna hesla pod rukama.
// Chyběla v prvním provedení 11. 8. 2026, našel ji panel /checkup (všechny čtyři
// kontroly nezávisle) a potvrdil běh: heslo se změnilo, notifikací nula.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const tf = col.fields.getByName("type");
  if (tf.values.indexOf("password_reset") < 0) {
    tf.values = tf.values.concat(["password_reset"]);
  }
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const tf = col.fields.getByName("type");
  tf.values = tf.values.filter((v) => v !== "password_reset");
  app.save(col);
});
