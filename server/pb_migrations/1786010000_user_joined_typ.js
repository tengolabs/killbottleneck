/// <reference path="../pb_data/types.d.ts" />
// Nový typ notifikace `user_joined` — pozvaný kolega se poprvé přihlásil.
// Richard 6. 8. 2026 večer: „když někoho pozvu a on se přihlásí, měl bych
// dostat notifikaci, že uživatel vstoupil do systému." Dostává ji ZVOUCÍ
// (users.invited_by), jen při PRVNÍM přihlášení — žádný spam z každého loginu.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const tf = col.fields.getByName("type");
  if (tf.values.indexOf("user_joined") < 0) tf.values = tf.values.concat(["user_joined"]);
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const tf = col.fields.getByName("type");
  tf.values = tf.values.filter((v) => v !== "user_joined");
  app.save(col);
});
