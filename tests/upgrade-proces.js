// Upgrade: data z vydání BEZ stylu Proces (KB_STARY_IMAGE, např. kb-app:20261029 = v0.93-beta) → nový image nad
// TÝMŽ volume (/checkup 29. 10. 2026: jediná nevratná věc ve vydání stylu Proces).
//  • migrace 1792928875_kind_process rozšíří goalmaps.kind o "process", přidá templates.map_kind a založí
//    systémovou šablonu „Týdenní provoz kanceláře“ (proces) — jednou, ani po restartu ne podruhé
//  • stávající mapy zůstanou projekty (kind ""), org mapa org, `updated` se nezmění; pravidlo opakování ze staré
//    verze se dál opakuje; systémovou šablonu, kterou správce smazal, migrace NEvrátí
//  • po upgradu jde mapu přepnout na proces a pravidla dostanou obnovu podkroků
// Bez KB_STARY_IMAGE se sada přeskočí (v plné regresi) — spouštět cíleně:
//   KB_STARY_IMAGE=kb-app:20261029 KB_TEST_IMAGE=<nový> node product/tests/upgrade-proces.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';
const mapa = (title) => ({ title, nodes: [{ id: 'r', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: title, title, status: 'todo' } },
  { id: 'a', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'Krok ' + title, status: 'todo', deadline: '2026-01-05' } }], edges: [{ id: 'e', source: 'r', target: 'a' }] });
const PROCES_SABLONA = 'Týdenní provoz kanceláře';

H.beh(async () => {
  if (!STARY) {
    expect(true, 'upgrade test PŘESKOČEN — KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 };
  const VOL = 'kb-upg-proces-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  console.log(`== stará verze (${STARY}): projekt s opakováním, archivovaná mapa, org mapa, smazaná systémová šablona ==`);
  const stara = await H.startInstance({ slug: 'upg-proces-stara', image: STARY, volume: VOL, env });
  const staraVerze = (await stara.api('GET', '/api/kb/config')).json.version;
  await stara.register('a@example.com', { name: 'Anna' });
  let A = await stara.login('a@example.com');
  const proj = (await stara.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Úklid') })).json;
  const arch = (await stara.api('POST', '/api/collections/goalmaps/records', { token: A, body: mapa('Starý') })).json;
  await stara.api('PATCH', `/api/collections/goalmaps/records/${arch.id}`, { token: A, body: { archived: true } });
  const org = (await stara.api('POST', '/api/kb/org-map', { token: A })).json.map;
  let r = await stara.api('POST', '/api/kb/rules/save', { token: A, body: { map: proj.id, name: 'Opakování', node_id: 'a',
    trigger: { type: 'node_status_changed', status: 'done' }, conditions: [], actions: [{ type: 'set_status', status: 'todo' }, { type: 'set_deadline', advance: 'weekly' }] } });
  const pravidlo = r.json && r.json.rule;
  expect(r.status === 200 && !!pravidlo, `pravidlo opakování ve staré verzi (${r.status})`);
  let su = await stara.superuser();
  const sysPred = (await stara.api('GET', `/api/collections/templates/records?perPage=200&filter=${encodeURIComponent("owner = ''")}`, { token: su })).json.items || [];
  expect(sysPred.length > 1 && !sysPred.some((x) => x.title === PROCES_SABLONA) && sysPred.every((x) => x.map_kind === undefined),
    `stará verze ${staraVerze}: ${sysPred.length} systémových šablon, šablonu procesu ani pole map_kind nezná (jinak test neměří upgrade)`);
  const smazana = sysPred[0];
  await stara.api('DELETE', `/api/collections/templates/records/${smazana.id}`, { token: su });
  const predUpd = (await stara.api('GET', `/api/collections/goalmaps/records/${proj.id}`, { token: A })).json.updated;
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== nová verze nad týmž volume ==');
  const nova = await H.startInstance({ slug: 'upg-proces-nova', volume: VOL, env });
  const logy = nova.logs(160);
  expect(!/(migrat\w*[^\n]*(error|fail)|panic|TypeError|ReferenceError|no such column)/i.test(logy), `start bez chyb migrací (${(logy.match(/[^\n]*(error|panic|no such)[^\n]*/i) || [''])[0].slice(0, 160)})`);
  expect(/kind_process: založeno 1 systémových šablon/.test(logy), `migrace založila právě šablonu procesu (${(logy.match(/kind_process[^\n]*/) || ['—'])[0]})`);
  A = await nova.login('a@example.com');
  const projPo = (await nova.api('GET', `/api/collections/goalmaps/records/${proj.id}`, { token: A })).json;
  expect(projPo.kind === '' && projPo.updated === predUpd, `projekt zůstal projektem a jeho updated se nezměnilo (kind="${projPo.kind}")`);
  const archPo = (await nova.api('GET', `/api/collections/goalmaps/records/${arch.id}`, { token: A })).json;
  expect(archPo.kind === '' && archPo.archived === true, 'archivovaná mapa beze změny');
  const orgPo = (await nova.api('GET', `/api/collections/goalmaps/records/${org.id}`, { token: A })).json;
  expect(orgPo.kind === 'org', `org mapa zůstala org (${orgPo.kind})`);
  su = await nova.superuser();
  const sysPo = (await nova.api('GET', `/api/collections/templates/records?perPage=200&filter=${encodeURIComponent("owner = ''")}`, { token: su })).json.items || [];
  const procS = sysPo.filter((x) => x.title === PROCES_SABLONA);
  expect(procS.length === 1 && procS[0].map_kind === 'process', `šablona procesu jednou, map_kind=process (${procS.length})`);
  expect(!sysPo.some((x) => x.title === smazana.title), `smazaná systémová šablona „${smazana.title}“ se NEvrátila`);
  expect(sysPo.length === sysPred.length, `systémových šablon = dřív − smazaná + proces (${sysPo.length} = ${sysPred.length})`);

  console.log('== po upgradu: opakování ze staré verze běží, přepnutí na proces doplní obnovu podkroků ==');
  let f = (await nova.api('GET', `/api/collections/goalmaps/records/${proj.id}`, { token: A })).json;
  r = await nova.api('PATCH', `/api/collections/goalmaps/records/${proj.id}`, { token: A, body: { nodes: f.nodes.map((n) => (n.id === 'a' ? { ...n, data: { ...n.data, status: 'done' } } : n)), edges: f.edges, base_updated: f.updated } });
  f = (await nova.api('GET', `/api/collections/goalmaps/records/${proj.id}`, { token: A })).json;
  const krok = f.nodes.find((n) => n.id === 'a');
  expect(r.status === 200 && krok.data.status === 'todo' && krok.data.deadline > '2026-01-05', `staré pravidlo opakování proběhlo (${krok.data.status}, ${krok.data.deadline})`);
  r = await nova.api('PATCH', `/api/collections/goalmaps/records/${proj.id}`, { token: A, body: { kind: 'process', base_updated: f.updated } });
  const akce = ((((await nova.api('GET', `/api/kb/rules?map=${proj.id}`, { token: A })).json || {}).rules || []).find((x) => x.id === pravidlo.id) || {}).actions || [];
  expect(r.status === 200 && r.json.kind === 'process' && akce.some((x) => x.type === 'reset_subtree'), `přepnutí na proces + obnova podkroků (${r.status} ${JSON.stringify(akce)})`);

  console.log('== druhý start: šablona procesu se nezdvojí ==');
  await nova.restart();
  su = await nova.superuser();
  const sys2 = (await nova.api('GET', `/api/collections/templates/records?perPage=200&filter=${encodeURIComponent("owner = ''")}`, { token: su })).json.items || [];
  expect(sys2.filter((x) => x.title === PROCES_SABLONA).length === 1 && sys2.length === sysPo.length, `po restartu stále jedna šablona procesu (${sys2.length})`);
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
}, { nazev: 'UPGRADE-PROCES' });
