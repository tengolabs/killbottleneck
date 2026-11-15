// Upgrade: instance z vydání PŘED vlnou L (KB_STARY_IMAGE, např. kb-app:20261105 = v0.99-beta) má systémové
// šablony Lean Canvas / BMC s původními (skoro doslovnými) texty → nový image nad TÝMŽ volume je migrací
// 1793956000_canvas_texty_vlastni přepíše; osobní kopie uživatele se nemění; ostatní šablony beze změny.
//
// What the instance admin edited must survive (code analysis 4, S8-02 / T1-01). The released migration
// recognises an edited template only by its description, so the guard 1793955900_canvas_keep_admin_edits
// runs before it. Four upgrades, each over its own volume:
//   1. description of BMC edited, Lean Canvas untouched        → BMC kept whole, Lean Canvas rewritten
//   2. BLOCKS (ai_nodes) of both edited, descriptions untouched → blocks kept, descriptions get the authors
//   3. Lean Canvas description only prefixed, BMC untouched     → the description kept, the blocks rewritten
//   4. instance that ALREADY ran 1793956000 (KB_PO_MIGRACI_IMAGE, e.g. kb-app:20261112 = v1.1.0), admin
//      edited the blocks afterwards → the guard, applied late, changes nothing
// plus a fresh install of the new image (nothing to guard, the seed has the new wording).
// Bez KB_STARY_IMAGE se sada přeskočí (tests/run-all.sh obraz dosadí sám, když na stroji je) — cíleně:
//   KB_STARY_IMAGE=kb-app:20261105 KB_PO_MIGRACI_IMAGE=kb-app:20261112 KB_TEST_IMAGE=<nový> node product/tests/upgrade-canvas-texty.js
// Mutation: without 1793955900 the checks of upgrades 2 and 3 marked „(S8-02)“ go red.
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';
const PO_MIGRACI = process.env.KB_PO_MIGRACI_IMAGE || '';

const BMC = 'Business Model Canvas', LEAN = 'Lean Canvas';
const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0 };
const sys = (inst, token) => inst.api('GET', '/api/collections/templates/records?perPage=200&filter=' + encodeURIComponent("owner = ''"), { token }).then((r) => r.json.items || []);
const j = (v) => JSON.stringify(v);
const chybyMigraci = (logy) => /migrat\w* (failed|error)|Error applying migration|panic/i.test(logy);
const puvodniLean = (t) => !!t && !/CC BY-SA/.test(t.description) && /Top 3 features that solve the problem/.test(j(t.ai_nodes_en));
const novyLeanEn = (t) => !!t && /CC BY-SA/.test(t.description_en) && /What customers pay for and how/.test(j(t.ai_nodes_en)) && !/Top 3 features that solve the problem/.test(j(t.ai_nodes_en));
// The admin changes the title of the first block; returns what the server stored.
const upravUzly = async (inst, token, sablona, znacka) => {
  const uzly = JSON.parse(j(sablona.ai_nodes));
  uzly[0].title = znacka;
  const r = await inst.api('PATCH', `/api/collections/templates/records/${sablona.id}`, { token, body: { ai_nodes: uzly } });
  return { status: r.status, uzly: r.json && r.json.ai_nodes };
};

// One upgrade: old image → `priprav(stara, A, sablony)` → new image over the same volume → the templates after.
async function upgrade(slug, obraz, priprav) {
  const VOL = `kb-upg-canvas-${slug}-data`;
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
  const stara = await H.startInstance({ slug: `upg-canvas-${slug}-stara`, image: obraz, volume: VOL, env });
  await stara.register('a@example.com', { name: 'Anna' }); // first account = instance admin → may edit a system template
  const A = await stara.login('a@example.com');
  const pred = await sys(stara, A);
  const stav = await priprav(stara, A, pred);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });
  const nova = await H.startInstance({ slug: `upg-canvas-${slug}-nova`, volume: VOL, env });
  const logy = execSync(`docker logs ${nova.name} 2>&1 | tail -120`).toString();
  const A2 = await nova.login('a@example.com');
  const po = await sys(nova, A2);
  return { nova, A: A2, pred, po, logy, stav, uklid: async () => { await nova.stop(); execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`); } };
}

H.beh(async () => {
  if (!STARY) {
    H.preskoceno('KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz vydání před v0.101, např. kb-app:20261105>');
    return;
  }

  console.log(`== 1. upgrade z ${STARY}: admin upravil POPIS BMC, Lean Canvas nechal; Anna má osobní kopii ==`);
  let u = await upgrade('popis', STARY, async (stara, A, pred) => {
    const lean = pred.find((t) => t.title === LEAN);
    expect(puvodniLean(lean), 'stará verze má původní texty');
    const kopie = await stara.api('POST', '/api/collections/templates/records', { token: A, body: { title: LEAN, description: lean.description, goal: lean.goal, ai_nodes: lean.ai_nodes, nodes: [], edges: [], visibility: 'personal' } });
    expect(kopie.status === 200, `Anna si Lean Canvas zkopírovala mezi své šablony (${kopie.status})`);
    const bmc = pred.find((t) => t.title === BMC);
    const uprava = await stara.api('PATCH', `/api/collections/templates/records/${bmc.id}`, { token: A, body: { description: 'Náš vlastní popis BMC (upravil admin)' } });
    expect(uprava.status === 200 && uprava.json.description === 'Náš vlastní popis BMC (upravil admin)', `admin si upravil popis systémové šablony BMC (${uprava.status})`);
    return { kopieId: kopie.json && kopie.json.id, staryPopis: lean.description, bmcUzly: j(bmc.ai_nodes) };
  });
  {
    const lean = u.po.find((t) => t.title === LEAN), bmc = u.po.find((t) => t.title === BMC);
    expect(!chybyMigraci(u.logy), `start bez chyb migrací (${(u.logy.match(/.*(migrat|Error|panic).*/gi) || []).slice(0, 3).join(' | ') || 'log čistý'})`);
    expect(lean && /Maurya/.test(lean.description) && novyLeanEn(lean), 'Lean Canvas přepsán vlastními texty + autor');
    expect(bmc && bmc.description === 'Náš vlastní popis BMC (upravil admin)' && j(bmc.ai_nodes) === u.stav.bmcUzly, `BMC s popisem upraveným adminem migrace NEPŘEPSALA (${(bmc?.description || '').slice(0, 40)})`);
    expect(/canvas_texty_vlastni: šablona „Business Model Canvas“ je upravená adminem — ponechána/.test(u.logy), 'migrace zalogovala ponechanou šablonu');
    expect(u.po.length === u.pred.length, `počet systémových šablon stejný (${u.pred.length} → ${u.po.length})`);
    const swot = u.pred.find((t) => t.title === 'SWOT analýza'), swotPo = u.po.find((t) => t.title === 'SWOT analýza');
    expect(swot && swotPo && j(swot.ai_nodes) === j(swotPo.ai_nodes) && swot.updated === swotPo.updated, 'ostatní šablony nedotčené');
    const k = (await u.nova.api('GET', `/api/collections/templates/records/${u.stav.kopieId}`, { token: u.A })).json || {};
    expect(k.id === u.stav.kopieId && k.description === u.stav.staryPopis && !!k.owner, `osobní kopie uživatele beze změny (${(k.description || '').slice(0, 40)})`);
  }
  await u.uklid();

  console.log(`== 2. upgrade z ${STARY}: admin upravil BLOKY obou šablon, popisy nechal ==`);
  u = await upgrade('bloky', STARY, async (stara, A, pred) => {
    const b = await upravUzly(stara, A, pred.find((t) => t.title === BMC), 'ADMIN: náš byznys model');
    const l = await upravUzly(stara, A, pred.find((t) => t.title === LEAN), 'ADMIN: náš startup');
    expect(b.status === 200 && /ADMIN: náš byznys model/.test(j(b.uzly)) && l.status === 200 && /ADMIN: náš startup/.test(j(l.uzly)), `admin si upravil bloky obou systémových šablon (${b.status}, ${l.status})`);
    return { bmcUzly: j(b.uzly), leanUzly: j(l.uzly) };
  });
  {
    const lean = u.po.find((t) => t.title === LEAN), bmc = u.po.find((t) => t.title === BMC);
    expect(!chybyMigraci(u.logy), 'start bez chyb migrací');
    expect(bmc && j(bmc.ai_nodes) === u.stav.bmcUzly, `bloky BMC upravené adminem upgrade NEPŘEPSAL (S8-02) (${j(bmc?.ai_nodes).slice(0, 60)})`);
    expect(lean && j(lean.ai_nodes) === u.stav.leanUzly, `bloky Lean Canvas upravené adminem upgrade NEPŘEPSAL (S8-02) (${j(lean?.ai_nodes).slice(0, 60)})`);
    expect(bmc && /Osterwalder/.test(bmc.description) && /CC BY-SA/.test(bmc.description_en), `popis BMC, na který admin nesáhl, dostal autory rámce (${(bmc?.description || '').slice(0, 70)})`);
    expect(lean && /Maurya/.test(lean.description) && /CC BY-SA/.test(lean.description) && novyLeanEn(lean), 'popis a anglické bloky Lean Canvas, na které admin nesáhl, mají nové znění');
    expect((u.logy.match(/canvas_keep_admin_edits: template "(Business Model Canvas|Lean Canvas)" was edited by the admin — kept blocks/g) || []).length === 2, 'upgrade zalogoval obě šablony s ponechanými bloky (S8-02)');
  }
  await u.uklid();

  console.log(`== 3. upgrade z ${STARY}: admin dal před popis Lean Canvas vlastní větu (konec nechal), BMC nechal ==`);
  const VLASTNI = 'Používáme na každý nový produkt. 9 bloků pro rychlé ověření startupu/produktu (Ash Maurya).';
  u = await upgrade('predpona', STARY, async (stara, A, pred) => {
    const r = await stara.api('PATCH', `/api/collections/templates/records/${pred.find((t) => t.title === LEAN).id}`, { token: A, body: { description: VLASTNI } });
    expect(r.status === 200 && r.json.description === VLASTNI, `admin si doplnil popis Lean Canvas (${r.status})`);
    return {};
  });
  {
    const lean = u.po.find((t) => t.title === LEAN), bmc = u.po.find((t) => t.title === BMC);
    expect(lean && lean.description === VLASTNI, `popis Lean Canvas upravený adminem upgrade NEPŘEPSAL (S8-02) (${(lean?.description || '').slice(0, 50)})`);
    expect(novyLeanEn(lean) && !/Top 3 funkce|3 hlavní funkce, které řeší problém/.test(j(lean.ai_nodes)) && j(lean.ai_nodes) !== j(u.pred.find((t) => t.title === LEAN).ai_nodes), 'bloky Lean Canvas, na které admin nesáhl, mají nové znění');
    expect(bmc && /Osterwalder/.test(bmc.description) && /CC BY-SA/.test(bmc.description_en), 'nedotčený BMC dostal autory rámce');
    expect(!/Business Model Canvas/.test((u.logy.match(/canvas_(keep_admin_edits|texty_vlastni):.*/g) || []).join('\n')), 'o nedotčeném BMC upgrade netvrdí, že ho upravil admin');
  }
  await u.uklid();

  if (!PO_MIGRACI) {
    H.preskoceno('4. upgrade (instance, kde migrace 1793956000 už proběhla) — KB_PO_MIGRACI_IMAGE není; např. kb-app:20261112');
  } else {
    console.log(`== 4. upgrade z ${PO_MIGRACI} (1793956000 už proběhla): admin upravil bloky BMC až po ní ==`);
    u = await upgrade('pozde', PO_MIGRACI, async (stara, A, pred) => {
      const bmc = pred.find((t) => t.title === BMC);
      expect(/Osterwalder/.test(bmc.description) && novyLeanEn(pred.find((t) => t.title === LEAN)), 'výchozí vydání už má nové texty');
      const b = await upravUzly(stara, A, bmc, 'ADMIN: po upgradu');
      expect(b.status === 200, `admin si upravil bloky BMC (${b.status})`);
      return { bmcUzly: j(b.uzly) };
    });
    const bez = (t) => { const { updated, ...zbytek } = t; return zbytek; };
    const pred = (await Promise.resolve(u.pred)).map((t) => (t.title === BMC ? { ...t, ai_nodes: JSON.parse(u.stav.bmcUzly) } : t));
    expect(!chybyMigraci(u.logy), 'start bez chyb migrací, i když má nová migrace starší razítko než už proběhlé');
    expect(!/canvas_keep_admin_edits:/.test(u.logy), 'pojistka na instanci po migraci nic nepřepisuje ani neloguje');
    expect([BMC, LEAN].every((n) => j(bez(u.po.find((t) => t.title === n))) === j(bez(pred.find((t) => t.title === n)))), 'obě šablony včetně úpravy admina beze změny');
    await u.uklid();
  }

  console.log('== čerstvá instalace nového image ==');
  const cista = await H.startInstance({ slug: 'upg-canvas-cista', env });
  await cista.register('a@example.com', { name: 'Anna' });
  const C = await cista.login('a@example.com');
  const sablony = await sys(cista, C);
  const logyC = cista.logs(200);
  expect(novyLeanEn(sablony.find((t) => t.title === LEAN)) && /Osterwalder/.test(sablony.find((t) => t.title === BMC).description), 'čerstvá instance má nové texty ze seedu');
  expect(!/canvas_keep_admin_edits:/.test(logyC) && !chybyMigraci(logyC), 'pojistka na čerstvé instanci nic nedělá');
}, { nazev: 'UPGRADE-CANVAS-TEXTY' });
