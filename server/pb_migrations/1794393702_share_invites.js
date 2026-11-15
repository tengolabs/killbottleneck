/// <reference path="../pb_data/types.d.ts" />
// PENDING SHARES (code analysis 4, finding S4-02; decision 11 Nov 2026).
//
// A project shared with an address that has no account used to get a `map_shares` row
// right away, so WHOEVER registered that address (the e-mail is never verified) got the
// access meant for somebody else; and every reader of the project saw the pending
// address in `shared_with*` on the project record.
//
// From now on a share with an address without an account lives ONLY here — a locked
// collection (all rules null, the server is the only reader). It turns into a real share
// when the recipient proves they received the invitation: by signing up / signing in
// through the link with the one-time token from the invitation e-mail (only the hash of
// the token is stored, with an expiry), or when the person who manages the sharing
// confirms it for the account that now exists.
//
// Data step (idempotent): every address in `shared_with*` of any project that has NO
// account is moved here (without a token — the owner sends the invitation again) and its
// `map_shares` row is removed. Addresses with an account are left exactly as they are.
// Timestamp = current time (automigrate=0).
migrate((app) => {
  let col = null;
  try { col = app.findCollectionByNameOrId("share_invites"); } catch (err) { col = null; }
  if (!col) {
    const mapsId = app.findCollectionByNameOrId("goalmaps").id;
    col = new Collection({
      type: "base",
      name: "share_invites",
      fields: [
        { name: "map", type: "relation", collectionId: mapsId, maxSelect: 1, required: true, cascadeDelete: true },
        { name: "email", type: "text", required: true, max: 255 },
        { name: "permission", type: "select", maxSelect: 1, required: true, values: ["read", "work", "edit"] },
        // sha256 of the one-time token; the plain token exists only in the invitation link
        { name: "token_hash", type: "text", max: 64, hidden: true },
        { name: "token_expires", type: "date" },
        { name: "invited_by", type: "text", max: 255 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_share_invites_map_email ON share_invites (map, email)",
        "CREATE INDEX idx_share_invites_email ON share_invites (email)",
        "CREATE INDEX idx_share_invites_token ON share_invites (token_hash)",
      ],
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null, // server only
    });
    app.save(col);
  }

  // ---- move the existing pending addresses ----
  const known = {};
  const hasAccount = (email) => {
    if (known[email] !== undefined) return known[email];
    const c = arrayOf(new DynamicModel({ c: 0 }));
    app.db().newQuery("SELECT COUNT(*) as c FROM users WHERE email = {:e}").bind({ e: email }).all(c);
    known[email] = c[0].c > 0;
    return known[email];
  };
  const list = (s) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch (err) { return []; } };
  const rows = arrayOf(new DynamicModel({ id: "", shared_with: "", shared_with_edit: "", shared_with_work: "" }));
  app.db().newQuery("SELECT id, COALESCE(shared_with, '') AS shared_with, COALESCE(shared_with_edit, '') AS shared_with_edit, COALESCE(shared_with_work, '') AS shared_with_work FROM goalmaps WHERE shared_with != '' AND shared_with != '[]' AND shared_with IS NOT NULL").all(rows);
  let moved = 0;
  for (const m of rows) {
    const w = list(m.shared_with), ed = list(m.shared_with_edit), wk = list(m.shared_with_work);
    const pending = w.filter((x) => typeof x === "string" && x.indexOf("@") > 0 && !/\s/.test(x)
      && !/^ext-.*@kontakt\.invalid$/i.test(x) && !hasAccount(x));
    if (!pending.length) continue;
    for (const email of pending) {
      const perm = ed.indexOf(email) >= 0 ? "edit" : (wk.indexOf(email) >= 0 ? "work" : "read");
      const lower = email.toLowerCase();
      const ex = arrayOf(new DynamicModel({ c: 0 }));
      app.db().newQuery("SELECT COUNT(*) as c FROM share_invites WHERE map = {:m} AND email = {:e}").bind({ m: m.id, e: lower }).all(ex);
      if (ex[0].c === 0) {
        const rec = new Record(col);
        rec.set("map", m.id); rec.set("email", lower); rec.set("permission", perm);
        app.save(rec);
      }
      app.db().newQuery("DELETE FROM map_shares WHERE map = {:m} AND email = {:e}").bind({ m: m.id, e: email }).execute();
      moved += 1;
    }
    const keep = (arr) => JSON.stringify(arr.filter((x) => pending.indexOf(x) < 0));
    // plain UPDATE: `updated` must not move (an open editor would hit a false conflict)
    app.db().newQuery("UPDATE goalmaps SET shared_with = {:a}, shared_with_edit = {:b}, shared_with_work = {:c} WHERE id = {:id}")
      .bind({ a: keep(w), b: keep(ed), c: keep(wk), id: m.id }).execute();
  }
  // rows without a mirror entry and without an account (a mirror edited by hand) — the same hole
  app.db().newQuery("DELETE FROM map_shares WHERE email NOT IN (SELECT email FROM users)").execute();
  if (moved) { try { app.logger().info("share_invites: pending shares moved out of the project records", "count", moved); } catch (err) { /* log is a bonus */ } }
}, (app) => {
  // Down: the pending shares are NOT put back (that would reopen the hole); only the collection goes.
  try { const c = app.findCollectionByNameOrId("share_invites"); if (c) app.delete(c); } catch (err) { /* already gone */ }
});
