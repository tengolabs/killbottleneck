/// <reference path="../pb_data/types.d.ts" />
// DELETING A MEMBER DELETES ONLY THEIR PRIVATE THINGS (decision 11 Nov 2026; code
// analysis 4, finding M1-01).
//
// Until now the `cascadeDelete` of the author relation took with the account everything
// the person had ever put into OTHER people's and team projects: attachments (files gone
// from storage, no undo), time entries, team templates, events in shared calendars
// (including other people's attendance) and pages shared with the team or by a public link.
//
// The relations below stop cascading (and stop being required — PocketBase clears a
// non-cascading reference when the account goes; a required one would block the delete).
// What is PRIVATE is removed by the users delete hook (helpers.cleanupBeforeUserDelete):
// personal templates, private events, private pages, time entries on the person's own
// projects, assistant images not used in a kept page. Private projects still go with the
// account through goalmaps.owner (unchanged) and take their content with them.
//
// Idempotent; timestamp = current time (automigrate=0).
const RELATIONS = [
  ["node_files", "owner"],
  ["time_entries", "owner"],
  ["templates", "owner"],
  ["events", "owner"],
  ["ai_pages", "user"],
  ["ai_images", "user"],
];
// required BEFORE this migration (restored by the down step)
const WAS_REQUIRED = { "time_entries.owner": true, "events.owner": true, "ai_pages.user": true, "ai_images.user": true };

// ⚠️ A record WITHOUT an owner must not match a visitor WITHOUT a session. A rule like
// `owner = @request.auth.id` is true for an anonymous request once the owner is empty
// ("" = ""), so the kept records would be readable (time entries also writable) by
// anybody on the internet — the trap described in migrations 1785020006 and 1792080000.
// Every rule of the six collections therefore gets the guard `@request.auth.id != ""`.
// The ONE exception is templates list/view: built-in templates (owner "") are public on
// purpose (migration 1751900003). The same guard also closes a hole that v1.0.1 already
// had: templates update/delete was `owner = @request.auth.id || role = admin`, so an
// anonymous request could rewrite or delete every built-in template (owner "").
const GUARD = '@request.auth.id != "" && ';
const RULES = ["listRule", "viewRule", "createRule", "updateRule", "deleteRule"];
const PUBLIC_ON_PURPOSE = { "templates.listRule": true, "templates.viewRule": true };

migrate((app) => {
  for (const [name, field] of RELATIONS) {
    let col = null;
    try { col = app.findCollectionByNameOrId(name); } catch (err) { col = null; }
    if (!col) continue;
    let changed = false;
    const f = col.fields.getByName(field);
    if (f && !(f.cascadeDelete === false && f.required === false)) {
      f.cascadeDelete = false;
      f.required = false;
      changed = true;
    }
    for (const r of RULES) {
      const rule = col[r];
      if (rule === null || rule === undefined || PUBLIC_ON_PURPOSE[name + "." + r]) continue; // null = server only
      if (String(rule).indexOf(GUARD) === 0 || String(rule).trim() === '@request.auth.id != ""') continue;
      // an empty rule (= public, set by hand) has nothing to wrap: `GUARD + "()"` is not a
      // valid filter and the instance would not start
      col[r] = String(rule).trim() === "" ? '@request.auth.id != ""' : GUARD + "(" + rule + ")";
      changed = true;
    }
    if (changed) app.save(col);
  }
}, (app) => {
  // Down: the relations go back; the sign-in guard on the rules STAYS (removing it would
  // reopen anonymous access to ownerless records).
  for (const [name, field] of RELATIONS) {
    let col = null;
    try { col = app.findCollectionByNameOrId(name); } catch (err) { col = null; }
    if (!col) continue;
    const f = col.fields.getByName(field);
    if (!f) continue;
    f.cascadeDelete = true;
    f.required = !!WAS_REQUIRED[name + "." + field];
    app.save(col);
  }
});
