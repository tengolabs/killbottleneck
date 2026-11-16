// Brain training zone — routes (9 Nov 2026). Logic in brain.js (the PB JSVM does not see top-level
// variables of files with routerAdd → everything through require). Rows of `brain_results` are written
// ONLY here: the client never creates/updates records directly (collection rules = null), so the day,
// the duration and the score bounds are decided by the server. Personal data: the owner only.
//
//   POST /api/kb/brain/start    { game, level, tzOffset }      → { id, day }
//   POST /api/kb/brain/finish   { id, won, score, durationMs } → { ok, summary }
//   GET  /api/kb/brain/summary?tzOffset=60                     → summary (today, streak, bests, last30)


routerAdd("POST", "/api/kb/brain/start", (e) => {
  const B = require(`${__hooks}/brain.js`);
  const { minuteLimitHit } = require(`${__hooks}/helpers.js`);
  if (minuteLimitHit($app.store(), "brain:start:" + e.auth.id, 60)) return e.json(429, { error: "Too many requests" });
  const v = B.validateStart(e.requestInfo().body);
  if (v.error) return e.json(400, { error: v.error });
  const now = Date.now();
  // rounds never finished (the hub opens one after every result for "Play again") would pile up forever:
  // the player's own unfinished rounds older than the finish window go away here (checkup 15 Nov 2026)
  try {
    const stale = $app.findRecordsByFilter("brain_results", "user = {:u} && finished = '' && started < {:t}", "", 200, 0,
      { u: e.auth.id, t: new Date(now - B.FINISH_WINDOW_MS).toISOString().replace("T", " ") });
    for (const s of stale) { try { $app.delete(s); } catch (err) { /* already gone */ } }
  } catch (err) { /* cleanup is a bonus, the start must not fail on it */ }
  const rec = new Record($app.findCollectionByNameOrId("brain_results"));
  rec.set("user", e.auth.id);
  rec.set("game", v.game);
  rec.set("level", v.level);
  rec.set("started", new Date(now).toISOString());
  rec.set("day", B.localDay(now, v.tz));
  $app.save(rec);
  return e.json(200, { id: rec.id, day: rec.getString("day") });
}, $apis.requireAuth(), $apis.bodyLimit(16 * 1024));

routerAdd("POST", "/api/kb/brain/finish", (e) => {
  const B = require(`${__hooks}/brain.js`);
  const { minuteLimitHit } = require(`${__hooks}/helpers.js`);
  if (minuteLimitHit($app.store(), "brain:finish:" + e.auth.id, 60)) return e.json(429, { error: "Too many requests" });
  const body = e.requestInfo().body || {};
  const id = String(body.id || "");
  if (!/^[a-z0-9]{1,32}$/i.test(id)) return e.json(400, { error: "bad id" });
  const now = Date.now();
  // every decision inside ONE transaction, so a second /finish racing this one gets its 409 too (checkup 15 Nov 2026:
  // the in-transaction throw used to surface as a generic 400)
  let status = 200, out = null;
  try {
    $app.runInTransaction((tx) => {
      let rec = null;
      try { rec = tx.findRecordById("brain_results", id); } catch (err) { rec = null; }
      // someone else's round looks exactly like a missing one
      if (!rec || rec.getString("user") !== e.auth.id) { status = 404; out = { error: "Not found" }; return; }
      if (rec.getString("finished")) { status = 409; out = { error: "already finished" }; return; }
      const v = B.validateFinish(body, Date.parse(rec.getString("started")), now);
      if (v.error) { status = 400; out = { error: v.error }; return; }
      rec.set("finished", new Date(now).toISOString());
      rec.set("won", v.won);
      rec.set("score", v.score);
      rec.set("duration_ms", v.durationMs);
      tx.save(rec);
    });
  } catch (err) {
    // a concurrent writer beat us: whatever happened, the round is not ours to finish any more
    return e.json(409, { error: "already finished" });
  }
  if (status !== 200) return e.json(status, out);
  const tz = B.clampTz(body.tzOffset);
  return e.json(200, { ok: true, summary: B.buildSummary(B.rowsOf($app, e.auth.id), now, tz) });
}, $apis.requireAuth(), $apis.bodyLimit(16 * 1024));

routerAdd("GET", "/api/kb/brain/summary", (e) => {
  const B = require(`${__hooks}/brain.js`);
  const { minuteLimitHit } = require(`${__hooks}/helpers.js`);
  if (minuteLimitHit($app.store(), "brain:summary:" + e.auth.id, 120)) return e.json(429, { error: "Too many requests" });
  const tz = B.clampTz(e.request.url.query().get("tzOffset"));
  return e.json(200, B.buildSummary(B.rowsOf($app, e.auth.id), Date.now(), tz));
}, $apis.requireAuth());
