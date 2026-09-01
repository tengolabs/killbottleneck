// Serverová validace sdílecích e-mailů v syncShares (bezpečnostní panel 28. 8. 2026):
// řešitelé ze šablon a duplikace mapy nesly do map_shares cokoli z dat — FE byl
// jediný filtr. Server teď při stavbě map_shares řádků TIŠE zahodí (s logem
// „syncShares: přeskočeno …") hodnoty bez @, s bílým znakem a pseudo-adresy
// externích kontaktů (ext-…@kontakt.invalid). ŽÁDNÁ kanonizace, JSON zrcadlo
// na mapě se nemění — jen řádky map_shares.
//
// Mutační pojistky (image PŘED změnou, kb-drobnosti-3):
//  • sekce „ext- pseudo první": řádek ext-…@kontakt.invalid VZNIKNE (tvar
//    e-mailu projde validací pole) → kontrola počtu řádků červená
//  • log „syncShares: přeskočeno" neexistuje → kontroly logu červené
const H = require('./_harness');
const { expect, waitFor } = H;

const VLASTNIK = 'vlastnik@e2e.cz';
const PLATNY = 'platny@e2e.cz';
const KOLEGA = 'kolega@e2e.cz';

const APEX = { id: 'root', type: 'apex', position: { x: 0, y: 0 }, data: { apexText: 'Cíl' } };
const KROK = { id: 'k1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo' } };
const NODES = [APEX, KROK];
const EDGES = [{ id: 'e1', source: 'root', target: 'k1' }];

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'sdileni-validace', env: { KB_UVODNI_MAPA: 0 } });
  const { api, login } = inst;
  for (const email of [VLASTNIK, PLATNY, KOLEGA]) await inst.register(email);
  const V = await login(VLASTNIK), P = await login(PLATNY), K = await login(KOLEGA);
  const SUT = await inst.superuser();

  // řádky map_shares očima superusera (RLS by běžnému účtu cizí řádky skryla)
  const radky = async (mapId) => {
    const r = await api('GET', `/api/collections/map_shares/records?perPage=50&filter=${encodeURIComponent(`map='${mapId}'`)}`, { token: SUT });
    return (r.json?.items || []).map((x) => ({ email: x.email, permission: x.permission }));
  };
  // logger píše do _logs dávkově (flush ~3 s) → čekáme přes /api/logs
  const logObsahuje = (kus) => waitFor(async () => {
    const r = await api('GET', `/api/logs?perPage=100&filter=${encodeURIComponent(`message~'syncShares'`)}`, { token: SUT });
    return (r.json?.items || []).some((l) => String(l.message).includes(kus));
  }, { timeout: 15000, popis: `log se „${kus}"` }).then(() => true, () => false);

  console.log('== (a) create mapy s duchy v shared_with → jen platný řádek + log ==');
  const mA = await api('POST', '/api/collections/goalmaps/records', { token: V, body: {
    title: 'Mapa s duchy', nodes: NODES, edges: EDGES,
    shared_with: [PLATNY, 'bez-zavinace', 'ext-abc@kontakt.invalid', 'a b@x.cz'],
    shared_with_edit: [], shared_with_work: [],
  } });
  expect(mA.status === 200 && !!mA.json?.id, `mapa s duchy vznikla (${mA.status})`);
  let rows = await radky(mA.json.id);
  expect(rows.length === 1 && rows[0].email === PLATNY && rows[0].permission === 'read',
    `map_shares má JEN řádek ${PLATNY} (${JSON.stringify(rows)})`);
  let r = await api('GET', `/api/collections/goalmaps/records/${mA.json.id}`, { token: P });
  expect(r.status === 200, `platný adresát mapu vidí (${r.status})`);
  expect(await logObsahuje('přeskočeno "bez-zavinace"'), 'log hlásí přeskočené „bez-zavinace"');
  expect(await logObsahuje('přeskočeno "ext-abc@kontakt.invalid"'), 'log hlásí přeskočený ext- pseudo-e-mail');
  expect(await logObsahuje('přeskočeno "a b@x.cz"'), 'log hlásí přeskočený e-mail s mezerou');

  // ⚠️ MUTAČNÍ JÁDRO: ext- pseudo JAKO PRVNÍ hodnota. Na starém image projde
  // validací pole email (má tvar adresy) a řádek VZNIKNE dřív, než malformované
  // hodnoty save shodí — počet řádků by tu byl 2. („bez-zavinace" za ním by na
  // starém image save jen přerušil — proto nestačí sekce (a).)
  console.log('== (a2) ext- pseudo první: řádek externího kontaktu NEVZNIKNE ==');
  const mA2 = await api('POST', '/api/collections/goalmaps/records', { token: V, body: {
    title: 'Mapa s ext kontaktem', nodes: NODES, edges: EDGES,
    shared_with: ['ext-def0@kontakt.invalid', PLATNY],
    shared_with_edit: [], shared_with_work: ['ext-def0@kontakt.invalid'],
  } });
  expect(mA2.status === 200 && !!mA2.json?.id, `mapa s ext kontaktem vznikla (${mA2.status})`);
  rows = await radky(mA2.json.id);
  expect(rows.length === 1 && rows[0].email === PLATNY,
    `řádek pro ext-…@kontakt.invalid NEVZNIKL, platný ano (${JSON.stringify(rows)})`);
  // zrcadlo na mapě se NEPŘEPISUJE — filtr platí jen pro map_shares řádky
  r = await api('GET', `/api/collections/goalmaps/records/${mA2.json.id}`, { token: V });
  expect((r.json?.shared_with || []).includes('ext-def0@kontakt.invalid'),
    `JSON zrcadlo shared_with zůstalo netknuté (${JSON.stringify(r.json?.shared_with)})`);

  console.log('== (b) duplikace mapy s duchem v shared_with nespadne, sdílení platných přežije ==');
  // normální mapa + řádné sdílení kolegovi
  const mB = await api('POST', '/api/collections/goalmaps/records', { token: V, body: { title: 'Originál', nodes: NODES, edges: EDGES } });
  r = await api('POST', '/api/flowmap/share', { token: V, body: { action: 'share', mapId: mB.json.id, email: KOLEGA, permission: 'work' } });
  expect(r.status === 200, `řádné sdílení kolegovi prošlo (${r.status})`);
  // duch v zrcadle = historická data (superuser PATCH; update hook syncShares nevolá)
  r = await api('PATCH', `/api/collections/goalmaps/records/${mB.json.id}`, { token: SUT, body: { shared_with: [KOLEGA, 'duch stary@x.cz'] } });
  expect(r.status === 200, `duch vložen do zrcadla originálu (${r.status})`);
  // duplikace = FE založí novou mapu se zkopírovanými poli včetně shared_with*
  const orig = (await api('GET', `/api/collections/goalmaps/records/${mB.json.id}`, { token: V })).json;
  const kopie = await api('POST', '/api/collections/goalmaps/records', { token: V, body: {
    title: 'Originál (kopie)', nodes: orig.nodes, edges: orig.edges,
    shared_with: orig.shared_with, shared_with_edit: orig.shared_with_edit, shared_with_work: orig.shared_with_work,
  } });
  expect(kopie.status === 200 && !!kopie.json?.id, `duplikace s duchem NESPADLA (${kopie.status})`);
  rows = await radky(kopie.json.id);
  expect(rows.length === 1 && rows[0].email === KOLEGA && rows[0].permission === 'work',
    `kopie sdílí platnému kolegovi (work), duch přeskočen (${JSON.stringify(rows)})`);
  r = await api('GET', `/api/collections/goalmaps/records/${kopie.json.id}`, { token: K });
  expect(r.status === 200, `kolega kopii vidí (${r.status})`);
  expect(await logObsahuje('přeskočeno "duch stary@x.cz"'), 'log hlásí přeskočeného ducha z duplikace');

  console.log('== (c) /share normální cesta beze změny ==');
  const mC = await api('POST', '/api/collections/goalmaps/records', { token: V, body: { title: 'Běžná mapa', nodes: NODES, edges: EDGES } });
  r = await api('POST', '/api/flowmap/share', { token: V, body: { action: 'share', mapId: mC.json.id, email: PLATNY, permission: 'read' } });
  expect(r.status === 200, `přidání sdílení funguje (${r.status})`);
  rows = await radky(mC.json.id);
  expect(rows.length === 1 && rows[0].email === PLATNY && rows[0].permission === 'read', `řádek read vznikl (${JSON.stringify(rows)})`);
  r = await api('POST', '/api/flowmap/share', { token: V, body: { action: 'update_permission', mapId: mC.json.id, memberEmail: PLATNY, permission: 'edit' } });
  expect(r.status === 200, `povýšení na edit funguje (${r.status})`);
  rows = await radky(mC.json.id);
  expect(rows.length === 1 && rows[0].permission === 'edit', `řádek povýšen na edit (${JSON.stringify(rows)})`);
  r = await api('POST', '/api/flowmap/share', { token: V, body: { action: 'unshare', mapId: mC.json.id, memberEmail: PLATNY } });
  expect(r.status === 200, `odebrání funguje (${r.status})`);
  rows = await radky(mC.json.id);
  expect(rows.length === 0, `řádky po odebrání zmizely (${JSON.stringify(rows)})`);
  r = await api('GET', `/api/collections/goalmaps/records/${mC.json.id}`, { token: P });
  expect(r.status === 404, `odebraný mapu nevidí (${r.status})`);
}, { nazev: 'SDÍLENÍ-VALIDACE' });
