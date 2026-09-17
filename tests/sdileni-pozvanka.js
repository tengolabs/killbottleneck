// SDÍLENÍ S ADRESOU BEZ ÚČTU → pozvánka e-mailem.
//
// Nález z bety (Discord 16. 9. 2026): „Mailovou bránu funkční mám a stejně se
// zvací mail neodeslal." notify() neregistrovaného příjemce tiše přeskočí,
// takže sdílení na adresu bez účtu neposlalo nic. Sada hlídá:
//   - bez mailové brány: stav no_smtp, nic neodejde, a závora se NEZAPÍŠE
//     (po zapnutí brány musí pozvánka odejít),
//   - s bránou: pozvánka odejde, předmět nese adresu sdílejícího, Reply-To na
//     něj, tlačítko na /register?email=, název projektu escapovaný,
//   - odebrání + nové přidání / povýšení práv / spolusprávce nepošle podruhé,
//   - registrovaný adresát pozvánku nedostane,
//   - denní strop odesílatele,
//   - `quiet` (zadání práce) pozvánku neregistrovanému POŠLE,
//   - instance s registračním klíčem: text „účet zakládá správce", bez odkazu
//     na registraci; can_invite_to_org jen admin/manažer.
// Zprávy se NEPOSÍLAJÍ ven — vlastní SMTP jímka (vzor notify-email-dedup.js).
const { execSync } = require('child_process');
const net = require('net');

const NAME = 'flowmap-e2e-sdileni-pozvanka';
const PORT = 20700;
const SMTP_PORT = 20701;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };
const IMAGE = process.env.KB_TEST_IMAGE || 'product-flowmap';

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, p, { token, body } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json = null; try { json = await res.json(); } catch { /* prázdné tělo */ }
  return { status: res.status, json };
};

const maily = [];
function jimka() {
  return net.createServer((sock) => {
    let buf = '', vData = false, zprava = '', rcpt = [];
    sock.write('220 jimka ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const radek = buf.slice(0, i); buf = buf.slice(i + 2);
        if (vData) {
          if (radek === '.') { maily.push({ rcpt: rcpt.join(','), raw: zprava }); zprava = ''; rcpt = []; vData = false; sock.write('250 OK\r\n'); }
          else zprava += radek + '\n';
          continue;
        }
        const cmd = radek.toUpperCase();
        if (cmd.startsWith('EHLO')) sock.write('250-jimka\r\n250 8BITMIME\r\n');
        else if (cmd.startsWith('HELO')) sock.write('250 jimka\r\n');
        else if (cmd.startsWith('RCPT TO')) { rcpt.push(radek.slice(8).replace(/[<>\s]/g, '').toLowerCase()); sock.write('250 OK\r\n'); }
        else if (cmd.startsWith('DATA')) { vData = true; sock.write('354 go\r\n'); }
        else if (cmd.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
    sock.on('error', () => { /* klient odpojen */ });
  });
}
const pro = (adresa) => maily.filter((m) => m.rcpt.includes(adresa));
const cekejNaHealth = async () => { for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* startuje */ } await sleep(1000); } return false; };
// MIME tělo může být quoted-printable / base64 — pro hledání textu dekódovat
function dekoduj(raw) {
  const qp = raw.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  let b64 = '';
  for (const blok of raw.split(/\n\n/)) {
    const cisty = blok.replace(/\s+/g, '');
    if (cisty.length > 40 && /^[A-Za-z0-9+/=]+$/.test(cisty)) { try { b64 += Buffer.from(cisty, 'base64').toString('utf8'); } catch { /* není base64 */ } }
  }
  const utf = (s) => { try { return Buffer.from(s, 'latin1').toString('utf8'); } catch { return s; } };
  return raw + '\n' + utf(qp) + '\n' + b64;
}
// předmět bývá RFC 2047 (=?utf-8?q?…?= / =?utf-8?b?…?=)
function predmet(raw) {
  const m = raw.match(/^Subject: (.*(?:\n[ \t].*)*)/mi);
  if (!m) return '';
  return m[1].replace(/\n[ \t]/g, '').replace(/=\?utf-8\?([qb])\?([^?]*)\?=\s*/gi, (_, k, s) => (k.toLowerCase() === 'b'
    ? Buffer.from(s, 'base64').toString('utf8')
    : Buffer.from(s.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8')));
}

async function spust(extraEnv) {
  execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
  execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway -e KB_UVODNI_MAPA=0 -e KB_PURPOSE_ASK=0 ${extraEnv} -p 127.0.0.1:${PORT}:8090 ${IMAGE}`, { stdio: 'ignore' });
  expect(await cekejNaHealth(), 'instance nastartovala');
  execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
  return (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;
}
const zapniSmtp = (ST) => api('PATCH', '/api/settings', { token: ST, body: {
  meta: { appName: 'killBottleneck', appURL: 'https://kb.example.com', senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
  smtp: { enabled: true, host: 'host.docker.internal', port: SMTP_PORT, tls: false },
} });
const ucet = async (email, extra = {}) => {
  await api('POST', '/api/collections/users/records', { body: { email, password: PW, passwordConfirm: PW, ...extra } });
  return (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: email, password: PW } })).json;
};
const mapa = async (token, title) => (await api('POST', '/api/collections/goalmaps/records', { token, body: {
  title, nodes: [{ id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { title: 'Cíl', status: 'todo' } }], edges: [],
} })).json;
const sdilej = (token, body) => api('POST', '/api/kb/share', { token, body: { action: 'share', ...body } });

(async () => {
  const server = jimka();
  try {
    await new Promise((r) => server.listen(SMTP_PORT, '0.0.0.0', r));

    console.log('== A: otevřená registrace, strop odesílatele 3 ==');
    let ST = await spust('-e KB_SHARE_INVITE_DAILY_CAP=3');
    const A = await ucet('a@example.com', { full_name: 'Alena Nováková' });
    const B = await ucet('b@example.com');
    const M = await mapa(A.token, 'Plán <b>jaro</b>');
    expect(!!M.id, 'mapa založena');

    console.log('-- bez mailové brány --');
    let r = await sdilej(A.token, { mapId: M.id, email: 'Novy@Example.com', permission: 'read' });
    expect(r.status === 200 && r.json.member.registered === false, `sdílení prošlo, adresát bez účtu (${r.status})`);
    expect(r.json.invite === 'no_smtp', `stav no_smtp (${r.json.invite})`);
    expect(r.json.registration_open === true, 'registrace je otevřená');
    await sleep(800);
    expect(maily.length === 0, `nic neodešlo (${maily.length})`);
    r = await api('POST', '/api/kb/share', { token: A.token, body: { action: 'unshare', mapId: M.id, memberEmail: 'novy@example.com' } });
    expect(r.status === 200, 'odebráno');

    console.log('-- s mailovou bránou --');
    r = await zapniSmtp(ST);
    expect(r.status === 200, 'SMTP zapnuto');
    r = await sdilej(A.token, { mapId: M.id, email: 'novy@example.com', permission: 'read' });
    expect(r.json.invite === 'sent', `po zapnutí brány pozvánka odešla — závora z no_smtp nesmí blokovat (${r.json.invite})`);
    await sleep(1500);
    const pozv = pro('novy@example.com');
    expect(pozv.length === 1, `adresát dostal právě 1 mail (${pozv.length})`);
    if (pozv[0]) {
      const txt = dekoduj(pozv[0].raw);
      const subj = predmet(pozv[0].raw);
      expect(/a@example\.com/.test(subj) && /Plán/.test(subj), `předmět nese sdílejícího a projekt („${subj}")`);
      expect(/^Reply-To:.*a@example\.com/mi.test(pozv[0].raw), 'Reply-To míří na sdílejícího');
      expect(/kb\.example\.com\/register\?email=novy%40example\.com/.test(txt), 'tlačítko vede na registraci s předvyplněnou adresou');
      expect(/Alena Nováková/.test(txt), 'v těle je jméno sdílejícího');
      // textová část <b> legitimně obsahuje (je to prostý text) — kontroluje se jen HTML
      const htmlCast = dekoduj(pozv[0].raw.split(/Content-Type: text\/html/i)[1] || '');
      expect(htmlCast.length > 0 && !/<b>jaro<\/b>/.test(htmlCast) && /&lt;b&gt;jaro/.test(htmlCast), 'název projektu je v HTML escapovaný');
      expect(/zaregistrujte se touto e-mailovou adresou/.test(txt), 'návod k registraci (otevřená registrace)');
    }

    console.log('-- žádná druhá pozvánka --');
    await api('POST', '/api/kb/share', { token: A.token, body: { action: 'unshare', mapId: M.id, memberEmail: 'novy@example.com' } });
    r = await sdilej(A.token, { mapId: M.id, email: 'novy@example.com', permission: 'read' });
    expect(r.json.invite === 'already_sent', `odebrat + přidat znovu → already_sent (${r.json.invite})`);
    r = await sdilej(A.token, { mapId: M.id, email: 'novy@example.com', permission: 'edit' });
    expect(r.status === 200 && r.json.upgraded && r.json.invite === 'already_sent', `povýšení práv → already_sent (${r.json.invite})`);
    await sleep(1000);
    expect(pro('novy@example.com').length === 1, `dál jen 1 mail (${pro('novy@example.com').length})`);

    console.log('-- registrovaný adresát --');
    r = await sdilej(A.token, { mapId: M.id, email: 'b@example.com', permission: 'read' });
    expect(r.status === 200 && r.json.member.registered === true && r.json.invite === undefined, 'registrovaný: bez pozvánky, registered=true');
    r = await api('POST', '/api/kb/share', { token: A.token, body: { action: 'list', mapId: M.id } });
    const reg = Object.fromEntries((r.json.members || []).map((m) => [m.email, m.registered]));
    expect(reg['b@example.com'] === true && reg['novy@example.com'] === false, `seznam nese příznak registered (${JSON.stringify(reg)})`);

    console.log('-- quiet (zadání práce) + denní strop --');
    const M2 = await mapa(A.token, 'Druhý');
    r = await sdilej(A.token, { mapId: M2.id, email: 'x1@example.com', permission: 'work', quiet: true });
    expect(r.json.invite === 'sent', `quiet neregistrovanému pozvánku pošle (${r.json.invite})`);
    r = await sdilej(A.token, { mapId: M2.id, email: 'x2@example.com' });
    expect(r.json.invite === 'sent', `3. pozvánka dne ještě projde (${r.json.invite})`);
    r = await sdilej(A.token, { mapId: M2.id, email: 'x3@example.com' });
    expect(r.status === 200 && r.json.invite === 'limit', `4. pozvánka narazí na strop, sdílení ale projde (${r.status} ${r.json.invite})`);
    await sleep(1500);
    expect(pro('x1@example.com').length === 1 && pro('x2@example.com').length === 1 && pro('x3@example.com').length === 0, 'doručeno x1, x2; x3 ne');
    expect(pro('b@example.com').length === 0, 'registrovaný b@ nedostal nic (e-mailové notifikace jsou ve výchozím stavu vypnuté)');

    console.log('-- spolusprávce tutéž adresu znovu nepozve --');
    r = await sdilej(A.token, { mapId: M2.id, email: 'b@example.com', permission: 'edit' });
    expect(r.status === 200, 'b@ je spolusprávce druhé mapy');
    await api('POST', '/api/kb/share', { token: A.token, body: { action: 'unshare', mapId: M2.id, memberEmail: 'x1@example.com' } });
    r = await sdilej(B.token, { mapId: M2.id, email: 'x1@example.com' });
    expect(r.status === 200 && r.json.invite === 'already_sent', `spolusprávce: already_sent (${r.status} ${r.json && r.json.invite})`);
    await sleep(1000);
    expect(pro('x1@example.com').length === 1, `x1 dál 1 mail (${pro('x1@example.com').length})`);

    console.log('-- po registraci adresát mapu vidí --');
    const N = await ucet('novy@example.com');
    r = await api('GET', `/api/collections/goalmaps/records/${M.id}`, { token: N.token });
    expect(r.status === 200, `nově registrovaný mapu otevře (${r.status})`);

    console.log('== B: registrace na klíč ==');
    maily.length = 0;
    ST = await spust('-e KB_SETUP_CODE=e2e-kod');
    await zapniSmtp(ST);
    const ADM = await ucet('adm@example.com', { setup_code: 'e2e-kod' });
    const U = await ucet('u@example.com', { setup_code: 'e2e-kod' });
    expect(ADM.record?.role === 'admin' && U.record?.role === 'user', 'admin a člen založeni');
    const MA = await mapa(ADM.token, 'Adminův');
    const MU = await mapa(U.token, 'Členův');
    r = await sdilej(U.token, { mapId: MU.id, email: 'cizi@example.com' });
    expect(r.json.invite === 'sent' && r.json.registration_open === false && r.json.can_invite_to_org === false,
      `člen: pozvánka odešla, registrace zavřená, pozvat do organizace nesmí (${JSON.stringify([r.json.invite, r.json.registration_open, r.json.can_invite_to_org])})`);
    r = await sdilej(ADM.token, { mapId: MA.id, email: 'cizi2@example.com' });
    expect(r.json.can_invite_to_org === true, 'admin: smí pozvat do organizace');
    await sleep(1500);
    const zav = pro('cizi@example.com');
    expect(zav.length === 1, `pozvánka doručena (${zav.length})`);
    if (zav[0]) {
      const txt = dekoduj(zav[0].raw);
      expect(/nezaložíte sami/.test(txt), 'text vysvětluje, že účet zakládá správce');
      expect(!/\/register\?email=/.test(txt), 'bez odkazu na registraci, která by stejně nešla');
    }
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.stack || e.message);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    server.close();
  }
  console.log(`\n${fail ? '🔴' : '🟢'} SDÍLENÍ POZVÁNKA PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
