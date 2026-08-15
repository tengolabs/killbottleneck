/// <reference path="../pb_data/types.d.ts" />
// B1 — rozpočet notifikací (rešerše konkurence; udělat před vydáním):
// - notifications.count + base_text: SLÉVÁNÍ DÁVEK — další událost stejného
//   typu ve stejném projektu v okně navýší počítadlo nepřečtené notifikace
//   místo nového řádku; text se přegenerovává z base_text + count.
// - notifications.emailed: přesné počítání denního e-mailového stropu
//   (store čítač by po restartu lhal).
// - users.notify_email_mode: '' /instant = e-maily dle per-typ zaškrtnutí,
//   'digest' = jen jeden denní souhrn, 'none' = nikdy nic e-mailem.
//   Doplňuje notify_prefs, nenahrazuje je.
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  col.fields.add(new NumberField({ name: "count", onlyInt: true }));
  col.fields.add(new TextField({ name: "base_text", max: 1000 }));
  col.fields.add(new BoolField({ name: "emailed" }));
  // 'overflow' = přetokový souhrn nad denním stropem (jeden řádek s počítadlem)
  const tf = col.fields.getByName("type");
  if (tf.values.indexOf("overflow") < 0) tf.values = tf.values.concat(["overflow"]);
  app.save(col);
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new SelectField({
    name: "notify_email_mode",
    values: ["instant", "digest", "none"],
    maxSelect: 1,
  }));
  app.save(users);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  col.fields.removeByName("count");
  col.fields.removeByName("base_text");
  col.fields.removeByName("emailed");
  const tf = col.fields.getByName("type");
  tf.values = tf.values.filter((v) => v !== "overflow");
  app.save(col);
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("notify_email_mode");
  app.save(users);
});
