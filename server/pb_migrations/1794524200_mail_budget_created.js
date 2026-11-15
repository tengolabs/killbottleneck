/// <reference path="../pb_data/types.d.ts" />
// mail_budget gets `created` (code analysis 4, M1-02). The nightly cleanup in
// prune_notifications deleted by `created`, a column this collection never had: the
// statement failed every night ("no such column: created") and the table only grew.
//
// Rows that already exist get their date from what they are: a daily row (`YYYY-MM-DD`)
// and the daily markers (`digest:`, `navrat:`, `psday:` + date) from the date in the key,
// everything else (the e-mail gates `n:<key>`, the share-invitation gates `ps:…`) from
// the moment of this migration — those expire 40 days from now, not at once.
migrate((app) => {
  const col = app.findCollectionByNameOrId("mail_budget");
  if (!col.fields.getByName("created")) {
    col.fields.add(new AutodateField({ name: "created", onCreate: true }));
    app.save(col);
  }
  const DATE = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'";
  app.db().newQuery("UPDATE mail_budget SET created = day || ' 00:00:00.000Z' WHERE created = '' AND day GLOB " + DATE).execute();
  for (const prefix of ["digest:", "navrat:", "psday:"]) {
    app.db().newQuery("UPDATE mail_budget SET created = substr(day, " + (prefix.length + 1) + ") || ' 00:00:00.000Z' "
      + "WHERE created = '' AND day LIKE '" + prefix + "%' AND substr(day, " + (prefix.length + 1) + ") GLOB " + DATE).execute();
  }
  app.db().newQuery("UPDATE mail_budget SET created = strftime('%Y-%m-%d %H:%M:%fZ', 'now') WHERE created = ''").execute();
}, (app) => {
  const col = app.findCollectionByNameOrId("mail_budget");
  col.fields.removeByName("created");
  app.save(col);
});
