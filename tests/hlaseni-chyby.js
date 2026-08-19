// Nahlásit chybu / nápad — routa /api/kb/report.
//
// ⚠️ ŽÁDNÁ ZPRÁVA NEODEJDE VEN. Test si postaví vlastní SMTP jímku a čte, co jí
// instance podstrčila (vzor maily-jazyk.js). Cíl hlášení se navíc nastavuje
// proměnnou KB_REPORT_TO, kterou tady schválně míříme na example.com — brzda
// je uvnitř odesílající cesty, ne v prostředí testu (feedback z 6. 8. 2026,
// kdy „vypnutí přes prostředí" nefungovalo a testy psaly skutečné zprávy).
//
// Nejdůležitější tvrzení sady: BEZ KB_REPORT_TO routa neexistuje. Na tom stojí
// Richardovo zadání „jen z našich instancí" — cizí self-host nesmí odesílat nic.
const net = require('net');
const { execSync } = require('child_process');

const SMTP_PORT = 20532;
const PORT = 20534;
const BASE = `http://127.0.0.1:${PORT}`;
const NAME = 'kb-e2e-hlaseni';
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };
const CIL = 'podpora@example.com';

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

const maily = [];
const jimka = () => net.createServer((sock) => {
  let buf = '', vData = false, zprava = '';
  sock.write('220 jimka ESMTP\r\n');
  sock.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const radek = buf.slice(0, i); buf = buf.slice(i + 2);
      if (vData) {
        if (radek === '.') { maily.push(zprava); zprava = ''; vData = false; sock.write('250 OK\r\n'); }
        else zprava += radek + '\n';
        continue;
      }
      const cmd = radek.toUpperCase();
      if (cmd.startsWith('EHLO')) sock.write('250-jimka\r\n250 8BITMIME\r\n');
      else if (cmd.startsWith('HELO')) sock.write('250 jimka\r\n');
      else if (cmd.startsWith('DATA')) { vData = true; sock.write('354 go\r\n'); }
      else if (cmd.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 OK\r\n');
    }
  });
  sock.on('error', () => { /* klient odpojen, nevadí */ });
});

const qp = (s) => Buffer.from(
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
  'binary').toString('utf8');
const dekoduj = (s) => {
  let out = s.replace(/=\?[Uu][Tt][Ff]-8\?[Bb]\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  out = qp(out);
  for (const kus of out.split(/\r?\n\r?\n/)) {
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(kus.trim())) {
      try { out += '\n' + Buffer.from(kus.trim(), 'base64').toString('utf8'); } catch { /* nevadí */ }
    }
  }
  return out;
};

const spust = (env) => {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway -p 127.0.0.1:${PORT}:8090 ${env} ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
};
const pockej = async () => {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* startuje */ } await sleep(1000); }
  return false;
};
const nastavSmtp = async () => {
  execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
  const st = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;
  await api('PATCH', '/api/settings', { token: st, body: {
    meta: { appName: 'killBottleneck', appURL: BASE, senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
    smtp: { enabled: true, host: 'host.docker.internal', port: SMTP_PORT, tls: false },
  } });
};
const ucet = async (email) => {
  await api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW } });
  return (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json.token;
};

(async () => {
  const server = jimka();
  try {
    await new Promise((r) => server.listen(SMTP_PORT, '0.0.0.0', r));

    console.log('== BEZ KB_REPORT_TO: funkce vůbec neexistuje ==');
    spust('');
    ok(await pockej(), 'instance bez KB_REPORT_TO naběhla');
    await nastavSmtp();
    const t0 = await ucet('kdokoli@example.com');
    const cfg0 = await api('GET', '/api/kb/config');
    ok(cfg0.json.report_enabled === false, 'config hlásí report_enabled=false');
    maily.length = 0;
    const r0 = await api('POST', '/api/kb/report', { token: t0, body: { kind: 'chyba', text: 'tohle nesmí nikam odejít' } });
    ok(r0.status === 404, `routa vrací 404, neprozrazuje se (${r0.status})`);
    await sleep(1200);
    ok(maily.length === 0, `a NEODEŠLA žádná zpráva (${maily.length})`);

    console.log('== S KB_REPORT_TO: hlášení dojde ==');
    spust(`-e KB_REPORT_TO=${CIL} -e KB_VERSION=v0.38-test`);
    ok(await pockej(), 'instance s KB_REPORT_TO naběhla');
    await nastavSmtp();
    const token = await ucet('uzivatel@example.com');
    const cfg = await api('GET', '/api/kb/config');
    ok(cfg.json.report_enabled === true, 'config hlásí report_enabled=true');
    ok(JSON.stringify(cfg.json).indexOf(CIL) === -1, 'cílová adresa se v configu ven NEPOSÍLÁ');

    maily.length = 0;
    const r1 = await api('POST', '/api/kb/report', { token, body: {
      kind: 'chyba', text: 'Tlačítko Uložit nic nedělá <script>alert(1)</script> a & uvozovky "x"', page: '/map/abc', browser: 'Chrome/141',
    } });
    ok(r1.status === 200, `hlášení přijato (${r1.status})`);
    await sleep(1500);
    ok(maily.length === 1, `odešla právě jedna zpráva (${maily.length})`);
    const m = dekoduj(maily[0] || '');
    ok(/podpora@example\.com/.test(m), 'míří na adresu z KB_REPORT_TO');
    ok(/Reply-To:\s*uzivatel@example\.com/i.test(m), 'Reply-To je adresa hlásícího (jde odpovědět)');
    ok(/noreply@killbottleneck\.com/.test(m), 'From zůstává noreply (kvůli SPF/DKIM)');
    ok(/Tlačítko Uložit nic nedělá/.test(m), 'text uživatele je ve zprávě');
    // ⚠️ HTML a TEXTOVOU část je nutné posuzovat ZVLÁŠŤ. V HTML musí být
    // uživatelův text escapovaný, v textové verzi naopak syrový — ta se
    // nikde nerenderuje. Test, který to slil dohromady, hlásil chybu tam,
    // kde žádná nebyla (19. 8. 2026).
    const htmlCast = (m.split(/Content-Type:\s*text\/html/i)[1] || '');
    ok(/&lt;script&gt;/.test(htmlCast), 'v HTML části je text uživatele escapovaný');
    ok(!/<script>alert/.test(htmlCast), 'a žádná živá značka tam není');
    // Escapovat se smí JEDNOU. Dvojí escapování dorazí jako „&amp;lt;b&amp;gt;" — a hlášení
    // chyby je přesně ten obsah, kde úryvky kódu a ampersandy chodí (panel 19. 8.).
    ok(!/&amp;(lt|gt|amp|quot);/.test(htmlCast), 'escapuje se jen jednou, ne dvakrát');
    ok(/uzivatel@example\.com/.test(m), 'je vidět, kdo hlásil');
    ok(/v0\.38-test/.test(m), 'je vidět verze instance');
    ok(/\/map\/abc/.test(m), 'je vidět, na které stránce to bylo');

    console.log('== nápad má vlastní předmět ==');
    maily.length = 0;
    await api('POST', '/api/kb/report', { token, body: { kind: 'napad', text: 'Chtělo by to tmavý režim i v tabulce' } });
    await sleep(1500);
    const mn = dekoduj(maily[0] || '');
    ok(/Nápad|Idea/.test(mn), 'předmět rozlišuje nápad od chyby');
    // ⚠️ Serverové i18n dosazuje {klic}, ne {{klic}} jako frontend. Zapsáno
    // frontendovým způsobem projde všude kromě výsledku: v předmětu pak stojí
    // „instance {adresa}" i se závorkami (naraženo při přípravě klik-testu).
    ok(!/\{\s*org\s*\}|\{\{/.test(mn), 'v předmětu nezůstala nedosazená značka');
    // Přísnější než kontrola výše: hodnota se dosadí, ale závorky kolem ní
    // zůstanou („instance {127.0.0.1}"), takže hledat samotné {org} nestačí.
    ok(!/\{[^}\n]*\}/.test((mn.match(/^Subject:.*$/m) || [''])[0]), 'v předmětu nezůstaly složené závorky kolem hodnoty');

    console.log('== seznam odeslaných hlášení ==');
    // Richard 18. 8. 2026: „ať vím, co už jsem nahlásil a nedělám to znovu."
    const moje = await api('GET', '/api/collections/reports/records?perPage=10&sort=-created', { token });
    ok(moje.status === 200 && moje.json.totalItems >= 2, `svá hlášení si přečtu (${moje.json && moje.json.totalItems})`);
    const posledni = (moje.json.items || [])[0];
    ok(posledni && posledni.sent === true, 'odeslané hlášení má příznak, že odešlo');
    ok(posledni && posledni.version, `nese verzi instance (${posledni && posledni.version})`);
    // cizí hlášení nesmí být vidět — text může být cokoli, včetně stížnosti na kolegu
    const cizi = await ucet('treti@example.com');
    const ciziSeznam = await api('GET', '/api/collections/reports/records?perPage=10', { token: cizi });
    ok(ciziSeznam.json.totalItems === 0, `cizí hlášení nevidím (${ciziSeznam.json.totalItems})`);
    // do kolekce se nesmí psát mimo routu (obešel by se rate limit i odeslání)
    const primo = await api('POST', '/api/collections/reports/records', { token,
      body: { kind: 'chyba', text: 'zápis mimo routu', owner: 'x' } });
    ok(primo.status === 400 || primo.status === 403 || primo.status === 404,
      `přímý zápis do kolekce neprojde (${primo.status})`);

    console.log('== ochrany ==');
    const bezPrihlaseni = await api('POST', '/api/kb/report', { body: { kind: 'chyba', text: 'anonymní pokus' } });
    ok(bezPrihlaseni.status === 401 || bezPrihlaseni.status === 403,
      `bez přihlášení to nejde (${bezPrihlaseni.status})`);
    const prazdne = await api('POST', '/api/kb/report', { token, body: { kind: 'chyba', text: 'ne' } });
    ok(prazdne.status === 400, `prázdné/krátké hlášení odmítnuto (${prazdne.status})`);

    maily.length = 0;
    let limit = 0;
    for (let i = 0; i < 6; i++) {
      const r = await api('POST', '/api/kb/report', { token, body: { kind: 'chyba', text: `opakované hlášení ${i}` } });
      if (r.status === 429) limit++;
    }
    ok(limit > 0, `po pěti hlášeních za hodinu přijde 429 (${limit}× odmítnuto)`);

    console.log('== stará cesta /api/flowmap/report ==');
    const t2 = await ucet('druhy@example.com');
    const stara = await api('POST', '/api/flowmap/report', { token: t2, body: { kind: 'chyba', text: 'přes starou cestu' } });
    ok(stara.status === 200, `stará cesta funguje taky (${stara.status})`);
  } catch (e) {
    fail++;
    console.log(`  ❌ výjimka: ${e.message}`);
  } finally {
    try { server.close(); } catch { /* nevadí */ }
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} HLÁŠENÍ PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
