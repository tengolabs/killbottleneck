// Upgrade: data from v1.0.1 (KB_STARY_IMAGE, e.g. kb-analyza-4) → the new image over the
// SAME volume. Covers the two migrations of code analysis 4, wave 1:
//   1794393702_share_invites            — pending shares (address without an account) move
//                                         out of the project record and of map_shares
//   1794393800_user_delete_keeps_shared — author relations stop cascading
// What is measured: the start has no migration errors; the live schema (/api/collections)
// really changed; the pending share from the old version no longer grants anything to
// whoever registers the address, the owner still sees it and can send the invitation; the
// share of a registered account is untouched; deleting a member with data made in the OLD
// version keeps what they put into other people's projects; a second start (migrations
// already applied) changes nothing.
// Without KB_STARY_IMAGE the suite is skipped (full regression) — run it on purpose:
//   KB_STARY_IMAGE=kb-analyza-4 KB_TEST_IMAGE=<new> node product/tests/upgrade-chyby4.js
const H = require('./_harness');
const { expect } = H;
const { execSync } = require('child_process');
const STARY = process.env.KB_STARY_IMAGE || '';

const telo = (title) => ({
  title,
  nodes: [
    { id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo', nodeType: 'normal' } },
  ],
  edges: [{ id: 'e1', source: 'R', target: 'n1' }],
});
const den = (posun) => new Date(Date.now() + posun * 86400000).toISOString().slice(0, 10);

H.beh(async () => {
  if (!STARY) {
    H.preskoceno('KB_STARY_IMAGE není; spouštět cíleně: KB_STARY_IMAGE=<obraz minulého vydání>');
    return;
  }
  const env = { KB_UVODNI_MAPA: 0, KB_PURPOSE_ASK: 0, TZ: 'Europe/Prague' };
  const VOL = 'kb-upg-chyby4-data';
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);

  console.log(`== stará verze (${STARY}) ==`);
  const stara = await H.startInstance({ slug: 'upg-chyby4-stara', image: STARY, volume: VOL, env });
  const ids = {};
  for (const j of ['admin', 'vlastnik', 'ctenar', 'kolega', 'odchazejici']) ids[j] = (await stara.register(j + '@up.cz')).json.id;
  const tok = {};
  for (const j of Object.keys(ids)) tok[j] = await stara.login(j + '@up.cz');
  const mapaS = async (kdo, title) => (await stara.api('POST', '/api/collections/goalmaps/records', { token: tok[kdo], body: Object.assign(telo(title), { owner: ids[kdo], owner_email: kdo + '@up.cz' }) })).json;
  const M = await mapaS('vlastnik', 'SDILENA');
  const KM = await mapaS('kolega', 'KOLEGUV');
  let r = await stara.api('POST', '/api/kb/share', { token: tok.vlastnik, body: { action: 'share', mapId: M.id, email: 'ctenar@up.cz', permission: 'read' } });
  r = await stara.api('POST', '/api/kb/share', { token: tok.vlastnik, body: { action: 'share', mapId: M.id, email: 'ceka@up.cz', permission: 'edit' } });
  expect(r.status === 200 && r.json.member.registered === false && r.json.member.pending === undefined, `stará verze: sdílení na adresu bez účtu jako hotové (jinak sada neměří upgrade) (${r.status})`);
  const stST = await stara.superuser();
  const radkyS = ((await stara.api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${M.id}"`)}`, { token: stST })).json.items || []).map((x) => x.email).sort();
  expect(JSON.stringify(radkyS) === JSON.stringify(['ceka@up.cz', 'ctenar@up.cz']), `stará verze: čekající adresa má autorizační řádek (${radkyS.join(', ')})`);
  await stara.api('POST', '/api/kb/share', { token: tok.kolega, body: { action: 'share', mapId: KM.id, email: 'odchazejici@up.cz', permission: 'edit' } });
  const pril = (await stara.api('POST', '/api/collections/node_files/records', { token: tok.odchazejici, body: { map: KM.id, node_id: 'n1', name: 'odkaz-odchazejiciho', url: 'https://example.com/x' } })).json;
  const cas = (await stara.api('POST', '/api/collections/time_entries/records', { token: tok.odchazejici, body: { map: KM.id, node_id: 'n1', label: 'CAS-U-KOLEGY', started: '2026-08-20 08:00:00.000Z', ended: '2026-08-20 09:00:00.000Z' } })).json;
  const tpl = (await stara.api('POST', '/api/collections/templates/records', { token: tok.odchazejici, body: { title: 'TYMOVA-SABLONA', ai_nodes: [{ id: 'n1', title: 'Kořen', parentId: null }] } })).json;
  await stara.api('POST', '/api/kb/calendars/save', { token: tok.admin, body: { name: 'Firemní', kind: 'shared' } });
  const ev = (await stara.api('POST', '/api/kb/events/save', { token: tok.odchazejici, body: { title: 'PORADA', day: den(5), time: '10:00', calendar: 'Firemní', participants: ['kolega@up.cz'] } })).json.event;
  expect(!!pril.id && !!cas.id && !!tpl.id && !!ev, 'stará verze: příloha, čas, šablona a událost odcházejícího v cizím/týmovém');
  const staraCols = (await stara.api('GET', '/api/collections?perPage=200', { token: stST })).json.items;
  expect(!staraCols.some((c) => c.name === 'share_invites') && staraCols.find((c) => c.name === 'node_files').fields.find((f) => f.name === 'owner').cascadeDelete === true,
    'stará verze: kolekce share_invites není a node_files.owner má kaskádu');
  // a rule emptied by hand (= public) — the migration must turn it into the sign-in guard,
  // not into the invalid `… && ()` that kept the instance from starting
  const imgCol = staraCols.find((c) => c.name === 'ai_images');
  r = await stara.api('PATCH', `/api/collections/${imgCol.id}`, { token: stST, body: { viewRule: '' } });
  expect(r.status === 200 && r.json.viewRule === '', `stará verze: ai_images.viewRule ručně vyprázdněno (${r.status})`);
  execSync(`docker rm -f ${stara.name}`, { stdio: 'ignore' });

  console.log('== nová verze nad týmž volume ==');
  let nova = await H.startInstance({ slug: 'upg-chyby4-nova', volume: VOL, env });
  const kontrolaLogu = (inst, co) => {
    const logy = inst.logs(200);
    expect(!/(migrat\w*[^\n]*(error|fail)|panic|TypeError|ReferenceError|no such (column|table))/i.test(logy), `${co}: start bez chyb migrací (${(logy.match(/[^\n]*(error|panic|no such)[^\n]*/i) || [''])[0].slice(0, 160)})`);
  };
  kontrolaLogu(nova, 'první start');
  let ST = await nova.superuser();
  const schema = async () => {
    const cols = (await nova.api('GET', '/api/collections?perPage=200', { token: ST })).json.items;
    const rel = (c, f) => ((cols.find((x) => x.name === c) || {}).fields || []).find((x) => x.name === f) || {};
    const si = cols.find((c) => c.name === 'share_invites');
    expect(!!si && [si.listRule, si.viewRule, si.createRule, si.updateRule, si.deleteRule].every((x) => x === null), 'živé schéma: share_invites existuje a je zamčená (všechna pravidla null)');
    for (const [c, f] of [['node_files', 'owner'], ['time_entries', 'owner'], ['templates', 'owner'], ['events', 'owner'], ['ai_pages', 'user'], ['ai_images', 'user']]) {
      expect(rel(c, f).cascadeDelete === false && rel(c, f).required === false, `živé schéma: ${c}.${f} bez kaskády, nepovinné (${rel(c, f).cascadeDelete}, ${rel(c, f).required})`);
      const col = cols.find((x) => x.name === c) || {};
      const bez = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].filter((k) => col[k] !== null && !(c === 'templates' && (k === 'listRule' || k === 'viewRule')) && !/^@request\.auth\.id != ""/.test(col[k]));
      expect(bez.length === 0, `živé schéma: pravidla ${c} začínají podmínkou přihlášení (${bez.join(', ') || 'vše'})`);
    }
    console.log('    pravidla po migraci: ' + JSON.stringify(Object.fromEntries(['node_files', 'time_entries', 'templates', 'events', 'ai_pages', 'ai_images'].map((c) => { const col = cols.find((x) => x.name === c) || {}; return [c, { list: col.listRule, view: col.viewRule, create: col.createRule, update: col.updateRule, delete: col.deleteRule }]; }))));
  };
  await schema();
  {
    const cols = (await nova.api('GET', '/api/collections?perPage=200', { token: ST })).json.items;
    const vr = (cols.find((x) => x.name === 'ai_images') || {}).viewRule;
    expect(vr === '@request.auth.id != ""', `ručně vyprázdněné pravidlo je po migraci podmínka přihlášení (${JSON.stringify(vr)})`);
  }
  const login = (j) => nova.login(j + '@up.cz');
  let V = await login('vlastnik');
  const C = await login('ctenar');
  const radky = async () => ((await nova.api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${M.id}"`)}`, { token: ST })).json.items || []).map((x) => x.email + ':' + x.permission).sort();
  const cekajici = async () => ((await nova.api('GET', `/api/collections/share_invites/records?filter=${encodeURIComponent(`map="${M.id}"`)}`, { token: ST })).json.items || []);
  expect(JSON.stringify(await radky()) === JSON.stringify(['ctenar@up.cz:read']), `čekající adresa o autorizační řádek přišla, registrovaný čtenář ne (${(await radky()).join(', ')})`);
  let c = await cekajici();
  expect(c.length === 1 && c[0].email === 'ceka@up.cz' && c[0].permission === 'edit', `čekající sdílení je v share_invites se svým právem (${JSON.stringify(c.map((x) => [x.email, x.permission]))})`);
  const zaznam = (await nova.api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: C }));
  expect(zaznam.status === 200 && !JSON.stringify(zaznam.json).includes('ceka@up.cz') && zaznam.json.shared_with.includes('ctenar@up.cz'), 'čtenář projekt dál vidí a čekající adresu v něm už ne');
  const sez = ((await nova.api('POST', '/api/kb/share', { token: V, body: { action: 'list', mapId: M.id } })).json.members || []);
  expect(sez.some((m) => m.email === 'ceka@up.cz' && m.pending === true && m.invite_valid === false) && sez.some((m) => m.email === 'ctenar@up.cz' && !m.pending), 'vlastník vidí čekajícího (bez platného odkazu) i čtenáře');
  await nova.register('ceka@up.cz');
  const squat = await login('ceka');
  expect((await nova.api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: squat })).status === 404, 'registrace čekající adresy po upgradu přístup nedá');
  r = await nova.api('POST', '/api/kb/share', { token: V, body: { action: 'reinvite', mapId: M.id, memberEmail: 'ceka@up.cz' } });
  const token = decodeURIComponent(String(r.json.invite_path || '').split('invite=')[1] || '');
  expect(r.status === 200 && token.length === 40, `vlastník pošle pozvánku znovu a dostane odkaz (${r.status} ${r.json.invite})`);
  r = await nova.api('POST', '/api/kb/share-invite/claim', { token: squat, body: { token } });
  expect(r.status === 200 && (await nova.api('PATCH', `/api/collections/goalmaps/records/${M.id}`, { token: squat, body: { description: 'ok' } })).status === 200, `s tokenem z odkazu přístup (edit) získá (${r.status})`);

  console.log('== smazání člena s daty ze staré verze ==');
  const A = await login('admin');
  r = await nova.api('DELETE', `/api/collections/users/records/${ids.odchazejici}`, { token: A });
  expect(r.status === 204, `účet smazán (${r.status} ${JSON.stringify(r.json)})`);
  const su = (path) => nova.api('GET', path, { token: ST });
  const p2 = (await su(`/api/collections/node_files/records/${pril.id}`));
  expect(p2.status === 200 && p2.json.owner === '' && p2.json.owner_email === 'odchazejici@up.cz', `příloha v projektu kolegy zůstala (${p2.status})`);
  expect((await su(`/api/collections/time_entries/records/${cas.id}`)).status === 200, 'záznam času na projektu kolegy zůstal');
  const t2 = await su(`/api/collections/templates/records/${tpl.id}`);
  expect(t2.status === 200 && t2.json.owner === ids.admin, `týmová šablona zůstala a drží ji administrátor (${t2.status})`);
  const e2 = await su(`/api/collections/events/records/${ev.id}`);
  expect(e2.status === 200 && e2.json.owner === '' && (e2.json.participants || []).includes(ids.kolega), `událost ve firemním kalendáři zůstala i s pozvaným (${e2.status})`);

  const anonCas = await nova.api('GET', '/api/collections/time_entries/records');
  expect(anonCas.status === 200 && anonCas.json.items.length === 0, `nepřihlášený zachovaný záznam času nevidí (${anonCas.json && anonCas.json.items.length})`);
  const vest = ((await nova.api('GET', `/api/collections/templates/records?perPage=1&filter=${encodeURIComponent('owner=""')}`)).json.items || [])[0];
  r = await nova.api('DELETE', `/api/collections/templates/records/${vest.id}`);
  expect(r.status === 404 || r.status === 403, `nepřihlášený vestavěnou šablonu po upgradu nesmaže (${r.status})`);

  console.log('== druhý start: migrace jsou idempotentní ==');
  await nova.restart();
  kontrolaLogu(nova, 'druhý start');
  ST = await nova.superuser();
  await schema();
  expect(JSON.stringify(await radky()) === JSON.stringify(['ceka@up.cz:edit', 'ctenar@up.cz:read']) && (await cekajici()).length === 0, `sdílení beze změny (${(await radky()).join(', ')})`);
  V = await login('vlastnik');
  expect((await nova.api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: V })).json.shared_with.length === 2, 'záznam projektu beze změny');
  execSync(`docker volume rm -f ${VOL} 2>/dev/null; true`);
}, { nazev: 'UPGRADE-CHYBY4' });
