// Upgrade: mail_budget rows written by the PREVIOUS version (KB_STARY_IMAGE) get `created` from
// migration 1794524200 (code analysis 4, M1-02) — over the SAME volume. Measured: the start has
// no migration errors; dated rows take their date from the key (so the first cleanup removes
// what is older than 40 days); undated gates start counting from the upgrade and survive the
// first cleanup; a second start changes nothing.
// Without KB_STARY_IMAGE the suite is skipped (full regression) — run it on purpose:
//   KB_STARY_IMAGE=<image before the fix> KB_TEST_IMAGE=<new> node product/tests/upgrade-chyby4-mail-budget.js
const H = require('./_harness');
const { expect, sleep } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

H.beh(async () => {
  if (!STARY) {
    H.preskoceno('KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz před opravou>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0 };
  const VOL = 'kb-upg-chyby4-mb-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  const dnes = new Date().toISOString().slice(0, 10);
  const DNY = ['2025-01-01', 'digest:2025-01-02', 'navrat:2025-01-03', 'psday:2025-01-04', 'n:due:stara:x', 'ps:mapa123:abcdef', dnes, 'digest:' + dnes];

  console.log(`== stará verze (${STARY}) ==`);
  const stara = await H.startInstance({ slug: 'upg-ch4-mb-stara', image: STARY, volume: VOL, env });
  const uid = (await stara.register('a@up.cz')).json.id;
  const stST = await stara.superuser();
  for (const day of DNY) {
    const r = await stara.api('POST', '/api/collections/mail_budget/records', { token: stST, body: { user: uid, day, sent: 1 } });
    if (r.status !== 200) throw new Error(`mail_budget ${day}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const staraCol = ((await stara.api('GET', '/api/collections?perPage=200', { token: stST })).json.items || []).find((c) => c.name === 'mail_budget');
  expect(!!staraCol && !staraCol.fields.some((f) => f.name === 'created'), 'stará verze: mail_budget nemá pole created (jinak sada neměří upgrade)');
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== nová verze nad týmž volume ==');
  const nova = await H.startInstance({ slug: 'upg-ch4-mb-nova', volume: VOL, env });
  const kontrolaLogu = (co) => {
    const logy = nova.logs(200);
    expect(!/(migrat\w*[^\n]*(error|fail)|panic|TypeError|ReferenceError|no such (column|table))/i.test(logy), `${co}: start bez chyb migrací (${(logy.match(/[^\n]*(error|panic|no such)[^\n]*/i) || [''])[0].slice(0, 160)})`);
  };
  kontrolaLogu('první start');
  let ST = await nova.superuser();
  const radky = async () => Object.fromEntries((((await nova.api('GET', '/api/collections/mail_budget/records?perPage=200', { token: ST })).json.items) || []).map((x) => [x.day, String(x.created || '')]));
  const col = ((await nova.api('GET', '/api/collections?perPage=200', { token: ST })).json.items || []).find((c) => c.name === 'mail_budget');
  expect(!!col && col.fields.some((f) => f.name === 'created' && f.type === 'autodate') && [col.listRule, col.viewRule, col.createRule, col.updateRule, col.deleteRule].every((x) => x === null), 'živé schéma: mail_budget má created (autodate) a zůstala zamčená');
  const r1 = await radky();
  expect(Object.keys(r1).length === DNY.length, `žádný řádek se migrací neztratil (${Object.keys(r1).length} / ${DNY.length})`);
  expect(r1['2025-01-01'].startsWith('2025-01-01') && r1['digest:2025-01-02'].startsWith('2025-01-02') && r1['navrat:2025-01-03'].startsWith('2025-01-03') && r1['psday:2025-01-04'].startsWith('2025-01-04'),
    `datované řádky mají created z data v klíči (${['2025-01-01', 'digest:2025-01-02', 'navrat:2025-01-03', 'psday:2025-01-04'].map((d) => r1[d].slice(0, 10)).join(', ')})`);
  expect(r1[dnes].startsWith(dnes) && r1['digest:' + dnes].startsWith(dnes), 'dnešní řádky mají dnešní created');
  const blizkoTed = (s) => Math.abs(new Date(s.replace(' ', 'T')).getTime() - Date.now()) < 10 * 60 * 1000;
  expect(blizkoTed(r1['n:due:stara:x']) && blizkoTed(r1['ps:mapa123:abcdef']), `nedatované závory počítají stáří od upgradu (${r1['n:due:stara:x']})`);
  const novy = await nova.api('POST', '/api/collections/mail_budget/records', { token: ST, body: { user: uid, day: 'n:novy', sent: 0 } });
  expect(novy.status === 200 && blizkoTed(String(novy.json.created || '')), `nový řádek dostane created sám (${novy.json && novy.json.created})`);

  console.log('== první úklid po upgradu ==');
  const s = (await nova.api('POST', '/api/crons/prune_notifications', { token: ST })).status;
  await sleep(4000);
  const r2 = await radky();
  expect((s === 204 || s === 200) && !('2025-01-01' in r2) && !('digest:2025-01-02' in r2) && !('navrat:2025-01-03' in r2) && !('psday:2025-01-04' in r2), `staré datované řádky uklizeny (zbylo: ${Object.keys(r2).sort().join(', ')})`);
  expect(dnes in r2 && ('digest:' + dnes) in r2 && 'n:due:stara:x' in r2 && 'ps:mapa123:abcdef' in r2 && 'n:novy' in r2, 'dnešní řádky a nedatované závory zůstaly');
  const logy = JSON.stringify((await nova.api('GET', '/api/logs?perPage=200&sort=-created', { token: ST })).json || {}) + nova.logs(200);
  expect(!/no such column/i.test(logy), 'v logu není „no such column“');

  console.log('== druhý start: migrace je idempotentní ==');
  await nova.restart();
  kontrolaLogu('druhý start');
  ST = await nova.superuser();
  const r3 = await radky();
  expect(JSON.stringify(r3) === JSON.stringify(r2), 'řádky i jejich created beze změny');
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
}, { nazev: 'UPGRADE-CHYBY4-MAIL-BUDGET' });
