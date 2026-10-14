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
//   - instance s registračním klíčem (14. 10. 2026, systémové řešení „sestra mi
//     nasdílela mapu a nemám se jak přihlásit"):
//       · ČLEN sdílí → pozvánka říká „správce dostal žádost" (bez „odpovězte"),
//         admin dostane notifikaci org_notice s extra.pozvat, člen nesmí zvát;
//       · ADMIN sdílí → účet vznikne ROVNOU (invited_by, role user), odpověď
//         org_invited + registered:true, pozvánkový mail s nastavením hesla
//         jmenuje projekt; mail „účet zakládá správce" NEodchází;
//       · pozvaný si přes odkaz nastaví heslo a mapu vidí.
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
    ST = await spust('-e KB_SETUP_CODE=e2e-kod -e KB_SHARE_INVITE_DAILY_CAP=4'); // strop 4: pátá pozvánka člena = limit
    await zapniSmtp(ST);
    const ADM = await ucet('adm@example.com', { setup_code: 'e2e-kod' });
    const U = await ucet('u@example.com', { setup_code: 'e2e-kod' });
    expect(ADM.record?.role === 'admin' && U.record?.role === 'user', 'admin a člen založeni');
    const MA = await mapa(ADM.token, 'Adminův');
    const MU = await mapa(U.token, 'Členův');
    const ucty = async (email) => (await api('GET', `/api/collections/users/records?filter=${encodeURIComponent(`email="${email}"`)}`, { token: ST })).json?.items || [];

    console.log('-- check: dialog se ptá jen tam, kde to dává smysl --');
    r = await api('POST', '/api/kb/share', { token: ADM.token, body: { action: 'check', mapId: MA.id, email: 'cizi2@example.com' } });
    expect(r.json.needs_confirm === true && r.json.registered === false && r.json.can_invite_to_org === true, `admin + adresa bez účtu → ptát se (${JSON.stringify(r.json)})`);
    r = await api('POST', '/api/kb/share', { token: U.token, body: { action: 'check', mapId: MU.id, email: 'cizi@example.com' } });
    expect(r.json.needs_confirm === false && r.json.can_invite_to_org === false, 'člen → neptat se (zvát nesmí)');
    r = await api('POST', '/api/kb/share', { token: ADM.token, body: { action: 'check', mapId: MA.id, email: 'u@example.com' } });
    expect(r.json.needs_confirm === false && r.json.registered === true, 'adresa s účtem → neptat se');

    console.log('-- člen sdílí → správce dostane žádost, účet NEvzniká --');
    r = await sdilej(U.token, { mapId: MU.id, email: 'cizi@example.com' });
    expect(r.json.invite === 'sent' && r.json.registration_open === false && r.json.can_invite_to_org === false,
      `člen: pozvánka odešla, registrace zavřená, pozvat do organizace nesmí (${JSON.stringify([r.json.invite, r.json.registration_open, r.json.can_invite_to_org])})`);
    expect(r.json.admin_asked === true, 'člen: správce dostal žádost v aplikaci');
    expect((await ucty('cizi@example.com')).length === 0, 'člen: účet NEvznikl');
    await sleep(1500);
    const zav = pro('cizi@example.com');
    expect(zav.length === 1, `pozvánka doručena (${zav.length})`);
    if (zav[0]) {
      const txt = dekoduj(zav[0].raw);
      expect(/nezaložíte sami/.test(txt), 'text vysvětluje, že účet zakládá správce');
      expect(/poslali žádost/.test(txt), 'text říká, že správci dostali žádost');
      expect(!/Odpovězte na tento e-mail/.test(txt), 'bez „odpovězte na e-mail" — žádost šla v aplikaci');
      expect(!/\/register\?email=/.test(txt), 'bez odkazu na registraci, která by stejně nešla');
    }
    r = await api('GET', `/api/collections/notifications/records?perPage=5&sort=-created&filter=${encodeURIComponent('type="org_notice"')}`, { token: ADM.token });
    const zadost = (r.json?.items || [])[0];
    expect(!!zadost && /cizi@example\.com/.test(zadost.text || '') && zadost.extra?.pozvat === 'cizi@example.com' && zadost.map === MU.id,
      `admin dostal žádost „pozvěte cizi@example.com" s vazbou na mapu (${JSON.stringify(zadost && [zadost.type, zadost.text, zadost.extra, zadost.map])})`);
    r = await api('GET', `/api/collections/notifications/records?perPage=5&filter=${encodeURIComponent('type="org_notice"')}`, { token: U.token });
    expect((r.json?.totalItems || 0) === 0, 'člen žádost nedostal (jen správci)');
    const MU2 = await mapa(U.token, 'Členův druhý');
    r = await sdilej(U.token, { mapId: MU2.id, email: 'cizi@example.com' });
    r = await api('GET', `/api/collections/notifications/records?perPage=5&filter=${encodeURIComponent('type="org_notice"')}`, { token: ADM.token });
    expect((r.json?.totalItems || 0) === 1, `druhý projekt s touž adresou → žádost se neopakuje (${r.json?.totalItems})`);
    r = await sdilej(U.token, { mapId: MU.id, email: 'xx@example.com' });
    r = await sdilej(U.token, { mapId: MU.id, email: 'xy@example.com' });
    r = await sdilej(U.token, { mapId: MU.id, email: 'xz@example.com' });
    expect(r.json.invite === 'limit' && r.json.admin_asked === false, `nad denním stropem pozvánek žádná žádost správci (${JSON.stringify([r.json.invite, r.json.admin_asked])})`);

    console.log('-- admin sdílí BEZ potvrzení → jen mail, účet NEvzniká --');
    maily.length = 0;
    r = await sdilej(ADM.token, { mapId: MA.id, email: 'cizi2@example.com' });
    expect(r.json.invite === 'sent' && r.json.can_invite_to_org === true && r.json.member?.registered === false && !r.json.temp_password,
      `admin bez invite_to_org: pozvánka, bez účtu (${JSON.stringify([r.json.invite, r.json.can_invite_to_org, r.json.member?.registered])})`);
    expect((await ucty('cizi2@example.com')).length === 0, 'admin bez potvrzení: účet NEvznikl');
    await sleep(1200);
    if (pro('cizi2@example.com')[0]) {
      const txt = dekoduj(pro('cizi2@example.com')[0].raw);
      expect(/Odpovězte na tento e-mail/.test(txt), 'mail: „odpovězte sdílejícímu" (ten zvát umí)');
    }

    console.log('-- quiet (zadání práce) na zavřené instanci NIKDY nezakládá účet --');
    r = await sdilej(ADM.token, { mapId: MA.id, email: 'tichy@example.com', permission: 'work', quiet: true, invite_to_org: true });
    expect(r.json.invite === 'sent' && (await ucty('tichy@example.com')).length === 0, `quiet + invite_to_org → jen pozvánka, bez účtu (${r.json.invite})`);

    console.log('-- admin potvrdí „pozvat do organizace" → účet vzniká, i nad dřív nasdílenou adresou --');
    maily.length = 0;
    r = await sdilej(ADM.token, { mapId: MA.id, email: 'cizi2@example.com', invite_to_org: true });
    expect(r.json.success === true && r.json.invite === 'org_invited' && r.json.invited_via_email === true && r.json.member?.registered === true,
      `invite_to_org nad už sdílenou adresou: účet + pozvánka místo 400 (${JSON.stringify([r.status, r.json.invite, r.json.invited_via_email, r.json.member?.registered, r.json.error])})`);
    expect(!r.json.temp_password, 'dočasné heslo se s mailovou bránou NEvrací');
    const novy = (await ucty('cizi2@example.com'))[0];
    expect(!!novy && novy.role === 'user' && novy.invited_by === 'adm@example.com',
      `účet existuje, role user, invited_by = admin (${JSON.stringify(novy && [novy.role, novy.invited_by])})`);
    await sleep(1500);
    const poz = pro('cizi2@example.com');
    expect(poz.length === 1, `přišel přesně JEDEN mail — pozvánka, ne navíc „účet zakládá správce" (${poz.length})`);
    let resetToken = '';
    if (poz[0]) {
      const txt = dekoduj(poz[0].raw);
      expect(/Adminův/.test(txt), 'pozvánka jmenuje sdílený projekt');
      expect(/sdílí s vámi projekt|sdílí projekt/.test(txt), 'pozvánka říká, že jde o sdílení projektu');
      expect(/nastav/i.test(txt) && /reset-password\?token=/.test(txt), 'pozvánka nese odkaz na nastavení hesla');
      expect(!/nezaložíte sami/.test(txt), 'mail NEříká „účet zakládá správce"');
      // dekoduj() vrací raw + dekódované části; v raw je QP „token=3D…" → brát NEJDELŠÍ nález
      resetToken = [...txt.matchAll(/reset-password\?token=(?:3D)?([A-Za-z0-9._-]+)/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0] || '';
    }
    r = await sdilej(ADM.token, { mapId: MA.id, email: 'cizi2@example.com', permission: 'edit' });
    expect(r.json.upgraded === true && r.json.invite === undefined, 'povýšení už založeného účtu nezve podruhé');
    if (resetToken) {
      r = await api('POST', '/api/collections/users/confirm-password-reset', { body: { token: resetToken, password: PW, passwordConfirm: PW } });
      expect(r.status === 204 || r.status === 200, `pozvaný si odkazem nastavil heslo (${r.status})`);
      const C2 = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'cizi2@example.com', password: PW } })).json;
      r = await api('GET', `/api/collections/goalmaps/records/${MA.id}`, { token: C2.token });
      expect(r.status === 200, `pozvaný po přihlášení sdílenou mapu otevře (${r.status})`);
      r = await api('GET', `/api/collections/notifications/records?perPage=5&filter=${encodeURIComponent('type="map_shared"')}`, { token: C2.token });
      expect((r.json?.totalItems || 0) >= 1, `pozvaný má v aplikaci oznámení o nasdílení (${r.json?.totalItems})`);
    }

    console.log('-- kdo smí: správce struktury ano (jen role user), člen ne --');
    const OM = await ucet('om@example.com', { setup_code: 'e2e-kod' });
    await api('PATCH', `/api/collections/users/records/${OM.record.id}`, { token: ST, body: { is_org_manager: true } });
    const MO = await mapa(OM.token, 'Strukturní');
    r = await sdilej(OM.token, { mapId: MO.id, email: 'cizi5@example.com', invite_to_org: true, role: 'admin' });
    const u5 = (await ucty('cizi5@example.com'))[0];
    expect(r.json.invite === 'org_invited' && !!u5 && u5.role === 'user', `správce struktury založil účet, role user i s podstrčeným role:admin (${JSON.stringify([r.json.invite, u5 && u5.role])})`);
    r = await sdilej(U.token, { mapId: MU.id, email: 'cizi6@example.com', invite_to_org: true });
    expect(r.status === 403 && (await ucty('cizi6@example.com')).length === 0, `člen s invite_to_org → 403, bez účtu (${r.status})`);

    console.log('-- admin potvrdí BEZ mailové brány → dočasné heslo v odpovědi --');
    await api('PATCH', '/api/settings', { token: ST, body: { smtp: { enabled: false } } });
    r = await sdilej(ADM.token, { mapId: MA.id, email: 'cizi3@example.com', invite_to_org: true });
    expect(r.json.invite === 'org_invited' && typeof r.json.temp_password === 'string' && r.json.temp_password.length >= 8 && r.json.member?.registered === true,
      `bez SMTP: účet založen, dočasné heslo k předání (${JSON.stringify([r.json.invite, !!r.json.temp_password])})`);
    const C3 = (await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'cizi3@example.com', password: r.json.temp_password || 'x' } })).json;
    expect(!!C3.token, 'dočasné heslo funguje');
  } catch (e) {
    fail++; console.log('  ❌ výjimka', e.stack || e.message);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    server.close();
  }
  console.log(`\n${fail ? '🔴' : '🟢'} SDÍLENÍ POZVÁNKA PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
