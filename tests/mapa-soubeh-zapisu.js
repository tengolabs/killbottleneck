// Concurrent writes into ONE map must not overwrite each other silently (code analysis 4,
// finding S3-01). API suite, no AI.
//
// Before: every writer did "load the map → change → save the whole record"; two writers that
// overlapped both got 200 and one change vanished (two people ticking their steps, the
// editor's autosave against a tick, two parallel v1/MCP update_node, a share toggle against
// a status change). `base_updated` was compared before the write, not at it.
//
// What is measured (races are REPEATED, never a single attempt):
//   1) two collaborators tick their own steps at the same moment, 50 pairs      → loss 0
//   2) 24 parallel ticks of 24 steps → 24 stay done, 24 different versions
//   3) two v1 update_node with the SAME base_updated, 50 pairs                  → never
//      "200 and gone": the second one gets 409 (it carried a stale version)
//   4) the editor's PATCH (with base_updated) against a tick, small and big map → every
//      200 is really stored; the overlapped stale PATCH gets 409
//   5) a tick against a deadline request, a share toggle and a rename (other columns):
//      both sides stay; the tick is logged once, under the person who made it
//   6) the same on a big map (400 steps with long descriptions), and the time of one tick
//   7) nothing changed for sequential use: a stale version is 409, a fresh one 200,
//      a PATCH without base_updated still goes through.
//
// Run: KB_TEST_IMAGE=<image> node product/tests/mapa-soubeh-zapisu.js
const H = require('./_harness');
const { expect, sleep } = H;

const POPIS = 'Připravit podklady pro výrobu, ověřit rozměry u zákazníka, objednat materiál a dohodnout termín montáže. ';
function mapa(title, n, popis) {
  const nodes = [{ id: 'R', type: 'apexNode', position: { x: 0, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } }];
  const edges = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `k${i}`, type: 'goalNode', position: { x: (i % 20) * 260, y: 300 + Math.floor(i / 20) * 200 },
      data: Object.assign({ title: `Krok ${i}`, status: 'todo', nodeType: 'normal' }, popis ? { description: POPIS.repeat(14).slice(0, 1500) } : {}) });
    edges.push({ id: `e${i}`, source: 'R', target: `k${i}` });
  }
  return { title, nodes, edges };
}

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'mapa-soubeh', env: { KB_UVODNI_MAPA: 0, KB_NOTIFY_DAILY_CAP: 5000 } }); // the suite counts rule notifications (default cap: 50 a day)
  const ST = await inst.superuser();
  const ucet = async (email) => {
    const r = await inst.register(email);
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    return { id: r.json.id, email, token: await inst.login(email) };
  };
  const anna = await ucet('anna@t.cz');   // owner (first account = administrator)
  const bob = await ucet('bob@t.cz');
  const cyril = await ucet('cyril@t.cz');
  const zaloz = async (title, n, popis) => {
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: anna.token, body: Object.assign(mapa(title, n, popis), { owner: anna.id, owner_email: anna.email }) });
    if (r.status !== 200) throw new Error(`mapa ${title}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    for (const kdo of [bob, cyril]) {
      const s = await inst.api('POST', '/api/kb/share', { token: anna.token, body: { action: 'share', mapId: r.json.id, email: kdo.email, permission: 'edit', quiet: true } });
      if (s.status !== 200) throw new Error(`sdílení: ${s.status} ${JSON.stringify(s.json)}`);
    }
    return r.json.id;
  };
  const nacti = async (id) => (await inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: ST })).json;
  const stav = (rec, nodeId) => ((rec.nodes.find((n) => n.id === nodeId) || {}).data || {}).status;
  const tick = (kdo, mapId, nodeId, status = 'done') => inst.api('POST', '/api/kb/node-status', { token: kdo.token, body: { mapId, nodeId, status } });
  // a key may write 30× a minute → a fresh key for every batch of writes
  let klic = '';
  const novyKlic = async () => { klic = (await inst.api('POST', '/api/kb/api-keys', { token: anna.token, body: { label: 'soubeh', scope: 'read_write' } })).json.token; if (!klic) throw new Error('API klíč nevznikl'); };
  await novyKlic();
  expect(!!klic, 'API klíč vlastníka');
  const v1 = (method, path, body) => inst.api(method, `/api/kb/v1${path}`, { bearer: klic, body });

  const M = await zaloz('Malá', 150, false);

  console.log('== 1) dva lidé odškrtnou každý svůj krok ve stejný okamžik, 50 dvojic ==');
  let obe200 = 0, ztrata = 0, jine = 0;
  for (let i = 0; i < 50; i++) {
    const [a, b] = await Promise.all([tick(bob, M, `k${2 * i}`), tick(cyril, M, `k${2 * i + 1}`)]);
    if (a.status === 200 && b.status === 200) obe200++; else jine++;
    const rec = await nacti(M);
    if ((a.status === 200 && stav(rec, `k${2 * i}`) !== 'done') || (b.status === 200 && stav(rec, `k${2 * i + 1}`) !== 'done')) ztrata++;
  }
  console.log(`     50 dvojic: obě 200 = ${obe200}, jiný výsledek = ${jine}, dvojic se ztrátou = ${ztrata}`);
  expect(ztrata === 0, `žádné odškrtnutí s odpovědí 200 nezmizelo (dvojic se ztrátou ${ztrata} z 50)`);
  expect(obe200 === 50, `obě odškrtnutí prošla ve všech 50 dvojicích — řadí se, neodmítají (${obe200})`);
  let rec = await nacti(M);
  expect(rec.nodes.filter((n) => (n.data || {}).status === 'done').length === 100, `v mapě je hotových všech 100 kroků (${rec.nodes.filter((n) => (n.data || {}).status === 'done').length})`);
  const zmeny = async (mapId) => (await inst.api('GET', `/api/collections/map_changes/records?perPage=500&filter=${encodeURIComponent(`map="${mapId}" && field="status"`)}`, { token: ST })).json.items || [];
  let zm = await zmeny(M);
  expect(zm.length === 100 && zm.filter((z) => z.actor_email === bob.email).length === 50, `záznam změn: 100 řádků, každé odškrtnutí jednou a pod tím, kdo ho udělal (${zm.length}, Bob ${zm.filter((z) => z.actor_email === bob.email).length})`);

  console.log('== 2) 24 paralelních odškrtnutí ==');
  const M2 = await zaloz('Čtyřiadvacet', 24, false);
  const vys = await Promise.all(Array.from({ length: 24 }, (_, i) => tick(anna, M2, `k${i}`)));
  rec = await nacti(M2);
  const hotovo = rec.nodes.filter((n) => (n.data || {}).status === 'done').length;
  const verze = new Set(vys.map((r) => (r.json || {}).updated));
  console.log(`     odpovědí 200 = ${vys.filter((r) => r.status === 200).length} / 24, hotových kroků = ${hotovo}, různých verzí = ${verze.size}`);
  expect(vys.every((r) => r.status === 200) && hotovo === 24, `24 odpovědí 200 a 24 hotových kroků (${vys.filter((r) => r.status === 200).length}, ${hotovo})`);
  expect(verze.size === 24, `každý zápis má vlastní verzi \`updated\` — žádné dvě stejné (${verze.size})`);

  console.log('== 3) dva v1 update_node se STEJNÝM base_updated, 50 dvojic ==');
  const M3 = await zaloz('Agent', 100, false);
  let tiche = 0, s409 = 0, obe = 0;
  for (let i = 0; i < 50; i++) {
    if (i % 10 === 0) await novyKlic();
    const base = (await v1('GET', `/maps/${M3}`)).json.updated;
    const [a, b] = await Promise.all([
      v1('POST', `/maps/${M3}/nodes/k${2 * i}`, { status: 'done', base_updated: base }),
      v1('POST', `/maps/${M3}/nodes/k${2 * i + 1}`, { status: 'done', base_updated: base }),
    ]);
    rec = await nacti(M3);
    if ((a.status === 200 && stav(rec, `k${2 * i}`) !== 'done') || (b.status === 200 && stav(rec, `k${2 * i + 1}`) !== 'done')) tiche++;
    if (a.status === 200 && b.status === 200) obe++;
    if ([a.status, b.status].sort().join() === '200,409') s409++;
  }
  console.log(`     50 dvojic: 200+409 = ${s409}, obě 200 = ${obe}, „200 a zmizelo" = ${tiche}`);
  expect(tiche === 0, `žádný update_node s odpovědí 200 nezmizel (${tiche} z 50 dvojic)`);
  expect(s409 === 50, `druhý zápis se stejnou verzí dostane 409 i při překryvu — v každé dvojici právě jeden (${s409})`);
  rec = await nacti(M3);
  expect(rec.nodes.filter((n) => (n.data || {}).status === 'done').length === 50, `hotových kroků = počet odpovědí 200 (${rec.nodes.filter((n) => (n.data || {}).status === 'done').length})`);

  const patchXtick = async (mapId, kol, odstupy, popis) => {
    let ztracenTick = 0, ztracenaUprava = 0, p409 = 0, p200 = 0, t200 = 0;
    for (let i = 0; i < kol; i++) {
      const pred = await nacti(mapId);
      const nodes = pred.nodes.map((n) => (n.id === 'k0' ? Object.assign({}, n, { data: Object.assign({}, n.data, { title: `Annina úprava ${i}` }) }) : n));
      const odstup = odstupy[i % odstupy.length];
      const patch = () => inst.api('PATCH', `/api/collections/goalmaps/records/${mapId}`, { token: anna.token, body: { nodes, base_updated: pred.updated } });
      const t = () => tick(bob, mapId, `k${i + 1}`);
      let pp, pt;
      if (odstup >= 0) { pt = t(); if (odstup) await sleep(odstup); pp = patch(); } else { pp = patch(); await sleep(-odstup); pt = t(); }
      const [rp, rt] = await Promise.all([pp, pt]);
      const po = await nacti(mapId);
      if (rt.status === 200) { t200++; if (stav(po, `k${i + 1}`) !== 'done') ztracenTick++; }
      if (rp.status === 200) { p200++; if (((po.nodes.find((n) => n.id === 'k0') || {}).data || {}).title !== `Annina úprava ${i}`) ztracenaUprava++; }
      if (rp.status === 409) p409++;
    }
    console.log(`     ${popis}: ${kol} kol — odškrtnutí 200 = ${t200}, PATCH 200 = ${p200}, PATCH 409 = ${p409}, ztracené odškrtnutí = ${ztracenTick}, ztracená úprava = ${ztracenaUprava}`);
    return { ztracenTick, ztracenaUprava, p409, p200, t200 };
  };

  console.log('== 4) PATCH editoru (s base_updated) proti odškrtnutí ==');
  const M4 = await zaloz('Editor', 60, false);
  let x = await patchXtick(M4, 30, [0, 0, 3, -3, 8, -150], 'malá mapa');
  expect(x.ztracenTick === 0 && x.ztracenaUprava === 0, `malá mapa: nic s odpovědí 200 nezmizelo (odškrtnutí ${x.ztracenTick}, úprava ${x.ztracenaUprava})`);
  expect(x.t200 === 30, `malá mapa: všechna odškrtnutí prošla (${x.t200}/30)`);
  expect(x.p409 > 0, `malá mapa: překrytý zastaralý PATCH dostal 409 (${x.p409}×)`);
  expect(x.p200 >= 5, `malá mapa: PATCH, který doběhl dřív, než odškrtnutí začalo, prošel (${x.p200}×) — a odškrtnutí po něm také`);

  console.log('== 5) odškrtnutí proti zápisům do JINÝCH sloupců a jiným řádkovým akcím ==');
  const M5 = await zaloz('Sloupce', 80, false);
  // old data straight in the database (every API path normalizes): the stored graph loses one field of the
  // normalized shape, as on maps saved before the field existed
  const sql = (q) => inst.exec(`sqlite3 /app/pb_data/data.db '${q}'`);
  sql(`UPDATE goalmaps SET nodes = (SELECT json_group_array(json_remove(j.value, "$.data.automationNote")) FROM json_each(goalmaps.nodes) j) WHERE id = "${M5}"`);
  {
    // the stored graph of this map is NOT in the normalized shape (created with the minimum of
    // node data, like older / imported maps) — a rename must still not count as a graph change
    const ulozene = Object.keys((((await nacti(M5)).nodes.find((n) => n.id === 'k70') || {}).data) || {}).length;
    const N = await zaloz('Normalizace', 5, false);
    const n0 = await nacti(N);
    const p1 = await inst.api('PATCH', `/api/collections/goalmaps/records/${N}`, { token: anna.token, body: { nodes: n0.nodes } });
    const n1 = await nacti(N);
    const p2 = await inst.api('PATCH', `/api/collections/goalmaps/records/${N}`, { token: anna.token, body: { nodes: n1.nodes } });
    const n2 = await nacti(N);
    const normalizovane = Object.keys(((n1.nodes.find((n) => n.id === 'k1') || {}).data) || {}).length;
    expect(p1.status === 200 && p2.status === 200 && JSON.stringify(n1.nodes) === JSON.stringify(n2.nodes), 'normalizace grafu je idempotentní (druhé uložení téhož grafu nic nezmění)');
    expect(normalizovane > ulozene, `předpoklad: uložený graf testovací mapy není v normalizovaném tvaru (${ulozene} polí uzlu proti ${normalizovane})`);
    const pr = await inst.api('PATCH', `/api/collections/goalmaps/records/${M5}`, { token: anna.token, body: { title: 'Jen název' } });
    const n3 = await nacti(M5);
    expect(pr.status === 200 && Object.keys(((n3.nodes.find((n) => n.id === 'k70') || {}).data) || {}).length === ulozene, `PATCH bez uzlů (přejmenování) uložený graf nepřepisuje — pro kontrolu souběhu to není „změna grafu" (${pr.status})`);
  }
  // deadlines for the requests
  await novyKlic();
  let base = (await v1('GET', `/maps/${M5}`)).json.updated;
  for (let i = 0; i < 20; i++) {
    const r = await v1('POST', `/maps/${M5}/nodes/k${40 + i}`, { deadline: '2027-01-15', base_updated: base });
    if (r.status !== 200) throw new Error(`termín: ${r.status} ${JSON.stringify(r.json)}`);
    base = r.json.updated;
  }
  let zt = 0, zz = 0, zs = 0, zn = 0, chyb = 0;
  for (let i = 0; i < 20; i++) {
    const access = i % 2 ? 'read' : 'edit';
    const [a, b, c, d] = await Promise.all([
      tick(bob, M5, `k${i}`),
      inst.api('POST', '/api/kb/deadline-requests', { token: cyril.token, body: { action: 'request', mapId: M5, nodeId: `k${40 + i}`, date: '2027-02-01', note: 'nestíhám' } }),
      inst.api('POST', '/api/kb/share', { token: anna.token, body: { action: 'set_team_access', mapId: M5, access } }),
      inst.api('PATCH', `/api/collections/goalmaps/records/${M5}`, { token: anna.token, body: { title: `Sloupce ${i}` } }),
    ]);
    if (![a, b, c, d].every((r) => r.status === 200)) { chyb++; console.log(`     kolo ${i}: ${[a, b, c, d].map((r) => r.status).join(',')}`); }
    rec = await nacti(M5);
    if (a.status === 200 && stav(rec, `k${i}`) !== 'done') zt++;
    if (b.status === 200 && ((rec.nodes.find((n) => n.id === `k${40 + i}`) || {}).data || {}).deadlineChangeWanted !== '2027-02-01') zz++;
    if (c.status === 200 && rec.team_access !== access) zs++;
    if (d.status === 200 && rec.title !== `Sloupce ${i}`) zn++;
  }
  console.log(`     20 kol po 4 souběžných zápisech: ztracené odškrtnutí = ${zt}, žádost o termín = ${zz}, týmový přístup = ${zs}, název = ${zn}, nečekaný status = ${chyb}`);
  expect(zt === 0 && zz === 0, `odškrtnutí ani žádost o termín se neztratily (${zt}, ${zz})`);
  expect(zs === 0 && zn === 0, `změna sdílení ani přejmenování se neztratily a samy nic nepřepsaly (${zs}, ${zn})`);
  expect(chyb === 0, `všechny čtyři zápisy vždy 200 — přejmenování se grafu netýká, takže 409 nedostane ani při překryvu s odškrtnutím (${chyb})`);
  zm = await zmeny(M5);
  expect(zm.length === 20 && zm.every((z) => z.actor_email === bob.email), `záznam změn: 20 odškrtnutí, všechna pod Bobem — souběžné přejmenování si je nepřipsalo (${zm.length}, cizích ${zm.filter((z) => z.actor_email !== bob.email).length})`);
  const sdileni = ((await inst.api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${M5}"`)}`, { token: ST })).json.items || []).map((r) => r.email).sort();
  rec = await nacti(M5);
  expect(JSON.stringify(sdileni) === JSON.stringify([bob.email, cyril.email]) && JSON.stringify((rec.shared_with || []).slice().sort()) === JSON.stringify([bob.email, cyril.email]),
    `sdílení mapy (řádky i zrcadlo) zůstalo, jak bylo (${sdileni.join(', ')})`);

  console.log('== 5b) callback agenta proti odškrtnutí člověka, 15 kol ==');
  // a run is set up directly (the dispatch to a webhook is not what is measured here)
  const crypto = require('crypto');
  let zc = 0, zh = 0, c200 = 0;
  for (let i = 0; i < 15; i++) {
    const token = 'kbr_' + crypto.randomBytes(20).toString('hex');
    const run = await inst.api('POST', '/api/collections/agent_runs/records', { token: ST, body: { agent_name: 'test', map: M5, node_id: `k${60 + i}`, node_title: `Krok ${60 + i}`, status: 'running',
      started: new Date().toISOString().replace('T', ' '), triggered_by: 'system', attempt: 1, depth: 0, token_hash: crypto.createHash('sha256').update(token).digest('hex') } });
    if (run.status !== 200) throw new Error(`běh agenta: ${run.status} ${JSON.stringify(run.json)}`);
    const [a, b] = await Promise.all([
      inst.api('POST', '/api/kb/agent-callback', { body: { run_id: run.json.id, run_token: token, status: 'done', result: 'hotovo' } }),
      tick(bob, M5, `k${20 + i}`),
    ]);
    rec = await nacti(M5);
    if (a.status === 200) { c200++; if (stav(rec, `k${60 + i}`) !== 'done') zc++; }
    if (b.status === 200 && stav(rec, `k${20 + i}`) !== 'done') zh++;
    const stavBehu = (await inst.api('GET', `/api/collections/agent_runs/records/${run.json.id}`, { token: ST })).json.status;
    if (stavBehu === 'done' && stav(rec, `k${60 + i}`) !== 'done') zc++;
  }
  console.log(`     15 kol: callback 200 = ${c200}, krok agenta „hotovo" ztracen = ${zc}, odškrtnutí člověka ztraceno = ${zh}`);
  expect(c200 === 15 && zc === 0 && zh === 0, `callback agenta i odškrtnutí člověka zůstaly v mapě (callback 200: ${c200}/15, ztráty ${zc}, ${zh})`);

  console.log('== 5c) zápis, který NIC nemění, proti odškrtnutí kolegy: pravidlo a oznámení právě jednou ==');
  // Security review 11 Nov 2026: a no-op update_node whose save overlapped a colleague's tick took over the
  // colleague's graph — and then ran the rules and notifications for THEIR change a second time.
  const MR = await zaloz('Pravidlo', 260, true);
  const pravidlo = (await inst.api('POST', '/api/collections/automation_rules/records', { token: ST, body: { map: MR, enabled: true, name: 'Hotovo → oznámit',
    trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'notify', to: 'map_owner', message: 'krok dokončen' }], created_by: anna.email } })).json;
  if (!pravidlo.id) throw new Error(`pravidlo: ${JSON.stringify(pravidlo)}`);
  let prekryvu = 0, zt5c = 0;
  for (let i = 0; i < 40; i++) {
    if (i % 12 === 0) await novyKlic();
    const b0 = (await v1('GET', `/maps/${MR}`)).json.updated;
    const noop = () => v1('POST', `/maps/${MR}/nodes/k250`, { status: 'todo', base_updated: b0 }); // k250 is "todo" already
    const odstup = [0, 10, 25, 40][i % 4];
    const pn = noop();
    if (odstup) await sleep(odstup);
    const [rn, rt] = await Promise.all([pn, tick(bob, MR, `k${i}`)]);
    if (rn.status === 200 && rt.status === 200) prekryvu++;
    if (rt.status === 200 && stav(await nacti(MR), `k${i}`) !== 'done') zt5c++;
  }
  const behy = (await inst.api('GET', `/api/collections/rule_runs/records?perPage=500&filter=${encodeURIComponent(`rule="${pravidlo.id}"`)}`, { token: ST })).json.items || [];
  const naUzel = {};
  for (const b of behy) naUzel[b.node_id] = (naUzel[b.node_id] || 0) + 1;
  const dvakrat = Object.keys(naUzel).filter((k) => naUzel[k] > 1);
  const logy = await zmeny(MR);
  console.log(`     40 kol (obě 200 v ${prekryvu}): běhů pravidla = ${behy.length}, uzlů se dvěma běhy = ${dvakrat.length}, řádků záznamu změn = ${logy.length}, ztracených odškrtnutí = ${zt5c}`);
  expect(zt5c === 0, `odškrtnutí se neztratilo (${zt5c})`);
  expect(behy.length === 40 && dvakrat.length === 0, `pravidlo běželo pro každé odškrtnutí právě jednou (${behy.length} běhů, dvakrát u ${dvakrat.length} kroků)`);
  expect(logy.length === 40 && logy.every((z) => z.actor_email === bob.email), `záznam změn: 40 řádků, všechny pod Bobem (${logy.length}, cizích ${logy.filter((z) => z.actor_email !== bob.email).length})`);

  console.log('== 5e) pravidlo, které do mapy ZAPISUJE, proti odškrtnutí člověkem: jednou, bez „failed", nic ztraceno ==');
  // Decision 11 Nov 2026: a rule whose write is refused (the map changed meanwhile) is repeated once on a fresh load.
  const MP = await zaloz('Pravidlo zapisuje', 260, true);
  const prav2 = (await inst.api('POST', '/api/collections/automation_rules/records', { token: ST, body: { map: MP, enabled: true, name: 'Hotovo → předat a oznámit',
    trigger: { type: 'node_status_changed', status: 'done' }, conditions: [],
    actions: [{ type: 'set_owner', owner: cyril.email }, { type: 'notify', to: 'map_owner', message: 'PRAVIDLO-5E' }], created_by: anna.email } })).json;
  if (!prav2.id) throw new Error(`pravidlo: ${JSON.stringify(prav2)}`);
  let zt5e = 0, bezOwnera = 0;
  const odmitnuto5e = [];  // answers other than 200 — a refused write has no rule run, the numbers below must say so
  for (let i = 0; i < 40; i++) {
    if (i % 12 === 0) await novyKlic();
    const b0 = (await v1('GET', `/maps/${MP}`)).json.updated;
    // Anna's write triggers the rule (the rule then writes the owner); Bob ticks another step so that his write lands in between
    const pa = v1('POST', `/maps/${MP}/nodes/k${i}`, { status: 'done', base_updated: b0 });
    await sleep([20, 50, 80, 110][i % 4]);
    const [ra, rb] = await Promise.all([pa, tick(bob, MP, `k${100 + i}`)]);
    if (ra.status !== 200) odmitnuto5e.push(`k${i}:${ra.status}`);
    if (rb.status !== 200) odmitnuto5e.push(`k${100 + i}:${rb.status}`);
    const pe = await nacti(MP);
    if (rb.status === 200 && stav(pe, `k${100 + i}`) !== 'done') zt5e++;
    if (ra.status === 200 && (stav(pe, `k${i}`) !== 'done' || ((pe.nodes.find((n) => n.id === `k${i}`) || {}).data || {}).owner !== cyril.email)) bezOwnera++;
  }
  const behy2 = (await inst.api('GET', `/api/collections/rule_runs/records?perPage=500&filter=${encodeURIComponent(`rule="${prav2.id}"`)}`, { token: ST })).json.items || [];
  const failed = behy2.filter((b) => b.status === 'failed');
  const poctyUzlu = {};
  for (const b of behy2.filter((x) => x.status === 'ok')) poctyUzlu[b.node_id] = (poctyUzlu[b.node_id] || 0) + 1;
  const ozn = ((await inst.api('GET', `/api/collections/notifications/records?perPage=500&filter=${encodeURIComponent(`user="${anna.id}" && type="rule_notice"`)}`, { token: ST })).json.items || []).filter((n) => /PRAVIDLO-5E/.test(n.text || ''));
  const oznPocet = ozn.reduce((a, n) => a + (Number(n.count) || 1), 0);
  console.log(`     40 kol: běhů ${behy2.length} (ok ${behy2.length - failed.length}, failed ${failed.length}${failed[0] ? ': ' + String(failed[0].detail).slice(0, 80) : ''}), kroků bez akce pravidla = ${bezOwnera}, ztracených odškrtnutí = ${zt5e}, oznámení pravidla = ${oznPocet}, odpovědi jiné než 200 = ${odmitnuto5e.length}${odmitnuto5e.length ? ' (' + odmitnuto5e.join(', ') + ')' : ''}`);
  expect(failed.length === 0, `žádný běh pravidla neskončil „failed" (${failed.length})`);
  // Anna's write carries base_updated: when Bob's tick lands first (seen on a faster machine, 14 Nov 2026), the server
  // refuses hers with 409 — that is the correct answer, and such a step has no rule run. Only that refusal is
  // tolerated, and only a few of them, so that the rounds still overlap.
  const jen409Anny = odmitnuto5e.every((o) => /^k\d{1,2}:409$/.test(o));
  expect(jen409Anny && odmitnuto5e.length <= 5, `odmítnutý je nanejvýš zápis přes API se starým base_updated (409), a to zřídka (${odmitnuto5e.join(', ') || 'žádný'})`);
  const cekano5e = 80 - odmitnuto5e.length;
  expect(behy2.length === cekano5e && Object.keys(poctyUzlu).length === cekano5e && Object.values(poctyUzlu).every((n) => n === 1), `pravidlo proběhlo pro každý dokončený krok právě jednou (${behy2.length} běhů na ${Object.keys(poctyUzlu).length} kroků, čekáno ${cekano5e})`);
  expect(bezOwnera === 0 && zt5e === 0, `akce pravidla je v mapě u všech kroků a žádné odškrtnutí se neztratilo (${bezOwnera}, ${zt5e})`);
  expect(oznPocet === cekano5e, `oznámení pravidla právě jedno na běh — žádné dvojí (${oznPocet} z ${cekano5e})`);

  console.log('== 5d) sloupec sdílení prázdný jako null: zápis téže prázdné hodnoty nepřepíše souběžné sdílení ==');
  let zt5d = 0, kol5d = 0, nullu = 0;
  for (let i = 0; i < 8; i++) {
    const r0 = await inst.api('POST', '/api/collections/goalmaps/records', { token: anna.token, body: Object.assign(mapa(`Null ${i}`, 300, true), { owner: anna.id, owner_email: anna.email }) });
    const id = r0.json.id;
    sql(`UPDATE goalmaps SET shared_with = NULL, shared_with_edit = NULL, shared_with_work = NULL WHERE id = "${id}"`); // a row from before the columns existed
    if (sql(`SELECT COUNT(*) FROM goalmaps WHERE id = "${id}" AND shared_with IS NULL`).trim() === '1') nullu++;
    const pp = inst.api('PATCH', `/api/collections/goalmaps/records/${id}`, { token: anna.token, body: { title: `Null ${i} přejmenováno`, shared_with: [], shared_with_edit: [], shared_with_work: [] } });
    await sleep([5, 15, 30, 45][i % 4]);
    const ps = inst.api('POST', '/api/kb/share', { token: anna.token, body: { action: 'share', mapId: id, email: bob.email, permission: 'read', quiet: true } });
    const [rp, rs] = await Promise.all([pp, ps]);
    const po5 = await nacti(id);
    if (rp.status === 200 && rs.status === 200) { kol5d++; if (!(po5.shared_with || []).includes(bob.email) || po5.title !== `Null ${i} přejmenováno`) zt5d++; }
  }
  console.log(`     8 kol (obě 200 v ${kol5d}, sloupec NULL v ${nullu}): ztracené sdílení nebo název = ${zt5d}`);
  expect(kol5d === 8 && nullu === 8 && zt5d === 0, `sdílení přidané během PATCHe, který posílá tutéž prázdnou hodnotu, v mapě zůstalo (${zt5d} ztrát v ${kol5d} kolech)`);

  console.log('== 6) velká mapa (400 kroků s dlouhými popisy) ==');
  const V = await zaloz('Velká', 400, true);
  const casy = [];
  for (let i = 0; i < 6; i++) { const t0 = Date.now(); const r = await tick(bob, V, `k${300 + i}`); casy.push(Date.now() - t0); if (r.status !== 200) throw new Error(`tick: ${r.status}`); }
  console.log(`     jedno odškrtnutí na velké mapě: ${casy.join(', ')} ms`);
  let vz = 0, v200 = 0;
  for (let i = 0; i < 20; i++) {
    const [a, b] = await Promise.all([tick(bob, V, `k${2 * i}`), tick(cyril, V, `k${2 * i + 1}`)]);
    if (a.status === 200 && b.status === 200) v200++;
    rec = await nacti(V);
    if ((a.status === 200 && stav(rec, `k${2 * i}`) !== 'done') || (b.status === 200 && stav(rec, `k${2 * i + 1}`) !== 'done')) vz++;
  }
  console.log(`     20 dvojic odškrtnutí: obě 200 = ${v200}, dvojic se ztrátou = ${vz}`);
  expect(vz === 0 && v200 === 20, `velká mapa: 20 dvojic, obě 200 a nic se neztratilo (${v200}, ztráta ${vz})`);
  x = await patchXtick(V, 18, [0, 20, -20, 40, -40, 80], 'velká mapa');
  expect(x.ztracenTick === 0 && x.ztracenaUprava === 0 && x.t200 === 18, `velká mapa, PATCH proti odškrtnutí: nic s odpovědí 200 nezmizelo (odškrtnutí ${x.ztracenTick}, úprava ${x.ztracenaUprava}; odškrtnutí 200: ${x.t200}/18)`);
  expect(x.p409 > 0, `velká mapa: překrytý zastaralý PATCH dostal 409 (${x.p409}×)`);
  expect(Math.max(...casy) < 3000, `jedno odškrtnutí na velké mapě do 3 s (nejdelší ${Math.max(...casy)} ms)`);

  console.log('== 7) postupné použití beze změny ==');
  const M7 = await zaloz('Postupně', 10, false);
  const r0 = await nacti(M7);
  let r = await tick(bob, M7, 'k1');
  expect(r.status === 200 && r.json.updated > r0.updated, `odškrtnutí vrací novou verzi (${r.status})`);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${M7}`, { token: anna.token, body: { nodes: r0.nodes, base_updated: r0.updated } });
  expect(r.status === 409 && /mezitím upravena/.test((r.json || {}).message || ''), `PATCH se starou verzí → 409 se srozumitelnou větou (${r.status} ${(r.json || {}).message})`);
  const r1 = await nacti(M7);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${M7}`, { token: anna.token, body: { nodes: r1.nodes, base_updated: r1.updated } });
  expect(r.status === 200 && r.json.updated > r1.updated, `PATCH s čerstvou verzí → 200 (${r.status})`);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${M7}`, { token: anna.token, body: { nodes: r1.nodes } });
  expect(r.status === 200, `PATCH bez base_updated postupně dál projde (rozhodnuto dřív) (${r.status})`);
  await novyKlic();
  r = await v1('POST', `/maps/${M7}/nodes/k2`, { status: 'done', base_updated: r1.updated });
  expect(r.status === 409, `v1 se starou verzí → 409 (${r.status})`);
  r = await v1('POST', `/maps/${M7}/nodes/k2`, { status: 'done', base_updated: (await v1('GET', `/maps/${M7}`)).json.updated });
  expect(r.status === 200, `v1 s čerstvou verzí → 200 (${r.status})`);
  r = await tick(cyril, M7, 'neexistuje');
  expect(r.status === 404, `neexistující krok → 404 (${r.status})`);
  r = await inst.api('POST', '/api/kb/node-status', { token: bob.token, body: { mapId: 'x'.repeat(15), nodeId: 'k1', status: 'done' } });
  expect(r.status === 404, `neexistující mapa → 404 (${r.status})`);
  // a save that changes nothing in the graph keeps every column byte for byte (the merge copies stored values back)
  const pred = await nacti(M5);
  r = await inst.api('POST', '/api/kb/share', { token: anna.token, body: { action: 'set_team_access', mapId: M5, access: pred.team_access === 'edit' ? 'read' : 'edit' } });
  const po = await nacti(M5);
  const stejne = Object.keys(pred).filter((k) => !['updated', 'team_access'].includes(k)).filter((k) => JSON.stringify(pred[k]) !== JSON.stringify(po[k]));
  expect(r.status === 200 && stejne.length === 0, `zápis jednoho sloupce nezmění žádný jiný (${stejne.join(', ') || 'beze změny'})`);
}, { nazev: 'MAPA-SOUBEH-ZAPISU' });
