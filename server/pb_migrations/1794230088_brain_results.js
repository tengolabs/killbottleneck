/// <reference path="../pb_data/types.d.ts" />
// Brain training zone (9 Nov 2026): one row per played round. Personal statistics only — the owner
// reads their own rows (RLS), writes go exclusively through the routes in brain.pb.js (validation,
// server-side day). Nothing is visible to other users or to the organisation (an instance superuser
// can read the table like any other — personal data of the instance); deleting the account deletes the
// rows (cascade) and "Download all my data" exports them.
//
//   game        text    a game id of GAMES in pb_hooks/brain.js (7 games in v1.3.0, 11 from v1.4.0)
//   level       number  1-based difficulty
//   started     date    set by /start; `finished` empty = round abandoned
//   finished    date    set by /finish
//   won         bool    round completed successfully (timed games: always true when finished)
//   score       number  game-specific (seconds, guesses, correct answers — see components/brain/README.md)
//   duration_ms number  capped by the server to now − started
//   day         text    YYYY-MM-DD, the user's local day (tzOffset from the client, clamped; at /finish from v1.4.0)
//   daily, rules        added by 1794620000_brain_results_daily (v1.4.0)
migrate((app) => {
  const usersId = app.findCollectionByNameOrId("users").id;
  let col;
  try { col = app.findCollectionByNameOrId("brain_results"); } catch (err) { col = null; }
  if (col) return;
  col = new Collection({
    type: "base",
    name: "brain_results",
    fields: [
      { name: "user", type: "relation", collectionId: usersId, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "game", type: "text", required: true, max: 20 },
      { name: "level", type: "number", onlyInt: true, min: 1, max: 9 },
      { name: "started", type: "date", required: true },
      { name: "finished", type: "date" },
      { name: "won", type: "bool" },
      { name: "score", type: "number", min: 0 },
      { name: "duration_ms", type: "number", onlyInt: true, min: 0 },
      { name: "day", type: "text", max: 10 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_brain_results_user_day ON brain_results (user, day)",
      "CREATE INDEX idx_brain_results_user_finished ON brain_results (user, finished)",
    ],
    listRule: "user = @request.auth.id",
    viewRule: "user = @request.auth.id",
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(col);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("brain_results")); } catch (err) { /* already gone */ }
});
