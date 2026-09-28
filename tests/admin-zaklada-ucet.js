// Admin zakládá účet přes PB API (POST /api/collections/users/records s tokenem) —
// větev „byAdmin" v create hooku users (main.pb.js). Do 27. 9. 2026 byla NEDOSAŽITELNÁ:
// `jeAdmin` importovaný v bloku `{}` a použitý za ním → ReferenceError → generické 400
// pro KAŽDÝ POST s tokenem (analýza kódu 2, S4-01); org-map.js to zamykal jako „400 = OK".
//
// Na starém kódu padne: „admin založí účet → 200" (dostane 400), „role z těla se
// uloží", „platný zástupce projde", „neplatný zástupce → hláška o zástupci"
// (400 sice přijde, ale generické „Something went wrong…"), a obě kontroly člena
// (dostane 400 místo účtu s roli user).
//
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/admin-zaklada-ucet.js
const H = require('./_harness');
const { expect, PW } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'admin-ucet', env: { KB_UVODNI_MAPA: 0 } });
  const { api } = inst;
  const rA = await inst.register('a@example.com');
  expect(rA.status === 200 && rA.json.role === 'admin', `první registrace = admin (${rA.status} ${rA.json && rA.json.role})`);
  const rB = await inst.register('b@example.com');
  expect(rB.status === 200 && rB.json.role === 'user', `druhá registrace = user (${rB.status})`);
  const A = await inst.login('a@example.com');
  const B = await inst.login('b@example.com');
  const novy = (email, extra) => ({ email, password: PW, passwordConfirm: PW, ...extra });

  console.log('== admin (token, ne superuser) zakládá účty ==');
  let r = await api('POST', '/api/collections/users/records', { token: A, body: novy('c@example.com') });
  expect(r.status === 200 && r.json.role === 'user', `admin založí účet → 200, bez role v těle = user (${r.status} ${JSON.stringify(r.json && (r.json.message || r.json.role))})`);
  r = await api('POST', '/api/collections/users/records', { token: A, body: novy('m@example.com', { role: 'manager' }) });
  expect(r.status === 200 && r.json.role === 'manager', `admin zadá roli manager → uloží se (${r.status} ${r.json && r.json.role})`);
  r = await api('POST', '/api/collections/users/records', { token: A, body: novy('d@example.com', { deputy: 'b@example.com' }) });
  expect(r.status === 200 && r.json.deputy === 'b@example.com', `platný zástupce (existující člen) projde (${r.status} ${r.json && r.json.deputy})`);
  r = await api('POST', '/api/collections/users/records', { token: A, body: novy('e@example.com', { deputy: 'neexistuje@example.com' }) });
  expect(r.status === 400 && /existující člen|existing member/.test((r.json && r.json.message) || ''), `neplatný zástupce → 400 s hláškou o zástupci, ne generické 400 (${r.status} ${JSON.stringify(r.json && r.json.message)})`);
  r = await api('POST', '/api/collections/users/records', { token: A, body: novy('f@example.com', { deputy: 'f@example.com' }) });
  expect(r.status === 400 && /tentýž|own deputy/.test((r.json && r.json.message) || ''), `zástupce = sám sobě → 400 (${r.status} ${JSON.stringify(r.json && r.json.message)})`);
  const ok = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'm@example.com', password: PW } });
  expect(ok.status === 200 && ok.json.record.role === 'manager', `adminem založený účet se přihlásí (${ok.status})`);

  console.log('== člen s tokenem = jako samoregistrace (self-host bez KB_SETUP_CODE): účet ano, práva ne ==');
  r = await api('POST', '/api/collections/users/records', { token: B, body: novy('g@example.com', { role: 'admin', deputy: 'a@example.com', is_ai_manager: true, is_org_manager: true }) });
  expect(r.status === 200 && r.json.role === 'user', `člen POST users → 200, role z těla se NEbere (${r.status} ${JSON.stringify(r.json && (r.json.message || r.json.role))})`);
  expect(r.status === 200 && r.json.deputy === '' && r.json.is_ai_manager === false && r.json.is_org_manager === false, 'člen nepodstrčí zástupce ani správcovská práva');
}, { nazev: 'ADMIN-ZAKLADA-UCET' });
