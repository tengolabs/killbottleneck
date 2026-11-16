// Brain training zone (9 Nov 2026) — API suite for server/pb_hooks/brain.pb.js + unit checks of brain.js:
// a round is opened by /start and closed by /finish (owner only, once, within 2 h, duration capped by the server,
// score clamped), /summary derives today's set, the streak of days and personal bests; rows are visible to the
// owner only (RLS) and cannot be created directly; the local day comes from the server clock + tzOffset. Every start/finish in this test sends tzOffset: 60 like the real client — between 23:00 and 24:00 UTC a start without it lands on the UTC day and the Prague summary would miss it.
const H = require('./_harness');
const { expect } = H;
const B = require('../server/pb_hooks/brain.js');
const fs = require('fs');
const path = require('path');

// the game registry lives twice (hub + server) and the Deluxe kit seven times (one file per game) — both must stay in sync
{
  const src = fs.readFileSync(path.join(__dirname, '../frontend/src/components/brain/brainApi.js'), 'utf8');
  const hub = {};
  for (const m of src.matchAll(/\{ id: '(\w+)',[^\n]*?levels: (\d+),(?:[^\n]*?phoneLevels: (\d+),)?[^\n]*?better: '(\w+)'/g)) hub[m[1]] = { levels: Number(m[2]), better: m[4] };
  const same = Object.keys(B.GAMES).length === Object.keys(hub).length && Object.keys(B.GAMES).every((id) => hub[id] && hub[id].levels === B.GAMES[id].levels && hub[id].better === B.GAMES[id].better);
  expect(Object.keys(hub).length === 7 && same, `GAMES in brainApi.js and brain.js agree (${JSON.stringify(hub)} vs ${JSON.stringify(B.GAMES)})`);
  const dir = path.join(__dirname, '../frontend/public/brain');
  const blocks = Object.keys(B.GAMES).map((id) => {
    const html = fs.readFileSync(path.join(dir, id + '.html'), 'utf8');
    const a = html.indexOf('const sfx = {'), b = html.indexOf('// Theme + level plumbing');
    return { id, ok: a > 0 && b > a, block: a > 0 && b > a ? html.slice(a, b).replace(/\s+/g, ' ') : '' };
  });
  const drift = blocks.filter((x) => !x.ok || x.block !== blocks[0].block).map((x) => x.id);
  expect(drift.length === 0, `the shared kit block (sfx, confetti, sound button) is identical in all seven games${drift.length ? ' — drifted: ' + drift.join(', ') : ''}`);
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
  expect(B.validateFinish({}, t - 3 * 3600000, t).error === 'round expired' && B.validateFinish({}, t + 1000, t).error, 'finish: expired after 2 h, started in the future rejected');
  const rows = [
    { game: 'mines', level: 1, won: true, score: 50, finished: 'x', day: '2026-11-10' },
    { game: 'mines', level: 1, won: true, score: 40, finished: 'x', day: '2026-11-09' },
    { game: 'mines', level: 1, won: false, score: 5, finished: 'x', day: '2026-11-10' },
    { game: 'math', level: 2, won: true, score: 12, finished: 'x', day: '2026-11-10' },
    { game: 'math', level: 2, won: true, score: 99, finished: '', day: '2026-11-10' },
  ];
  const s = B.buildSummary(rows, t, 60);
  expect(s.today.day === '2026-11-10' && s.today.done.join() === 'mines,math' && s.today.count === 2 && s.today.total === 7, 'summary: today = unique finished games');
  expect(s.bests.mines[1] === 40 && s.bests.math[2] === 12 && !('1' in s.bests.math), 'bests: lower seconds win, higher correct answers win, lost and unfinished rounds ignored');
  expect(s.streak === 2 && s.last30.length === 30 && s.last30[29].count === 3 && s.rounds === 4, 'summary: streak, last 30 days, finished rounds');

  console.log('== instance: start / finish / summary ==');
  const inst = await H.startInstance({ slug: 'brain-api', env: { KB_UVODNI_MAPA: 0 } });
  await inst.register('a@example.com', { name: 'Anna' });
  await inst.register('b@example.com', { name: 'Bob' });
  const A = await inst.login('a@example.com');
  const Bt = await inst.login('b@example.com');
  let r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60');
  expect(r.status === 401 || r.status === 403 || r.status === 404, `summary without a token is refused (${r.status})`);
  r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: A });
  expect(r.status === 200 && r.json.today.count === 0 && r.json.streak === 0 && r.json.set.length === 7, 'empty summary: 0/7, streak 0');
  const today = B.localDay(Date.now(), 60);
  expect(r.json.today.day === today, `today is ${today} for tzOffset 60 (${r.json.today.day})`);
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'nope', level: 1 , tzOffset: 60 } });
  expect(r.status === 400, `unknown game → 400 (${r.status})`);
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
  expect(r.json.summary.today.done.join() === 'mines' && r.json.summary.today.count === 1 && r.json.summary.streak === 1, 'finish returns the summary: mines done today, streak 1');
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
  expect(r.status === 200 && r.json.summary.today.done.includes('word') && Object.keys(r.json.summary.bests.word).length === 0, 'a lost round counts for the daily set but not as a best');
  r = await inst.api('POST', '/api/kb/brain/start', { token: A, body: { game: 'sudoku', level: 1 , tzOffset: 60 } });
  expect(r.status === 200, 'an abandoned round (never finished) is allowed');
  r = await inst.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: A });
  expect(r.json.today.count === 3 && r.json.rounds === 3, `abandoned rounds are ignored (today ${r.json.today.count}/7, rounds ${r.json.rounds})`);
  r = await inst.api('GET', '/api/collections/brain_results/records?perPage=50', { token: A });
  const mine = (r.json && r.json.items) || [];
  expect(r.status === 200 && mine.length === 4, `the owner lists her rows (${mine.length})`);
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
  expect(r.status === 200 && r.json.today.count === 0 && r.json.streak === 0, 'Bob\'s summary is empty — statistics are personal');

  console.log('== the account export carries the results; stale unfinished rounds are cleaned on the next start ==');
  const ex = (await inst.api('GET', '/api/kb/export', { token: A })).json;
  const exRows = (ex && ex.brain_results) || [];
  expect(exRows.length === 4 && exRows.some((x) => x.game === 'math' && x.level === 3 && x.won === true && x.day === today), `"Download all my data" includes brain_results (${exRows.length} rows)`);
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
  expect(!after.some((x) => x.id === abandoned.id) && after.filter((x) => x.finished).length === 3 && after.some((x) => !x.finished && x.game === 'clock'), `the stale unfinished round is gone, finished rows and the fresh round stay (${after.length} rows)`);
  r = await inst.api('POST', '/api/kb/brain/finish', { token: A, body: { id: abandoned.id, won: true, score: 1, tzOffset: 60 } });
  expect(r.status === 404, `finishing the cleaned round → 404 (${r.status})`);
}, { nazev: 'brain-api' });
