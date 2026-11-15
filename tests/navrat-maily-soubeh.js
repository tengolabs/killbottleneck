// Return e-mails vs. concurrent account changes (finding S7-01 of code analysis 4).
//
// The batch used to load every candidate at its start and, after each (slow) model call,
// save the WHOLE stale record: whoever changed the password, signed in, renamed themselves
// or switched e-mails off during the batch lost the change (the old password and the old
// session token came back) — and got the mail anyway.
//
// The suite makes the race deterministic: the AI mock performs the "user" actions itself
// while it holds the model answer. Recipients are processed in the order of last_login:
//   x  (9 days)  — plain recipient; DURING its model call:
//                    v  changes the password, signs in, renames himself,
//                    v2 switches e-mails to "none" and unsubscribes;
//   v, v2 (6 days) — must get NO mail and keep every change;
//   w  (5 days)  — unsubscribes during ITS OWN model call → no mail, stays unsubscribed;
//   z  (4 days)  — changes password and name during ITS OWN model call → the mail goes
//                    (still away), the stage is recorded, the changes survive.
// No real LLM and no real mail: the model is a local mock, SMTP a local sink.
const H = require('./_harness');
const { expect } = H;

const NOVE_HESLO = 'uplnenoveheslo456';
const predDny = (n, posunMs = 0) => new Date(Date.now() - n * 86400000 + posunMs).toISOString();

H.beh(async () => {
  let inst = null;
  const U = {};
  const akce = {};      // map title fragment → async action performed while the model "thinks"
  const volani = [];
  const mock = await H.httpMock(async (req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (!req.url.startsWith('/v1/chat/completions')) { res.statusCode = 404; return res.end('{}'); }
    const kdo = Object.keys(akce).find((k) => body.includes(k) || body.includes(k.replace('PROJEKT', 'KROK')));
    volani.push(((body.match(/(?:PROJEKT|KROK)-([A-Z]+)-KONEC/) || [])[0] || '?').replace('KROK', 'PROJEKT'));
    if (kdo) { try { await akce[kdo](); } catch (e) { console.log('  ❌ akce během volání modelu selhala:', String(e && e.message || e)); } }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'AI TEXT pro návrat.' } }] }));
  });
  const sink = await H.smtpSink();
  inst = await H.startInstance({ slug: 'navratsoubeh', addHostGateway: true,
    env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_AI_PROVIDER: 'openai', KB_AI_URL: mock.base + '/v1', KB_AI_TOKEN: 'x', KB_AI_MODEL: 'kb-test' } });
  const ST = await inst.superuser();

  const zaloz = async (jmeno) => {
    const email = jmeno + '@example.com';
    const r = await inst.register(email);
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status}`);
    U[jmeno] = { id: r.json.id, email, token: await inst.login(email) };
    if (jmeno === 'spravce') return;
    const m = await inst.api('POST', '/api/collections/goalmaps/records', { token: U[jmeno].token, body: {
      title: 'PROJEKT-' + jmeno.toUpperCase() + '-KONEC',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'C', title: 'C', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'KROK-' + jmeno.toUpperCase() + '-KONEC', status: 'todo', owner: email, deadline: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'n1' }],
    } });
    if (m.status !== 200) throw new Error(`mapa ${email}: ${m.status}`);
    await inst.api('POST', '/api/collections/loginlogs/records', { token: U[jmeno].token, body: {} });
  };
  const zpetne = (jmeno, dnu, posunMs) => inst.api('PATCH', `/api/collections/users/records/${U[jmeno].id}`, { token: ST, body: { last_login: predDny(dnu, posunMs) } });
  const cti = async (jmeno) => (await inst.api('GET', `/api/collections/users/records/${U[jmeno].id}`, { token: ST })).json;
  const prihlaseni = (jmeno, pw) => inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: U[jmeno].email, password: pw } });
  const mailyPro = (jmeno) => sink.maily.filter((m) => new RegExp('^To:.*' + jmeno + '@example\\.com', 'mi').test(m));
  const zmenHeslo = async (jmeno) => {
    const r = await inst.api('PATCH', `/api/collections/users/records/${U[jmeno].id}`, { token: U[jmeno].token, body: { oldPassword: H.PW, password: NOVE_HESLO, passwordConfirm: NOVE_HESLO } });
    if (r.status !== 200) throw new Error(`změna hesla ${jmeno}: ${r.status}`);
    const l = await prihlaseni(jmeno, NOVE_HESLO);
    if (l.status !== 200) throw new Error(`přihlášení novým heslem ${jmeno}: ${l.status}`);
    U[jmeno].novyToken = l.json.token;
  };

  await zaloz('spravce');       // first account = administrator, not a candidate (never opened the app)
  for (const j of ['x', 'v', 'vdva', 'w', 'z']) await zaloz(j);
  await sink.zapoj(inst, ST, { appURL: inst.base });
  await zpetne('x', 9); await zpetne('v', 6); await zpetne('vdva', 6, 1000); await zpetne('w', 5); await zpetne('z', 4);
  const loginPred = { v: (await cti('v')).last_login, z: (await cti('z')).last_login };

  akce['PROJEKT-X-KONEC'] = async () => {
    // v: password change + sign-in (opens the app → loginlogs) + rename
    await zmenHeslo('v');
    await inst.api('POST', '/api/collections/loginlogs/records', { token: U.v.novyToken, body: {} });
    await inst.api('PATCH', `/api/collections/users/records/${U.v.id}`, { token: U.v.novyToken, body: { name: 'Nove Jmeno V' } });
    // vdva: e-mails "none" + unsubscribed from return mails
    await inst.api('PATCH', `/api/collections/users/records/${U.vdva.id}`, { token: U.vdva.token, body: { notify_email_mode: 'none', navrat: { odhlaseno: true } } });
  };
  akce['PROJEKT-W-KONEC'] = async () => {
    await inst.api('PATCH', `/api/collections/users/records/${U.w.id}`, { token: U.w.token, body: { navrat: { odhlaseno: true } } });
  };
  akce['PROJEKT-Z-KONEC'] = async () => {
    await zmenHeslo('z');
    await inst.api('PATCH', `/api/collections/users/records/${U.z.id}`, { token: U.z.novyToken, body: { name: 'Nove Jmeno Z' } });
  };

  console.log('== dávka se souběžnými změnami účtů ==');
  const beh = await inst.api('POST', '/api/kb/run-navrat-maily', { token: ST });
  expect(beh.status === 200, `dávka doběhla (${beh.status} ${JSON.stringify(beh.json)})`);
  expect(volani.includes('PROJEKT-X-KONEC') && volani.includes('PROJEKT-W-KONEC') && volani.includes('PROJEKT-Z-KONEC'),
    `předpoklad: model byl volán pro x, w i z — souběžné akce opravdu proběhly (${volani.join(', ')})`);
  await H.sleep(500);

  console.log('== x: běžný příjemce ==');
  expect(mailyPro('x').length === 1 && (await cti('x')).navrat.krok === 7, `x dostal mail a stupeň 7 je zapsaný (${mailyPro('x').length})`);

  console.log('== v: během dávky změnil heslo, přihlásil se, přejmenoval se ==');
  const v = await cti('v');
  expect(mailyPro('v').length === 0, `v mail NEdostal — mezitím se vrátil (${mailyPro('v').length})`);
  expect(v.name === 'Nove Jmeno V', `jméno zůstalo nové („${v.name}")`);
  expect(v.last_login !== loginPred.v && v.last_login > loginPred.v, `last_login zůstal čerstvý (${v.last_login})`);
  expect((await prihlaseni('v', NOVE_HESLO)).status === 200, 'NOVÉ heslo platí');
  expect((await prihlaseni('v', H.PW)).status === 400, 'STARÉ heslo neplatí');
  expect((await inst.api('POST', '/api/collections/users/auth-refresh', { token: U.v.novyToken })).status === 200, 'relace vydaná PO změně hesla platí');
  expect((await inst.api('POST', '/api/collections/users/auth-refresh', { token: U.v.token })).status === 401, 'relace vydaná PŘED změnou hesla neplatí');
  expect(!v.navrat || !v.navrat.krok, `žádný stupeň se mu nezapsal (${JSON.stringify(v.navrat)})`);
  expect(!volani.includes('PROJEKT-V-KONEC'), 'model se pro něj ani nevolal');

  console.log('== vdva: během dávky vypnul e-maily ==');
  const v2 = await cti('vdva');
  expect(mailyPro('vdva').length === 0, `vdva mail NEdostal (${mailyPro('vdva').length})`);
  expect(v2.notify_email_mode === 'none', `režim e-mailů zůstal „Nic" („${v2.notify_email_mode}")`);
  expect(v2.navrat && v2.navrat.odhlaseno === true, `odhlášení návratových mailů zůstalo (${JSON.stringify(v2.navrat)})`);

  console.log('== w: odhlásil se, zatímco model psal JEHO mail ==');
  const w = await cti('w');
  expect(mailyPro('w').length === 0, `w mail NEdostal (${mailyPro('w').length})`);
  expect(w.navrat && w.navrat.odhlaseno === true && !w.navrat.krok, `zůstal odhlášený, stupeň se nezapsal (${JSON.stringify(w.navrat)})`);

  console.log('== z: během psaní SVÉHO mailu změnil heslo a jméno, ale nepřihlásil se do aplikace ==');
  const z = await cti('z');
  expect(mailyPro('z').length === 1, `z mail dostal — pořád je pryč (${mailyPro('z').length})`);
  expect(z.navrat && z.navrat.krok === 3 && z.navrat.cyklus === loginPred.z && !!z.navrat.odhlasit, `stupeň 3 je zapsaný (${JSON.stringify(z.navrat)})`);
  expect(z.name === 'Nove Jmeno Z', `jméno zůstalo nové („${z.name}")`);
  expect((await prihlaseni('z', NOVE_HESLO)).status === 200 && (await prihlaseni('z', H.PW)).status === 400, 'nové heslo platí, staré ne');
  expect((await inst.api('POST', '/api/collections/users/auth-refresh', { token: U.z.novyToken })).status === 200, 'relace po změně hesla platí');
  // the unsubscribe link from the mail that did go out works (token hash written by the single-column UPDATE)
  const raw = mailyPro('z')[0] || '';
  const odkaz = (raw.replace(/=\r?\n/g, '').replace(/=3D/g, '=').match(/\/api\/kb\/navrat\/odhlasit\?u=[A-Za-z0-9]+&(?:amp;)?t=[A-Za-z0-9]+/) || [''])[0].replace('&amp;', '&');
  const od = odkaz ? await fetch(inst.base + odkaz) : { status: 0 };
  expect(od.status === 200 && (await cti('z')).navrat.odhlaseno === true, `odhlašovací odkaz z mailu funguje (${od.status})`);

  console.log('== druhý běh: nikdo nic nedostane dvakrát ==');
  const pred = sink.maily.length;
  const beh2 = await inst.api('POST', '/api/kb/run-navrat-maily', { token: ST });
  expect(beh2.json.sent === 0 && sink.maily.length === pred, `druhá dávka neposlala nic (${beh2.json && beh2.json.sent})`);
  expect(beh.json.sent === 2, `první dávka hlásí 2 odeslané maily: x a z (${beh.json.sent})`);
}, { nazev: 'NAVRAT-MAILY-SOUBEH' });
