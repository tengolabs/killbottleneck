// Code analysis 4, wave 4 — server (notifications, import, rules, e-mail digest, mail_budget cleanup):
//   S2-01  "an admin reset your password" is not swallowed by the daily notification cap
//   S2-02  a project import does not take over foreign stamps (who assigned, who asked for a deadline change)
//   S2-03  the rule action "create sub-steps" checks its assignees (on save and on run) and shares the
//          project with them
//   S2-06  the daily e-mail digest that failed to send keeps its window — the next run sends it
//   M1-02  the nightly cleanup of mail_budget really deletes (the column `created` exists now)
// E-mails go only to the harness sink; no LLM.
// Run: KB_TEST_IMAGE=<image> node product/tests/chyby4-server4.js
const { execSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const H = require('./_harness');
const { expect, sleep } = H;

const node = (id, data, type) => ({ id, type: type || 'goalNode', position: { x: 0, y: 100 }, data });
const CAP = 5;

H.beh(async () => {
  const sink = await H.smtpSink();
  const inst = await H.startInstance({ slug: 'chyby4-server4', addHostGateway: true,
    env: { KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0, KB_NOTIFY_DAILY_CAP: CAP, KB_NOTIFY_DIGEST_HOUR: 0 } });
  const { api } = inst;
  const ids = {};
  for (const j of ['admin', 'eva', 'bara', 'cyril', 'dana', 'gustav', 'dig']) ids[j] = (await inst.register(`${j}@t.cz`)).json.id; // admin first
  const T = {};
  for (const j of Object.keys(ids)) T[j] = await inst.login(`${j}@t.cz`);
  let ST = await inst.superuser();
  const notif = async (token) => (await api('GET', '/api/collections/notifications/records?perPage=200&sort=-created', { token })).json.items || [];
  const mapa = async (kdo, title, nodes) => (await api('POST', '/api/collections/goalmaps/records', { token: T[kdo], body: { title,
    nodes: [node('root', { apexText: title, title, status: 'todo' }, 'apexNode')].concat(nodes),
    edges: nodes.map((n) => ({ id: 'e-' + n.id, source: 'root', target: n.id })) } })).json;
  const fresh = async (kdo, id) => (await api('GET', `/api/collections/goalmaps/records/${id}`, { token: T[kdo] })).json;
  const patch = async (kdo, id, zmena) => {
    const f = await fresh(kdo, id);
    return api('PATCH', `/api/collections/goalmaps/records/${id}`, { token: T[kdo], body: { base_updated: f.updated, edges: f.edges, nodes: f.nodes.map(zmena) } });
  };
  // every finding in its own guarded section: an exception in one must not hide the others
  const sekce = async (fn) => { try { await fn(); } catch (err) { expect(false, `výjimka v sekci: ${err && err.stack ? err.stack.split('\n').slice(0, 2).join(' ') : err}`); } };
  const uzelData = (id, data) => (n) => (n.id === id ? Object.assign({}, n, { data: Object.assign({}, n.data, data) }) : n);

  console.log(`== S2-01: reset hesla správcem nad denním stropem (${CAP}) ==`);
  await sekce(async () => {
    const M = await mapa('eva', 'Rušný den', Array.from({ length: CAP + 2 }, (_, i) => node('k' + i, { title: 'Krok ' + i, status: 'todo' })));
    for (let i = 0; i < CAP + 2; i++) {
      const r = await patch('eva', M.id, uzelData('k' + i, { owner: 'bara@t.cz' }));
      if (r.status !== 200) throw new Error(`přiřazení ${i}: ${r.status} ${JSON.stringify(r.json)}`);
    }
    const pred = await notif(T.bara);
    const prepad = pred.find((n) => n.type === 'overflow');
    expect(pred.filter((n) => n.type === 'node_assigned').length === CAP && !!prepad, `Bára je nad stropem běžným přiřazováním: ${pred.filter((n) => n.type === 'node_assigned').length} řádků + přetokový souhrn (${prepad && prepad.count}×)`);
    let r = await api('POST', '/api/kb/reset-user-password', { token: T.admin, body: { email: 'bara@t.cz' } });
    expect(r.status === 200 && !!r.json.temp_password, `správce obnovil Báře heslo (${r.status})`);
    T.bara = await inst.login('bara@t.cz', r.json.temp_password);
    const po = await notif(T.bara);
    const pr = po.filter((n) => n.type === 'password_reset');
    expect(pr.length === 1 && /admin@t\.cz/.test(pr[0].text), `Bára má oznámení „správce vám obnovil heslo“ i nad stropem, s tím, KDO to udělal (${pr.length}: ${(pr[0] || {}).text || '—'})`);
    expect((po.find((n) => n.type === 'overflow') || {}).count === prepad.count, 'přetokový souhrn kvůli tomu nenarostl');
    // the cap still holds for everything else
    r = await patch('eva', M.id, uzelData('k0', { owner: '' }));
    r = await patch('eva', M.id, uzelData('k0', { owner: 'bara@t.cz' }));
    const po2 = await notif(T.bara);
    expect(po2.filter((n) => n.type !== 'overflow').length === CAP + 1 && (po2.find((n) => n.type === 'overflow') || {}).count > prepad.count, `kontrola: běžná notifikace nad stropem dál jen navyšuje souhrn (${(po2.find((n) => n.type === 'overflow') || {}).count}×)`);
    // control: a user under the cap
    r = await api('POST', '/api/kb/reset-user-password', { token: T.admin, body: { email: 'cyril@t.cz' } });
    T.cyril = await inst.login('cyril@t.cz', r.json.temp_password);
    expect((await notif(T.cyril)).filter((n) => n.type === 'password_reset').length === 1, 'kontrola: uživatel pod stropem dostane oznámení jako dřív');
  });

  console.log('== S2-02: import nepřebírá cizí razítka ==');
  await sekce(async () => {
    const soubor = { format: 'killbottleneck.map/1', map: { title: 'Kopie nabídky',
      nodes: [node('root', { apexText: 'Kopie nabídky', title: 'Kopie nabídky', status: 'todo' }, 'apexNode'),
        node('n1', { title: 'URGENT: zavolejte na 800 123 456', status: 'todo', deadline: '2027-12-01', owner: 'dana@t.cz', assignedBy: 'dana@t.cz',
          deadlineChangeWanted: '2027-12-24', deadlineChangeNote: 'nestíhám', deadlineChangeRequestedBy: 'dana@t.cz', automationWanted: true, automationRequestedBy: 'cizi@jinde.example' }),
        node('n2', { title: 'Bez termínu', status: 'todo', assignedBy: 'cizi@jinde.example', positionKind: 'position', holder: 'gustav@t.cz', deputy: 'cizi@jinde.example' })],
      edges: [{ id: 'e1', source: 'root', target: 'n1' }, { id: 'e2', source: 'root', target: 'n2' }] },
      rules: [{ name: 'Po hotovu založ kroky', node_id: 'n2', trigger: { type: 'node_status_changed', status: 'done' },
        actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [{ title: 'Pro Gustava z importu', owner: 'gustav@t.cz', children: [{ title: 'Vnořený pro Danu', owner: 'dana@t.cz' }] }, { title: 'Bez řešitele z importu' }] }] }] };
    let r = await api('POST', '/api/kb/map-import', { token: T.eva, body: soubor });
    expect(r.status === 200 && !!r.json.id, `Eva naimportovala soubor (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
    const K = await fresh('eva', r.json.id);
    const d1 = (K.nodes.find((n) => n.data.title.startsWith('URGENT')) || {}).data || {};
    const d2 = (K.nodes.find((n) => n.data.title === 'Bez termínu') || {}).data || {};
    expect(d1.assignedBy === 'eva@t.cz', `zadavatel kroku s termínem = importující, ne e-mail ze souboru (${d1.assignedBy})`);
    expect(d1.deadlineChangeWanted === '' && d1.deadlineChangeNote === '' && d1.deadlineChangeRequestedBy === '', `žádost o změnu termínu se nepřenesla (${JSON.stringify([d1.deadlineChangeWanted, d1.deadlineChangeNote, d1.deadlineChangeRequestedBy])})`);
    expect(d2.assignedBy === '' && !JSON.stringify(K.nodes).includes('jinde.example'), `krok bez termínu bez razítka; v uzlech není žádný e-mail z cizí instance (${d2.assignedBy})`);
    expect(d1.automationRequestedBy === 'eva@t.cz' && d1.deadline === '2027-12-01' && d1.owner === 'dana@t.cz', 'kontrola: žadatel o automatizaci přerazítkován jako dřív, termín a řešitel zůstaly');
    expect(r.json.deadline_requests_dropped === 1, `odpověď importu přiznává zahozenou žádost o termín (${r.json.deadline_requests_dropped})`);
    expect(d2.holder === '' && d2.deputy === '' && d2.positionKind === '', `pole pozice z org struktury (držitel, zástupce) se nepřenesla (${JSON.stringify([d2.positionKind, d2.holder, d2.deputy])})`);
    // the imported rule: assignees of its sub-steps are emptied ALWAYS — otherwise its first run would share the project
    const impPravidla = (await api('GET', `/api/kb/rules?map=${K.id}`, { token: T.eva })).json.rules || [];
    const impItems = ((impPravidla[0] || {}).actions || [{}])[0].items || [];
    expect(impPravidla.length === 1 && r.json.rules_imported === 1 && impItems.length === 2 && !impItems[0].owner && !((impItems[0].children || [])[0] || {}).owner,
      `importované pravidlo má podkroky bez řešitelů, i když jsou to členové (${JSON.stringify(impItems).slice(0, 160)})`);
    expect(r.json.assignments_dropped === 2, `zahozená přiřazení jsou přiznaná v počítadle (${r.json.assignments_dropped})`);
    const idN2 = K.nodes.find((n) => n.data.title === 'Bez termínu').id;
    const rr = await patch('eva', K.id, uzelData(idN2, { status: 'done' }));
    await sleep(800);
    const poBehu = await fresh('eva', K.id);
    const sd = ((await api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${K.id}"`)}`, { token: ST })).json.items || []).length;
    expect(rr.status === 200 && poBehu.nodes.some((n) => n.data.title === 'Pro Gustava z importu' && !n.data.owner) && sd === 0, `běh importovaného pravidla založil podkroky a NIKOMU nic nenasdílel (sdílení: ${sd})`);
    const predD = (await notif(T.dana)).length;
    const idN1 = K.nodes.find((n) => n.data.title.startsWith('URGENT')).id;
    r = await patch('eva', K.id, uzelData(idN1, { deadline: '2027-12-05' }));
    expect(r.status === 200, `Eva v kopii změnila termín (${r.status})`);
    await sleep(500);
    const poD = await notif(T.dana);
    expect(!poD.some((n) => n.type === 'deadline_request_resolved'), `Dana NEdostala „vaše žádost je vyřízená“ o kopii, o kterou nežádala (${poD.length - predD} nových: ${poD.slice(0, poD.length - predD).map((n) => n.type).join(', ')})`);
  });

  console.log('== S2-03: pravidlo „založ podkroky“ — řešitel musí existovat a projekt uvidí ==');
  await sekce(async () => {
    const M = await mapa('eva', 'Reklamace', [node('A', { title: 'Krok A', status: 'todo' }), node('B', { title: 'Krok B', status: 'todo' })]);
    const uloz = (items, extra) => api('POST', '/api/kb/rules/save', { token: T.eva, body: Object.assign({ map: M.id, name: 'Po A založ kroky', node_id: 'A',
      trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'create_subnodes', parent: 'trigger_node', items }] }, extra || {}) });
    let r = await uloz([{ title: 'Pro ducha', owner: 'duch@nikde.example' }]);
    expect(r.status === 400 && /duch@nikde\.example/.test(String(r.json && r.json.error)), `uložení pravidla s neexistujícím řešitelem → 400 s jeho adresou (${r.status} ${String(r.json && r.json.error).slice(0, 140)})`);
    r = await uloz([{ title: 'Rodič', children: [{ title: 'Pro „me“', owner: 'me' }] }]);
    expect(r.status === 400, `řešitel „me“ ve vnořené položce → 400, ne krok pro řetězec „me“ (${r.status})`);
    r = await uloz([{ title: 'Pro Gustava', owner: 'Gustav@T.cz', deadline: '2027-12-10' }, { title: 'Bez řešitele', owner: 'none' }]);
    expect(r.status === 200 && !r.json.rule.actions[0].items[1].owner, `řešitel „none“ = bez řešitele (${JSON.stringify(r.json && r.json.rule && r.json.rule.actions[0].items[1])})`);
    expect(r.status === 200 && r.json.rule.actions[0].items[0].owner === 'gustav@t.cz', `pravidlo se skutečným řešitelem uloženo, e-mail v kanonickém tvaru (${r.status} ${r.json && r.json.rule && r.json.rule.actions[0].items[0].owner})`);
    expect((await api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: T.gustav })).status === 404, 'před spuštěním Gustav projekt nevidí');
    r = await patch('eva', M.id, uzelData('A', { status: 'done' }));
    expect(r.status === 200, `Eva odškrtla Krok A v editoru (${r.status})`);
    await sleep(800);
    const po = await fresh('eva', M.id);
    const novy = po.nodes.find((n) => n.data.title === 'Pro Gustava');
    expect(!!novy && novy.data.owner === 'gustav@t.cz' && po.nodes.some((n) => n.data.title === 'Bez řešitele'), 'podkroky vznikly, „Pro Gustava“ má řešitele');
    const sdileni = ((await api('GET', `/api/collections/map_shares/records?filter=${encodeURIComponent(`map="${M.id}"`)}`, { token: ST })).json.items || []).map((x) => `${x.email}:${x.permission}`);
    expect(sdileni.join() === 'gustav@t.cz:work', `projekt je Gustavovi nasdílen jako spolupracovníkovi (${sdileni.join(', ') || 'nic'})`);
    expect((await api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: T.gustav })).status === 200, 'Gustav projekt otevře');
    const md = await api('GET', '/api/kb/my-day', { token: T.gustav });
    expect(md.status === 200 && JSON.stringify(md.json).includes('Pro Gustava'), 'Gustav má „Pro Gustava“ v Můj den');
    expect((po.shared_with || []).includes('gustav@t.cz') && (po.shared_with_work || []).includes('gustav@t.cz'), 'záznam projektu nese sdílení (seznam lidí v dialogu Sdílet)');

    // a rule stored before the check (or whose assignee left since): the sub-step is created WITHOUT an
    // assignee, the other sub-steps and actions go on, and the run history says so
    r = await api('POST', '/api/collections/automation_rules/records', { token: ST, body: { map: M.id, name: 'Staré pravidlo s duchem', node_id: 'B', enabled: true, created_by: 'eva@t.cz',
      trigger: { type: 'node_status_changed', status: 'done' }, conditions: [],
      actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [{ title: 'Pro ducha', owner: 'duch@nikde.example' }, { title: 'Druhý podkrok', owner: 'cyril@t.cz' }] }, { type: 'notify', to: 'map_owner', message: 'B je hotové' }] } });
    expect(r.status === 200, `staré pravidlo vloženo přímo do DB (${r.status} ${JSON.stringify(r.json).slice(0, 100)})`);
    const stare = r.json.id;
    r = await patch('eva', M.id, uzelData('B', { status: 'done' }));
    await sleep(800);
    const po2 = await fresh('eva', M.id);
    const duch = po2.nodes.find((n) => n.data.title === 'Pro ducha');
    expect(r.status === 200 && !!duch && !duch.data.owner && !JSON.stringify(po2.nodes).includes('duch@nikde.example'), `běh starého pravidla: podkrok vznikl BEZ řešitele, neexistující adresa v projektu není (${duch ? JSON.stringify(duch.data.owner) : 'podkrok nevznikl'})`);
    expect((po2.nodes.find((n) => n.data.title === 'Druhý podkrok') || { data: {} }).data.owner === 'cyril@t.cz', 'ostatní podkroky téže akce vznikly i s řešitelem');
    expect((await notif(T.eva)).some((n) => n.type === 'rule_notice' && /B je hotové/.test(n.text)), 'další akce pravidla (upozornění vlastníkovi) proběhla');
    const behy = (await api('GET', `/api/collections/rule_runs/records?perPage=50&filter=${encodeURIComponent(`rule="${stare}"`)}`, { token: ST })).json.items || [];
    expect(behy.length === 1 && behy[0].status === 'ok' && /duch@nikde\.example/.test(JSON.stringify(behy[0])), `historie běhu to přiznává (${behy.map((b) => b.status + ': ' + String(b.detail || '').slice(0, 130)).join(' | ') || 'žádný běh'})`);
    const prav = (await api('GET', `/api/collections/automation_rules/records/${stare}`, { token: ST })).json;
    expect(prav.enabled === true && !prav.last_error, `pravidlo se neoznačilo za rozbité (${prav.last_error || 'bez chyby'})`);
    // editing that stored rule (rename): the assignee who is gone is emptied quietly, not a 400 — the rule stays editable
    r = await api('POST', '/api/kb/rules/save', { token: T.eva, body: { map: M.id, id: stare, name: 'Přejmenované pravidlo', node_id: 'B', trigger: prav.trigger, actions: prav.actions } });
    expect(r.status === 200 && r.json.rule.name === 'Přejmenované pravidlo' && !r.json.rule.actions[0].items[0].owner && r.json.rule.actions[0].items[1].owner === 'cyril@t.cz',
      `úprava uloženého pravidla s odešlým řešitelem projde a řešitele vyprázdní (${r.status} ${String(r.json && r.json.error || '').slice(0, 100)})`);
    r = await api('POST', '/api/kb/rules/save', { token: T.eva, body: { map: M.id, id: stare, name: 'Přejmenované pravidlo', node_id: 'B', trigger: prav.trigger,
      actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [{ title: 'Nový duch', owner: 'jiny-duch@nikde.example' }] }] } });
    expect(r.status === 400, `nově zadaný neznámý řešitel při úpravě dál končí 400 (${r.status})`);

    // people are checked as the SAVING person sees them (a private external contact), not as the project owner
    const kontakt = (await api('POST', '/api/collections/external_contacts/records', { token: T.eva, body: { name: 'Evina účetní', private: true } })).json;
    const MA = await mapa('admin', 'Adminův projekt', [node('Q', { title: 'Krok Q', status: 'todo' })]);
    r = await api('POST', '/api/kb/share', { token: T.admin, body: { action: 'share', mapId: MA.id, email: 'eva@t.cz', permission: 'edit' } });
    const extEmail = `ext-${String(kontakt.id).toLowerCase()}@kontakt.invalid`;
    const telo = { map: MA.id, name: 'S externistou', node_id: 'Q', trigger: { type: 'node_status_changed', status: 'done' }, actions: [{ type: 'create_subnodes', parent: 'trigger_node', items: [{ title: 'Pro účetní', owner: extEmail }] }] };
    const rEva = await api('POST', '/api/kb/rules/save', { token: T.eva, body: telo });
    expect(!!kontakt.id && r.status === 200 && rEva.status === 200, `Eva (spolusprávkyně cizího projektu) uloží pravidlo se SVÝM soukromým kontaktem (${rEva.status} ${String(rEva.json && rEva.json.error || '').slice(0, 120)})`);
    const rAdm = await api('POST', '/api/kb/rules/save', { token: T.admin, body: Object.assign({}, telo, { name: 'Admin s cizím kontaktem' }) });
    expect(rAdm.status === 400, `vlastník projektu, který ten kontakt nevidí, ho do pravidla nedá (${rAdm.status})`);
    r = await patch('eva', MA.id, uzelData('Q', { status: 'done' }));
    await sleep(800);
    const poQ = await fresh('admin', MA.id);
    expect(r.status === 200 && (poQ.nodes.find((n) => n.data.title === 'Pro účetní') || { data: {} }).data.owner === extEmail, 'za běhu se řešitel ověřuje jako AUTOR pravidla: podkrok pro Evin kontakt vznikl i s řešitelem');
  });

  console.log('== S2-06: denní souhrn, který se nepodařilo odeslat, se pošle příště ==');
  await sekce(async () => {
    let r = await api('PATCH', `/api/collections/users/records/${ids.dig}`, { token: T.dig, body: { notify_email_mode: 'digest' } });
    expect(r.status === 200, `uživatel v režimu „denní souhrn“ (${r.status})`);
    const M = await mapa('eva', 'ProjektXQ7', [node('s1', { title: 'Krok do souhrnu', status: 'todo' })]);
    r = await patch('eva', M.id, uzelData('s1', { owner: 'dig@t.cz' }));
    const mam = (await notif(T.dig)).filter((n) => n.type === 'node_assigned');
    expect(r.status === 200 && mam.length === 1, `ve zvonečku má 1 notifikaci (${mam.length})`);
    // a port nobody listens on: opened and closed again
    const mrtvy = await new Promise((res) => { const s = net.createServer(); s.listen(0, '0.0.0.0', () => { const p = s.address().port; s.close(() => res(p)); }); });
    r = await api('PATCH', '/api/settings', { token: ST, body: { meta: { appName: 'killBottleneck', appURL: inst.base, senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
      smtp: { enabled: true, host: 'host.docker.internal', port: mrtvy, tls: false } } });
    expect(r.status === 200, `pošta namířená na zavřený port ${mrtvy} (${r.status})`);
    r = await api('POST', '/api/kb/run-email-digests', { token: ST });
    expect(r.status === 200 && r.json.sent === 0 && sink.maily.length === 0, `souhrn při výpadku pošty: odesláno 0 (${JSON.stringify(r.json)})`);
    await sleep(1200);
    r = await sink.zapoj(inst, ST);
    expect(r.status === 200, 'pošta opravena (jímka)');
    r = await api('POST', '/api/kb/run-email-digests', { token: ST });
    await sleep(1500);
    const mail = sink.maily.find((m) => /dig@t\.cz/.test(m));
    expect(r.status === 200 && r.json.sent === 1 && !!mail, `další běh souhrn odeslal (sent ${r.json && r.json.sent}, mailů v jímce ${sink.maily.length}) — dřív 0 a notifikace už nepřišla nikdy`);
    expect(!!mail && mail.replace(/=\n/g, '').includes('ProjektXQ7'), 'v e-mailu je notifikace z doby výpadku (projekt „ProjektXQ7“)');
    // control: after a successful run the window moves — the same notification is not sent again
    r = await api('POST', '/api/kb/run-email-digests', { token: ST });
    await sleep(1000);
    expect(r.json.sent === 0 && sink.maily.filter((m) => /dig@t\.cz/.test(m)).length === 1, `kontrola: po úspěšném odeslání se táž notifikace nepošle podruhé (sent ${r.json.sent})`);

    // the SCHEDULED path (cron email_digests, no force; KB_NOTIFY_DIGEST_HOUR=0): one failure → the next
    // run sends; three failures in a day → the day is closed and the fourth run does not send any more
    const cron = async () => { const x = await api('POST', '/api/crons/email_digests', { token: ST }); await sleep(1500); return x.status; };
    const mrtvaPosta = () => api('PATCH', '/api/settings', { token: ST, body: { smtp: { enabled: true, host: 'host.docker.internal', port: mrtvy, tls: false } } });
    r = await patch('eva', M.id, uzelData('s1', { owner: '' }));
    r = await patch('eva', M.id, uzelData('s1', { owner: 'dig@t.cz' }));
    await mrtvaPosta();
    const pred1 = sink.maily.length;
    let cs = await cron();
    expect((cs === 204 || cs === 200) && sink.maily.length === pred1, `plánovaný běh při výpadku pošty: nic neodešlo (cron ${cs})`);
    await sink.zapoj(inst, ST);
    await cron();
    // the mail reaches the sink asynchronously — under a loaded machine (the full regression) later than the fixed pause
    let m2 = null;
    for (let i = 0; i < 20 && !m2; i++) { m2 = sink.maily.slice(pred1).find((m) => /dig@t\.cz/.test(m)); if (!m2) await sleep(500); }
    expect(!!m2 && m2.replace(/=\n/g, '').includes('ProjektXQ7'), `plánovaný běh po jednom neúspěchu: další běh souhrn odeslal (nových mailů ${sink.maily.length - pred1})`);
  });

  console.log('== S2-06: strop opakování — tři neúspěchy za den den uzavřou ==');
  await sekce(async () => {
    // a second instance: the day of the first one is already closed by the successful scheduled run
    const i2 = await H.startInstance({ slug: 'chyby4-server4-digest', addHostGateway: true, env: { KB_UVODNI_MAPA: 0, KB_NOTIFY_COALESCE_MIN: 0, KB_NOTIFY_DIGEST_HOUR: 0 } });
    const a2 = (await i2.register('a@t.cz')).json.id; const d2 = (await i2.register('d@t.cz')).json.id;
    const TA = await i2.login('a@t.cz'); const TD = await i2.login('d@t.cz');
    const S2 = await i2.superuser();
    await i2.api('PATCH', `/api/collections/users/records/${d2}`, { token: TD, body: { notify_email_mode: 'digest' } });
    const m = (await i2.api('POST', '/api/collections/goalmaps/records', { token: TA, body: { title: 'StropXQ9', nodes: [node('root', { apexText: 'StropXQ9', title: 'StropXQ9', status: 'todo' }, 'apexNode'), node('z1', { title: 'Krok', status: 'todo', owner: 'd@t.cz' })], edges: [{ id: 'e', source: 'root', target: 'z1' }] } })).json;
    expect(!!a2 && !!m.id && ((await i2.api('GET', '/api/collections/notifications/records', { token: TD })).json.items || []).length >= 1, 'druhá instance: uživatel v režimu souhrnu má notifikaci');
    const mrtvy2 = await new Promise((res) => { const sv = net.createServer(); sv.listen(0, '0.0.0.0', () => { const pp = sv.address().port; sv.close(() => res(pp)); }); });
    await i2.api('PATCH', '/api/settings', { token: S2, body: { meta: { appName: 'killBottleneck', appURL: i2.base, senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' }, smtp: { enabled: true, host: 'host.docker.internal', port: mrtvy2, tls: false } } });
    const cron2 = async () => { const x = await i2.api('POST', '/api/crons/email_digests', { token: S2 }); await sleep(1500); return x.status; };
    const znacka = async () => ((await i2.api('GET', `/api/collections/mail_budget/records?filter=${encodeURIComponent('day ~ "digest:"')}`, { token: S2 })).json.items || []).length;
    await cron2(); await cron2();
    expect(await znacka() === 0, 'po dvou neúspěších den ještě uzavřený není (značka dne v DB není)');
    await cron2();
    expect(await znacka() === 1, `třetí neúspěch den uzavřel (značek dne: ${await znacka()})`);
    const pred = sink.maily.length;
    await sink.zapoj(i2, S2);
    await cron2();
    expect(sink.maily.length === pred, `čtvrtý běh téhož dne už neodesílá, ani když pošta zase jde (nových mailů ${sink.maily.length - pred})`);
    await sleep(4500); // PocketBase writes its log in batches
    const l2 = JSON.stringify((await i2.api('GET', '/api/logs?perPage=200&sort=-created', { token: S2 })).json || {}) + i2.logs(300);
    expect(/failed 3 times today/.test(l2), 'v logu je varování o vzdání se do zítřka');
  });

  console.log('== M1-02: úklid mail_budget ==');
  await sekce(async () => {
    const dnes = new Date().toISOString().slice(0, 10);
    const radek = async (user, day) => { const r = await api('POST', '/api/collections/mail_budget/records', { token: ST, body: { user, day, sent: 1 } }); if (r.status !== 200) throw new Error(`mail_budget ${day}: ${r.status} ${JSON.stringify(r.json)}`); };
    await radek(ids.cyril, '2025-01-01');          // an old daily row
    await radek(ids.cyril, 'digest:2025-01-02');   // an old daily marker
    await radek(ids.cyril, 'n:due:today:x');       // an old e-mail gate
    await radek(ids.cyril, 'ps:mapa123:abcdef');   // a share-invitation gate (kept for good)
    await radek(ids.cyril, dnes);                  // today's counter
    await radek(ids.dana, 'n:due:fresh:y');        // a fresh e-mail gate
    // ageing straight in the DB (as nova-verze-prune.js): the container is stopped, python3 + sqlite over a copy of data.db
    inst.pause();
    const tmp = `/tmp/kb-ch4-mb-${process.pid}.db`; const skript = `/tmp/kb-ch4-mb-${process.pid}.py`;
    execSync(`docker cp ${inst.name}:/app/pb_data/data.db ${tmp}`, { stdio: 'ignore' });
    fs.writeFileSync(skript, ['import sqlite3, sys', 'c = sqlite3.connect(sys.argv[1])',
      'cols = [r[1] for r in c.execute("PRAGMA table_info(mail_budget)")]',
      'print("created" in cols)',
      'if "created" in cols:',
      `    c.execute("UPDATE mail_budget SET created = strftime('%Y-%m-%d %H:%M:%fZ','now','-41 days') WHERE day IN ('2025-01-01','digest:2025-01-02','n:due:today:x','ps:mapa123:abcdef')")`,
      'c.commit(); c.close()'].join('\n'));
    const maSloupec = execSync(`python3 ${skript} ${tmp}`).toString().trim() === 'True';
    execSync(`docker cp ${tmp} ${inst.name}:/app/pb_data/data.db`, { stdio: 'ignore' });
    fs.rmSync(skript, { force: true }); fs.rmSync(tmp, { force: true });
    await inst.resume();
    ST = await inst.superuser();
    expect(maSloupec, 'tabulka mail_budget má sloupec created');
    const dny = async () => ((await api('GET', '/api/collections/mail_budget/records?perPage=200', { token: ST })).json.items || []).map((x) => x.day).sort();
    const pred = await dny();
    const s = (await api('POST', '/api/crons/prune_notifications', { token: ST })).status;
    expect(s === 204 || s === 200, `cron prune_notifications spuštěn (${s})`);
    await sleep(4000);
    const po = await dny();
    expect(!po.includes('2025-01-01') && !po.includes('digest:2025-01-02') && !po.includes('n:due:today:x'), `řádky starší 40 dní jsou pryč: denní, značka souhrnu i závora e-mailu (zbylo: ${po.join(', ')})`);
    expect(po.includes(dnes) && po.includes('n:due:fresh:y'), 'dnešní počítadlo a čerstvá závora zůstaly');
    expect(po.includes('ps:mapa123:abcdef'), 'závora pozvánky ke sdílení zůstala (drží „už pozváno“ napořád jako dosud)');
    expect(pred.length - po.length === 3, `smazány právě 3 řádky (${pred.length} → ${po.length})`);
    const logy = JSON.stringify((await api('GET', '/api/logs?perPage=200&sort=-created', { token: ST })).json || {}) + inst.logs(200);
    expect(!/no such column/i.test(logy), 'v logu instance není „no such column“');
  });
}, { nazev: 'CHYBY4 SERVER 4' });
