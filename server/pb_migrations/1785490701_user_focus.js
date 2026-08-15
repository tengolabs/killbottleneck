/// <reference path="../pb_data/types.d.ts" />
// Denní fokus: JEDEN nejdůležitější úkol na dnes a jeden na zítra.
// { "<YYYY-MM-DD>": { kind: 'node'|'task', id, map } } — max 2 záznamy, klíč je
// datum, takže volba VYPRŠÍ SAMA (staré klíče zahazuje users hook, žádný cron —
// stejný princip jako „plán do minulosti vyprší sám"). NENÍ to pole priority
// (to bylo 27. 7. 2026 zamítnuto) — je to osobní volba na konkrétní den.
// Pole na users (vzor notify_prefs/skin_custom): cestuje s účtem, RLS zdarma.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new JSONField({ name: "focus", maxSize: 600 }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.removeByName("focus");
  app.save(users);
});
