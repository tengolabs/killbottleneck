// Brain training zone (9 Nov 2026) — API suite for server/pb_hooks/brain.pb.js + unit checks of brain.js:
// a round is opened by /start and closed by /finish (owner only, once, within 2 h, duration capped by the server,
// score clamped), /summary derives today's set, the streak of days and personal bests; rows are visible to the
// owner only (RLS) and cannot be created directly; the local day comes from the server clock + tzOffset. Every start/finish in this test sends tzOffset: 60 like the real client — between 23:00 and 24:00 UTC a start without it lands on the UTC day and the Prague summary would miss it.
const H = require('./_harness');
const { expect } = H;
const B = require('../server/pb_hooks/brain.js');
const fs = require('fs');
const path = require('path');

// the game registry lives twice (hub + server) and the Deluxe kit once per game file — both must stay in sync
{
  const src = fs.readFileSync(path.join(__dirname, '../frontend/src/components/brain/brainApi.js'), 'utf8');
  const hub = {};
  for (const m of src.matchAll(/\{ id: '(\w+)',[^\n]*?levels: (\d+),(?:[^\n]*?phoneLevels: (\d+),)?[^\n]*?better: '(\w+)'/g)) hub[m[1]] = { levels: Number(m[2]), better: m[4] };
  const same = Object.keys(B.GAMES).length === Object.keys(hub).length && Object.keys(B.GAMES).every((id) => hub[id] && hub[id].levels === B.GAMES[id].levels && hub[id].better === B.GAMES[id].better);
  expect(Object.keys(hub).length === 11 && same, `GAMES in brainApi.js and brain.js agree (${JSON.stringify(hub)} vs ${JSON.stringify(B.GAMES)})`);
  const dir = path.join(__dirname, '../frontend/public/brain');
  const blocks = Object.keys(B.GAMES).map((id) => {
    let html = ''; try { html = fs.readFileSync(path.join(dir, id + '.html'), 'utf8'); } catch (err) { /* a missing game file is a drift too */ }
    const a = html.indexOf('const sfx = {'), b = html.indexOf('// Theme + level plumbing');
    return { id, ok: a > 0 && b > a, block: a > 0 && b > a ? html.slice(a, b).replace(/\s+/g, ' ') : '' };
  });
  const drift = blocks.filter((x) => !x.ok || x.block !== blocks[0].block).map((x) => x.id);
  expect(drift.length === 0, `the shared kit block (sfx, confetti, sound button) is identical in all ${blocks.length} games${drift.length ? ' — drifted: ' + drift.join(', ') : ''}`);
}

H.beh(async () => {
  console.log('== pure logic (brain.js) ==');
  const t = Date.UTC(2026, 10, 9, 23, 30); // 23:30 UTC = 00:30 in Prague on the next day
  expect(B.localDay(t, 60) === '2026-11-10' && B.localDay(t, 0) === '2026-11-09', 'local day follows tzOffset (Prague crosses midnight, UTC does not)');
  expect(B.localDay(t, 99999) === '2026-11-10' && B.clampTz(-99999) === -840 && B.clampTz('x') === 0, 'tzOffset clamped to ±14 h, garbage → 0');
  expect(B.streak(['2026-11-10', '2026-11-09', '2026-11-08'], '2026-11-10') === 3, 'streak counts consecutive days ending today');
  expect(B.streak(['2026-11-09', '2026-11-08'], '2026-11-10') === 2, 'nothing yet today → the streak ending yesterday is still alive');
  expect(B.streak(['2026-11-07'], '2026-11-10') === 0 && B.streak([], '2026-11-10') === 0, 'a gap of a day breaks the streak');
  expect(B.validateStart({ game: 'mines', level: 4, tzOffset: 60 }).level === 4 && B.validateStart({ game: 'mines', level: 5 }).error && B.validateStart({ game: 'nope' }).error && B.validateStart({ game: 'word', level: 2 }).error, 'start validation: known game, level within range');
  const f = B.validateFinish({ won: true, score: 1e9, durationMs: 999999 }, t - 5000, t);
  expect(f.score === B.MAX_SCORE && f.durationMs === 5000 && f.won === true, 'finish: score clamped, duration capped by elapsed');
  expect(B.validateFinish({ hints: 3 }, t - 5000, t).hints === 3 && B.validateFinish({ hints: -2 }, t - 5000, t).hints === 0
    && B.validateFinish({ hints: 1e9 }, t - 5000, t).hints === 1000 && B.validateFinish({ hints: 'x' }, t - 5000, t).hints === 0 && B.validateFinish({}, t - 5000, t).hints === 0,
    'finish: hints 0–1000, garbage → 0');
  expect(B.ROUNDS_PER_MINUTE === 20, 'start/finish: 20 per account and minute');
  expect(B.validateFinish({ score: 50 }, t - 5000, t, 'anagram').score === 10 && B.validateFinish({ score: 50 }, t - 5000, t, 'missing').score === 10
    && B.validateFinish({ score: 5000 }, t - 5000, t, 'sequence').score === 1000 && B.validateFinish({ score: 500 }, t - 5000, t, 'maze').score === 500,
    'finish: phase 2 games clamp to their own ceiling (anagram/missing 10 words/rounds, sequence 1000), maze only to the global one');

  console.log('== game of the day: one of 11, per user and day, every game once per 11-day cycle ==');
  const g1 = B.dailyGame('u1', '2026-11-10');
  expect(!!B.GAMES[g1] && B.dailyGame('u1', '2026-11-10') === g1, `a known game, the same all day (${g1})`);
  const days = Array.from({ length: 440 }, (_, i) => B.shiftDay('2026-01-01', i));
  let cyclesOk = 0, cycles = 0, twice = 0, differ = 0;
  for (let u = 0; u < 50; u++) {
    const seq = days.map((d) => B.dailyGame('user' + u, d));
    for (let k = 1; k < seq.length; k++) if (seq[k] === seq[k - 1]) twice++;
    // whole cycles: day numbers k·11 … k·11+10
    const first = days.findIndex((d) => B.dayNumber(d) % 11 === 0);
    for (let c = first; c + 11 <= seq.length; c += 11) { cycles++; if (new Set(seq.slice(c, c + 11)).size === 11) cyclesOk++; }
    if (u > 0 && seq.join() !== days.map((d) => B.dailyGame('user0', d)).join()) differ++;
  }
  expect(cycles > 1000 && cyclesOk === cycles, `every 11-day cycle has all 11 games (${cyclesOk}/${cycles})`);
  expect(twice === 0, `never the same game two days in a row, not even across cycles (${twice})`);
  expect(differ === 49, 'users get different orders');
  // locked values: a new game or another GAMES order changes the rotation — the stored `daily` flag keeps history, but
  // the change must be a conscious one (update these values in the same commit)
  const lock = ['u1', 'abc123xyz', 'user0'].map((u) => ['2026-11-16', '2026-11-17', '2026-11-27', '2027-01-01'].map((d) => B.dailyGame(u, d)).join(',')).join(' | ');
  expect(lock === 'math,clock,anagram,math | anagram,math,mines,word | memory,maze,memory,maze', `the rotation is locked (${lock})`);
  expect(B.validateStart({ game: 'constructor', level: 9 }).error && B.validateStart({ game: '__proto__', level: 1 }).error && B.validateStart({ game: 'toString' }).error
    && !B.isGame('hasOwnProperty') && B.validateFinish({ score: 5e5 }, t - 5000, t, 'valueOf').score === B.MAX_SCORE && Object.keys(B.bestOf('constructor', [])).length === 0,
    'names of Object.prototype are not games (start refused, no own ceiling, no bests)');
  expect(B.weekStart('2026-11-16') === '2026-11-16' && B.weekStart('2026-11-22') === '2026-11-16' && B.weekStart('2026-11-23') === '2026-11-23' && B.weekStart('2026-11-12') === '2026-11-09',
    'the week starts on Monday');
  expect(B.validateFinish({}, t - 3 * 3600000, t).error === 'round expired' && B.validateFinish({}, t + 1000, t).error, 'finish: expired after 2 h, started in the future rejected');
  const g0 = B.dailyGame('u1', '2026-11-09');
  const others = B.GAME_IDS.filter((g) => g !== g1 && g !== 'mines' && g !== 'math');
  const rows = [
    { game: 'mines', level: 1, won: true, score: 50, finished: 'x', day: '2026-11-10' },
    { game: 'mines', level: 1, won: true, score: 40, finished: 'x', day: '2026-11-09' },
    { game: 'mines', level: 1, won: false, score: 5, finished: 'x', day: '2026-11-10' },
    { game: 'math', level: 2, won: true, score: 12, finished: 'x', day: '2026-11-10' },
    { game: 'math', level: 2, won: true, score: 99, finished: '', day: '2026-11-10' },
  ];
  const s = B.buildSummary(rows, t, 60, 'u1');
  const expBonus = ['mines', 'math'].filter((g) => g !== g1).length;
  expect(s.today.day === '2026-11-10' && s.today.game === g1 && s.today.done.join() === 'mines,math' && s.today.bonus === expBonus && s.today.dailyDone === ['mines', 'math'].includes(g1),
    `summary: game of the day ${g1}, done = unique finished games, bonus = the others (${s.today.bonus})`);
  expect(s.week.start === '2026-11-09' && s.week.count === 2 && s.week.total === 11 && s.week.done.join() === 'mines,math', `week: distinct games since Monday (${s.week.done.join()})`);
  expect(s.bests.mines[1] === 40 && s.bests.math[2] === 12 && !('1' in s.bests.math), 'bests: lower seconds win, higher correct answers win, lost and unfinished rounds ignored');
  expect(s.last30.length === 30 && s.last30[29].count === 3 && s.rounds === 4, 'summary: last 30 days, finished rounds');
  // the streak counts days whose game of the day was finished (a lost round counts, other games don't)
  const day = (game, d, won = true, daily = false) => ({ game, level: 1, won, score: 1, finished: 'x', day: d, daily, rules: B.RULES_VERSION });
  const s3 = B.buildSummary([day(g1, '2026-11-10', false, true), day(g0, '2026-11-09', true, true), day(B.dailyGame('u1', '2026-11-08') === 'mines' ? 'math' : 'mines', '2026-11-08')], t, 60, 'u1');
  expect(s3.streak === 2 && s3.today.dailyDone && s3.today.bonus === 0, `streak = days with the game of the day (2; the 8th only had another game) — ${s3.streak}`);
  const s4 = B.buildSummary([day(others[0], '2026-11-10'), day(g0, '2026-11-09', true, true)], t, 60, 'u1');
  expect(s4.streak === 1 && !s4.today.dailyDone && s4.today.bonus === 1, `another game today is a bonus, the streak lives on from yesterday until midnight (${s4.streak})`);
  const s5 = B.buildSummary(B.GAME_IDS.map((g, i) => day(g, B.shiftDay('2026-11-09', i % 2))), t, 60, 'u1');
  expect(s5.week.count === 11 && s5.week.done.length === 11, 'all 11 games this week = the full week');
  // rows of v1.3.0 (rules 0): any finished round kept the streak then and still does; new rows count only with `daily`
  const v13 = (game, d) => ({ game, level: 1, won: true, score: 1, finished: 'x', day: d });
  const v14 = (game, d, daily) => ({ game, level: 1, won: true, score: 1, finished: 'x', day: d, daily, rules: B.RULES_VERSION });
  const s7 = B.buildSummary([v13('mines', '2026-11-07'), v13('mines', '2026-11-08'), v13('mines', '2026-11-09'), v14('maze', '2026-11-10', false)], t, 60, 'u1');
  expect(s7.streak === 3 && !s7.today.dailyDone, `old rows keep their streak after the upgrade (3, today's non-daily round adds nothing yet) — ${s7.streak}`);
  const s8 = B.buildSummary([v13('mines', '2026-11-09'), v14('maze', '2026-11-10', true)], t, 60, 'u1');
  expect(s8.streak === 2, `a stored daily flag counts, whatever the rotation says today (${s8.streak})`);
  const s9 = B.buildSummary([v14(B.dailyGame('u1', '2026-11-09'), '2026-11-09', false)], t, 60, 'u1');
  expect(s9.streak === 0, 'a new row without the flag does not count even if the rotation now matches');
  const s6 = B.buildSummary([day('mines', '2026-11-08')], t, 60, 'u1');
  expect(s6.week.count === 0, 'Sunday belongs to the previous week');

  console.log('== the word deck (words.js in Node): no word twice inside a deck, also when the list is not a multiple of 10 ==');
  {
    const ctx = { window: {} };
    new Function('window', require('fs').readFileSync(require('path').join(__dirname, '../frontend/public/brain/words.js'), 'utf8'))(ctx.window);
    const D = ctx.window.BRAIN_DECK, W = ctx.window.BRAIN_WORDS;
    for (const k of ['cs7', 'en6', 'cs']) {
      const L = W[k];
      let st = null, inDeck = new Set(), rep = 0, adj = 0, prev = [], decks = 0;
      for (let r = 0; r < 300; r++) {
        const o = D.draw(L, st, 10);
        const reset = st && o.state.used.length < st.used.length;
        if (reset) { decks++; inDeck = new Set(o.picked); } else for (const w of o.picked) { if (inDeck.has(w)) rep++; inDeck.add(w); }
        if (o.picked.some((w) => prev.includes(w))) adj++;
        prev = o.picked; st = o.state;
      }
      expect(L.length % 10 !== 0 || k === 'cs' ? rep === 0 && adj === 0 && decks > 3 : false, `${k} (${L.length} words): 300 rounds, ${decks} decks, ${rep} repeats inside a deck, ${adj} overlaps with the previous round`);
    }
  }

  console.log('== instance: start / finish / summary ==');
  const inst = await H.startInstance({ slug: 'brain-api', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('a@example.com', { name: 'Anna' });
  await inst.register('b@example.com', { name: 'Bob' });
  const A = await inst.login('a@example.com');
  const Bt = await inst.login('b@example.com');
  let r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60');
  expect(r.status === 401 || r.status === 403 || r.status === 404, `summary without a token is refused (${r.status})`);
  r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: A });
  expect(r.status === 200 && !!B.GAMES[r.json.today.game] && r.json.today.dailyDone === false && r.json.today.bonus === 0 && r.json.week.count === 0 && r.json.week.total === 11 && r.json.streak === 0,
    'empty summary: a game of the day, nothing done, week 0/11, streak 0');
  const dailyA = r.json.today.game;
  const nBonus = (games) => games.filter((g) => g !== dailyA).length;
  const today = B.localDay(Date.now(), 60);
  expect(r.json.today.day === today, `today is ${today} for tzOffset 60 (${r.json.today.day})`);
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'nope', level: 1 , tzOffset: 60 } });
  expect(r.status === 400, `unknown game → 400 (${r.status})`);
  for (const bad of ['constructor', '__proto__', 'toString']) {
    r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: bad, level: 9, tzOffset: 60 } });
    expect(r.status === 400, `"${bad}" is not a game → 400 (${r.status})`);
  }
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'mines', level: 9 , tzOffset: 60 } });
  expect(r.status === 400, `level out of range → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'mines', level: 2, tzOffset: 60 } });
  expect(r.status === 200 && /^[a-z0-9]{15}$/.test(r.json.id) && r.json.day === today, `start → id + server day (${r.status} ${JSON.stringify(r.json)})`);
  const id1 = r.json.id;
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: 'x!', won: true , tzOffset: 60 } });
  expect(r.status === 400, `bad id → 400 (${r.status})`);
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: 'abcdefghij12345', won: true , tzOffset: 60 } });
  expect(r.status === 404, `unknown id → 404 (${r.status})`);
  r = await inst.api('POST', '/api/kb/brain/finish', { token: Bt, body: { id: id1, won: true, score: 1 , tzOffset: 60 } });
  expect(r.status === 404, `someone else's round looks like a missing one (${r.status})`);
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: id1, won: true, score: 73, durationMs: 999999, tzOffset: 60 } });
  expect(r.status === 200 && r.json.ok === true, `finish → ok (${r.status})`);
  expect(r.json.summary.today.done.join() === 'mines' && r.json.summary.today.bonus === nBonus(['mines']) && r.json.summary.week.count === 1 && r.json.summary.streak === (dailyA === 'mines' ? 1 : 0), 'finish returns the summary: mines done today, bonus/streak by the game of the day');
  expect(r.json.summary.bests.mines[2] === 73 && r.json.summary.rounds === 1, 'best for mines level 2 = 73');
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: id1, won: true, score: 1 , tzOffset: 60 } });
  expect(r.status === 409, `finishing twice → 409 (${r.status})`);

  console.log('== bounds, lost rounds, RLS ==');
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'math', level: 3 , tzOffset: 60 } });
  const id2 = r.json.id;
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: id2, won: true, score: 1e9, durationMs: -5 , tzOffset: 60 } });
  expect(r.status === 200 && r.json.summary.bests.math[3] === B.MAX_SCORE, `score clamped to ${B.MAX_SCORE}`);
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'word', level: 1 , tzOffset: 60 } });
  const id3 = r.json.id;
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: id3, won: false, score: 6 , tzOffset: 60 } });
  expect(r.status === 200 && r.json.summary.today.done.includes('word') && Object.keys(r.json.summary.bests.word).length === 0, 'a lost round counts as played but not as a best');
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'sudoku', level: 1 , tzOffset: 60 } });
  expect(r.status === 200, 'an abandoned round (never finished) is allowed');
  r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: A });
  expect(r.json.today.done.length === 3 && r.json.today.bonus === nBonus(['mines', 'math', 'word']) && r.json.week.count === 3 && r.json.rounds === 3 && r.json.today.game === dailyA, `abandoned rounds are ignored (bonus ${r.json.today.bonus}, week ${r.json.week.count}, rounds ${r.json.rounds})`);
  // the game of the day through the API → the streak starts
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: dailyA, level: 1, tzOffset: 60 } });
  const idD = r.json.id;
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: idD, won: false, score: 0, hints: 3, tzOffset: 60 } });
  expect(r.status === 200 && r.json.summary.today.dailyDone === true && r.json.summary.streak === 1, `finishing the game of the day (${dailyA}, even lost) completes today, streak 1`);
  {
    const rowD = (await inst.api('GET', `/api/collections/brain_results/records/${idD}`, { token: A })).json;
    expect(rowD.daily === true && rowD.rules === B.RULES_VERSION && rowD.day === today && rowD.hints === 3, `the row stores the daily flag, the rules and the hints (${rowD.daily}, ${rowD.rules}, ${rowD.day}, ${rowD.hints})`);
  }
  // the day of the FINISH decides: a round started "yesterday" (backdated day) and finished now belongs to today
  // a start offset that lands on ANOTHER local day than tzOffset 60 (UTC−12 or UTC+14, one of them always does)
  const tzJinak = [-720, 840].find((z) => B.localDay(Date.now(), z) !== today);
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'clock', level: 1, tzOffset: tzJinak } });
  const idM = r.json.id, startDay = r.json.day;
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: idM, won: true, score: 3, tzOffset: 60 } });
  const rowM = (await inst.api('GET', `/api/collections/brain_results/records/${idM}`, { token: A })).json;
  expect(r.status === 200 && startDay !== today && rowM.day === today, `the day comes from the finish (start said ${startDay} with tzOffset ${tzJinak}, finish ${rowM.day})`);
  r = await inst.api('GET', '/api/collections/brain_results/records?perPage=50', { token: A });
  const mine = (r.json && r.json.items) || [];
  expect(r.status === 200 && mine.length === 6, `the owner lists her rows (${mine.length})`);
  const row2 = mine.find((x) => x.id === id2);
  expect(!!row2 && row2.duration_ms === 0 && row2.won === true && row2.day === today, 'negative duration stored as 0, day from the server');
  const row1 = mine.find((x) => x.id === id1);
  expect(!!row1 && row1.duration_ms > 0 && row1.duration_ms < 60000, `duration capped by the time really elapsed (${row1 && row1.duration_ms} ms, not 999999)`);
  r = await inst.api('GET', '/api/collections/brain_results/records?perPage=50', { token: Bt });
  expect(r.status === 200 && r.json.items.length === 0, 'the other user sees nothing (RLS)');
  r = await inst.api('POST', '/api/collections/brain_results/records', { token: A, body: { user: mine[0].user, game: 'mines', level: 1, started: new Date().toISOString(), finished: new Date().toISOString(), won: true, score: 1, day: today } });
  expect(r.status === 400 || r.status === 403, `direct create is refused (${r.status}) — rows only through /start`);
  r = await inst.api('PATCH', `/api/collections/brain_results/records/${id1}`, { token: A, body: { score: 1 } });
  expect(r.status === 400 || r.status === 403 || r.status === 404, `direct update is refused (${r.status})`);
  r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: Bt });
  expect(r.status === 200 && r.json.today.done.length === 0 && r.json.week.count === 0 && r.json.streak === 0, 'Bob\'s summary is empty — statistics are personal');

  console.log('== the account export carries the results; stale unfinished rounds are cleaned on the next start ==');
  const ex = (await inst.api('GET', '/api/kb/export', { token: A })).json;
  const exRows = (ex && ex.brain_results) || [];
  expect(exRows.length === 6 && exRows.some((x) => x.game === 'math' && x.level === 3 && x.won === true && x.day === today), `"Download all my data" includes brain_results (${exRows.length} rows)`);
  const exB = (await inst.api('GET', '/api/kb/export', { token: Bt })).json;
  expect(Array.isArray(exB.brain_results) && exB.brain_results.length === 0, 'the other account exports none of them');
  const ST = await inst.superuser();
  const abandoned = mine.find((x) => !x.finished);
  const old = new Date(Date.now() - 3 * 3600000).toISOString().replace('T', ' ');
  r = await inst.api('PATCH', `/api/collections/brain_results/records/${abandoned.id}`, { token: ST, body: { started: old } });
  expect(r.status === 200, `superuser backdates the abandoned round by 3 h (${r.status})`);
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'clock', level: 1, tzOffset: 60 } });
  expect(r.status === 200, 'a new start');
  r = await inst.api('GET', '/api/collections/brain_results/records?perPage=50', { token: A });
  const after = r.json.items || [];
  expect(!after.some((x) => x.id === abandoned.id) && after.filter((x) => x.finished).length === 5 && after.some((x) => !x.finished && x.game === 'clock'), `the stale unfinished round is gone, finished rows and the fresh round stay (${after.length} rows)`);
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: abandoned.id, won: true, score: 1, tzOffset: 60 } });
  expect(r.status === 404, `finishing the cleaned round → 404 (${r.status})`);

  console.log('== 5100 rounds: the summary is computed in SQL from all of them (no 5000-row window) ==');
  {
    await inst.register('c@example.com', { name: 'Cyril' });
    const C = await inst.login('c@example.com');
    const cId = (await inst.api('POST', '/api/collections/users/auth-refresh', { token: C })).json.record.id;
    const ST2 = await inst.superuser();
    r = await inst.api('PATCH', '/api/settings', { token: ST2, body: { batch: { enabled: true, maxRequests: 100, timeout: 10, maxBodySize: 0 } } });
    expect(r.status === 200, `superuser enables the batch API for the fixture (${r.status})`);
    const iso = (d) => `${d} 12:00:00.000Z`;
    const rowsC = [];
    // the OLDEST round holds the best (1 s); 60 recent days with v1.3.0 rows (any round counts) → streak 60
    rowsC.push({ game: 'mines', level: 1, won: true, score: 1, day: '2025-01-01' });
    for (let i = 0; i < 5039; i++) rowsC.push({ game: 'mines', level: 1, won: true, score: 100 + (i % 50), day: B.shiftDay('2025-02-01', i % 300) });
    for (let i = 1; i <= 60; i++) rowsC.push({ game: 'memory', level: 2, won: true, score: 30, day: B.shiftDay(today, -i) });
    for (let k = 0; k < rowsC.length; k += 100) {
      const requests = rowsC.slice(k, k + 100).map((x) => ({ method: 'POST', url: '/api/collections/brain_results/records',
        body: { user: cId, game: x.game, level: x.level, started: iso(x.day), finished: iso(x.day), won: x.won, score: x.score, duration_ms: 1000, day: x.day, rules: 0 } }));
      r = await inst.api('POST', '/api/batch', { token: ST2, body: { requests } });
      if (r.status !== 200) { expect(false, `batch insert ${k} (${r.status} ${JSON.stringify(r.json).slice(0, 160)})`); break; }
    }
    r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: C });
    expect(r.status === 200 && r.json.rounds === 5100 && r.json.bests.mines[1] === 1 && r.json.bests.memory[2] === 30 && r.json.streak === 60,
      `all 5100 rounds count: rounds ${r.json.rounds}, best mines ${r.json.bests && r.json.bests.mines[1]} s (the oldest round), streak ${r.json.streak}`);
    const ref = B.buildSummary(rowsC.map((x) => ({ ...x, finished: 'x', rules: 0 })), Date.now(), 60, cId);
    // key order differs (the server's JSON sorts keys) → compare in a canonical form
    const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${k}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v));
    const differ = ['bests', 'streak', 'rounds', 'last30', 'week', 'today'].filter((k) => canon(ref[k]) !== canon(r.json[k]));
    expect(differ.length === 0, `the SQL summary equals the reference built from the plain rows${differ.length ? ' — differs: ' + differ.map((k) => `${k} ${JSON.stringify(ref[k]).slice(0, 120)} vs ${JSON.stringify(r.json[k]).slice(0, 120)}`).join('; ') : ''}`);
  }
}, { nazev: 'brain-api' });
