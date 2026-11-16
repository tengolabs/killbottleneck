// Upgrade v1.3.0 → this version over the SAME volume (brain training, game of the day). v1.3.0 counted a streak day
// with ANY finished round; this version counts the game of the day. The owner's decision (16 Nov 2026): days played
// before the upgrade keep counting the old way. Migration 1794620000_brain_results_daily adds `daily` + `rules`
// (old rows: rules 0). What is measured: a v1.3.0 player with two days of a game that was NOT the game of the day keeps
// the streak after the upgrade; a non-daily round today adds a bonus, not a day; the game of the day adds the day.
//   KB_STARY_IMAGE=<v1.3.0 image> KB_TEST_IMAGE=<new> node product/tests/upgrade-brain-v13.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const B = require('../server/pb_hooks/brain.js');
const STARY = process.env.KB_STARY_IMAGE || '';

H.beh(async () => {
  if (!STARY) {
    H.preskoceno('KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz v1.3.0>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, TZ: 'Europe/Prague' };
  const VOL = 'kb-upg-brain13-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  const today = B.localDay(Date.now(), 60), d1 = B.shiftDay(today, -1), d2 = B.shiftDay(today, -2);

  console.log(`== v1.3.0 (${STARY}): two days of rounds ==`);
  const stara = await H.startInstance({ slug: 'upg-brain13-stara', image: STARY, volume: VOL, env });
  await stara.register('hrac13@up.cz', { name: 'Hráč' });
  let tok = await stara.login('hrac13@up.cz');
  const me = (await stara.api('POST', '/api/collections/users/auth-refresh', { token: tok })).json.record;
  // a v1.3.0 game that is the game of the day on NEITHER of those two days (otherwise the suite measures nothing)
  const hra = ['mines', 'memory', 'word', 'math', 'stroop', 'sudoku', 'clock'].find((g) => g !== B.dailyGame(me.id, d1) && g !== B.dailyGame(me.id, d2));
  const ST = await stara.superuser();
  for (const den of [d2, d1]) {
    let r = await stara.api('POST', '/api/kb/brain/start', { token: tok, body: { game: hra, level: 1, tzOffset: 60 } });
    const id = r.json.id;
    r = await stara.api('POST', '/api/kb/brain/finish', { token: tok, body: { id, won: true, score: 30, durationMs: 30000 } });
    expect(r.status === 200, `v1.3.0: a round of ${hra} finished (${r.status})`);
    r = await stara.api('PATCH', `/api/collections/brain_results/records/${id}`, { token: ST, body: { day: den } });
    expect(r.status === 200, `v1.3.0: the round moved to ${den} (${r.status})`);
  }
  let r = await stara.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: tok });
  expect(r.json.streak === 2, `v1.3.0: streak 2 (${r.json.streak})`);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== this version over the same volume ==');
  const nova = await H.startInstance({ slug: 'upg-brain13-nova', volume: VOL, env });
  const logy = nova.logs(200);
  expect(!/(migrat\w*[^\n]*(error|fail)|panic|TypeError|ReferenceError|no such (column|table))/i.test(logy), 'start without migration errors');
  tok = await nova.login('hrac13@up.cz');
  r = await nova.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: tok });
  const daily = r.json.today.game;
  expect(r.status === 200 && r.json.streak === 2 && r.json.today.dailyDone === false, `after the upgrade the old days still count: streak 2 (${r.json.streak}, ${hra} was not the game of the day)`);
  const rows = (await nova.api('GET', '/api/collections/brain_results/records?perPage=10', { token: tok })).json.items;
  expect(rows.length === 2 && rows.every((x) => x.rules === 0 && x.daily === false), `old rows: rules 0, daily false (${JSON.stringify(rows.map((x) => [x.rules, x.daily]))})`);
  const other = B.GAME_IDS.find((g) => g !== daily);
  r = await nova.api('POST', '/api/kb/brain/start', { token: tok, body: { game: other, level: 1, tzOffset: 60 } });
  r = await nova.api('POST', '/api/kb/brain/finish', { token: tok, body: { id: r.json.id, won: true, score: 5, tzOffset: 60 } });
  expect(r.status === 200 && r.json.summary.streak === 2 && r.json.summary.today.bonus === 1 && !r.json.summary.today.dailyDone, `a new non-daily round: a bonus, the streak stays 2 until midnight (${r.json.summary.streak})`);
  r = await nova.api('POST', '/api/kb/brain/start', { token: tok, body: { game: daily, level: 1, tzOffset: 60 } });
  r = await nova.api('POST', '/api/kb/brain/finish', { token: tok, body: { id: r.json.id, won: true, score: 5, tzOffset: 60 } });
  expect(r.status === 200 && r.json.summary.streak === 3 && r.json.summary.today.dailyDone, `the game of the day (${daily}) adds today: streak 3 (${r.json.summary.streak})`);
  execSync(`docker rm -f ${nova.name}`, { stdio: 'ignore' });
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
}, { nazev: 'UPGRADE-BRAIN-V13' });
