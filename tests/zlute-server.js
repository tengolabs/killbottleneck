// Yellow findings of code analysis 4, server side — what has no natural home in another suite.
//
//  M1-03  syncShares deleted only the first 500 rows of a project's shares: rows above that stayed
//         behind (and with 500+ named shares re-inserting hit the unique index — sharing was stuck).
//  M1-04  share lists written by the owner straight through the API (not the /share route) left the
//         authorization rows untouched, and the owner could get a share row for their own project.
//  M1-06  a deleted member's PRIVATE contacts stayed in the database, visible to nobody.
//  S4-04  an account's e-mail change left sharing, ownership and step owners on the old address.
//  S8-07  the daily digest window lived only in memory: after a restart it fell back to 24 hours.
//
// Mutation proof: on the image before the fix one stale share row survives and the private contact stays.
const H = require('./_harness');
const { expect } = H;

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'zlute-server', env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  for (const e of ['a@e2e.cz', 'b@e2e.cz', 'c@e2e.cz']) await inst.register(e);
  const A = await inst.login('a@e2e.cz'); // the first account = administrator
  const C = await inst.login('c@e2e.cz');
  const uid = async (email) => (await inst.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent(`email="${email}"`), { token: ST })).json.items[0].id;

  console.log('== M1-03: sdílení projektu se přestaví celé, i když má přes 500 řádků ==');
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Velké sdílení', nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Velké sdílení', title: 'Velké sdílení', status: 'todo' } }], edges: [] } })).json;
  expect(!!mapa.id, 'projekt založen');
  const N = 520;
  let zapsano = 0;
  for (let i = 0; i < N; i += 20) {
    const davka = await Promise.all(Array.from({ length: Math.min(20, N - i) }, (_, k) => inst.api('POST', '/api/collections/map_shares/records', { token: ST, body: { map: mapa.id, email: `duch${i + k}@e2e.cz`, permission: 'read', email_edit: '' } })));
    zapsano += davka.filter((r) => r.status === 200).length;
  }
  expect(zapsano === N, `${N} starých řádků sdílení zapsáno (${zapsano})`);
  const radky = async () => (await inst.api('GET', `/api/collections/map_shares/records?perPage=1&filter=${encodeURIComponent(`map="${mapa.id}"`)}`, { token: ST })).json;
  expect((await radky()).totalItems === N, 'před změnou jich je 520');
  let r = await inst.api('POST', '/api/kb/share', { token: A, body: { action: 'share', mapId: mapa.id, email: 'b@e2e.cz', permission: 'read' } });
  expect(r.status === 200, `vlastník nasdílí projekt kolegovi (${r.status} ${r.json && r.json.error})`);
  const po = await radky();
  expect(po.totalItems === 1 && po.items[0].email === 'b@e2e.cz', `po přestavbě zbyl jen řádek kolegy, žádný starý (${po.totalItems})`);

  console.log('== M1-04: seznamy sdílení zapsané vlastníkem přímo přes API končí stejnými řádky jako routa ==');
  const mapa2 = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Přímý zápis', shared_with: ['a@e2e.cz', 'b@e2e.cz'], shared_with_edit: ['a@e2e.cz'], nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Přímý zápis', title: 'Přímý zápis', status: 'todo' } }], edges: [] } })).json;
  const radky2 = async () => ((await inst.api('GET', `/api/collections/map_shares/records?perPage=50&filter=${encodeURIComponent(`map="${mapa2.id}"`)}`, { token: ST })).json.items || []).map((x) => `${x.email}:${x.permission}`).sort().join(',');
  expect(await radky2() === 'b@e2e.cz:read', `nový projekt: vlastník sám sobě řádek sdílení nedostane (${await radky2()})`);
  const m2 = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa2.id}`, { token: A })).json;
  expect(JSON.stringify(m2.shared_with) === '["b@e2e.cz"]' && JSON.stringify(m2.shared_with_edit || []) === '[]', `ani v seznamech na projektu vlastník není (${JSON.stringify(m2.shared_with)})`);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa2.id}`, { token: A, body: { shared_with: ['b@e2e.cz', 'c@e2e.cz', 'a@e2e.cz'], shared_with_edit: ['c@e2e.cz'] } });
  expect(r.status === 200 && await radky2() === 'b@e2e.cz:read,c@e2e.cz:edit', `úprava seznamů přes API přestaví řádky (${await radky2()})`);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa2.id}`, { token: A, body: { shared_with: [], shared_with_edit: [] } });
  expect(r.status === 200 && await radky2() === '', `vyprázdnění seznamů řádky smaže (${await radky2()})`);
  r = await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa2.id}`, { token: A, body: { title: 'Přímý zápis 2' } });
  expect(r.status === 200 && r.json.title === 'Přímý zápis 2', 'běžná úprava projektu beze změny sdílení projde');

  console.log('== M1-06: soukromé kontakty smazaného člena mizí s ním, týmové zůstávají ==');
  const soukromy = (await inst.api('POST', '/api/collections/external_contacts/records', { token: C, body: { name: 'Soukromý kontakt', private: true } })).json;
  const tymovy = (await inst.api('POST', '/api/collections/external_contacts/records', { token: C, body: { name: 'Týmový kontakt', private: false } })).json;
  expect(!!soukromy.id && !!tymovy.id, 'člen si založil soukromý a týmový kontakt');
  r = await inst.api('DELETE', `/api/collections/users/records/${await uid('c@e2e.cz')}`, { token: A });
  expect(r.status === 204, `správce smazal člena (${r.status})`);
  const kontakty = ((await inst.api('GET', '/api/collections/external_contacts/records?perPage=50', { token: ST })).json.items || []).map((k) => k.name).sort().join(',');
  expect(kontakty === 'Týmový kontakt', `v databázi zůstal jen týmový kontakt (${kontakty})`);

  console.log('== S4-04: změna e-mailu účtu — sdílení, vlastnictví i kroky jdou za novou adresou ==');
  {
    const Bt = await inst.login('b@e2e.cz');
    const bid = await uid('b@e2e.cz');
    const ap = (t) => ({ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: t, title: t, status: 'todo' } });
    const cizi = (await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Sdílený s B', shared_with: ['b@e2e.cz'], nodes: [ap('Sdílený s B'), { id: 'k1', type: 'goalNode', position: { x: 0, y: 100 }, data: { title: 'Krok kolegy', status: 'todo', owner: 'b@e2e.cz' } }], edges: [{ id: 'e1', source: 'root', target: 'k1' }] } })).json;
    const vlastni = (await inst.api('POST', '/api/collections/goalmaps/records', { token: Bt, body: { title: 'Projekt B', nodes: [ap('Projekt B')], edges: [] } })).json;
    expect(!!cizi.id && !!vlastni.id && (await inst.api('GET', `/api/collections/goalmaps/records/${cizi.id}`, { token: Bt })).status === 200, 'kolega B vidí sdílený projekt a má vlastní');
    const zm = await inst.api('PATCH', `/api/collections/users/records/${bid}`, { token: ST, body: { email: 'b-nova@e2e.cz' } });
    expect(zm.status === 200 && zm.json.email === 'b-nova@e2e.cz', `provozovatel změnil účtu adresu (${zm.status})`);
    const Bn = await inst.login('b-nova@e2e.cz');
    expect((await inst.api('GET', `/api/collections/goalmaps/records/${cizi.id}`, { token: Bn })).status === 200, 'po změně adresy sdílený projekt pořád vidí');
    const c2 = (await inst.api('GET', `/api/collections/goalmaps/records/${cizi.id}`, { token: ST })).json;
    expect(JSON.stringify(c2.shared_with) === '["b-nova@e2e.cz"]' && ((c2.nodes || []).find((n) => n.id === 'k1') || { data: {} }).data.owner === 'b-nova@e2e.cz', `seznam sdílení i řešitel kroku nesou novou adresu (${JSON.stringify(c2.shared_with)})`);
    const v2 = (await inst.api('GET', `/api/collections/goalmaps/records/${vlastni.id}`, { token: ST })).json;
    expect(v2.owner_email === 'b-nova@e2e.cz', `vlastní projekt má vlastníka na nové adrese (${v2.owner_email})`);
    const stareRadky = (await inst.api('GET', `/api/collections/map_shares/records?perPage=1&filter=${encodeURIComponent('email="b@e2e.cz"')}`, { token: ST })).json.totalItems;
    expect(stareRadky === 0, `na staré adrese nezůstal žádný řádek sdílení (${stareRadky})`);
    await inst.register('b@e2e.cz');
    const Bstary = await inst.login('b@e2e.cz');
    expect((await inst.api('GET', `/api/collections/goalmaps/records/${cizi.id}`, { token: Bstary })).status === 404, 'kdo si starou adresu zaregistruje znovu, sdílený projekt nezdědí');
  }

  console.log('== S2-11 + S3-06: krok s id „constructor“; převod projektů provozovatelem bez cílové adresy ==');
  {
    const ap = { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Divná id', title: 'Divná id', status: 'todo' } };
    const k = (id) => ({ id, type: 'goalNode', position: { x: 0, y: 100 }, data: { title: 'Krok ' + id, status: 'todo' } });
    const rr = await inst.api('POST', '/api/collections/goalmaps/records', { token: A, body: { title: 'Divná id', nodes: [ap, k('constructor'), k('toString')], edges: [{ id: 'e1', source: 'root', target: 'constructor' }, { id: 'e2', source: 'root', target: 'toString' }] } });
    expect(rr.status === 200, `projekt s kroky „constructor“ a „toString“ jde uložit (${rr.status} ${rr.json && (rr.json.message || rr.json.error) || ''})`);
    const tr = await inst.api('POST', `/api/kb/users/${await uid('a@e2e.cz')}/transfer-maps`, { token: ST, body: {} });
    expect(tr.status === 400 && /člen|member/i.test(JSON.stringify(tr.json)), `provozovatel bez cílové adresy dostane srozumitelné odmítnutí (${tr.status} ${JSON.stringify(tr.json).slice(0, 120)})`);
  }

  console.log('== M1-07, M1-08: jeden řádek nastavení; datum nápadu ==');
  {
    const aid = await uid('a@e2e.cz');
    let o1 = await inst.api('POST', '/api/collections/org_settings/records', { token: A, body: { name: 'Firma' } });
    const bylo = ((await inst.api('GET', '/api/collections/org_settings/records', { token: ST })).json.items || []).length;
    const o2 = await inst.api('POST', '/api/collections/org_settings/records', { token: A, body: { name: 'Firma podruhé' } });
    const je = ((await inst.api('GET', '/api/collections/org_settings/records', { token: ST })).json.items || []).length;
    expect(bylo === 1 && o2.status === 400 && je === 1, `druhý řádek nastavení organizace server odmítne (první ${o1.status}, druhý ${o2.status}, řádků ${je})`);
    const n1 = await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Nápad', owner: aid, deadline: 'pozitri' } });
    const n2 = await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Nápad', owner: aid, planned_on: '2099-99-99' } });
    const n3 = await inst.api('POST', '/api/collections/buffer_nodes/records', { token: A, body: { title: 'Nápad', owner: aid, deadline: '2027-01-15' } });
    expect(n1.status === 400 && n2.status === 400 && n3.status === 200, `nápad v zásobníku: „pozitri“ a „2099-99-99“ ne, skutečné datum ano (${n1.status}, ${n2.status}, ${n3.status})`);
    const n4 = await inst.api('PATCH', `/api/collections/buffer_nodes/records/${n3.json.id}`, { token: A, body: { title: 'Nápad přejmenovaný' } });
    expect(n4.status === 200, `úprava jiného pole nápadu projde (${n4.status})`);
  }

  console.log('== S2-07: důvod přeskočené akce v historii pravidla je v jazyce vlastníka projektu ==');
  await inst.register('en@e2e.cz', { language: 'en' });
  const EN = await inst.login('en@e2e.cz');
  const uzlyP = [
    { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Rules', title: 'Rules', status: 'todo' } },
    { id: 'Z', type: 'goalNode', position: { x: 0, y: 200 }, data: { title: 'No owner', status: 'todo' } },
  ];
  const hranyP = [{ id: 'e1', source: 'root', target: 'Z' }];
  const beh = async (token, kdo) => {
    const m = (await inst.api('POST', '/api/collections/goalmaps/records', { token, body: { title: 'Rules ' + kdo, nodes: uzlyP, edges: hranyP } })).json;
    const pravidlo = (await inst.api('POST', '/api/collections/automation_rules/records', { token: ST, body: { map: m.id, enabled: true, created_by: kdo, name: 'Done → deputy', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'set_owner', owner: 'deputy_of_node_owner' }] } })).json;
    const hotovo = uzlyP.map((n) => (n.id === 'Z' ? { ...n, data: { ...n.data, status: 'done' } } : n));
    const p = await inst.api('PATCH', `/api/collections/goalmaps/records/${m.id}`, { token, body: { nodes: hotovo, edges: hranyP } });
    const behy = (await inst.api('GET', `/api/collections/rule_runs/records?perPage=20&filter=${encodeURIComponent(`rule="${pravidlo.id}"`)}`, { token: ST })).json.items || [];
    return { status: p.status, beh: behy[0] || {} };
  };
  const bEn = await beh(EN, 'en@e2e.cz');
  const duvodEn = String(bEn.beh.detail || '') + ' ' + JSON.stringify(bEn.beh.actions_done || []);
  expect(bEn.status === 200 && bEn.beh.status === 'skipped' && /skipped: set_owner \(the step has no responsible person/.test(duvodEn) && !/přeskočeno|zodpovědnou/.test(duvodEn),
    `anglický vlastník čte důvod anglicky (${bEn.beh.status}: ${bEn.beh.detail})`);
  const bCs = await beh(A, 'a@e2e.cz');
  expect(bCs.beh.status === 'skipped' && /přeskočeno: set_owner \(uzel nemá zodpovědnou osobu/.test(String(bCs.beh.detail || '')), `český vlastník beze změny česky (${bCs.beh.detail})`);
  inst.stop();

  console.log('== S8-04: souběžná kreslení nepřečerpají týdenní kvótu kreditů ==');
  // own picture service (OpenAI Images API) that answers after 1.5 s — the four requests overlap
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]).toString('base64');
  const sluzba = await H.httpMock((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    setTimeout(() => res.end(JSON.stringify({ created: 1, data: [{ b64_json: JPEG }] })), 1500);
  });
  // quota 5 credits a week, a picture costs 3: one fits (0 → 3), the second too (3 < 5 → 6), the third must wait
  const kr = await H.startInstance({ slug: 'zlute-kredity', addHostGateway: true, env: { KB_UVODNI_MAPA: 0, KB_IMAGE_PROVIDER: 'openai', KB_IMAGE_URL: sluzba.base + '/v1', KB_IMAGE_TOKEN: 'sk-test', KB_AI_KVOTA_TYDEN: '5', KB_OBRAZEK_KREDITY: '3', KB_AI_MAX_PER_HOUR: 600 } });
  await kr.register('a@e2e.cz');
  const KA = await kr.login('a@e2e.cz');
  const KS = await kr.superuser();
  const kuid = (await kr.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="a@e2e.cz"'), { token: KS })).json.items[0].id;
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push((await kr.api('POST', '/api/collections/ai_images/records', { token: KS, body: { user: kuid, title: 'Obrázek ' + i, prompt: 'a tree, no text', model: 'klein', preset: 'ctverec', stav: 'ceka' } })).json.id);
  expect(ids.every(Boolean), 'čtyři zadané obrázky čekají na nakreslení');
  const vys = await Promise.all(ids.map((id) => kr.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: KA, body: { id } })));
  const nakresleno = vys.filter((v) => v.status === 200 && v.json.obrazek && v.json.obrazek.stav === 'hotovo').length;
  const odmitnuto = vys.filter((v) => v.status === 429 && v.json.code === 'ai_kvota').length;
  const logK = ((await kr.api('GET', '/api/collections/ai_chat_log/records?perPage=50', { token: KS })).json.items || []).filter((l) => l.tools === 'image_draw' && l.stav === 'ok');
  const utraceno = logK.reduce((a, l) => a + (Number(l.kredity) || 0), 0);
  expect(nakresleno === 2 && odmitnuto === 2 && sluzba.pozadavky.length === 2, `4 kreslení naráz při kvótě 5 a ceně 3: nakreslí se 2, 2 odmítne kvóta ještě před službou (nakresleno ${nakresleno}, odmítnuto ${odmitnuto}, služba volána ${sluzba.pozadavky.length}×; stavy ${vys.map((v) => v.status).join(',')})`);
  expect(utraceno === 6, `utraceno 6 kreditů, ne 12 (${utraceno})`);
  const stavyPo = await Promise.all(ids.map(async (id) => ((await kr.api('GET', `/api/kb/chat/obrazek/${id}`, { token: KA })).json.obrazek || {}).stav));
  expect(stavyPo.filter((x) => x === 'chyba').length === 2, `odmítnuté obrázky jsou „chyba“ se Zkusit znovu, netočí se (${stavyPo.join(',')})`);
  // the reservation is given back: with the quota raised the next drawing passes
  const dalsi = await kr.api('POST', '/api/kb/chat/obrazek/vytvorit', { token: KA, body: { id: ids[vys.findIndex((v) => v.status === 429)] } });
  expect(dalsi.status === 429 && dalsi.json.code === 'ai_kvota', `po doběhnutí je kvóta vyčerpaná doopravdy (6 z 5) → další kreslení 429 (${dalsi.status})`);
  kr.stop();

  console.log('== S8-07: okno denního souhrnu přežije restart instance ==');
  // the last digest went out 4 days ago, a notification is 3 days old, the instance restarts (the
  // in-memory stamp is gone) → the scheduled run must still send it; before, the window fell to 24 h
  const sink = await H.smtpSink();
  const dg = await H.startInstance({ slug: 'zlute-souhrn', addHostGateway: true, env: { KB_UVODNI_MAPA: 0, KB_NOTIFY_DIGEST_HOUR: 0 } });
  await dg.register('a@e2e.cz'); await dg.register('d@e2e.cz');
  const DD = await dg.login('d@e2e.cz');
  let DS = await dg.superuser();
  const did = (await dg.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="d@e2e.cz"'), { token: DS })).json.items[0].id;
  await dg.api('PATCH', `/api/collections/users/records/${did}`, { token: DD, body: { notify_email_mode: 'digest' } });
  const stara = await dg.api('POST', '/api/collections/notifications/records', { token: DS, body: { user: did, type: 'node_assigned', text: 'Oznameni XQ5 z doby vypadku', read: false, count: 1 } });
  const den4 = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  const zn = await dg.api('POST', '/api/collections/mail_budget/records', { token: DS, body: { user: did, day: 'digest:' + den4, sent: 1 } });
  expect(stara.status === 200 && zn.status === 200, `notifikace a značka posledního souhrnu založeny (${stara.status}, ${zn.status})`);
  dg.pause();
  {
    const { execSync } = require('child_process'); const fs = require('fs');
    const tmp = `/tmp/kb-zlute-dg-${process.pid}.db`; const skript = `/tmp/kb-zlute-dg-${process.pid}.py`;
    execSync(`docker cp ${dg.name}:/app/pb_data/data.db ${tmp}`, { stdio: 'ignore' });
    fs.writeFileSync(skript, ['import sqlite3, sys', 'c = sqlite3.connect(sys.argv[1])',
      `c.execute("UPDATE notifications SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-3 days') WHERE id = ?", ("${stara.json.id}",))`,
      `c.execute("UPDATE mail_budget SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-4 days','-1 minutes') WHERE id = ?", ("${zn.json.id}",))`,
      'c.commit(); c.close()'].join('\n'));
    execSync(`python3 ${skript} ${tmp}`, { stdio: 'ignore' });
    execSync(`docker cp ${tmp} ${dg.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
    fs.rmSync(skript, { force: true }); fs.rmSync(tmp, { force: true });
  }
  await dg.resume();
  DS = await dg.superuser();
  await sink.zapoj(dg, DS);
  const cronDg = async () => { const x = await dg.api('POST', '/api/crons/email_digests', { token: DS }); await H.sleep(1500); return x.status; };
  const cs = await cronDg();
  const mailD = sink.maily.find((m) => /d@e2e\.cz/.test(m));
  expect((cs === 204 || cs === 200) && !!mailD && mailD.replace(/=\n/g, '').includes('Oznameni XQ5'), `po restartu souhrn nese 3 dny starou notifikaci — okno sahá k poslednímu souhrnu, ne jen 24 h (mailů ${sink.maily.length})`);
  const znacky = ((await dg.api('GET', `/api/collections/mail_budget/records?filter=${encodeURIComponent('day ~ "digest:"')}&sort=-created`, { token: DS })).json.items || []);
  const dnesni = znacky.find((z) => z.id !== zn.json.id);
  expect(!!dnesni && Number(dnesni.sent) === 1, `dnešní značka je uzavřená s počtem odeslaných (${dnesni ? dnesni.sent : 'chybí'})`);
  await cronDg();
  expect(sink.maily.filter((m) => /d@e2e\.cz/.test(m)).length === 1, 'druhý běh téhož dne nepošle nic');
  // the 7-day ceiling: an older marker does not pull weeks of notifications into one e-mail
  const dg2 = await H.startInstance({ slug: 'zlute-souhrn2', addHostGateway: true, env: { KB_UVODNI_MAPA: 0, KB_NOTIFY_DIGEST_HOUR: 0 } });
  await dg2.register('a@e2e.cz'); await dg2.register('d@e2e.cz');
  const DD2 = await dg2.login('d@e2e.cz');
  let DS2 = await dg2.superuser();
  const did2 = (await dg2.api('GET', '/api/collections/users/records?filter=' + encodeURIComponent('email="d@e2e.cz"'), { token: DS2 })).json.items[0].id;
  await dg2.api('PATCH', `/api/collections/users/records/${did2}`, { token: DD2, body: { notify_email_mode: 'digest' } });
  const n9 = await dg2.api('POST', '/api/collections/notifications/records', { token: DS2, body: { user: did2, type: 'node_assigned', text: 'Oznameni XQ9 devet dni', read: false, count: 1 } });
  const n2 = await dg2.api('POST', '/api/collections/notifications/records', { token: DS2, body: { user: did2, type: 'node_assigned', text: 'Oznameni XQ2 dva dny', read: false, count: 1 } });
  const zn2 = await dg2.api('POST', '/api/collections/mail_budget/records', { token: DS2, body: { user: did2, day: 'digest:2026-01-01', sent: 1 } });
  dg2.pause();
  {
    const { execSync } = require('child_process'); const fs = require('fs');
    const tmp = `/tmp/kb-zlute-dg2-${process.pid}.db`; const skript = `/tmp/kb-zlute-dg2-${process.pid}.py`;
    execSync(`docker cp ${dg2.name}:/app/pb_data/data.db ${tmp}`, { stdio: 'ignore' });
    fs.writeFileSync(skript, ['import sqlite3, sys', 'c = sqlite3.connect(sys.argv[1])',
      `c.execute("UPDATE notifications SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-9 days') WHERE id = ?", ("${n9.json.id}",))`,
      `c.execute("UPDATE notifications SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-2 days') WHERE id = ?", ("${n2.json.id}",))`,
      `c.execute("UPDATE mail_budget SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-20 days','-1 minutes') WHERE id = ?", ("${zn2.json.id}",))`,
      'c.commit(); c.close()'].join('\n'));
    execSync(`python3 ${skript} ${tmp}`, { stdio: 'ignore' });
    execSync(`docker cp ${tmp} ${dg2.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
    fs.rmSync(skript, { force: true }); fs.rmSync(tmp, { force: true });
  }
  await dg2.resume();
  DS2 = await dg2.superuser();
  await sink.zapoj(dg2, DS2);
  const pred2 = sink.maily.length;
  await dg2.api('POST', '/api/crons/email_digests', { token: DS2 }); await H.sleep(1500);
  const mail2 = (sink.maily.slice(pred2).find((m) => /d@e2e\.cz/.test(m)) || '').replace(/=\n/g, '');
  expect(mail2.includes('Oznameni XQ2') && !mail2.includes('Oznameni XQ9'), `strop 7 dní: notifikace stará 2 dny v souhrnu je, 9 dní stará ne (${mail2 ? 'mail přišel' : 'mail nepřišel'})`);
  dg.stop(); dg2.stop();
}, { nazev: 'ZLUTE-SERVER' });
