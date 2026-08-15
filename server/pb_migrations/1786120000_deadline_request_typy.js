/// <reference path="../pb_data/types.d.ts" />
// Nové typy notifikací pro žádost o změnu termínu (Richard 7. 8. 2026):
// `deadline_request` — řešitel navrhl zadavateli nový termín;
// `deadline_request_resolved` — zadavatel žádost vyřídil (změna termínu =
// schválení, explicitní zamítnutí přes routu /deadline-requests).
migrate((app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const tf = col.fields.getByName("type");
  for (const v of ["deadline_request", "deadline_request_resolved"]) {
    if (tf.values.indexOf(v) < 0) tf.values = tf.values.concat([v]);
  }
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("notifications");
  const tf = col.fields.getByName("type");
  tf.values = tf.values.filter((v) => v !== "deadline_request" && v !== "deadline_request_resolved");
  app.save(col);
});
