// Upgrade: data from v1.2.0 (KB_STARY_IMAGE) → the new image over the SAME volume. Covers the migration
//   1794230088_brain_results — its stamp is OLDER than the v1.2.0 migrations already applied on a live box
//   (share_invites, user_delete_keeps_shared, mail_budget_created), so this suite proves PocketBase still runs it.
// What is measured: the start has no migration errors; `brain_results` appears in the live schema with the
// owner-only rules; a user from the OLD version can start and finish a round and sees it in the summary;
// a second start (migration already applied) changes nothing. Without KB_STARY_IMAGE the suite is skipped:
//   KB_STARY_IMAGE=kb-main KB_TEST_IMAGE=<new> node product/tests/upgrade-brain.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

H.beh(async () => {
  if (!STARY) {
    H.preskoceno('KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, TZ: 'Europe/Prague' };
  const VOL = 'kb-upg-brain-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);

  console.log(`== old version (${STARY}) ==`);
  const stara = await H.startInstance({ slug: 'upg-brain-stara', image: STARY, volume: VOL, env });
  await stara.register('hrac@up.cz', { name: 'Hráč' });
  const stST = await stara.superuser();
  const staraCols = (await stara.api('GET', '/api/collections?perPage=200', { token: stST })).json.items;
  expect(!staraCols.some((c) => c.name === 'brain_results'), 'old version: no brain_results collection (otherwise the suite measures nothing)');
  // share_invites comes from 1794393702 (v1.2.0) — newer than 1794230088_brain_results: the case we test
  expect(staraCols.some((c) => c.name === 'share_invites'), 'old version: has share_invites (a migration newer than brain_results is already applied)');
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== new version over the same volume ==');
  let nova = await H.startInstance({ slug: 'upg-brain-nova', volume: VOL, env });
  const kontrolaLogu = (inst, co) => {
    const logy = inst.logs(200);
    expect(!/(migrat\w*[^\n]*(error|fail)|panic|TypeError|ReferenceError|no such (column|table))/i.test(logy), `${co}: start without migration errors (${(logy.match(/[^\n]*(error|panic|no such)[^\n]*/i) || [''])[0].slice(0, 160)})`);
  };
  kontrolaLogu(nova, 'first start');
  let ST = await nova.superuser();
  let cols = (await nova.api('GET', '/api/collections?perPage=200', { token: ST })).json.items;
  const br = cols.find((c) => c.name === 'brain_results');
  expect(!!br, 'new version: brain_results exists although its stamp is older than the applied ones');
  expect(!!br && /@request\.auth\.id/.test(br.listRule || '') && br.createRule === null && br.updateRule === null && br.deleteRule === null, 'new version: rows readable by their owner only, written only through the routes');
  const tok = await nova.login('hrac@up.cz');
  let r = await nova.api('POST', '/api/kb/brain/start', { token: tok, body: { game: 'mines', level: 1, tzOffset: 60 } });
  expect(r.status === 200 && !!r.json.id, `user from the old version starts a round (${r.status})`);
  r = await nova.api('POST', '/api/kb/brain/finish', { token: tok, body: { id: r.json.id, won: true, score: 42, durationMs: 42000 } });
  expect(r.status === 200, `…and finishes it (${r.status})`);
  r = await nova.api('GET', '/api/kb/brain/summary?tzOffset=60', { token: tok });
  expect(r.status === 200 && r.json.today && r.json.today.done.includes('mines') && r.json.streak === 1, `…and the summary counts it (${r.status}, ${JSON.stringify(r.json.today)})`);
  execSync(`docker rm -f ${nova.name}`, { stdio: 'ignore' });

  console.log('== second start (migration already applied) ==');
  nova = await H.startInstance({ slug: 'upg-brain-nova2', volume: VOL, env });
  kontrolaLogu(nova, 'second start');
  ST = await nova.superuser();
  cols = (await nova.api('GET', '/api/collections?perPage=200', { token: ST })).json.items;
  const radky = (await nova.api('GET', '/api/collections/brain_results/records?perPage=5', { token: ST })).json;
  expect(cols.some((c) => c.name === 'brain_results') && radky.totalItems === 1, `second start: collection and the round are still there (${radky.totalItems})`);
  execSync(`docker rm -f ${nova.name}`, { stdio: 'ignore' });
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
}, { nazev: 'UPGRADE-BRAIN' });
