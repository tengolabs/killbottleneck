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
  maze: { levels: 3, better: "low" },
  sequence: { levels: 3, better: "high", max: 1000 },
  anagram: { levels: 3, better: "high", max: 10 },
  missing: { levels: 3, better: "high", max: 10 },
};
const GAME_IDS = Object.keys(GAMES);
// Game of the day (owner's decision 16 Nov 2026, replacing the first idea of a daily set of 7): ONE game a day, derived
// from user + local day (nothing stored); within every cycle of 11 days each game comes once. Finishing it keeps the
// streak; every other game finished that day is a bonus, and the week counts distinct games (all 11 = the week's badge).
const MAX_SCORE = 100000;
const MAX_HINTS = 1000;
// /start and /finish per account and minute (owner 16 Nov 2026, was 60): no person gets near 20, a script filling
// the table gets a third of before
const ROUNDS_PER_MINUTE = 20;
const FINISH_WINDOW_MS = 2 * 3600000;          // /finish accepted up to 2 h after /start
const TZ_MAX_MIN = 14 * 60;                    // tzOffset = minutes EAST of UTC (Prague winter = 60), clamped to ±14 h
const SUMMARY_DAYS = 30;
// Rules a finished row was played under (stored in `rules`): 0 = a row from before the game of the day (v1.3.0, the
// field did not exist) — that day counts for the streak with ANY finished round, as it did then (owner 16 Nov 2026);
// 2 = game of the day: `daily` is stored at /finish, so a later change of the rotation (a 12th game, another order)
// never rewrites history.
const RULES_VERSION = 2;
// own keys only: GAMES["constructor"] / GAMES["__proto__"] must not pass as a game (security checkup 16 Nov 2026)
const isGame = (g) => typeof g === "string" && Object.prototype.hasOwnProperty.call(GAMES, g);

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

// Day number since 1970-01-01 for 'YYYY-MM-DD' (NaN for garbage).
function dayNumber(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : NaN;
}

// The game order of one cycle of GAME_IDS.length days for one user: FNV-1a of "user:cycle" seeds a small PRNG
// (mulberry32) that shuffles the game list (Fisher-Yates).
function cycleOrder(userId, cycle) {
  let h = 2166136261;
  const key = String(userId || "") + ":" + String(cycle);
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let a = h;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ids = GAME_IDS.slice();
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = ids[i]; ids[i] = ids[j]; ids[j] = x; }
  return ids;
}

// Today's game for one user: day k of the cycle → the k-th game of that cycle's order. A cycle never starts with the
// game the previous one ended with (no game twice in a row across the boundary).
function dailyGame(userId, day) {
  const n = GAME_IDS.length;
  const dn = dayNumber(day);
  if (!isFinite(dn)) return GAME_IDS[0];
  const cycle = Math.floor(dn / n), k = ((dn % n) + n) % n;
  const order = cycleOrder(userId, cycle);
  if (order[0] === cycleOrder(userId, cycle - 1)[n - 1]) { const x = order[0]; order[0] = order[1]; order[1] = x; }
  return order[k];
}

// Monday of the (ISO) week that contains `day`.
function weekStart(day) {
  const dn = dayNumber(day);
  if (!isFinite(dn)) return "";
  const dow = (new Date(dn * 86400000).getUTCDay() + 6) % 7; // Monday = 0
  return shiftDay(day, -dow);
}

// Consecutive days in `daysPlayed` (for the hub: days whose game of the day was finished), ending today — or ending
// yesterday when today is not done yet (the streak is still alive until midnight). Neither today nor yesterday → 0.
function streak(daysPlayed, today) {
  const set = daysPlayed instanceof Set ? daysPlayed : new Set(daysPlayed || []);
  let day = set.has(today) ? today : shiftDay(today, -1);
  let n = 0;
  while (set.has(day)) { n++; day = shiftDay(day, -1); }
  return n;
}

// Best score per level among WON rounds of one game.
function bestOf(game, rows) {
  const g = isGame(game) ? GAMES[game] : null;
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
  if (!isGame(game)) return { error: "unknown game" };
  const level = Math.round(Number(b.level) || 1);
  if (level < 1 || level > GAMES[game].levels) return { error: "level out of range" };
  return { game, level, tz: clampTz(b.tzOffset) };
}

// `startedMs` = when the round was started on the server; `nowMs` = now. Returns the sanitized values
// to store, or { error }. `game` (optional) applies that game's own score ceiling.
function validateFinish(body, startedMs, nowMs, game) {
  const b = body || {};
  const elapsed = Number(nowMs) - Number(startedMs);
  if (!(elapsed >= 0)) return { error: "bad timestamps" };
  if (elapsed > FINISH_WINDOW_MS) return { error: "round expired" };
  const won = !!b.won;
  const max = (isGame(game) && GAMES[game].max) || MAX_SCORE;
  let score = Math.round(Number(b.score));
  if (!isFinite(score) || score < 0) score = 0;
  if (score > max) score = max;
  let duration = Math.round(Number(b.durationMs));
  if (!isFinite(duration) || duration < 0) duration = 0;
  duration = Math.min(duration, elapsed);   // the client cannot claim more time than really passed
  // hints used in the round (anagram, sudoku; the others send none) — for the future experience system
  let hints = Math.round(Number(b.hints));
  if (!isFinite(hints) || hints < 0) hints = 0;
  if (hints > MAX_HINTS) hints = MAX_HINTS;
  return { won, score, durationMs: duration, hints };
}

// What the summary needs, in a shape SQL can deliver without reading every row (checkup 16 Nov 2026: the old
// 5000-row read silently dropped old bests and long streaks):
//   dayFlags = [{ day, ok }]          one per played day; ok = the day counts for the streak
//   bests    = [{ game, level, mn, mx }]  min/max score of WON rounds per game and level
//   recent   = [{ game, day }]        finished rounds of the last SUMMARY_DAYS days (today, week, last30)
//   rounds   = number of finished rounds
// aggregate() builds it from plain rows (tests, and the reference the SQL in statsOf must match).
function streakDayOk(r) { return Number(r.rules) >= RULES_VERSION ? !!r.daily : true; }
function aggregate(rows) {
  const finished = (rows || []).filter((r) => r.finished);
  const flags = {}, best = {};
  for (const r of finished) {
    if (r.day) flags[r.day] = flags[r.day] || streakDayOk(r);
    if (!r.won || !isGame(r.game)) continue;
    const s = Number(r.score);
    if (!isFinite(s)) continue;
    const k = r.game + "|" + (Number(r.level) || 1);
    const b = best[k] || (best[k] = { game: r.game, level: Number(r.level) || 1, mn: s, mx: s });
    if (s < b.mn) b.mn = s;
    if (s > b.mx) b.mx = s;
  }
  return {
    dayFlags: Object.keys(flags).map((d) => ({ day: d, ok: flags[d] })),
    bests: Object.keys(best).map((k) => best[k]),
    recent: finished.map((r) => ({ game: r.game, day: r.day })),
    rounds: finished.length,
  };
}

// Summary for the hub from `stats` (see above; plain rows are accepted too and aggregated).
// today.game = the game of the day; today.done = every game finished today (the hub ticks its card); today.bonus =
// distinct games finished today other than the game of the day; week = distinct games finished since Monday.
// A round counts when finished (won or not).
function buildSummary(stats, nowMs, tzMin, userId) {
  const st = Array.isArray(stats) || !stats ? aggregate(stats) : stats;
  const today = localDay(nowMs, tzMin);
  const game = dailyGame(userId, today);
  const recent = st.recent || [];
  const byDay = {};
  for (const r of recent) { if (!r.day) continue; (byDay[r.day] = byDay[r.day] || {})[r.game] = true; }
  // a streak day: the game of the day finished (stored flag), or — rows from before the game of the day — any round
  const dailyDays = new Set((st.dayFlags || []).filter((f) => f.ok).map((f) => f.day));
  const doneToday = GAME_IDS.filter((g) => byDay[today] && byDay[today][g]);
  const dailyDone = !!(byDay[today] && byDay[today][game]);
  const monday = weekStart(today);
  const weekDone = GAME_IDS.filter((g) => Object.keys(byDay).some((d) => d >= monday && d <= today && byDay[d][g]));
  const bests = {};
  for (const g of GAME_IDS) bests[g] = {};
  for (const b of st.bests || []) {
    if (!isGame(b.game)) continue;
    bests[b.game][Number(b.level) || 1] = GAMES[b.game].better === "low" ? Number(b.mn) : Number(b.mx);
  }
  const last = [];
  const counts = {};
  for (const r of recent) counts[r.day] = (counts[r.day] || 0) + 1;
  for (let i = SUMMARY_DAYS - 1; i >= 0; i--) { const d = shiftDay(today, -i); last.push({ day: d, count: counts[d] || 0 }); }
  return {
    // count/total/set: the v1.3.0 shape, for a tab that was open across the upgrade (shows "x of 1" until reloaded)
    today: { day: today, game: game, dailyDone: dailyDone, done: doneToday, bonus: doneToday.filter((g) => g !== game).length,
      count: dailyDone ? 1 : 0, total: 1 },
    set: [game],
    week: { start: monday, done: weekDone, count: weekDone.length, total: GAME_IDS.length },
    streak: streak(dailyDays, today),
    bests: bests,
    last30: last,
    rounds: Number(st.rounds) || 0,
  };
}

// The summary's input straight from SQL (the only place that touches the database here): a handful of aggregate
// queries, whatever the number of rounds. Booleans are stored as 0/1.
function statsOf(app, userId, nowMs, tzMin) {
  const today = localDay(nowMs, tzMin);
  const from = [shiftDay(today, -(SUMMARY_DAYS - 1)), weekStart(today)].sort()[0];
  const q = (sqlText, model, bind) => {
    const rows = arrayOf(new DynamicModel(model));
    try { app.db().newQuery(sqlText).bind(bind).all(rows); } catch (err) { return []; }
    return rows;
  };
  const base = "FROM brain_results WHERE user = {:u} AND finished != ''";
  const dayFlags = q("SELECT day, MAX(CASE WHEN rules >= " + RULES_VERSION + " THEN (daily = true) ELSE 1 END) AS ok " + base + " AND day != '' GROUP BY day",
    { day: "", ok: 0 }, { u: userId }).map((r) => ({ day: String(r.day), ok: Number(r.ok) > 0 }));
  const bests = q("SELECT game, level, MIN(score) AS mn, MAX(score) AS mx " + base + " AND won = true GROUP BY game, level",
    { game: "", level: 0, mn: 0.0, mx: 0.0 }, { u: userId }).map((r) => ({ game: String(r.game), level: Number(r.level), mn: Number(r.mn), mx: Number(r.mx) }));
  const recent = q("SELECT game, day " + base + " AND day >= {:from}", { game: "", day: "" }, { u: userId, from: from })
    .map((r) => ({ game: String(r.game), day: String(r.day) }));
  const n = q("SELECT COUNT(*) AS n " + base, { n: 0 }, { u: userId });
  return { dayFlags, bests, recent, rounds: n.length ? Number(n[0].n) || 0 : 0 };
}

module.exports = { statsOf, aggregate, ROUNDS_PER_MINUTE, GAMES, GAME_IDS, RULES_VERSION, isGame, dayNumber, dailyGame, weekStart, MAX_SCORE, FINISH_WINDOW_MS, clampTz, localDay, shiftDay, streak, bestOf, validateStart, validateFinish, buildSummary };
