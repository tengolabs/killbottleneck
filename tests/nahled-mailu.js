// Vizuální náhled odchozí pošty: spustí instanci, projde celý tok pozvánky
// a ULOŽÍ HTML, které opravdu odešlo do jímky.
//
// Proč to není přeskládané z modulů: šablona i její naplnění (kdo, organizace,
// adresa) vznikají na dvou různých místech. Kdyby si náhled skládal zprávu sám,
// ukazoval by něco jiného, než co dostane zákazník — a přesně takový tichý drift
// mezi testem a produkcí je to, co se tady nesmí opakovat.
//
//   node product/tests/nahled-mailu.js [cílová složka]
const { execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const NAME = 'flowmap-nahled-mailu';
const PORT = 20527;
const SMTP_PORT = 20528;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };
const VEN = process.argv[2] || path.join(process.env.HOME, 'claude_spark', 'galerie', 'kb-maily');

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
    sock.on('error', () => { /* nevadí */ });
  });
}

const qp = (s) => Buffer.from(
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
  'binary').toString('utf8');

// HTML část zprávy (multipart) — bere se AŽ po dekódování quoted-printable.
const htmlZ = (raw) => {
  const telo = qp(raw);
  const i = telo.indexOf('<!doctype html>');
  if (i < 0) return '';
  const j = telo.lastIndexOf('</html>');
  return telo.slice(i, j >= 0 ? j + 7 : undefined);
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
      : Buffer.from(mm[2].replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary'));
    konec = mm.index + mm[0].length;
  }
  if (konec < radek.length) kusy.push(Buffer.from(radek.slice(konec), 'utf8'));
  return Buffer.concat(kusy).toString('utf8').trim();
};

(async () => {
  const server = jimka();
  const zachyceno = [];
  try {
    await new Promise((r) => server.listen(SMTP_PORT, '0.0.0.0', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;
    await api('PATCH', '/api/settings', { token: ST, body: {
      meta: { appName: 'killBottleneck', appURL: 'https://tengo.killbottleneck.com', senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
      smtp: { enabled: true, host: 'host.docker.internal', port: SMTP_PORT, tls: false },
    } });

    await api('POST', '/api/collections/users/records', { body: { email: 'sefka@firma.cz', password: PW, passwordConfirm: PW, language: 'cs' } });
    const prihl = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'sefka@firma.cz', password: PW } });
    const UT = prihl.json.token;
    await api('PATCH', `/api/collections/users/records/${prihl.json.record.id}`, { token: UT, body: { full_name: 'Jana Nováková' } });

    maily.length = 0;
    await api('POST', '/api/kb/invite', { token: UT, body: { email: 'kolega@firma.cz', role: 'user' } });
    await sleep(2500);
    zachyceno.push({ soubor: 'pozvanka.html', popis: 'Pozvánka do organizace', raw: maily[0] || '' });

    const tok = (qp(maily.join('')).match(/\/reset-password\?token=([A-Za-z0-9._-]+)/) || [])[1];
    await api('POST', '/api/collections/users/confirm-password-reset', { body: { token: tok, password: PW, passwordConfirm: PW } });
    const pozv = await api('POST', '/api/collections/users/auth-with-password', { body: { identity: 'kolega@firma.cz', password: PW } });
    maily.length = 0;
    await api('POST', '/api/collections/loginlogs/records', { token: pozv.json.token, body: {} });
    await sleep(2500);
    zachyceno.push({ soubor: 'uvitaci.html', popis: 'Uvítací mail po prvním vstupu', raw: maily[0] || '' });

    fs.mkdirSync(VEN, { recursive: true });
    const karty = [];
    for (const z of zachyceno) {
      const html = htmlZ(z.raw);
      const predmet = predmetZ(z.raw);
      const replyTo = (z.raw.match(/^Reply-To:\s*(.+)$/mi) || [])[1] || '(žádné)';
      if (!html) { console.log(`❌ ${z.soubor}: HTML se nepodařilo vytáhnout`); continue; }
      fs.writeFileSync(path.join(VEN, z.soubor), html);
      console.log(`✅ ${z.soubor} — předmět: ${predmet}`);
      karty.push({ ...z, predmet, replyTo });
    }

    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    fs.writeFileSync(path.join(VEN, 'index.html'), `<!doctype html>
<html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>killBottleneck — pozvánkové maily</title>
<style>
 body{margin:0;background:#eef1f5;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#1f2937}
 header{padding:28px 20px;background:#fff;border-bottom:1px solid #e5e7eb}
 h1{margin:0 0 6px;font-size:22px}header p{margin:0;color:#6b7280;font-size:14px}
 .mriz{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));padding:24px;max-width:1400px;margin:0 auto}
 .karta{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden}
 .hlava{padding:14px 18px;border-bottom:1px solid #e5e7eb}
 .hlava h2{margin:0 0 8px;font-size:16px}
 .radek{font-size:13px;color:#6b7280;margin:2px 0;word-break:break-word}
 .radek b{color:#1f2937;font-weight:600}
 iframe{width:100%;height:820px;border:0;display:block;background:#f3f4f6}
</style></head><body>
<header>
 <h1>killBottleneck — pozvánkové maily</h1>
 <p>Zachyceno z opravdu odeslané pošty (SMTP jímka), ne přeskládáno. Obrázek loga se tahá z killbottleneck.com — když se nenačte, uvidíte, jak zpráva vypadá s blokovanými obrázky.</p>
</header>
<div class="mriz">
${karty.map((k) => `  <div class="karta">
    <div class="hlava">
      <h2>${esc(k.popis)}</h2>
      <div class="radek"><b>Předmět:</b> ${esc(k.predmet)}</div>
      <div class="radek"><b>Reply-To:</b> ${esc(k.replyTo)}</div>
    </div>
    <iframe src="${k.soubor}" title="${esc(k.popis)}"></iframe>
  </div>`).join('\n')}
</div>
</body></html>`);
    console.log(`\n📁 ${VEN}`);
  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    server.close();
  }
})();
