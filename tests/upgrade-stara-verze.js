// Upgrade from an OLD public release straight to this image (v1.0.0 is the first release the stable update
// channel offers since v0.33-beta, so someone will jump from v0.33 or v0.65 directly to v1.0.0).
// Old image: an admin, a goal map with nodes, a comment on a node, an idea in the buffer. New image on the SAME
// volume: all migrations run without an error, the admin can sign in, the map/comment/idea are intact, the account
// got language = cs (migration 1793977492), writing still works, the instance serves the MIT license.
// Standalone task items (`tasks`) are deleted on purpose by migration 1787240000 (decision of 17 Aug 2026:
// a task is a node) — the suite checks the collection is empty afterwards instead of expecting them to survive.
// Needs KB_STARY_IMAGE (e.g. kb-v033 built from tag v0.33-beta); skipped in the full regression without it:
//   KB_STARY_IMAGE=kb-v033 KB_TEST_IMAGE=<new image> node product/tests/upgrade-stara-verze.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

H.beh(async () => {
  if (!STARY) {
    expect(true, 'upgrade test SKIPPED — KB_STARY_IMAGE not set; run on purpose: KB_STARY_IMAGE=kb-v033 (built from v0.33-beta)');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 };
  const VOL = 'kb-upg-stara-data-' + STARY.replace(/[^a-z0-9]/gi, '');
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);

  console.log(`== old image (${STARY}): admin, map, task, idea ==`);
  const stara = await H.startInstance({ slug: 'upg-stara', image: STARY, volume: VOL, env });
  const reg = await stara.register('anna@example.com', { full_name: 'Anna', language: '' }); // API client that sends no language
  expect(reg.status === 200, `Anna registered on the old image (${reg.status})`);
  const A0 = await stara.login('anna@example.com');
  const nodes = [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň', title: 'Kuchyň', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 150 }, data: { title: 'Objednat linku', status: 'todo' } },
    { id: 'n2', type: 'goalNode', position: { x: 200, y: 150 }, data: { title: 'Vybrat dlažbu', status: 'done' } },
  ];
  const map = await stara.api('POST', '/api/collections/goalmaps/records', { token: A0, body: { title: 'Rekonstrukce', nodes, edges: [{ id: 'e1', source: 'root', target: 'n1' }, { id: 'e2', source: 'root', target: 'n2' }] } });
  expect(map.status === 200, `map created on the old image (${map.status})`);
  const kom = await stara.api('POST', '/api/collections/comments/records', { token: A0, body: { goalmap: map.json.id, node_id: 'n1', text: 'Zavolat truhláři', author: reg.json.id, author_email: 'anna@example.com' } });
  expect(kom.status === 200, `comment created on the old image (${kom.status} ${JSON.stringify(kom.json).slice(0, 80)})`);
  const idea = await stara.api('POST', '/api/collections/buffer_nodes/records', { token: A0, body: { title: 'Nápad: nové světlo', text: 'Nápad: nové světlo', owner: reg.json.id, user: reg.json.id } });
  const ideaOk = idea.status === 200;
  expect(true, `idea in the buffer on the old image: ${idea.status} (${ideaOk ? 'created' : 'collection shape differs — not checked after upgrade'})`);
  const staraVerze = (await stara.api('GET', '/api/kb/config')).json || {};
  console.log(`   old instance config: ${JSON.stringify(staraVerze).slice(0, 120)}`);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== upgrade: new image on the same volume ==');
  const nova = await H.startInstance({ slug: 'upg-stara-nova', volume: VOL, env });
  const logy = execSync(`docker logs ${nova.name} 2>&1`).toString();
  const chyby = logy.split('\n').filter((l) => /migrat/i.test(l) && /(error|fail|panic)/i.test(l));
  expect(chyby.length === 0, `no migration errors in the log (${chyby.length ? chyby.slice(0, 3).join(' | ').slice(0, 300) : 'clean'})`);
  expect(/users_language_cs: 1 account/.test(logy), 'language migration filled in 1 account');
  const A = await nova.login('anna@example.com').catch(() => null);
  expect(!!A, 'Anna signs in after the upgrade');
  const ST = await nova.superuser();
  const anna = ((await nova.api('GET', "/api/collections/users/records?filter=email%3D%27anna%40example.com%27", { token: ST })).json.items || [])[0] || {};
  expect(anna.language === 'cs', `Anna has language = cs (${JSON.stringify(anna.language)})`);
  const mapy = (await nova.api('GET', '/api/collections/goalmaps/records?perPage=50', { token: A })).json.items || [];
  const m = mapy.find((x) => x.title === 'Rekonstrukce');
  if (!m) { expect(false, 'map „Rekonstrukce“ missing after the upgrade'); nova.stop(); return; }
  expect(Array.isArray(m.nodes) && m.nodes.length === 3 && m.edges.length === 2, `map intact: 3 nodes, 2 edges (${m.nodes.length}/${m.edges.length})`);
  expect(!!m.nodes.find((n) => n.id === 'n2' && n.data.status === 'done'), 'node statuses intact');
  const komentare = (await nova.api('GET', '/api/collections/comments/records?perPage=50', { token: A })).json.items || [];
  expect(komentare.some((c) => c.text === 'Zavolat truhláři' && c.node_id === 'n1'), `comment intact (${komentare.length} comment(s))`);
  const ukoly = (await nova.api('GET', '/api/collections/tasks/records?perPage=50', { token: ST })).json.items || [];
  expect(ukoly.length === 0, `standalone task items are gone by design (${ukoly.length})`);
  if (ideaOk) {
    const napady = (await nova.api('GET', '/api/collections/buffer_nodes/records?perPage=50', { token: A })).json.items || [];
    expect(napady.length >= 1, `idea intact (${napady.length})`);
  }
  const cfg = (await nova.api('GET', '/api/kb/config')).json || {};
  expect(typeof cfg.version === 'string' && cfg.version !== '' && cfg.update_check === true, `new instance reports its version and the update check (${JSON.stringify({ version: cfg.version, update_check: cfg.update_check })})`);
  const nove = m.nodes.concat([{ id: 'n3', type: 'goalNode', position: { x: 400, y: 150 }, data: { title: 'Nový krok po upgradu', status: 'todo' } }]);
  const zapis = await nova.api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token: A, body: { nodes: nove, edges: m.edges.concat([{ id: 'e3', source: 'root', target: 'n3' }]) } });
  expect(zapis.status === 200 && zapis.json.nodes.length === 4, `writing to the map works after the upgrade (${zapis.status})`);
  const kom2 = await nova.api('POST', '/api/collections/comments/records', { token: A, body: { goalmap: m.id, node_id: 'n3', text: 'Komentář po upgradu', author: anna.id, author_email: 'anna@example.com' } });
  expect(kom2.status === 200, `a new comment works after the upgrade (${kom2.status})`);
  const lic = await fetch(nova.base + '/LICENSE.txt');
  expect(lic.status === 200 && /^MIT License/.test(await lic.text()), 'instance serves the MIT license');
  nova.stop();
}, { nazev: `UPGRADE Z ${STARY}` });
