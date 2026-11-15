// Pending shares: a project shared with an address that has no account (code analysis 4,
// findings S4-02 and S4-05; decision 11 Nov 2026).
//
// Before: the share row existed right away, the e-mail is never verified, so WHOEVER
// registered the address picked the share up — and every reader of the project saw the
// pending address and could raise their own right that way.
//
// What is measured:
//   A (no mail server)
//     • the pending address has no authorization row and is not on the project record;
//       a reader cannot learn it (record, share list);
//     • registering the address WITHOUT the invitation link gives nothing — not even after
//       later share syncs; the owner sees it as pending and can confirm it for the account;
//     • the one-time token from the link: wrong / foreign / expired → 400; right one → the
//       share of ITS OWN project only (a token from the attacker's own project never opens
//       a share another owner gave to the address); single use; "send again" issues a new link and kills
//       the old one;
//     • permission change and removal of a pending share; other ways an address gets onto
//       a project (project created with shared_with, PATCH by the owner) do not open a
//       side door;
//     • /invite with a hand-delivered temporary password does NOT activate pending shares;
//     • S4-05: invited_by / last_login / welcome_sent cannot be set by a client.
//   B (mail sink)
//     • the invitation e-mail carries the link with the token and it works; "send again"
//       sends a second e-mail with another token;
//     • /invite never activates pending shares, not even when delivered by e-mail.
// No real e-mail leaves: SMTP is a local sink.
const H = require('./_harness');
const { expect } = H;

const telo = (title, extra) => Object.assign({
  title,
  nodes: [{ id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } }],
  edges: [],
}, extra || {});
const tokenZ = (cesta) => decodeURIComponent(String(cesta || '').split('invite=')[1] || '');
const qp = (raw) => raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

async function sada(inst, ST) {
  const ucet = async (email, extra) => {
    const r = await inst.register(email, extra || {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status} ${JSON.stringify(r.json)}`);
    return { id: r.json.id, email, token: await inst.login(email), record: r.json };
  };
  const share = (kdo, body) => inst.api('POST', '/api/kb/share', { token: kdo.token, body });
  const get = (kdo, id) => inst.api('GET', `/api/collections/goalmaps/records/${id}`, { token: kdo.token });
  const patch = (kdo, id, body) => inst.api('PATCH', `/api/collections/goalmaps/records/${id}`, { token: kdo.token, body });
  const radky = async (mapId) => ((await inst.api('GET', `/api/collections/map_shares/records?perPage=100&filter=${encodeURIComponent(`map="${mapId}"`)}`, { token: ST })).json.items || []).map((x) => x.email + ':' + x.permission).sort();
  const cekajici = async (mapId) => (await inst.api('GET', `/api/collections/share_invites/records?perPage=100&filter=${encodeURIComponent(`map="${mapId}"`)}`, { token: ST })).json.items || [];
  const claim = (kdo, token) => inst.api('POST', '/api/kb/share-invite/claim', { token: kdo.token, body: { token } });
  const seznam = async (kdo, mapId) => (await share(kdo, { action: 'list', mapId })).json.members || [];
  const mapa = async (kdo, title, extra) => {
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body: telo(title, Object.assign({ owner: kdo.id, owner_email: kdo.email }, extra || {})) });
    if (r.status !== 200) throw new Error(`mapa ${title}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  return { ucet, share, get, patch, radky, cekajici, claim, seznam, mapa };
}

H.beh(async () => {
  console.log('==== A: instance bez mailové brány ====');
  let inst = await H.startInstance({ slug: 'cekajici-a', env: { KB_UVODNI_MAPA: 0 } });
  let ST = await inst.superuser();
  let S = await sada(inst, ST);
  const admin = await S.ucet('admin@ck.cz');            // first account = administrator
  const vlastnik = await S.ucet('vlastnik@ck.cz');
  const ctenar = await S.ucet('ctenar@ck.cz');
  const M = await S.mapa(vlastnik, 'SDILENA');
  let r = await S.share(vlastnik, { action: 'share', mapId: M.id, email: ctenar.email, permission: 'read' });
  expect(r.status === 200, `předpoklad: čtenář má projekt ke čtení (${r.status})`);

  console.log('== sdílení na adresu bez účtu = čekající, mimo záznam projektu ==');
  r = await S.share(vlastnik, { action: 'share', mapId: M.id, email: 'Squat@CK.cz', permission: 'edit' });
  expect(r.status === 200 && r.json.member.registered === false && r.json.member.pending === true && r.json.member.email === 'squat@ck.cz',
    `sdílení prošlo jako čekající (${r.status} ${JSON.stringify(r.json && r.json.member)})`);
  expect(r.json.invite === 'no_smtp' && /^\/register\?email=squat%40ck\.cz&invite=[A-Za-z0-9]{40}$/.test(r.json.invite_path || ''),
    `bez pošty dostane sdílející odkaz s tokenem k předání (${r.json.invite}, ${String(r.json.invite_path).slice(0, 44)}…)`);
  const tokenSquat = tokenZ(r.json.invite_path);
  expect(JSON.stringify(await S.radky(M.id)) === JSON.stringify(['ctenar@ck.cz:read']), `autorizační řádek čekající adresa nemá (${(await S.radky(M.id)).join(', ')})`);
  let c = await S.cekajici(M.id);
  expect(c.length === 1 && c[0].email === 'squat@ck.cz' && c[0].permission === 'edit', `čeká v zamčené kolekci (${c.length})`);
  expect(!JSON.stringify(c).includes(tokenSquat), 'token sám v databázi není (jen otisk)');
  const zaznam = (await S.get(ctenar, M.id)).json;
  expect(!JSON.stringify(zaznam).includes('squat@ck.cz'), 'čtenář čekající adresu v záznamu projektu nevidí');
  r = await S.share(ctenar, { action: 'list', mapId: M.id });
  expect(r.status === 403, `seznam sdílení čtenář nedostane (${r.status})`);
  r = await inst.api('GET', '/api/collections/share_invites/records', { token: ctenar.token });
  expect(r.status === 403 || (r.status === 200 && r.json.totalItems === 0) || r.status === 404, `kolekce čekajících je pro klienta zavřená (${r.status})`);
  let sez = await S.seznam(vlastnik, M.id);
  let radek = sez.find((m) => m.email === 'squat@ck.cz');
  expect(!!radek && radek.pending === true && radek.registered === false && radek.permission === 'edit', `vlastník ji vidí jako čekající (${JSON.stringify(radek)})`);

  console.log('== registrace čekající adresy BEZ odkazu nic nedá ==');
  const squat = await S.ucet('squat@ck.cz');
  expect((await S.get(squat, M.id)).status === 404, 'účet se stejnou adresou projekt nevidí');
  r = await S.patch(squat, M.id, { title: 'PREPSANO-SQUAT' });
  expect(r.status === 404 && (await S.get(vlastnik, M.id)).json.title === 'SDILENA', `a nepřepíše ho (${r.status})`);
  r = await S.share(squat, { action: 'share', mapId: M.id, email: ctenar.email, permission: 'edit' });
  expect(r.status === 403, `ani nespravuje sdílení (${r.status})`);
  // a later share sync must not hand the row over
  await S.share(vlastnik, { action: 'update_permission', mapId: M.id, memberEmail: ctenar.email, permission: 'work' });
  await S.share(vlastnik, { action: 'update_permission', mapId: M.id, memberEmail: ctenar.email, permission: 'read' });
  expect((await S.get(squat, M.id)).status === 404 && !(await S.radky(M.id)).some((x) => x.startsWith('squat@')), 'ani po dalším přepočtu sdílení přístup nevznikne');
  r = await S.claim(squat, 'x'.repeat(40));
  expect(r.status === 400, `vymyšlený token → 400 (${r.status})`);
  r = await S.claim(ctenar, tokenSquat);
  expect(r.status === 400 && (await S.get(ctenar, M.id)).json && !(await S.radky(M.id)).some((x) => x === 'ctenar@ck.cz:edit'), `cizí účet se správným tokenem jiné adresy → 400 (${r.status})`);
  sez = await S.seznam(vlastnik, M.id);
  radek = sez.find((m) => m.email === 'squat@ck.cz');
  expect(!!radek && radek.pending === true && radek.registered === true, `vlastník vidí: účet existuje, pozvánka nepotvrzena (${JSON.stringify(radek)})`);

  console.log('== vlastník potvrdí sdílení existujícímu účtu ==');
  r = await S.share(vlastnik, { action: 'share', mapId: M.id, email: 'squat@ck.cz', permission: 'work' });
  expect(r.status === 200 && r.json.member.registered === true && !r.json.member.pending, `sdílení s existujícím účtem projde (${r.status})`);
  expect((await S.get(squat, M.id)).status === 200 && (await S.cekajici(M.id)).length === 0, 'účet projekt vidí, čekající řádek zmizel');
  expect((await S.radky(M.id)).includes('squat@ck.cz:work'), 'právo je to, které vlastník potvrdil (work), ne původní čekající (edit)');
  r = await S.claim(squat, tokenSquat);
  expect(r.status === 400, `starý token už nic neudělá (${r.status})`);

  console.log('== token z odkazu: potvrzení, jedno použití, platnost, nový odkaz ==');
  r = await S.share(vlastnik, { action: 'share', mapId: M.id, email: 'legit@ck.cz', permission: 'work' });
  const t1 = tokenZ(r.json.invite_path);
  const M2 = await S.mapa(vlastnik, 'DRUHA');
  r = await S.share(vlastnik, { action: 'share', mapId: M2.id, email: 'legit@ck.cz', permission: 'read' });
  const legit = await S.ucet('legit@ck.cz');
  expect((await S.get(legit, M.id)).status === 404 && (await S.get(legit, M2.id)).status === 404, 'po registraci bez odkazu nevidí nic');
  // expired token
  c = await S.cekajici(M.id);
  const radekLegit = c.find((x) => x.email === 'legit@ck.cz');
  await inst.api('PATCH', `/api/collections/share_invites/records/${radekLegit.id}`, { token: ST, body: { token_expires: new Date(Date.now() - 3600000).toISOString() } });
  r = await S.claim(legit, t1);
  expect(r.status === 400 && /Odkaz z pozvánky neplatí/.test(r.json.error || ''), `vypršelý token → 400 se srozumitelnou hláškou (${r.status}: ${String(r.json.error).slice(0, 40)})`);
  // send again → new link, the old one is dead
  r = await S.share(ctenar, { action: 'reinvite', mapId: M.id, memberEmail: 'legit@ck.cz' });
  expect(r.status === 403, `pozvánku znovu pošle jen ten, kdo sdílení spravuje (${r.status})`);
  r = await S.share(vlastnik, { action: 'reinvite', mapId: M.id, memberEmail: 'legit@ck.cz' });
  const t2 = tokenZ(r.json.invite_path);
  expect(r.status === 200 && t2.length === 40 && t2 !== t1, `„poslat znovu" vydá nový odkaz (${r.status})`);
  r = await S.claim(legit, t1);
  expect(r.status === 400, `starý odkaz přestal platit (${r.status})`);
  r = await S.claim(legit, t2);
  expect(r.status === 200 && r.json.claimed === 1, `nový token potvrdí PRÁVĚ svůj projekt (${r.status} ${JSON.stringify(r.json)})`);
  expect((await S.get(legit, M.id)).status === 200 && (await S.get(legit, M2.id)).status === 404, 'projekt z odkazu vidí, druhé čekající sdílení téže adresy čeká dál na svůj odkaz');
  expect((await S.cekajici(M2.id)).length === 1 && !(await S.radky(M2.id)).some((x) => x.startsWith('legit@')), 'druhý projekt: čekající řádek zůstal, autorizační nevznikl');
  r = await S.share(vlastnik, { action: 'reinvite', mapId: M2.id, memberEmail: 'legit@ck.cz' });
  r = await S.claim(legit, tokenZ(r.json.invite_path));
  expect(r.status === 200 && r.json.claimed === 1 && (await S.get(legit, M2.id)).status === 200, `druhý projekt potvrdí až jeho vlastní odkaz (${r.status})`);
  expect((await S.radky(M.id)).includes('legit@ck.cz:work') && (await S.radky(M2.id)).includes('legit@ck.cz:read'), 'každý s právem, které mu vlastník dal');
  expect((await S.patch(legit, M.id, { title: 'X' })).status === 404, 'spolupracovník (work) projekt nepřepíše');
  expect((await S.get(vlastnik, M.id)).json.shared_with.includes('legit@ck.cz'), 'po potvrzení je adresa v běžném seznamu sdílení');
  r = await S.claim(legit, t2);
  expect(r.status === 400, `token je na jedno použití (${r.status})`);
  expect((await S.cekajici(M.id)).length === 0 && (await S.cekajici(M2.id)).length === 0, 'čekající řádky zmizely');

  console.log('== token z VLASTNÍ mapy nevyzvedne čekající sdílení na CIZÍ mapě ==');
  // Security review 11 Nov 2026: whoever shares gets the invitation link back when the e-mail does not go out.
  // The attacker shares THEIR OWN project with the victim's address, takes the token, registers the address and
  // claims — and must get only their own project, never the share another owner gave to that address.
  const utocnik = await S.ucet('utocnik@ck.cz');
  const TAJNA = await S.mapa(vlastnik, 'TAJNA-PRO-OBET');
  r = await S.share(vlastnik, { action: 'share', mapId: TAJNA.id, email: 'obet@ck.cz', permission: 'edit' });
  expect(r.status === 200 && r.json.member.pending === true, 'předpoklad: vlastník čeká na oběť (edit)');
  const NAVNADA = await S.mapa(utocnik, 'NAVNADA');
  r = await S.share(utocnik, { action: 'share', mapId: NAVNADA.id, email: 'obet@ck.cz', permission: 'read' });
  const tUtok = tokenZ(r.json.invite_path);
  expect(tUtok.length === 40, 'útočník dostal token ke SVÉ mapě');
  const obetSquat = await S.ucet('obet@ck.cz'); // the attacker registers the victim's address
  r = await S.claim(obetSquat, tUtok);
  expect(r.status === 200 && r.json.claimed === 1, `token potvrdí jen útočníkovu vlastní mapu (${r.status} ${JSON.stringify(r.json)})`);
  expect((await S.get(obetSquat, NAVNADA.id)).status === 200, 'vlastní návnadu vidí');
  expect((await S.get(obetSquat, TAJNA.id)).status === 404 && (await S.patch(obetSquat, TAJNA.id, { title: 'UKRADENO' })).status === 404, 'CIZÍ mapu se sdílením pro oběť NEvidí ani nepřepíše');
  expect(!(await S.radky(TAJNA.id)).some((x) => x.startsWith('obet@')) && (await S.cekajici(TAJNA.id)).length === 1, 'na cizí mapě autorizační řádek nevznikl, sdílení čeká dál');
  expect((await S.get(vlastnik, TAJNA.id)).json.title === 'TAJNA-PRO-OBET', 'cizí mapa je netknutá');

  console.log('== úprava a odebrání čekajícího sdílení ==');
  r = await S.share(vlastnik, { action: 'share', mapId: M.id, email: 'ceka@ck.cz', permission: 'read' });
  const t3 = tokenZ(r.json.invite_path);
  r = await S.share(vlastnik, { action: 'share', mapId: M.id, email: 'ceka@ck.cz', permission: 'read' });
  expect(r.status === 400, `stejné právo znovu → „už je sdílena" (${r.status})`);
  r = await S.share(vlastnik, { action: 'share', mapId: M.id, email: 'ceka@ck.cz', permission: 'edit' });
  expect(r.status === 200 && r.json.upgraded === true && r.json.invite === 'already_sent' && !r.json.invite_path, `povýšení čekajícího: platný odkaz zůstává, nový se nevydává (${r.status} ${r.json.invite})`);
  r = await S.share(vlastnik, { action: 'update_permission', mapId: M.id, memberEmail: 'ceka@ck.cz', permission: 'work' });
  expect(r.status === 200 && (await S.cekajici(M.id))[0].permission === 'work', `změna práva čekajícího (${r.status})`);
  r = await S.share(vlastnik, { action: 'unshare', mapId: M.id, memberEmail: 'ceka@ck.cz' });
  expect(r.status === 200 && (await S.cekajici(M.id)).length === 0, `odebrání čekajícího (${r.status})`);
  const ceka = await S.ucet('ceka@ck.cz');
  r = await S.claim(ceka, t3);
  expect(r.status === 400 && (await S.get(ceka, M.id)).status === 404, `odkaz odebraného sdílení už nic nedá (${r.status})`);

  console.log('== postranní cesty: projekt založený se shared_with, ruční PATCH ==');
  const D = await S.mapa(vlastnik, 'DUPLIKAT', { shared_with: ['duch@ck.cz', ctenar.email], shared_with_edit: ['duch@ck.cz'], shared_with_work: [] });
  expect(JSON.stringify(await S.radky(D.id)) === JSON.stringify(['ctenar@ck.cz:read']), `řádek dostal jen existující účet (${(await S.radky(D.id)).join(', ')})`);
  const dz = (await S.get(ctenar, D.id)).json;
  expect(!JSON.stringify(dz).includes('duch@ck.cz'), 'adresa bez účtu ze záznamu projektu zmizela');
  c = await S.cekajici(D.id);
  expect(c.length === 1 && c[0].email === 'duch@ck.cz' && c[0].permission === 'edit', 'a je mezi čekajícími (bez odkazu — vlastník pošle pozvánku)');
  const duch = await S.ucet('duch@ck.cz');
  await S.share(vlastnik, { action: 'share', mapId: D.id, email: admin.email, permission: 'read' });
  expect((await S.get(duch, D.id)).status === 404, 'registrace té adresy přístup nedá ani po dalším přepočtu sdílení');
  // the owner writes an address without an account into the mirror by hand
  r = await S.patch(vlastnik, D.id, { shared_with: [ctenar.email, admin.email, 'rucne@ck.cz'], shared_with_edit: ['rucne@ck.cz'] });
  expect(r.status === 200, `PATCH zrcadla vlastníkem prošel (${r.status})`);
  const rucne = await S.ucet('rucne@ck.cz');
  await S.share(vlastnik, { action: 'update_permission', mapId: D.id, memberEmail: ctenar.email, permission: 'work' });
  expect((await S.get(rucne, D.id)).status === 404 && !(await S.radky(D.id)).some((x) => x.startsWith('rucne@')), 'ručně vepsaná adresa po registraci přístup nezíská');
  expect((await S.cekajici(D.id)).some((x) => x.email === 'rucne@ck.cz'), 'a vlastník ji vidí jako čekající');

  console.log('== odložení selže → účet nevznikne (dřív: jen log a další přepočet sdílení přístup udělil) ==');
  r = await S.patch(vlastnik, D.id, { shared_with: [ctenar.email, admin.email, 'selhani@ck.cz'], shared_with_edit: ['selhani@ck.cz'] });
  expect(r.status === 200, `předpoklad: adresa bez účtu je ručně v zrcadle (${r.status})`);
  // the pending-share collection refuses every new row → parking must fail
  const siCol = (await inst.api('GET', '/api/collections/share_invites', { token: ST })).json;
  r = await inst.api('PATCH', `/api/collections/${siCol.id}`, { token: ST, body: { fields: siCol.fields.concat([{ name: 'zkouska_blok', type: 'text', required: true }]) } });
  expect(r.status === 200, `předpoklad: kolekce čekajících sdílení odmítá nové řádky (${r.status})`);
  const regSelh = await inst.register('selhani@ck.cz');
  expect(regSelh.status !== 200, `registrace adresy, jejíž sdílení nejde odložit, je odmítnuta (${regSelh.status})`);
  const ucty = (await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="selhani@ck.cz"')}`, { token: ST })).json.items || [];
  expect(ucty.length === 0, `a účet nevznikl (${ucty.length})`);
  await S.share(vlastnik, { action: 'update_permission', mapId: D.id, memberEmail: ctenar.email, permission: 'read' });
  expect(!(await S.radky(D.id)).some((x) => x.startsWith('selhani@')), `ani po přepočtu sdílení adresa nemá autorizační řádek (${(await S.radky(D.id)).join(', ')})`);
  r = await inst.api('PATCH', `/api/collections/${siCol.id}`, { token: ST, body: { fields: siCol.fields } });
  expect(r.status === 200, `kolekce čekajících sdílení vrácena (${r.status})`);
  const selh = await S.ucet('selhani@ck.cz');
  await S.share(vlastnik, { action: 'update_permission', mapId: D.id, memberEmail: ctenar.email, permission: 'work' });
  expect((await S.get(selh, D.id)).status === 404 && (await S.cekajici(D.id)).some((x) => x.email === 'selhani@ck.cz'), 'po opravě se adresa zaregistruje, přístup nemá a sdílení čeká');

  console.log('== ručně vepsané adresy se znaky %, _, & (filtr LIKE by je minul) ==');
  const zvl = ['a%b@ck.cz', 'a_b@ck.cz', 'x&y@ck.cz'];
  const Z = await S.mapa(vlastnik, 'ZVLASTNI');
  r = await S.patch(vlastnik, Z.id, { shared_with: zvl.concat([ctenar.email]), shared_with_edit: zvl });
  expect(r.status === 200, `PATCH zrcadla se zvláštními adresami (${r.status})`);
  const zvlUcty = [];
  for (const em of zvl) { const reg = await inst.register(em); if (reg.status === 200) zvlUcty.push({ email: em, token: await inst.login(em) }); }
  expect(zvlUcty.length === zvl.length, `adresy se zvláštními znaky jdou zaregistrovat (${zvlUcty.length}/${zvl.length})`);
  await S.share(vlastnik, { action: 'share', mapId: Z.id, email: admin.email, permission: 'read' }); // a share sync
  let zvlPristup = 0;
  for (const u of zvlUcty) { if ((await S.get(u, Z.id)).status !== 404) zvlPristup += 1; }
  expect(zvlPristup === 0 && !(await S.radky(Z.id)).some((x) => zvl.some((em) => x.startsWith(em))), `žádná z nich po registraci přístup nezískala (${zvlPristup}; ${(await S.radky(Z.id)).join(', ')})`);
  expect((await S.cekajici(Z.id)).length === zvl.length, `všechny jsou mezi čekajícími (${(await S.cekajici(Z.id)).length})`);

  console.log('== /invite s ručně předaným heslem čekající sdílení neaktivuje ==');
  await S.share(vlastnik, { action: 'share', mapId: M.id, email: 'docasny@ck.cz', permission: 'edit' });
  r = await inst.api('POST', '/api/kb/invite', { token: admin.token, body: { email: 'docasny@ck.cz', role: 'user' } });
  expect(r.status === 200 && !!r.json.temp_password, `admin založil účet s dočasným heslem (${r.status})`);
  const docasny = { token: await inst.login('docasny@ck.cz', r.json.temp_password) };
  expect((await S.get(docasny, M.id)).status === 404, 'kdo má dočasné heslo, projekt nevidí — sdílení dál čeká');
  radek = (await S.seznam(vlastnik, M.id)).find((m) => m.email === 'docasny@ck.cz');
  expect(!!radek && radek.pending === true && radek.registered === true, 'vlastník ho vidí jako čekající s účtem a může potvrdit');

  console.log('== S4-05: serverová pole nejdou nastavit klientem ==');
  const podvrh = await S.ucet('podvrh@ck.cz', { invited_by: vlastnik.email, last_login: '2026-01-01 00:00:00.000Z', welcome_sent: true });
  let u = (await inst.api('GET', `/api/collections/users/records/${podvrh.id}`, { token: ST })).json;
  expect(u.invited_by === '' && u.last_login === '' && u.welcome_sent === false, `při registraci se zahodí (${JSON.stringify([u.invited_by, u.last_login, u.welcome_sent])})`);
  r = await inst.api('PATCH', `/api/collections/users/records/${podvrh.id}`, { token: podvrh.token, body: { invited_by: vlastnik.email, welcome_sent: true, name: 'Podvrh' } });
  u = (await inst.api('GET', `/api/collections/users/records/${podvrh.id}`, { token: ST })).json;
  expect(r.status === 200 && u.name === 'Podvrh' && u.invited_by === '' && u.welcome_sent === false, `ani úpravou vlastního účtu (${JSON.stringify([u.invited_by, u.welcome_sent])})`);
  r = await inst.api('PATCH', `/api/collections/users/records/${podvrh.id}`, { token: admin.token, body: { invited_by: vlastnik.email } });
  u = (await inst.api('GET', `/api/collections/users/records/${podvrh.id}`, { token: ST })).json;
  expect(u.invited_by === '', 'ani administrátor ho nepřepíše');
  await inst.api('POST', '/api/collections/loginlogs/records', { token: podvrh.token, body: {} });
  await H.sleep(300);
  const zv = (await inst.api('GET', `/api/collections/notifications/records?perPage=50&filter=${encodeURIComponent(`user="${vlastnik.id}" && type="user_joined"`)}`, { token: ST })).json.items || [];
  expect(zv.length === 0, `falešné „přijal pozvání" nikomu nepřijde (${zv.length})`);
  // the real invitation still carries the mark
  u = (await inst.api('GET', `/api/collections/users/records?filter=${encodeURIComponent('email="docasny@ck.cz"')}`, { token: ST })).json.items[0];
  expect(u.invited_by === admin.email, `skutečná pozvánka (/invite) značku nese dál (${u.invited_by})`);
  inst.stop();

  console.log('==== B: instance s mailovou bránou (jímka) ====');
  const sink = await H.smtpSink();
  inst = await H.startInstance({ slug: 'cekajici-b', addHostGateway: true, env: { KB_UVODNI_MAPA: 0 } });
  ST = await inst.superuser();
  S = await sada(inst, ST);
  const adminB = await S.ucet('admin@cb.cz');
  const vl = await S.ucet('vlastnik@cb.cz');
  await sink.zapoj(inst, ST, { appURL: 'https://kb.example.com' });
  const MB = await S.mapa(vl, 'POSTOU');
  const mailyPro = (adresa) => sink.maily.filter((m) => new RegExp('^To:.*' + adresa.replace(/\./g, '\\.'), 'mi').test(m));
  const tokenZMailu = (raw) => ((qp(raw).match(/register\?email=[^&\s"]+&(?:amp;)?invite=([A-Za-z0-9]{40})/) || [])[1] || '');

  r = await S.share(vl, { action: 'share', mapId: MB.id, email: 'postou@cb.cz', permission: 'edit' });
  expect(r.status === 200 && r.json.invite === 'sent' && !r.json.invite_path, `pozvánka odešla, odkaz se v odpovědi nevrací (${r.status} ${r.json.invite})`);
  await sink.cekejNaMail((m) => /^To:.*postou@cb\.cz/mi.test(m)).catch(() => {});
  const m1 = mailyPro('postou@cb.cz')[0] || '';
  const tm1 = tokenZMailu(m1);
  expect(tm1.length === 40 && /kb\.example\.com\/register\?email=postou%40cb\.cz/.test(qp(m1)), `e-mail nese odkaz s jednorázovým tokenem (${tm1.length})`);
  r = await S.share(vl, { action: 'reinvite', mapId: MB.id, memberEmail: 'postou@cb.cz' });
  expect(r.status === 200 && r.json.invite === 'sent', `„poslat znovu" pošle druhý e-mail i přes závoru „jen jednou" (${r.json.invite})`);
  await H.waitFor(() => mailyPro('postou@cb.cz').length === 2, { timeout: 5000, popis: 'druhý e-mail' }).catch(() => {});
  const tm2 = tokenZMailu(mailyPro('postou@cb.cz')[1] || '');
  expect(tm2.length === 40 && tm2 !== tm1, 'druhý e-mail nese jiný token');
  const postou = await S.ucet('postou@cb.cz');
  r = await S.claim(postou, tm1);
  expect(r.status === 400 && (await S.get(postou, MB.id)).status === 404, `token z prvního e-mailu už neplatí (${r.status})`);
  r = await S.claim(postou, tm2);
  expect(r.status === 200 && r.json.claimed === 1 && (await S.patch(postou, MB.id, { description: 'smí upravovat' })).status === 200, `token z druhého e-mailu sdílení potvrdí (edit) (${r.status})`);

  console.log('== /invite čekající sdílení NEaktivuje ani při doručení e-mailem ==');
  // Security review 11 Nov 2026: the inviter can reset the new account's password and sign in as the invited
  // person — an invitation to the organization must never turn a pending share into a real one.
  r = await S.share(vl, { action: 'share', mapId: MB.id, email: 'pozvany@cb.cz', permission: 'read' });
  expect(r.status === 200 && r.json.member.pending === true, 'předpoklad: čekající sdílení');
  r = await inst.api('POST', '/api/kb/invite', { token: adminB.token, body: { email: 'pozvany@cb.cz', role: 'user' } });
  expect(r.status === 200 && r.json.invited_via_email === true, `pozvánka do organizace šla e-mailem (${r.status} ${JSON.stringify(r.json)})`);
  expect(!(await S.radky(MB.id)).some((x) => x.startsWith('pozvany@')) && (await S.cekajici(MB.id)).some((x) => x.email === 'pozvany@cb.cz'),
    `sdílení čeká dál — pozvání do organizace ho nepotvrdilo (${(await S.radky(MB.id)).join(', ')})`);
  const rp = (await S.seznam(vl, MB.id)).find((m) => m.email === 'pozvany@cb.cz');
  expect(!!rp && rp.pending === true && rp.registered === true, 'vlastník ho vidí jako čekajícího s účtem a může potvrdit');
}, { nazev: 'SDILENI-CEKAJICI' });
