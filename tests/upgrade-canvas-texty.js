// Upgrade: instance z vydání PŘED vlnou L (KB_STARY_IMAGE, např. kb-app:20261105 = v0.99-beta) má systémové
// šablony Lean Canvas / BMC s původními (skoro doslovnými) texty → nový image nad TÝMŽ volume je migrací
// 1793956000_canvas_texty_vlastni přepíše; osobní kopie uživatele se nemění; ostatní šablony beze změny.
// Bez KB_STARY_IMAGE se sada přeskočí (v plné regresi) — spouštět cíleně:
//   KB_STARY_IMAGE=kb-app:20261105 KB_TEST_IMAGE=<nový> node product/tests/upgrade-canvas-texty.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

H.beh(async () => {
  if (!STARY) {
    expect(true, 'upgrade test PŘESKOČEN — KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 };
  const VOL = 'kb-upg-canvas-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  const sys = (inst, token) => inst.api('GET', '/api/collections/templates/records?perPage=200&filter=' + encodeURIComponent("owner = ''"), { token }).then((r) => r.json.items || []);

  console.log(`== stará verze (${STARY}): původní texty, Anna si Lean Canvas zkopíruje ==`);
  const stara = await H.startInstance({ slug: 'upg-canvas-stara', image: STARY, volume: VOL, env });
  await stara.register('a@example.com', { name: 'Anna' });
  let A = await stara.login('a@example.com');
  let lean = (await sys(stara, A)).find((t) => t.title === 'Lean Canvas');
  expect(lean && !/Maurya.*CC BY-SA/.test(lean.description) && /Top 3 features that solve the problem/.test(JSON.stringify(lean.ai_nodes_en)), 'stará verze má původní texty');
  const pocetPred = (await sys(stara, A)).length;
  const staryPopis = lean.description;
  const kopie = await stara.api('POST', '/api/collections/templates/records', { token: A, body: { title: 'Lean Canvas', description: staryPopis, goal: lean.goal, ai_nodes: lean.ai_nodes, nodes: [], edges: [], visibility: 'personal' } });
  const kopieId = kopie.status === 200 ? kopie.json.id : null;
  const swot = (await sys(stara, A)).find((t) => t.title === 'SWOT analýza');
  // Anna je první účet = admin instance → smí upravit systémovou šablonu; BMC si přepíše.
  const bmcStary = (await sys(stara, A)).find((t) => t.title === 'Business Model Canvas');
  const uprava = await stara.api('PATCH', `/api/collections/templates/records/${bmcStary.id}`, { token: A, body: { description: 'Náš vlastní popis BMC (upravil admin)' } });
  expect(uprava.status === 200 && uprava.json.description === 'Náš vlastní popis BMC (upravil admin)', `admin si upravil systémovou šablonu BMC (${uprava.status})`);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== upgrade: nový image nad týmž volume ==');
  const nova = await H.startInstance({ slug: 'upg-canvas-nova', volume: VOL, env });
  const logy = execSync(`docker logs ${nova.name} 2>&1 | tail -80`).toString();
  expect(!/migrat\w* (failed|error)|Error applying migration|panic/i.test(logy), `start bez chyb migrací (${(logy.match(/.*(migrat|Error|panic).*/gi) || []).slice(0, 3).join(' | ') || 'log čistý'})`);
  A = await nova.login('a@example.com');
  const po = await sys(nova, A);
  lean = po.find((t) => t.title === 'Lean Canvas');
  const bmc = po.find((t) => t.title === 'Business Model Canvas');
  expect(lean && /Maurya/.test(lean.description) && /CC BY-SA/.test(lean.description_en) && /What customers pay for and how/.test(JSON.stringify(lean.ai_nodes_en)) && !/Top 3 features that solve the problem/.test(JSON.stringify(lean.ai_nodes_en)), 'Lean Canvas přepsán vlastními texty + autor');
  expect(bmc && bmc.description === 'Náš vlastní popis BMC (upravil admin)', `BMC upravený adminem migrace NEPŘEPSALA (${(bmc?.description || '').slice(0, 40)})`);
  expect(/canvas_texty_vlastni: šablona „Business Model Canvas“ je upravená adminem — ponechána/.test(logy), 'migrace zalogovala ponechanou šablonu');
  expect(po.length === pocetPred, `počet systémových šablon stejný (${pocetPred} → ${po.length})`);
  const swotPo = po.find((t) => t.title === 'SWOT analýza');
  expect(swot && swotPo && JSON.stringify(swot.ai_nodes) === JSON.stringify(swotPo.ai_nodes) && swot.updated === swotPo.updated, 'ostatní šablony nedotčené');
  if (kopieId) {
    const k = (await nova.api('GET', `/api/collections/templates/records/${kopieId}`, { token: A })).json;
    expect(k.id === kopieId && k.description === staryPopis && k.owner, `osobní kopie uživatele beze změny (${(k.description || '').slice(0, 40)})`);
  } else {
    expect(true, `osobní kopii se nepodařilo založit přes API (${kopie.status}) — větev přeskočena`);
  }
  await nova.stop();
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
});
