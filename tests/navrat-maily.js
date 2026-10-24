// Návratové e-maily (navratMaily.js): žebřík 3/7/14/30 dní bez přihlášení.
//
// Co se měří: kdo nikdy neotevřel aplikaci, nic nedostane; po 4 dnech přijde
// stupeň 3 (AI text z mocku, odhlašovací odkaz, List-Unsubscribe, tlačítko na
// instanci); druhý force nic nepošle (stav na users.navrat); přeskočené stupně
// se nedoposílají; přihlášení (POST loginlogs) začíná nový cyklus; režim e-mailů
// „Nic" a vlastní odhlášení (odkazem i přepínačem) maily zastaví; klient nesmí
// přepsat stupeň; bez AI (429) jde deterministický výpis; jazyk příjemce; strop
// na instanci a den; vypršelá zkušebka = ticho.
//
// Kontejner běží v TZ=Europe/Prague; `last_login` zpětně datuje superuser PATCH
// (zámek v users update hooku pouští jen superusera).
const H = require('./_harness');
const { expect } = H;

// Dekódování mailu z jímky (quoted-printable po BAJTECH, encoded-words v předmětu) — vzor maily-jazyk.js
const qp = (s) => Buffer.from(
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
  'binary').toString('utf8');
const dekoduj = (s) => {
  let out = s.replace(/=\?[Uu][Tt][Ff]-8\?[Bb]\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  out = out.replace(/=\?[Uu][Tt][Ff]-8\?[Qq]\?([^?]+)\?=/g, (_, q) => qp(q.replace(/_/g, ' ')));
  out = qp(out);
  for (const kus of out.split(/\r?\n\r?\n/)) {
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(kus.trim())) {
      try { out += '\n' + Buffer.from(kus.trim(), 'base64').toString('utf8'); } catch { /* nevadí */ }
    }
  }
  return out;
};
const predmetZ = (raw) => {
  const m = raw.match(/^Subject:[ \t]*(.*(?:\r?\n[ \t].*)*)/mi);
  if (!m) return '';
  const radek = m[1].replace(/\r?\n[ \t]+/g, '').replace(/\?=\s+=\?/g, '?==?');
  const kusy = [];
  const re = /=\?[Uu][Tt][Ff]-8\?([BbQq])\?([^?]*)\?=/g;
  let konec = 0, mm;
  while ((mm = re.exec(radek))) {
    if (mm.index > konec) kusy.push(Buffer.from(radek.slice(konec, mm.index), 'utf8'));
    kusy.push(mm[1].toLowerCase() === 'b'
      ? Buffer.from(mm[2], 'base64')
      : Buffer.from(mm[2].replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary'));
    konec = mm.index + mm[0].length;
  }
  if (konec < radek.length) kusy.push(Buffer.from(radek.slice(konec), 'utf8'));
  return Buffer.concat(kusy).toString('utf8').trim();
};

const predDny = (n) => new Date(Date.now() - n * 86400000).toISOString();
const dnesPraha = (offset = 0) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' }));
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

let rezimAi = 'ok'; // ok | preteceno
const AI_TEXT = 'AI TEXT: začni fakturou pro Nováka, pak zavolej Janě.';

H.beh(async () => {
  const mock = await H.httpMock((req, res, body) => {
    res.setHeader('Content-Type', 'application/json');
    if (!req.url.startsWith('/v1/chat/completions')) { res.statusCode = 404; return res.end('{}'); }
    if (rezimAi === 'preteceno') { res.statusCode = 429; return res.end(JSON.stringify({ error: { message: 'Rate limit reached' } })); }
    res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: AI_TEXT + '\n\nNejdřív otevři fakturu, pak zavolej, nakonec odškrtni.\n\nDrž se! 💪' } }] }));
  });
  const sink = await H.smtpSink();
  const AI_ENV = { KB_AI_PROVIDER: 'openai', KB_AI_URL: mock.base + '/v1', KB_AI_TOKEN: 'x', KB_AI_MODEL: 'kb-test' };
  const inst = await H.startInstance({ slug: 'navrat', addHostGateway: true, env: Object.assign({ TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0 }, AI_ENV) });
  const ST = await inst.superuser();

  const uzivatele = {};
  const zaloz = async (email, extra) => {
    const r = await inst.register(email, extra || {});
    if (r.status !== 200) throw new Error(`registrace ${email}: ${r.status} ${JSON.stringify(r.json)}`);
    uzivatele[email] = { id: r.json.id, token: await inst.login(email) };
    return uzivatele[email];
  };
  const OLD = dnesPraha(-3), TODAY = dnesPraha(0);
  // mapa s prací po termínu + dnes — stejný podklad jako Můj den
  const mapaPro = async (email) => {
    const u = uzivatele[email];
    const r = await inst.api('POST', '/api/collections/goalmaps/records', { token: u.token, body: {
      title: 'Faktury ' + email.split('@')[0],
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'C', title: 'C', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Faktura pro Nováka', status: 'todo', owner: email, deadline: OLD } },
        { id: 'n2', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Zavolat Janě', status: 'todo', owner: email, deadline: TODAY } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'n1' }, { id: 'e2', source: 'root', target: 'n2' }],
    } });
    if (r.status !== 200) throw new Error(`mapa ${email}: ${r.status}`);
  };
  const vstup = (email) => inst.api('POST', '/api/collections/loginlogs/records', { token: uzivatele[email].token, body: {} });
  const zpetne = (email, dnu, navic) => inst.api('PATCH', `/api/collections/users/records/${uzivatele[email].id}`,
    { token: ST, body: Object.assign({ last_login: predDny(dnu) }, navic || {}) });
  const ctiU = async (email) => (await inst.api('GET', `/api/collections/users/records/${uzivatele[email].id}`, { token: ST })).json;
  const spust = async () => (await inst.api('POST', '/api/kb/run-navrat-maily', { token: ST })).json.sent;
  const mailyPro = (email) => sink.maily.filter((m) => new RegExp('^To:.*' + email.replace('.', '\\.'), 'mi').test(m));

  await zaloz('a@example.com');          // první = admin
  await zaloz('b@example.com');
  await zaloz('c@example.com');
  await zaloz('d@example.com');
  await zaloz('e@example.com', { language: 'en' });
  await zaloz('f@example.com');
  await zaloz('g@example.com');          // nikdy neotevře aplikaci
  await zaloz('h@example.com');
  for (const e of ['a', 'b', 'c', 'd', 'e', 'f', 'h']) { await mapaPro(e + '@example.com'); await vstup(e + '@example.com'); }

  console.log('== bez SMTP nic ==');
  await zpetne('a@example.com', 4);
  expect((await spust()) === 0, 'bez SMTP se nic neposílá');
  await sink.zapoj(inst, ST, { appURL: inst.base });

  console.log('== stupeň 3 po 4 dnech ==');
  let n = await spust();
  expect(n === 1, `po 4 dnech odešel 1 mail (${n})`);
  const m1 = mailyPro('a@example.com')[0] || '';
  expect(!!m1, 'mail dorazil adresátovi a@');
  const predmet1 = predmetZ(m1);
  expect(/Tři dny bez vás/.test(predmet1), `předmět stupně 3 cs („${predmet1}")`);
  const telo1 = dekoduj(m1);
  expect(telo1.includes('AI TEXT: začni fakturou'), 'tělo nese text z modelu');
  expect(telo1.includes('odhlasit?u=' + uzivatele['a@example.com'].id + '&t='), 'tělo nese odhlašovací odkaz s id uživatele');
  expect(new RegExp('List-Unsubscribe: <' + inst.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/api/kb/navrat/odhlasit', 'i').test(m1), 'hlavička List-Unsubscribe míří na odhlašovací routu');
  expect(/List-Unsubscribe-Post: List-Unsubscribe=One-Click/i.test(m1), 'hlavička One-Click');
  expect(telo1.includes('Otevřít killBottleneck: ' + inst.base + '/'), 'tlačítko vede na úvodní stránku instance');
  expect(telo1.includes('Po termínu: 1') && telo1.includes('Dnes: 1'), 'karta s počty (po termínu 1, dnes 1)');
  const posledniVolani = JSON.parse(mock.pozadavky[mock.pozadavky.length - 1].body);
  const prompt = JSON.stringify(posledniVolani.messages || []);
  expect(/Faktura pro Nováka/.test(prompt) && /4 dní nepřihlásil/.test(prompt), 'prompt nese podklad práce i počet dní');
  let ua = await ctiU('a@example.com');
  expect(ua.navrat && ua.navrat.krok === 3 && ua.navrat.cyklus === ua.last_login, `stav: krok 3, cyklus = last_login (${JSON.stringify(ua.navrat)})`);
  expect(!ua.navrat.odhlaseno && typeof ua.navrat.odhlasit === 'string' && ua.navrat.odhlasit.length === 64, 'v DB jen otisk tokenu (sha256), ne token sám');
  expect(!(ua.navrat.odhlasit && telo1.includes(ua.navrat.odhlasit)), 'otisk tokenu v mailu není');

  console.log('== idempotence ==');
  n = await spust();
  expect(n === 0, `druhý běh týž den nic nepošle (${n})`);
  expect(mailyPro('a@example.com').length === 1, 'a@ má pořád jen jeden mail');

  console.log('== nikdy nepřihlášený ==');
  expect(mailyPro('g@example.com').length === 0, 'kdo aplikaci nikdy neotevřel, mail nedostane');
  const ug = await ctiU('g@example.com');
  expect(!ug.last_login, 'g@ nemá last_login');

  console.log('== přeskočené stupně se nedoposílají ==');
  await zpetne('c@example.com', 8);
  n = await spust();
  expect(n === 1, `c@ po 8 dnech: 1 mail (${n})`);
  expect(/Týden bez vás/.test(predmetZ(mailyPro('c@example.com')[0] || '')), 'c@ dostal rovnou stupeň 7, ne 3');
  let uc = await ctiU('c@example.com');
  expect(uc.navrat.krok === 7, `c@ krok 7 (${uc.navrat.krok})`);
  // stejný cyklus posunutý na 20 dní (superuser smí sázet stav): jen stupeň 14, žádné doposílání 3
  await zpetne('c@example.com', 20);
  uc = await ctiU('c@example.com');
  await inst.api('PATCH', `/api/collections/users/records/${uzivatele['c@example.com'].id}`, { token: ST, body: { navrat: { cyklus: uc.last_login, krok: 7, odhlasit: uc.navrat.odhlasit, odhlaseno: false } } });
  n = await spust();
  expect(n === 1, `c@ po 20 dnech téhož cyklu: 1 mail (${n})`);
  expect(/Dva týdny/.test(predmetZ(mailyPro('c@example.com')[1] || '')), 'c@ dostal stupeň 14');
  uc = await ctiU('c@example.com');
  await zpetne('c@example.com', 40);
  await inst.api('PATCH', `/api/collections/users/records/${uzivatele['c@example.com'].id}`, { token: ST, body: { navrat: { cyklus: (await ctiU('c@example.com')).last_login, krok: 14, odhlasit: uc.navrat.odhlasit, odhlaseno: false } } });
  n = await spust();
  expect(n === 1, `c@ po 40 dnech: poslední stupeň (${n})`);
  const predmetLast = predmetZ(mailyPro('c@example.com')[2] || '');
  expect(/Poslední připomenutí/.test(predmetLast), `poslední stupeň má vlastní znění („${predmetLast}")`);
  expect(dekoduj(mailyPro('c@example.com')[2] || '').includes('40 dní jste se nepřihlásili'), 'úvod posledního stupně nese počet dní');
  n = await spust();
  expect(n === 0 && mailyPro('c@example.com').length === 3, 'po posledním stupni ticho');

  console.log('== přihlášení začíná nový cyklus ==');
  await zpetne('b@example.com', 4);
  n = await spust();
  expect(n === 1 && mailyPro('b@example.com').length === 1, 'b@ dostal stupeň 3');
  let r = await vstup('b@example.com');
  expect(r.status === 200, 'b@ otevřel aplikaci (loginlog)');
  n = await spust();
  expect(n === 0, 'po přihlášení nic (last_login je čerstvý)');
  await zpetne('b@example.com', 4);
  n = await spust();
  expect(n === 1 && mailyPro('b@example.com').length === 2, 'po dalších 4 dnech bez přihlášení znovu stupeň 3 (nový cyklus)');

  console.log('== režim e-mailů Nic a vlastní odhlášení ==');
  r = await inst.api('PATCH', `/api/collections/users/records/${uzivatele['f@example.com'].id}`, { token: uzivatele['f@example.com'].token, body: { notify_email_mode: 'none' } });
  expect(r.status === 200, 'f@ si vypnul e-maily (Nic)');
  await zpetne('f@example.com', 4);
  r = await inst.api('PATCH', `/api/collections/users/records/${uzivatele['d@example.com'].id}`, { token: uzivatele['d@example.com'].token, body: { navrat: { odhlaseno: true, krok: 99 } } });
  expect(r.status === 200 && r.json.navrat && r.json.navrat.odhlaseno === true, 'd@ se odhlásil přepínačem (klient smí jen odhlaseno)');
  expect(!(r.json.navrat.krok === 99), 'klient nemůže podstrčit stupeň (krok 99 zahozen)');
  await zpetne('d@example.com', 4);
  n = await spust();
  expect(n === 0, `f@ (Nic) ani d@ (odhlášen) nic nedostanou (${n})`);
  r = await inst.api('PATCH', `/api/collections/users/records/${uzivatele['d@example.com'].id}`, { token: uzivatele['d@example.com'].token, body: { navrat: { odhlaseno: false } } });
  expect(r.status === 200 && r.json.navrat.odhlaseno === false, 'd@ si připomínky zase zapnul');
  n = await spust();
  expect(n === 1 && mailyPro('d@example.com').length === 1, 'po zapnutí d@ mail dostal');
  // klientský PATCH nesmí přepsat stav zapsaný cronem (past jako u last_login)
  r = await inst.api('PATCH', `/api/collections/users/records/${uzivatele['d@example.com'].id}`, { token: uzivatele['d@example.com'].token, body: { navrat: { krok: 0, cyklus: '', odhlaseno: false } } });
  expect(r.json.navrat && r.json.navrat.krok === 3, `stupeň z cronu přežil klientský PATCH (${JSON.stringify(r.json.navrat)})`);
  n = await spust();
  expect(n === 0, 'd@ nedostane stupeň 3 podruhé');

  console.log('== odhlášení odkazem z mailu ==');
  // ⚠️ Odkaz se bere ze SUROVÉ hlavičky List-Unsubscribe, ne z dekódovaného těla:
  // dekoduj() pouští quoted-printable i přes hlavičky, a když token (nebo id) hned
  // za „=" začíná dvěma hex znaky, „=7A" se přepíše na „z" a odkaz tiše neplatí.
  // Projevovalo se jako náhodný pád u a@ nebo e@ (24. 10. 2026, ~30 % běhů na uživatele).
  const odhlasitZ = (raw) => (String(raw).match(/^List-Unsubscribe:\s*<([^>]+)>/mi) || [])[1];
  expect(/\/api\/kb\/navrat\/odhlasit\?u=/.test(telo1), 'odhlašovací odkaz je i v těle mailu');
  const odkaz = odhlasitZ(m1);
  expect(!!odkaz, 'z hlavičky List-Unsubscribe jde vytáhnout odhlašovací odkaz');
  let res = await fetch(odkaz.replace(inst.base, inst.base), { redirect: 'manual' });
  let html = await res.text();
  expect(res.status === 200 && /Hotovo — připomínky jsou vypnuté/.test(html), `GET odkaz → potvrzení (${res.status})`);
  expect(/text\/html/.test(res.headers.get('content-type') || ''), 'odpověď je HTML stránka');
  ua = await ctiU('a@example.com');
  expect(ua.navrat.odhlaseno === true, 'a@ je odhlášený');
  await zpetne('a@example.com', 8); // nový cyklus — odhlášení ho přežije
  n = await spust();
  expect(n === 0 && mailyPro('a@example.com').length === 1, 'odhlášení platí i v dalším cyklu');
  res = await fetch(inst.base + '/api/kb/navrat/odhlasit?u=' + uzivatele['a@example.com'].id + '&t=spatny-token');
  html = await res.text();
  expect(res.status === 200 && /Odkaz už neplatí/.test(html) && !/Hotovo/.test(html), 'špatný token → 200 „odkaz neplatí", nic neprozradí');
  res = await fetch(inst.base + '/api/kb/navrat/odhlasit?u=neexistuje&t=x');
  expect(res.status === 200 && /neplatí/.test(await res.text()), 'neexistující účet → stejná stránka');

  console.log('== jazyk příjemce + One-Click POST ==');
  await zpetne('e@example.com', 4);
  n = await spust();
  expect(n === 1, 'e@ (en) dostal mail');
  const me = mailyPro('e@example.com')[0] || '';
  expect(/Three days without you/.test(predmetZ(me)), `anglický předmět („${predmetZ(me)}")`);
  const odkazE = odhlasitZ(me);
  res = await fetch(odkazE, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  html = await res.text();
  expect(res.status === 200 && /reminders are off/.test(html), 'One-Click POST odhlásí, stránka anglicky');
  expect((await ctiU('e@example.com')).navrat.odhlaseno === true, 'e@ odhlášený');

  console.log('== bez AI (429) jde výpis ==');
  rezimAi = 'preteceno';
  await zpetne('h@example.com', 4);
  n = await spust();
  expect(n === 1, `h@ dostal mail i při 429 (${n})`);
  const teloH = dekoduj(mailyPro('h@example.com')[0] || '');
  expect(!teloH.includes('AI TEXT'), 'bez textu modelu');
  expect(teloH.includes('• Faktura pro Nováka') && teloH.includes('po termínu'), 'deterministický výpis nejdůležitějších položek');
  expect((await ctiU('h@example.com')).navrat.krok === 3, 'stupeň zapsán i bez AI');
  rezimAi = 'ok';

  console.log('== práva routy ==');
  r = await inst.api('POST', '/api/kb/run-navrat-maily', { token: uzivatele['a@example.com'].token });
  expect(r.status === 404, `admin instance (ne superuser) dostane 404 (${r.status})`);
  r = await inst.api('POST', '/api/kb/run-navrat-maily');
  expect(r.status === 404, `anonym dostane 404 (${r.status})`);

  console.log('== strop na instanci a den ==');
  const inst2 = await H.startInstance({ slug: 'navrat-strop', addHostGateway: true, env: Object.assign({ TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NAVRAT_MAX_DENNE: 2, KB_AI_PROVIDER: 'none' }) });
  const ST2 = await inst2.superuser();
  await sink.zapoj(inst2, ST2, { appURL: inst2.base });
  const ids2 = [];
  for (const e of ['x@strop.cz', 'y@strop.cz', 'z@strop.cz']) {
    const reg = await inst2.register(e);
    const tok = await inst2.login(e);
    await inst2.api('POST', '/api/collections/loginlogs/records', { token: tok, body: {} });
    await inst2.api('PATCH', `/api/collections/users/records/${reg.json.id}`, { token: ST2, body: { last_login: predDny(5) } });
    ids2.push(reg.json.id);
  }
  let r2 = await inst2.api('POST', '/api/kb/run-navrat-maily', { token: ST2 });
  expect(r2.json.sent === 2, `strop 2: odešly 2 ze 3 (${r2.json.sent})`);
  r2 = await inst2.api('POST', '/api/kb/run-navrat-maily', { token: ST2 });
  expect(r2.json.sent === 0, `týž den už nic (${r2.json.sent})`);
  const stavy2 = [];
  for (const id of ids2) stavy2.push(((await inst2.api('GET', `/api/collections/users/records/${id}`, { token: ST2 })).json.navrat || {}).krok || 0);
  expect(stavy2.filter((k) => k === 3).length === 2 && stavy2.filter((k) => !k).length === 1, `dva mají stupeň 3, jeden čeká (${stavy2})`);
  const teloX = dekoduj(sink.maily.find((m) => /^To:.*strop\.cz/mi.test(m)) || '');
  expect(teloX.includes('Momentálně na vás nečeká žádná otevřená práce'), 'bez práce i bez AI: odstavec „čistý stůl"');

  console.log('== vypnuto env ==');
  const inst3 = await H.startInstance({ slug: 'navrat-vyp', addHostGateway: true, env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_NAVRAT_MAILY: 0, KB_AI_PROVIDER: 'none' } });
  const ST3 = await inst3.superuser();
  await sink.zapoj(inst3, ST3, { appURL: inst3.base });
  const reg3 = await inst3.register('v@vyp.cz');
  await inst3.api('POST', '/api/collections/loginlogs/records', { token: await inst3.login('v@vyp.cz'), body: {} });
  await inst3.api('PATCH', `/api/collections/users/records/${reg3.json.id}`, { token: ST3, body: { last_login: predDny(5) } });
  const r3 = await inst3.api('POST', '/api/kb/run-navrat-maily', { token: ST3 });
  expect(r3.json.sent === 0, `KB_NAVRAT_MAILY=0 → nic (${r3.json.sent})`);

  console.log('== vypršelá zkušebka ==');
  const inst4 = await H.startInstance({ slug: 'navrat-trial', addHostGateway: true, env: { TZ: 'Europe/Prague', KB_UVODNI_MAPA: 0, KB_TRIAL_UNTIL: '2020-01-01', KB_AI_PROVIDER: 'none' } });
  const ST4 = await inst4.superuser();
  await sink.zapoj(inst4, ST4, { appURL: inst4.base });
  const reg4 = await inst4.api('POST', '/api/collections/users/records', { token: ST4, body: { email: 't@trial.cz', password: H.PW, passwordConfirm: H.PW, last_login: predDny(5) } });
  expect(reg4.status === 200 && reg4.json.last_login, `superuser založil účet s last_login (${reg4.status})`);
  const r4 = await inst4.api('POST', '/api/kb/run-navrat-maily', { token: ST4 });
  expect(r4.json.sent === 0, `po vypršení zkušebky nic (${r4.json.sent})`);
}, { nazev: 'NAVRAT-MAILY' });
