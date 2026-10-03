// Upgrade: data z vydání BEZ čísel projektů (KB_STARY_IMAGE, např. v0.69-beta) → nový image nad TÝMŽ volume.
//  • migrace 1790930603_goalmaps_project_number očísluje existující mapy podle `created` (smazaná se nepočítá,
//    org mapa = 0, archivovaná číslo dostane), NESÁHNE na `updated` (otevřené editory by jinak dostaly 409)
//  • řádek instance_settings s čítačem vznikne, i když před upgradem neexistoval; čítač = max + 1
//  • druhý start nového image nic nepřečísluje; nová mapa po upgradu pokračuje v řadě
// Bez KB_STARY_IMAGE se sada přeskočí (v plné regresi) — spouštět cíleně:
//   KB_STARY_IMAGE=kb-app:20261002 KB_TEST_IMAGE=<nový> node product/tests/upgrade-cislo-projektu.js
// Mutačně: backfill `ORDER BY title DESC` místo `created` → čísla nesedí; `app.save` místo SQL → `updated` se změní.
const H = require('./_harness');
const { expect, sleep } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';
const mapa = (title) => ({ title, nodes: [{ id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'todo' } },
  { id: 'a', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Krok ' + title, status: 'todo' } }], edges: [{ id: 'e', source: 'r', target: 'a' }] });

H.beh(async () => {
  if (!STARY) {
    // harness odmítá sadu bez jediné kontroly (vždy-zelená past) → přeskočení se zapíše nahlas
    expect(true, 'upgrade test PŘESKOČEN — KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0 };
  const VOL = 'kb-upg-cislo-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  console.log(`== stará verze (${STARY}): 4 mapy (1 smazaná, 1 archivovaná) + org mapa ==`);
  const stara = await H.startInstance({ slug: 'upg-cislo-stara', image: STARY, volume: VOL, env });
  const staraVerze = (await stara.api('GET', '/api/kb/config')).json.version;
  await stara.register('a@example.com', { name: 'Anna' });
  let A = await stara.login('a@example.com');
  const m = {};
  for (const t of ['Alfa', 'Beta', 'Gama', 'Delta']) {
    m[t] = (await stara.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa(t) })).json;
    await sleep(1100); // různé `created`
  }
  expect(Object.values(m).every((x) => x.id && x.project_number === undefined), `stará verze ${staraVerze} pole project_number nezná (jinak test neměří upgrade)`);
  await stara.api('PATCH', `/api/collections/goalmaps/records/${m.Beta.id}`, { token: A, body: { archived: true } });
  await stara.api('DELETE', `/api/collections/goalmaps/records/${m.Gama.id}`, { token: A });
  const org = (await stara.api('POST', '/api/kb/org-map', { token: A })).json.map;
  expect(!!org && org.kind === 'org', 'org mapa ve staré verzi založena');
  const pred = {};
  for (const t of ['Alfa', 'Beta', 'Delta']) pred[t] = (await stara.api('GET', `/api/collections/goalmaps/records/${m[t].id}`, { token: A })).json.updated;
  const nastaveniPred = (await stara.api('GET', '/api/collections/instance_settings/records', { token: await stara.superuser() })).json.items || [];
  expect(nastaveniPred.length === 0, `řádek instance_settings před upgradem neexistuje (${nastaveniPred.length}) — migrace ho musí založit`);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== nová verze nad týmž volume ==');
  const nova = await H.startInstance({ slug: 'upg-cislo-nova', volume: VOL, env });
  const logy = nova.logs(120);
  expect(!/(migrat\w*[^\n]*(error|fail)|panic|TypeError|ReferenceError|no such column)/i.test(logy), `start bez chyb migrací (${(logy.match(/[^\n]*(error|panic|no such)[^\n]*/i) || [''])[0].slice(0, 160)})`);
  expect(/goalmaps_project_number: očíslováno map 3, nejvyšší číslo 3/.test(logy), `migrace hlásí 3 očíslované mapy (${(logy.match(/goalmaps_project_number[^\n]*/) || [''])[0]})`);
  A = await nova.login('a@example.com');
  const po = {};
  for (const t of ['Alfa', 'Beta', 'Delta']) po[t] = (await nova.api('GET', `/api/collections/goalmaps/records/${m[t].id}`, { token: A })).json;
  expect(po.Alfa.project_number === 1 && po.Beta.project_number === 2 && po.Delta.project_number === 3, `čísla podle data vzniku, smazaná Gama se nepočítá (${po.Alfa.project_number},${po.Beta.project_number},${po.Delta.project_number})`);
  expect(po.Beta.archived === true && po.Beta.project_number === 2, 'archivovaná mapa je očíslovaná');
  const orgPo = (await nova.api('GET', `/api/collections/goalmaps/records/${org.id}`, { token: A })).json;
  expect((orgPo.project_number || 0) === 0, `org mapa bez čísla (${orgPo.project_number})`);
  expect(['Alfa', 'Beta', 'Delta'].every((t) => po[t].updated === pred[t]), `updated map se backfillem NEZMĚNILO (${['Alfa', 'Beta', 'Delta'].map((t) => po[t].updated === pred[t]).join(',')})`);
  const su = await nova.superuser();
  const nast = (await nova.api('GET', '/api/collections/instance_settings/records', { token: su })).json.items || [];
  expect(nast.length === 1 && nast[0].next_project_number === 4, `řádek nastavení založen, čítač = 4 (${nast.length}, ${nast[0] && nast[0].next_project_number})`);
  const nova1 = (await nova.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Epsilon') })).json;
  expect(nova1.project_number === 4, `nová mapa po upgradu = #4 (${nova1.project_number})`);
  const idx = ((await nova.api('GET', '/api/collections/goalmaps', { token: su })).json.indexes || []);
  expect(idx.some((i) => /idx_goalmaps_project_number/.test(i)), 'index existuje');

  console.log('== druhý start nové verze: migrace se neopakuje, čísla drží ==');
  await nova.restart();
  A = await nova.login('a@example.com');
  const po2 = {};
  for (const t of ['Alfa', 'Beta', 'Delta']) po2[t] = (await nova.api('GET', `/api/collections/goalmaps/records/${m[t].id}`, { token: A })).json;
  const eps = (await nova.api('GET', `/api/collections/goalmaps/records/${nova1.id}`, { token: A })).json;
  expect(po2.Alfa.project_number === 1 && po2.Beta.project_number === 2 && po2.Delta.project_number === 3 && eps.project_number === 4, 'po restartu čísla beze změny');
  const nast2 = (await nova.api('GET', '/api/collections/instance_settings/records', { token: await nova.superuser() })).json.items || [];
  expect(nast2.length === 1 && nast2[0].next_project_number === 5, `čítač po restartu 5 (${nast2[0] && nast2[0].next_project_number})`);
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
}, { nazev: 'UPGRADE-CISLO-PROJEKTU' });
