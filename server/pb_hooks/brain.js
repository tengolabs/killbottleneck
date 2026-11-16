// Brain training zone — pure logic (no PocketBase objects in here, so tests can `require` it directly).
// Routes live in brain.pb.js. Game contract: frontend/src/components/brain/README.md.

// levels = number of difficulty levels; better = which score wins ('low' = seconds/guesses, 'high' = correct answers)
const GAMES = {
  mines: { levels: 4, better: "low" },
  memory: { levels: 3, better: "low" },
  word: { levels: 1, better: "low" },
  math: { levels: 3, better: "high" },
  stroop: { levels: 3, better: "high" },
  sudoku: { levels: 3, better: "low" },
  clock: { levels: 3, better: "high" },
};
const DAILY_SET = Object.keys(GAMES);          // the daily set = every game once (v1; phase 2 may pick 7 of 11)
const MAX_SCORE = 100000;
const FINISH_WINDOW_MS = 2 * 3600000;          // /finish accepted up to 2 h after /start
const TZ_MAX_MIN = 14 * 60;                    // tzOffset = minutes EAST of UTC (Prague winter = 60), clamped to ±14 h
const SUMMARY_DAYS = 30;

const pad2 = (n) => (n < 10 ? "0" : "") + n;

// Clamp the client's timezone offset (minutes east of UTC). Anything odd → 0 (UTC).
function clampTz(v) {
  const n = Math.round(Number(v));
  if (!isFinite(n)) return 0;
  return Math.max(-TZ_MAX_MIN, Math.min(TZ_MAX_MIN, n));
}

// Local calendar day 'YYYY-MM-DD' for a UTC timestamp shifted by tzOffset minutes.
function localDay(nowMs, tzMin) {
  const d = new Date(Number(nowMs) + clampTz(tzMin) * 60000);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

// Day string shifted by n days (n may be negative).
function shiftDay(day, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

// Consecutive days with at least one finished round, ending today — or ending yesterday when today has
// nothing yet (the streak is still alive until midnight). Nothing today nor yesterday → 0.
function streak(daysPlayed, today) {
  const set = daysPlayed instanceof Set ? daysPlayed : new Set(daysPlayed || []);
  let day = set.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (set.has(day)) { n++; day = shiftDay(day, -1); }
  return n;
}

// Best score per level among WON rounds of one game.
function bestOf(game, rows) {
  const g = GAMES[game];
  if (!g) return {};
  const out = {};
  for (const r of rows || []) {
    if (r.game !== game || !r.won || !r.finished) continue;
    const lvl = Number(r.level) || 1;
    const s = Number(r.score);
    if (!isFinite(s)) continue;
    if (!(lvl in out) || (g.better === "low" ? s < out[lvl] : s > out[lvl])) out[lvl] = s;
  }
  return out;
}

function validateStart(body) {
  const b = body || {};
  const game = String(b.game || "");
  if (!GAMES[game]) return { error: "unknown game" };
  const level = Math.round(Number(b.level) || 1);
  if (level < 1 || level > GAMES[game].levels) return { error: "level out of range" };
  return { game, level, tz: clampTz(b.tzOffset) };
}

// `startedMs` = when the round was started on the server; `nowMs` = now. Returns the sanitized values
// to store, or { error }.
function validateFinish(body, startedMs, nowMs) {
  const b = body || {};
  const elapsed = Number(nowMs) - Number(startedMs);
  if (!(elapsed >= 0)) return { error: "bad timestamps" };
  if (elapsed > FINISH_WINDOW_MS) return { error: "round expired" };
  const won = !!b.won;
  let score = Math.round(Number(b.score));
  if (!isFinite(score) || score < 0) score = 0;
  if (score > MAX_SCORE) score = MAX_SCORE;
  let duration = Math.round(Number(b.durationMs));
  if (!isFinite(duration) || duration < 0) duration = 0;
  duration = Math.min(duration, elapsed);   // the client cannot claim more time than really passed
  return { won, score, durationMs: duration };
}

// Summary for the hub. `rows` = plain objects { game, level, won, score, finished (ISO or ''), day }.
function buildSummary(rows, nowMs, tzMin) {
  const today = localDay(nowMs, tzMin);
  const finished = (rows || []).filter((r) => r.finished);
  const days = new Set(finished.map((r) => r.day).filter(Boolean));
  const doneToday = [];
  for (const r of finished) if (r.day === today && doneToday.indexOf(r.game) < 0) doneToday.push(r.game);
  const bests = {};
  for (const g of DAILY_SET) bests[g] = bestOf(g, finished);
  const last = [];
  const counts = {};
  for (const r of finished) counts[r.day] = (counts[r.day] || 0) + 1;
  for (let i = SUMMARY_DAYS - 1; i >= 0; i--) { const d = shiftDay(today, -i); last.push({ day: d, count: counts[d] || 0 }); }
  return {
    today: { day: today, done: doneToday, count: doneToday.length, total: DAILY_SET.length },
    set: DAILY_SET.slice(),
    streak: streak(days, today),
    bests: bests,
    last30: last,
    rounds: finished.length,
  };
}

// All finished rounds of a user as plain objects (the only place that touches PocketBase records; 7 games/day →
// a few thousand rows a year, one query is fine).
function rowsOf(app, userId) {
  let recs = [];
  try { recs = app.findRecordsByFilter("brain_results", "user = {:u} && finished != ''", "-finished", 5000, 0, { u: userId }); } catch (err) { recs = []; }
  return recs.map((r) => ({ game: r.getString("game"), level: r.getInt("level"), won: r.getBool("won"), score: r.getFloat("score"), finished: r.getString("finished"), day: r.getString("day") }));
}

module.exports = { rowsOf, GAMES, DAILY_SET, MAX_SCORE, FINISH_WINDOW_MS, clampTz, localDay, shiftDay, streak, bestOf, validateStart, validateFinish, buildSummary };
