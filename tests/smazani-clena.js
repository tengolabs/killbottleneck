// Deleting a member deletes only their PRIVATE things (decision 11 Nov 2026; code
// analysis 4, findings M1-01, F4-06).
//
// Before: the cascade of the author relation took with the account every attachment the
// person had ever uploaded (also into other people's and taken-over projects — files gone
// from storage), their time entries, team templates, events in shared calendars and pages
// shared with the team.
//
// SHARED projects of the deleted member are handed over inside the delete itself (decision
// 11 Nov 2026, Richard): to a co-admin of the project (named share with the right to
// manage; several → the one shared with the longest), otherwise to the administrator who
// deletes the account. Private projects still go with the account.
//
// What is measured (the administrator does exactly what the dialog in user administration
// does: GET /users/{id}/maps → DELETE the account):
//   • the summary BEFORE the delete says what goes and what stays, and its numbers fit;
//   • private projects, private pages, personal templates, private events, own absences
//     and time entries on own projects GO;
//   • attachments (file on disk included) and comments in other people's and taken-over
//     projects, time entries on other people's projects, team templates (never ownerless —
//     an administrator holds them, automatic creation off), events in shared calendars
//     with other people's attendance, pages shared with the team / by a public link / by
//     name and the images they use STAY; the author reads as a former member;
//   • the live schema (/api/collections) really carries the changed relations.
const H = require('./_harness');
const { expect } = H;

const den = (posun) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + posun);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const telo = (title) => ({
  title,
  nodes: [
    { id: 'R', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: title, title: '', status: 'todo' } },
    { id: 'n1', type: 'goalNode', position: { x: 0, y: 300 }, data: { title: 'Krok', status: 'todo', nodeType: 'normal' } },
  ],
  edges: [{ id: 'e1', source: 'R', target: 'n1' }],
});

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'smazclena', env: { KB_UVODNI_MAPA: 0, TZ: 'Europe/Prague' } });
  const ST = await inst.superuser();
  const ucet = async (email, extra) => {
    const reg = Object.assign({}, extra || {}); delete reg.bezVstupu;
    const r = await inst.register(email, reg);
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    const token = await inst.login(email);
    // entering the app writes users.last_login (the client posts a login log); an account
    // WITHOUT it has "never signed in" and cannot become a co-admin owner — { bezVstupu: true }
    if (!(extra && extra.bezVstupu)) {
      const l = await inst.api('POST', '/api/collections/loginlogs/records', { token, body: {} });
      if (l.status !== 200) throw new Error(`loginlog ${email}: ${l.status}`);
    }
    return { id: r.json.id, email, token };
  };
  const su = (method, path, body) => inst.api(method, path, { token: ST, body });
  const pocet = async (col, filter) => (await su('GET', `/api/collections/${col}/records?perPage=200${filter ? '&filter=' + encodeURIComponent(filter) : ''}`)).json.items || [];
  const mapa = async (kdo, title) => {
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: kdo.token, body: Object.assign(telo(title), { owner: kdo.id, owner_email: kdo.email }) });
    if (r.status !== 200) throw new Error(`mapa ${title}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const share = (kdo, body) => inst.api('POST', '/api/kb/share', { token: kdo.token, body });
  const soubor = async (kdo, mapId, jmeno) => {
    const form = new FormData();
    form.append('map', mapId); form.append('node_id', 'n1'); form.append('name', jmeno); form.append('size', '2048');
    form.append('file', new Blob([new Uint8Array(2048)]), jmeno);
    const res = await fetch(`${inst.base}/api/collections/node_files/records`, { method: 'POST', headers: { Authorization: kdo.token }, body: form });
    const json = await res.json();
    if (res.status !== 200) throw new Error(`příloha ${jmeno}: ${res.status} ${JSON.stringify(json)}`);
    return json;
  };
  const odkaz = async (kdo, mapId, jmeno) => {
    const r = await inst.api('POST', '/api/collections/node_files/records', { token: kdo.token, body: { map: mapId, node_id: 'n1', name: jmeno, url: 'https://example.com/' + jmeno } });
    if (r.status !== 200) throw new Error(`odkaz ${jmeno}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const cas = async (kdo, mapId, label) => {
    const r = await inst.api('POST', '/api/collections/time_entries/records', { token: kdo.token, body: Object.assign({ label, started: '2026-08-20 08:00:00.000Z', ended: '2026-08-20 09:00:00.000Z' }, mapId ? { map: mapId, node_id: 'n1' } : {}) });
    if (r.status !== 200) throw new Error(`čas ${label}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  };
  const udalost = async (kdo, body) => {
    const r = await inst.api('POST', '/api/kb/events/save', { token: kdo.token, body });
    if (r.status !== 200) throw new Error(`událost ${body.title}: ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.event;
  };
  const naDisku = () => inst.exec("sh -c 'find /app/pb_data/storage -type f -name \"*.bin\" | wc -l'").trim();

  const admin = await ucet('admin@sm.cz');            // first account = administrator
  const kolega = await ucet('kolega@sm.cz', { name: 'Kolega' });
  const odch = await ucet('odchazejici@sm.cz', { name: 'Odcházející' });
  const treti = await ucet('treti@sm.cz', { name: 'Třetí', language: 'en' });
  const podtrz = await ucet('od_ch%az@sm.cz');       // LIKE wildcards in the address

  console.log('== příprava: co odcházející člen kde má ==');
  const PRIV = await mapa(odch, 'SOUKROMY');
  const TEAM = await mapa(odch, 'TYMOVY');
  const KM = await mapa(kolega, 'KOLEGUV');
  await share(odch, { action: 'set_team_access', mapId: TEAM.id, access: 'edit' });
  await share(kolega, { action: 'share', mapId: KM.id, email: odch.email, permission: 'edit' });
  // shared by name: a reader first, then two co-admins (the colleague BEFORE the administrator)
  const COAD = await mapa(odch, 'SE-SPOLUSPRAVCI');
  for (const [komu, perm] of [[treti, 'read'], [kolega, 'edit'], [admin, 'edit']]) {
    const rs = await share(odch, { action: 'share', mapId: COAD.id, email: komu.email, permission: perm });
    if (rs.status !== 200) throw new Error(`sdílení ${komu.email}: ${rs.status} ${JSON.stringify(rs.json)}`);
  }
  // shared only for reading with somebody else — no co-admin, the administrator does not see it
  const CTENI = await mapa(odch, 'JEN-KE-CTENI');
  await share(odch, { action: 'share', mapId: CTENI.id, email: treti.email, permission: 'read' });
  const casCoad = await cas(odch, COAD.id, 'CAS-SE-SPOLUSPRAVCI');
  // Decisions of the product owner, 11 Nov 2026:
  //  • a public board (is_public, no other sharing) is handed over, its public link keeps working;
  //  • an account that has never signed in is skipped as a co-admin (the next one takes over,
  //    otherwise the deleting administrator).
  const neakt = await ucet('pozvany-neaktivni@sm.cz', { bezVstupu: true });
  expect((await su('GET', `/api/collections/users/records/${neakt.id}`)).json.last_login === '' && (await su('GET', `/api/collections/users/records/${kolega.id}`)).json.last_login !== '', 'předpoklad: neaktivní účet nemá last_login, kolega ano');
  const VEREJNA = await mapa(odch, 'VEREJNA-VYVESKA');
  const rvy = await inst.api('PATCH', `/api/collections/goalmaps/records/${VEREJNA.id}`, { token: odch.token, body: { is_public: true } });
  if (rvy.status !== 200 || rvy.json.is_public !== true) throw new Error(`is_public: ${rvy.status}`);
  const verejneVidet = async () => { const x = await inst.api('POST', '/api/kb/public-maps', { body: { id: VEREJNA.id, mapId: VEREJNA.id } }); return x.status; };
  const verejnePred = await verejneVidet();
  const NEAKT1 = await mapa(odch, 'NEAKTIVNI-A-AKTIVNI');
  for (const komu of [neakt, treti]) await share(odch, { action: 'share', mapId: NEAKT1.id, email: komu.email, permission: 'edit' });
  const NEAKT2 = await mapa(odch, 'JEN-NEAKTIVNI');
  await share(odch, { action: 'share', mapId: NEAKT2.id, email: neakt.email, permission: 'edit' });
  // Security review 11 Nov 2026: a share row that no living account of somebody else stands
  // behind must NOT make a private project "shared" (the administrator would receive it):
  //  • an orphan row of an address without an account (left after a failed cleanup),
  //  • the owner's own address, when owner_email differs from the account e-mail.
  const radekSdileni = async (mapId, email, permission) => {
    const rs = await su('POST', '/api/collections/map_shares/records', { map: mapId, email, permission, email_edit: permission === 'edit' ? email : '' });
    if (rs.status !== 200) throw new Error(`řádek map_shares ${email}: ${rs.status} ${JSON.stringify(rs.json)}`);
  };
  const SIROTEK = await mapa(odch, 'SOUKROMY-SE-SIROTKEM');
  await radekSdileni(SIROTEK.id, 'duch-bez-uctu@sm.cz', 'edit');
  const VLASTNI = await mapa(odch, 'SOUKROMY-S-VLASTNI-ADRESOU');
  await radekSdileni(VLASTNI.id, odch.email, 'edit');
  const rv = await su('PATCH', `/api/collections/goalmaps/records/${VLASTNI.id}`, { owner_email: 'jina-adresa@sm.cz' });
  if (rv.status !== 200 || rv.json.owner_email !== 'jina-adresa@sm.cz') throw new Error(`owner_email: ${rv.status} ${JSON.stringify(rv.json).slice(0, 200)}`);
  // the address with `_` and `%` is shared into the colleague's project
  const KM2 = await mapa(kolega, 'KOLEGUV-DRUHY');
  const rp = await share(kolega, { action: 'share', mapId: KM2.id, email: podtrz.email, permission: 'edit' });
  if (rp.status !== 200) throw new Error(`sdílení s adresou s _ a %: ${rp.status} ${JSON.stringify(rp.json)}`);
  await soubor(odch, PRIV.id, 'v-soukromem.bin');
  const fTeam = await soubor(odch, TEAM.id, 'v-tymovem.bin');
  const fTeamOdkaz = await odkaz(odch, TEAM.id, 'odkaz-v-tymovem');
  const fTeamKolega = await soubor(kolega, TEAM.id, 'kolega-v-tymovem.bin');
  const fKM = await soubor(odch, KM.id, 'v-koleguve.bin');
  await cas(odch, PRIV.id, 'CAS-SOUKROMY');
  await cas(odch, '', 'CAS-BEZ-PROJEKTU');
  const casKM = await cas(odch, KM.id, 'CAS-U-KOLEGY');
  const casTeam = await cas(odch, TEAM.id, 'CAS-TYMOVY');
  let r = await inst.api('POST', '/api/collections/comments/records', { token: odch.token, body: { goalmap: KM.id, node_id: 'n1', text: 'KOMENTAR-ODCHAZEJICIHO' } });
  expect(r.status === 200, `komentář v projektu kolegy (${r.status})`);
  const tplTym = (await inst.api('POST', '/api/collections/templates/records', { token: odch.token, body: { title: 'TYMOVA-SABLONA', node_type: 'mise', ai_nodes: [{ id: 'n1', title: 'Kořen', parentId: null }], auto_create: 'weekly', auto_day: 1, auto_last: '' } })).json;
  const tplOsobni = (await inst.api('POST', '/api/collections/templates/records', { token: odch.token, body: { title: 'OSOBNI-SABLONA', ai_nodes: [], visibility: 'personal' } })).json;
  expect(!!tplTym.id && !!tplOsobni.id, 'týmová a osobní šablona');
  await inst.api('POST', '/api/kb/calendars/save', { token: admin.token, body: { name: 'Firemní', kind: 'shared' } });
  await inst.api('POST', '/api/kb/calendars/save', { token: admin.token, body: { name: 'Nepřítomnosti', kind: 'absence' } });
  const evOsobni = await udalost(odch, { title: 'ZUBAR', day: den(3), time: '09:00' });
  const evPozvany = await udalost(odch, { title: 'OBED-S-KOLEGOU', day: den(4), time: '12:00', participants: [kolega.email] });
  const evFirma = await udalost(odch, { title: 'PORADA-TYMU', day: den(5), time: '10:00', calendar: 'Firemní', participants: [kolega.email, admin.email] });
  const evDovolena = await udalost(odch, { title: 'DOVOLENA-ODCHAZEJICIHO', day: den(6), end_day: den(8), calendar: 'Nepřítomnosti' });
  // pages and assistant images are written only by the server (assistant) → set up by the superuser
  const img = async (title) => (await su('POST', '/api/collections/ai_images/records', { user: odch.id, title, model: 'klein', preset: 'ctverec', stav: 'hotovo' })).json;
  const imgPouzity = await img('POUZITY'); const imgVolny = await img('VOLNY');
  expect(!!imgPouzity.id && !!imgVolny.id, 'dva obrázky asistenta');
  const stranka = async (title, extra) => (await su('POST', '/api/collections/ai_pages/records', Object.assign({ user: odch.id, title, html: `<h1>${title}</h1>`, stav: 'hotovo' }, extra || {}))).json;
  const pgSoukroma = await stranka('STRANKA-SOUKROMA');
  const pgTym = await stranka('STRANKA-TYMOVA', { team_visible: true, html: `<h1>T</h1><img src="/api/files/ai_images/${imgPouzity.id}/x.jpg">` });
  const pgVerejna = await stranka('STRANKA-VEREJNA', { share_token: 'tok' + 'a'.repeat(29) });
  const pgJmenovita = await stranka('STRANKA-JMENOVITA', { shared_with: [kolega.id] });
  // shared with the team AND by a public link: the page stays, the link must not
  const pgTymOdkaz = await stranka('STRANKA-TYM-ODKAZ', { team_visible: true, share_token: 'tok' + 'b'.repeat(29) });
  expect([pgSoukroma, pgTym, pgVerejna, pgJmenovita, pgTymOdkaz].every((p) => !!p.id), 'pět stránek (soukromá, týmová, jen s veřejným odkazem, jmenovitě sdílená, týmová s veřejným odkazem)');
  expect((await fetch(`${inst.base}/p/tok${'a'.repeat(29)}`)).status === 200 && (await fetch(`${inst.base}/p/tok${'b'.repeat(29)}`)).status === 200, 'předpoklad: oba veřejné odkazy před smazáním fungují');
  expect(naDisku() === '4', `předpoklad: 4 soubory příloh na disku (${naDisku()})`);

  console.log('== živé schéma nese změněné relace ==');
  const cols = (await su('GET', '/api/collections?perPage=200')).json.items;
  const rel = (c, f) => ((cols.find((x) => x.name === c) || {}).fields || []).find((x) => x.name === f) || {};
  for (const [c, f] of [['node_files', 'owner'], ['time_entries', 'owner'], ['templates', 'owner'], ['events', 'owner'], ['ai_pages', 'user'], ['ai_images', 'user']]) {
    expect(rel(c, f).cascadeDelete === false && rel(c, f).required === false, `${c}.${f}: bez kaskády, nepovinné (${rel(c, f).cascadeDelete}, ${rel(c, f).required})`);
  }
  expect(rel('goalmaps', 'owner').cascadeDelete === true, 'goalmaps.owner kaskádu má dál (soukromé projekty zanikají s účtem)');
  expect(rel('notifications', 'user').cascadeDelete === true && rel('api_keys', 'owner').cascadeDelete === true, 'osobní věci (zvoneček, klíče) kaskádu mají dál');

  console.log('== co dialog řekne PŘEDEM ==');
  r = await inst.api('GET', `/api/kb/users/${odch.id}/maps`, { token: admin.token });
  const sm = (r.json || {}).summary || {};
  expect(r.status === 200 && r.json.count === 9 && JSON.stringify(r.json.maps.map((m) => m.title).sort()) === JSON.stringify(['SE-SPOLUSPRAVCI', 'TYMOVY']),
    `projekty: 9 celkem, názvem jen ty, které admin vidí (${JSON.stringify({ c: r.json.count, p: r.json.private_count, m: (r.json.maps || []).map((m) => m.title) })})`);
  expect(sm.maps_to_coadmin === 2 && sm.maps_to_admin === 4 && sm.maps_private === 3 && sm.maps_no_holder === 0,
    `předání: 2 na spolusprávce, 4 na mě (týmový, sdílený jen ke čtení, veřejná vývěska, sdílený jen s neaktivním účtem), 3 soukromé zaniknou — i ten s osiřelým řádkem sdílení a ten s vlastní adresou (${JSON.stringify([sm.maps_to_coadmin, sm.maps_to_admin, sm.maps_private, sm.maps_no_holder])})`);
  expect(!JSON.stringify(r.json).includes('JEN-KE-CTENI') && !JSON.stringify(r.json).includes(CTENI.id) && !JSON.stringify(r.json).includes('SOUKROMY'), 'projekt, který admin nevidí, dialog nejmenuje (jen počet)');
  expect(sm.pages_private === 2 && sm.pages_kept === 3, `stránky: 2 zaniknou (soukromá a ta jen s veřejným odkazem), 3 zůstanou (${sm.pages_private}, ${sm.pages_kept})`);
  expect(sm.templates_personal === 1 && sm.templates_kept === 1, `šablony: 1 osobní zanikne, 1 týmová zůstane (${sm.templates_personal}, ${sm.templates_kept})`);
  expect(sm.events_private === 2 && sm.events_kept === 2, `události: 2 soukromé zaniknou, 2 zůstanou (${sm.events_private}, ${sm.events_kept})`);
  expect(sm.files_kept === 3 && sm.time_kept === 3, `v projektech ostatních a v předávaných: 3 přílohy, 3 záznamy času (${sm.files_kept}, ${sm.time_kept})`);
  r = await inst.api('GET', '/api/kb/users/map-counts', { token: admin.token });
  expect(r.status === 200 && ((r.json || {}).counts || {})[odch.id] === 9, `počet v řádku člověka = počet v dialogu (${r.status} ${((r.json || {}).counts || {})[odch.id]})`);

  console.log('== postup ze Správy uživatelů: smazat (předání dělá server uvnitř mazání) ==');
  expect((await inst.api('GET', `/api/collections/goalmaps/records/${CTENI.id}`, { token: admin.token })).status === 404, 'předpoklad: projekt sdílený jen ke čtení s třetím admin před smazáním nevidí');
  r = await inst.api('DELETE', `/api/collections/users/records/${odch.id}`, { token: kolega.token });
  expect(r.status === 403 || r.status === 404, `člen cizí účet nesmaže (${r.status})`);
  expect((await su('GET', `/api/collections/goalmaps/records/${COAD.id}`)).json.owner === odch.id, 'a neúspěšný pokus nic nepředal');
  r = await inst.api('DELETE', `/api/collections/users/records/${odch.id}`, { token: admin.token });
  expect(r.status === 204, `účet smazán (${r.status} ${JSON.stringify(r.json)})`);

  console.log('== sdílené projekty přešly na nového vlastníka ==');
  const po = async (id) => (await su('GET', `/api/collections/goalmaps/records/${id}`)).json || {};
  const radkySdileni = async (id) => (await pocet('map_shares', `map="${id}"`)).map((x) => x.email + ':' + x.permission).sort();
  const zmenyVlastnika = async (id) => await pocet('map_changes', `map="${id}" && field="owner" && item_id="${id}"`);
  const zvon = async (kdo, id) => (await pocet('notifications', `user="${kdo.id}"`)).filter((n) => n.map === id && /byl smazán|was deleted/.test(n.text)); // only the handover notices
  const co = await po(COAD.id);
  expect(co.owner === kolega.id && co.owner_email === kolega.email, `projekt se dvěma spolusprávci převzal ten DÉLE sdílený — kolega, ne mazající admin (${co.owner_email})`);
  expect(JSON.stringify(await radkySdileni(COAD.id)) === JSON.stringify([admin.email + ':edit', treti.email + ':read']),
    `sdílení ostatních zůstalo, nový vlastník ani smazaný účet řádek nemají (${(await radkySdileni(COAD.id)).join(', ')})`);
  expect(!JSON.stringify([co.shared_with, co.shared_with_edit, co.shared_with_work]).includes(odch.email) && !(co.shared_with || []).includes(kolega.email), 'ani v zrcadlech sdílení na projektu');
  let zmv = await zmenyVlastnika(COAD.id);
  expect(zmv.length === 1 && zmv[0].from === odch.email && zmv[0].to === kolega.email && zmv[0].actor_email === admin.email, `předání je v záznamu změn projektu (${zmv.length}: ${zmv[0] && zmv[0].from} → ${zmv[0] && zmv[0].to}, provedl ${zmv[0] && zmv[0].actor_email})`);
  let zv = await zvon(kolega, COAD.id);
  expect(zv.length === 1 && zv[0].type === 'org_notice' && /Účet odchazejici@sm\.cz byl smazán\. Projekt „SE-SPOLUSPRAVCI" přešel na vás/.test(zv[0].text), `nový vlastník dostal oznámení (${zv.length}: ${zv[0] && zv[0].text})`);
  expect((await inst.api('GET', `/api/collections/goalmaps/records/${COAD.id}`, { token: kolega.token })).status === 200 && (await inst.api('PATCH', `/api/collections/goalmaps/records/${COAD.id}`, { token: kolega.token, body: { description: 'spravuje kolega' } })).status === 200, 'nový vlastník projekt otevře a upraví');
  const ct = await po(CTENI.id);
  expect(ct.owner === admin.id, `projekt bez spolusprávce (sdílený jen ke čtení) převzal mazající administrátor (${ct.owner_email})`);
  expect(JSON.stringify(await radkySdileni(CTENI.id)) === JSON.stringify([treti.email + ':read']) && (await inst.api('GET', `/api/collections/goalmaps/records/${CTENI.id}`, { token: treti.token })).status === 200, 'čtenář o projekt nepřišel');
  zmv = await zmenyVlastnika(CTENI.id);
  expect(zmv.length === 1 && zmv[0].to === admin.email, 'i tohle předání je v záznamu změn');
  expect((await zvon(admin, CTENI.id)).length === 0 && (await zvon(admin, TEAM.id)).length === 0, 'mazající admin sám sobě oznámení neposílá (řekl mu to dialog)');
  expect((await zvon(treti, CTENI.id)).length === 0, 'čtenář, který nic nepřevzal, oznámení o převzetí nedostal');
  const ve = await po(VEREJNA.id);
  expect(ve.owner === admin.id && ve.is_public === true, `veřejná vývěska bez jiného sdílení nezanikla — převzal ji mazající administrátor a je dál veřejná (${ve.owner_email}, ${ve.is_public})`);
  expect(verejnePred === 200 && await verejneVidet() === 200, `veřejný odkaz vývěsky funguje před smazáním i po něm (${verejnePred}, ${await verejneVidet()})`);
  expect((await po(NEAKT1.id)).owner === treti.id, `účet, který se nikdy nepřihlásil, se přeskočí — projekt převzal další spolusprávce (${(await po(NEAKT1.id)).owner_email})`);
  const n2 = await po(NEAKT2.id);
  expect(n2.owner === admin.id && (await radkySdileni(NEAKT2.id)).join() === neakt.email + ':edit', `projekt sdílený jen s neaktivním účtem převzal mazající administrátor; sdílení neaktivnímu zůstalo (${n2.owner_email})`);
  expect((await zvon(neakt, NEAKT1.id)).length === 0 && (await zvon(neakt, NEAKT2.id)).length === 0, 'neaktivní účet oznámení o převzetí nedostal');
  const casyCoad = await pocet('time_entries', 'label="CAS-SE-SPOLUSPRAVCI"');
  expect(casyCoad.length === 1 && casyCoad[0].id === casCoad.id && casyCoad[0].owner === '', 'záznam času na předaném projektu zůstal');

  console.log('== soukromé zaniklo ==');
  expect((await su('GET', `/api/collections/goalmaps/records/${PRIV.id}`)).status === 404, 'soukromý projekt zanikl');
  expect((await pocet('node_files', `name="v-soukromem.bin"`)).length === 0, 'i jeho příloha');
  expect((await pocet('time_entries', 'label="CAS-SOUKROMY" || label="CAS-BEZ-PROJEKTU"')).length === 0, 'záznamy času na vlastním projektu a bez projektu zanikly');
  expect((await su('GET', `/api/collections/templates/records/${tplOsobni.id}`)).status === 404, 'osobní šablona zanikla');
  expect((await su('GET', `/api/collections/events/records/${evOsobni.id}`)).status === 404, 'soukromá událost zanikla');
  expect((await su('GET', `/api/collections/events/records/${evDovolena.id}`)).status === 404, 'vlastní nepřítomnost zanikla (týkala se jen jeho)');
  expect((await su('GET', `/api/collections/ai_pages/records/${pgSoukroma.id}`)).status === 404, 'soukromá stránka zanikla');
  expect((await su('GET', `/api/collections/ai_images/records/${imgVolny.id}`)).status === 404, 'nepoužitý obrázek asistenta zanikl');
  expect((await pocet('notifications', `user="${odch.id}"`)).length === 0 && (await pocet('map_shares', `email="${odch.email}"`)).length === 0, 'zvoneček a řádky sdílení zmizely');
  expect((await pocet('goalmaps', `owner="${odch.id}" || owner=""`)).length === 0, 'žádný projekt nezůstal bez vlastníka');

  expect((await su('GET', `/api/collections/goalmaps/records/${SIROTEK.id}`)).status === 404, 'soukromý projekt s OSIŘELÝM řádkem sdílení zanikl — admin ho nedostal');
  expect((await su('GET', `/api/collections/goalmaps/records/${VLASTNI.id}`)).status === 404, 'soukromý projekt, kde je ve sdílení jen VLASTNÍ adresa vlastníka, zanikl — admin ho nedostal');
  expect(!(await pocet('goalmaps', `owner="${admin.id}"`)).some((m) => /SOUKROMY/.test(m.title)), 'mezi projekty administrátora žádný soukromý projekt smazaného není');

  console.log('== co vložil do projektů ostatních, zůstalo ==');
  const tm = (await su('GET', `/api/collections/goalmaps/records/${TEAM.id}`)).json;
  expect(tm.owner === admin.id, 'převzatý projekt je adminův');
  const prilohyTeam = (await pocet('node_files', `map="${TEAM.id}"`)).map((f) => f.id).sort();
  expect(JSON.stringify(prilohyTeam) === JSON.stringify([fTeam.id, fTeamOdkaz.id, fTeamKolega.id].sort()), `přílohy v PŘEVZATÉM projektu zůstaly všechny tři (${prilohyTeam.length})`);
  const pKM = await pocet('node_files', `map="${KM.id}"`);
  expect(pKM.length === 1 && pKM[0].id === fKM.id && pKM[0].owner === '' && pKM[0].owner_email === odch.email, `příloha v projektu KOLEGY zůstala; vlastník prázdný, stopa autora zůstala (${JSON.stringify(pKM.map((f) => [f.owner, f.owner_email]))})`);
  expect(naDisku() === '3', `soubory na disku: 3 ze 4 — zmizel jen ten ze soukromého projektu (${naDisku()})`);
  const seznamKolegy = await inst.api('GET', `/api/collections/node_files/records?filter=${encodeURIComponent(`map="${KM.id}"`)}`, { token: kolega.token });
  expect(seznamKolegy.status === 200 && seznamKolegy.json.items.length === 1, 'kolega přílohu ve svém projektu dál vidí');
  r = await inst.api('DELETE', `/api/collections/node_files/records/${fKM.id}`, { token: admin.token });
  expect(r.status === 404 || r.status === 403, `cizí (ne vlastník projektu) osiřelou přílohu nesmaže (${r.status})`);
  const casy = (await pocet('time_entries', 'label="CAS-U-KOLEGY" || label="CAS-TYMOVY"')).map((t) => [t.id, t.owner, t.owner_email, t.duration_min]);
  expect(casy.length === 2 && casy.every((t) => t[1] === '' && t[2] === odch.email && t[3] === 60) && casy.some((t) => t[0] === casKM.id) && casy.some((t) => t[0] === casTeam.id),
    `záznamy času na projektu kolegy a na převzatém projektu zůstaly (${JSON.stringify(casy)})`);
  const kom = await pocet('comments', `goalmap="${KM.id}"`);
  expect(kom.length === 1 && kom[0].author_email === odch.email, 'komentář zůstal');

  console.log('== týmová šablona: zůstala, nikdy bez vlastníka ==');
  const tp = (await su('GET', `/api/collections/templates/records/${tplTym.id}`)).json;
  expect(tp.owner === admin.id && tp.owner_email === odch.email, `drží ji administrátor, autor ve stopě zůstal (${tp.owner === admin.id}, ${tp.owner_email})`);
  expect(tp.auto_create === '', `automatické zakládání projektů z ní je vypnuté („${tp.auto_create}")`);
  r = await inst.api('GET', `/api/collections/templates/records?perPage=200&filter=${encodeURIComponent('title="TYMOVA-SABLONA"')}`, { token: kolega.token });
  expect(r.status === 200 && r.json.items.length === 1, 'kolega ji v nabídce vidí');
  r = await inst.api('GET', `/api/collections/templates/records?perPage=200&filter=${encodeURIComponent('title="TYMOVA-SABLONA"')}`);
  expect(r.status === 200 && r.json.items.length === 0, `nepřihlášený ji NEvidí — nestala se „vestavěnou" (${r.json && r.json.items.length})`);

  console.log('== události ve sdílených kalendářích zůstaly, i s účastí ostatních ==');
  const evK = (await inst.api('GET', `/api/kb/events?from=${den(0)}&to=${den(30)}`, { token: kolega.token })).json.events || [];
  const najdi = (id) => evK.find((x) => x.id === id);
  const porada = najdi(evFirma.id);
  expect(!!porada && JSON.stringify((porada.participants || []).slice().sort()) === JSON.stringify([admin.email, kolega.email].sort()), `porada ve firemním kalendáři zůstala s oběma pozvanými (${porada && porada.participants})`);
  expect(!!porada && porada.owner_email === '' && porada.owner_former === true, `u autora příznak „bývalý člen" (${porada && JSON.stringify([porada.owner_email, porada.owner_former])})`);
  expect(!!najdi(evPozvany.id), 'osobní událost, na kterou byl kolega pozvaný, mu zůstala');
  expect(!najdi(evOsobni.id) && !najdi(evDovolena.id), 'soukromé události v kalendáři nejsou');
  const zivy = (await inst.api('GET', `/api/kb/events?from=${den(0)}&to=${den(30)}`, { token: admin.token })).json.events.find((x) => x.id === evFirma.id);
  expect(!!zivy && zivy.can_edit === true, 'správce osiřelou událost ve sdíleném kalendáři dál umí upravit');

  console.log('== sdílené stránky zůstaly ==');
  const pg = async (id) => (await su('GET', `/api/collections/ai_pages/records/${id}`));
  expect((await pg(pgTym.id)).status === 200 && (await pg(pgTymOdkaz.id)).status === 200 && (await pg(pgJmenovita.id)).status === 200, 'týmové a jmenovitě sdílená stránka zůstaly');
  expect((await pg(pgVerejna.id)).status === 404, `stránka jen s veřejným odkazem zanikla — odkaz by už nikdo nevypnul (${(await pg(pgVerejna.id)).status})`);
  expect((await su('GET', `/api/collections/ai_images/records/${imgPouzity.id}`)).status === 200, 'obrázek použitý v týmové stránce zůstal');
  r = await inst.api('GET', '/api/kb/chat/stranky?skupina=tym', { token: kolega.token });
  const sdilene = (r.json || {}).stranky || [];
  const tit = sdilene.map((x) => x.title).sort();
  expect(r.status === 200 && JSON.stringify(tit) === JSON.stringify(['STRANKA-JMENOVITA', 'STRANKA-TYM-ODKAZ', 'STRANKA-TYMOVA']), `kolega sdílené stránky v seznamu vidí (${r.status}: ${tit.join(', ')})`);
  expect(sdilene.length === 3 && sdilene.every((x) => x.owner_former === true && x.owner_name === ''), `a u autora je příznak „bývalý člen" (${JSON.stringify(sdilene.map((x) => [x.owner_name, x.owner_former]))})`);
  r = await fetch(`${inst.base}/p/tok${'a'.repeat(29)}`);
  const r2 = await fetch(`${inst.base}/p/tok${'b'.repeat(29)}`);
  expect(r.status === 404 && r2.status === 404 && !/STRANKA/.test(await r2.text()), `veřejné odkazy stránek smazaného člena už nic neukážou (${r.status}, ${r2.status})`);
  expect((await pg(pgTymOdkaz.id)).json.share_token === '', 'u zachované týmové stránky je veřejný odkaz zrušen');

  console.log('== zachované záznamy bez vlastníka NEČTE ani nemění nepřihlášený ==');
  // Security review 11 Nov 2026: `owner = @request.auth.id` is true for an anonymous request once the owner is empty.
  const anon = (method, path, body) => inst.api(method, path, { body });
  for (const col of ['ai_pages', 'ai_images', 'time_entries', 'node_files', 'events']) {
    r = await anon('GET', `/api/collections/${col}/records?perPage=50`);
    expect((r.status === 200 && r.json.items.length === 0) || r.status === 403 || r.status === 401, `nepřihlášený: výpis ${col} je prázdný (${r.status} ${r.json && r.json.items ? r.json.items.length : ''})`);
  }
  for (const [col, id] of [['ai_pages', pgTym.id], ['ai_images', imgPouzity.id], ['time_entries', casKM.id]]) {
    r = await anon('GET', `/api/collections/${col}/records/${id}`);
    expect(r.status === 404 || r.status === 403, `nepřihlášený: záznam ${col} podle id nedostane (${r.status})`);
  }
  r = await anon('PATCH', `/api/collections/time_entries/records/${casKM.id}`, { label: 'PREPSANO-ANONYMEM' });
  expect(r.status === 404 || r.status === 403, `nepřihlášený záznam času nepřepíše (${r.status})`);
  r = await anon('DELETE', `/api/collections/time_entries/records/${casKM.id}`);
  expect(r.status === 404 || r.status === 403, `ani nesmaže (${r.status})`);
  const casPo = (await su('GET', `/api/collections/time_entries/records/${casKM.id}`));
  expect(casPo.status === 200 && casPo.json.label === 'CAS-U-KOLEGY', 'záznam času je netknutý');
  r = await inst.api('GET', '/api/collections/time_entries/records?perPage=50', { token: kolega.token });
  expect(r.status === 200 && r.json.items.every((t) => t.owner_email !== odch.email), 'ani přihlášený kolega cizí osiřelý záznam času nevidí (pravidlo zůstalo „jen vlastník")');
  const vestavena = ((await anon('GET', `/api/collections/templates/records?perPage=1&filter=${encodeURIComponent('owner=""')}`)).json.items || [])[0];
  expect(!!vestavena, 'vestavěná šablona je dál veřejně čitelná (záměr)');
  r = await anon('PATCH', `/api/collections/templates/records/${vestavena.id}`, { title: 'PREPSANO-ANONYMEM' });
  expect(r.status === 404 || r.status === 403, `nepřihlášený vestavěnou šablonu nepřepíše (${r.status})`);
  r = await anon('DELETE', `/api/collections/templates/records/${vestavena.id}`);
  expect(r.status === 404 || r.status === 403, `ani nesmaže (${r.status})`);
  r = await inst.api('PATCH', `/api/collections/templates/records/${vestavena.id}`, { token: kolega.token, body: { title: 'PREPSANO-CLENEM' } });
  expect(r.status === 404 || r.status === 403, `běžný člen vestavěnou šablonu nepřepíše (${r.status})`);
  const vPo = (await su('GET', `/api/collections/templates/records/${vestavena.id}`));
  expect(vPo.status === 200 && vPo.json.title === vestavena.title, 'vestavěná šablona je netknutá');
  r = await inst.api('PATCH', `/api/collections/templates/records/${tplTym.id}`, { token: admin.token, body: { description: 'spravuje administrátor' } });
  expect(r.status === 200, `administrátor převzatou týmovou šablonu dál spravuje (${r.status})`);
  const cols2 = (await su('GET', '/api/collections?perPage=200')).json.items;
  const pravidla = (c) => { const x = cols2.find((y) => y.name === c) || {}; return ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].map((k) => [k, x[k]]); };
  for (const c of ['node_files', 'time_entries', 'templates', 'events', 'ai_pages', 'ai_images']) {
    const bez = pravidla(c).filter(([k, v]) => v !== null && !(c === 'templates' && (k === 'listRule' || k === 'viewRule')) && !/^@request\.auth\.id != ""/.test(v));
    expect(bez.length === 0, `živé schéma: každé pravidlo ${c} začíná podmínkou přihlášení (${bez.map(([k]) => k).join(', ') || 'vše'})`);
  }

  console.log('== předání bez mazajícího admina (superuser) a adresa s _ a % ==');
  // a member whose only shared project has no co-admin, deleted by the superuser → the
  // longest-standing administrator holds it, and (not being the actor) is notified
  const dalsi = await ucet('dalsi@sm.cz');
  const DT = await mapa(dalsi, 'DALSIHO-TYMOVY');
  await share(dalsi, { action: 'set_team_access', mapId: DT.id, access: 'read' });
  const DP = await mapa(dalsi, 'DALSIHO-SOUKROMY');
  r = await su('GET', `/api/kb/users/${dalsi.id}/maps`);
  expect(r.status === 200 && r.json.summary.maps_to_admin === 1 && r.json.summary.maps_private === 1, `superuser: souhrn 1 na administrátora, 1 soukromý (${JSON.stringify(r.json && r.json.summary)})`);
  r = await su('DELETE', `/api/collections/users/records/${dalsi.id}`);
  expect(r.status === 204, `superuser účet smazal (${r.status})`);
  expect((await po(DT.id)).owner === admin.id && (await su('GET', `/api/collections/goalmaps/records/${DP.id}`)).status === 404, 'týmový projekt drží administrátor, soukromý zanikl');
  zv = await zvon(admin, DT.id);
  expect(zv.length === 1 && /Účet dalsi@sm\.cz byl smazán/.test(zv[0].text), `administrátor, který sám nemazal, oznámení dostal (${zv.length})`);
  // English recipient: the third account becomes an owner through a co-admin share
  const posl = await ucet('posledni@sm.cz');
  const PE = await mapa(posl, 'FOR-ENGLISH');
  await share(posl, { action: 'share', mapId: PE.id, email: treti.email, permission: 'edit' });
  r = await inst.api('DELETE', `/api/collections/users/records/${posl.id}`, { token: admin.token });
  zv = await zvon(treti, PE.id);
  expect(r.status === 204 && (await po(PE.id)).owner === treti.id && zv.length === 1 && /The account posledni@sm\.cz was deleted\. The project "FOR-ENGLISH" passed to you/.test(zv[0].text), `anglický spolusprávce převzal a dostal anglický text (${zv[0] && zv[0].text})`);
  // a co-admin whose right is in map_shares but who is missing in the share list (mirror) still takes over
  const mimo = await ucet('mimo@sm.cz');
  const MZ = await mapa(mimo, 'RADEK-BEZ-ZRCADLA');
  await radekSdileni(MZ.id, kolega.email, 'edit');
  r = await inst.api('DELETE', `/api/collections/users/records/${mimo.id}`, { token: admin.token });
  expect(r.status === 204 && (await po(MZ.id)).owner === kolega.id, `spolusprávce s právem v map_shares, ale bez položky v zrcadle, projekt převzal (${(await po(MZ.id)).owner_email})`);
  // the address with LIKE wildcards leaves the share lists too
  expect((await radkySdileni(KM2.id)).includes(podtrz.email + ':edit'), 'předpoklad: adresa s _ a % má sdílení v projektu kolegy');
  r = await inst.api('DELETE', `/api/collections/users/records/${podtrz.id}`, { token: admin.token });
  const km2 = await po(KM2.id);
  expect(r.status === 204 && (await radkySdileni(KM2.id)).length === 0 && !JSON.stringify([km2.shared_with, km2.shared_with_edit, km2.shared_with_work]).includes(podtrz.email),
    `po smazání účtu s _ a % v adrese jeho sdílení zmizelo z řádků i ze zrcadel (${(await radkySdileni(KM2.id)).join(', ')} ${JSON.stringify(km2.shared_with)})`);

  console.log('== znovu založený účet se stejnou adresou nic nezdědí ==');
  const znovu = await ucet('odchazejici@sm.cz');
  r = await inst.api('GET', `/api/collections/time_entries/records`, { token: znovu.token });
  expect(r.status === 200 && r.json.items.length === 0, 'nový účet téže adresy nevidí staré záznamy času');
  expect((await inst.api('GET', `/api/collections/goalmaps/records/${KM.id}`, { token: znovu.token })).status === 404, 'ani projekt kolegy');
  expect((await inst.api('GET', `/api/collections/goalmaps/records/${COAD.id}`, { token: znovu.token })).status === 404 && (await inst.api('GET', `/api/collections/goalmaps/records/${TEAM.id}`, { token: znovu.token })).status === 200,
    'ani předaný jmenovitě sdílený projekt (týmový vidí jako každý člen)');
}, { nazev: 'SMAZANI-CLENA' });
