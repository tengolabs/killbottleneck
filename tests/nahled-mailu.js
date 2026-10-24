// Vizuální náhled odchozí pošty: spustí instanci, projde celý tok pozvánky
// a ULOŽÍ HTML, které opravdu odešlo do jímky.
//
// Proč to není přeskládané z modulů: šablona i její naplnění (kdo, organizace,
// adresa) vznikají na dvou různých místech. Kdyby si náhled skládal zprávu sám,
// ukazoval by něco jiného, než co dostane zákazník — a přesně takový tichý drift
// mezi testem a produkcí je to, co se tady nesmí opakovat.
//
//   node product/tests/nahled-mailu.js [cílová složka]
//   (bez argumentu: $KB_MAIL_PREVIEW_DIR, jinak <tmp>/kb-maily)
const { execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'flowmap-nahled-mailu';
const PORT = 20527;
const SMTP_PORT = 20528;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };
const VEN = process.argv[2] || process.env.KB_MAIL_PREVIEW_DIR || path.join(os.tmpdir(), 'kb-maily');

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
    // AI pro návratové maily: bez env jde deterministický výpis; se skutečným modelem
    // (KB_AI_PROVIDER/URL/MODEL/TOKEN z prostředí) ukáže náhled i text modelu
    const aiEnv = ['KB_AI_PROVIDER', 'KB_AI_URL', 'KB_AI_MODEL', 'KB_AI_TOKEN', 'KB_AI_OPENAI_EXTRA']
      .filter((k) => process.env[k]).map((k) => `-e ${k}='${String(process.env[k]).replace(/'/g, "'\\''")}'`).join(' ');
    // KB_NOTIFY_EMAIL_DEFAULT=1: notifikace jdou hned mailem (náhled notifikačního mailu)
    execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway -e TZ=Europe/Prague -e KB_UVODNI_MAPA=0 -e KB_NOTIFY_EMAIL_DEFAULT=1 ${aiEnv} -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
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
    // mail podle PŘÍJEMCE: s KB_NOTIFY_EMAIL_DEFAULT=1 dostane zvoucí zároveň oznámení o vstupu
    const mailPro = async (komu) => { const re = new RegExp('^To:.*' + komu.replace(/\./g, '\\.'), 'mi'); for (let i = 0; i < 24; i++) { const m = maily.find((x) => re.test(x)); if (m) return m; await sleep(500); } return ''; };
    maily.length = 0;
    await api('POST', '/api/collections/loginlogs/records', { token: pozv.json.token, body: {} });
    zachyceno.push({ soubor: 'uvitaci.html', popis: 'Uvítací mail po prvním vstupu', raw: await mailPro('kolega@firma.cz') });
    zachyceno.push({ soubor: 'vstup-pozvaneho.html', popis: 'Oznámení zvoucímu: pozvaný poprvé vstoupil', raw: await mailPro('sefka@firma.cz') });

    // Ostatní odchozí maily — všechny s názvem organizace na začátku předmětu (24. 10. 2026)
    const KT = pozv.json.token, kolegaId = pozv.json.record.id;
    maily.length = 0;
    await api('POST', '/api/collections/users/request-password-reset', { body: { email: 'kolega@firma.cz' } });
    zachyceno.push({ soubor: 'obnova-hesla.html', popis: 'Obnovení hesla', raw: await mailPro('kolega@firma.cz') });
    // ověření adresy jde jen NEověřenému účtu → čerstvá samoregistrace
    await api('POST', '/api/collections/users/records', { body: { email: 'novacek@firma.cz', password: PW, passwordConfirm: PW } });
    maily.length = 0;
    await api('POST', '/api/collections/users/request-verification', { body: { email: 'novacek@firma.cz' } });
    zachyceno.push({ soubor: 'overeni-adresy.html', popis: 'Ověření e-mailové adresy', raw: await mailPro('novacek@firma.cz') });
    // přihlášení z nového místa (PocketBase authAlert): do 24. 10. 2026 chodilo anglicky
    // („Login from a new location"). Kolega už přihlášený byl → druhé přihlášení z jiného prohlížeče.
    maily.length = 0;
    await fetch(BASE + '/api/collections/users/auth-with-password', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36' },
      body: JSON.stringify({ identity: 'kolega@firma.cz', password: PW }) });
    zachyceno.push({ soubor: 'nove-misto.html', popis: 'Přihlášení z nového místa (do 24. 10. anglicky „Login from a new location")', raw: await mailPro('kolega@firma.cz') });
    const mapaN = (await api('POST', '/api/collections/goalmaps/records', { token: UT, body: {
      title: 'Web pro Dvořáka',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Web spuštěný', title: 'Web spuštěný', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Návrh úvodní stránky', status: 'todo', owner: 'kolega@firma.cz' } },
      ],
      edges: [{ id: 'e1', source: 'root', target: 'n1' }],
    } })).json;
    maily.length = 0;
    await api('POST', '/api/collections/comments/records', { token: UT, body: { goalmap: mapaN.id, node_id: 'n1', text: 'Stihneš návrh do pátku?' } });
    zachyceno.push({ soubor: 'notifikace.html', popis: 'Notifikace e-mailem (komentář k cíli)', raw: await mailPro('kolega@firma.cz') });
    await api('PATCH', `/api/collections/users/records/${kolegaId}`, { token: KT, body: { notify_email_mode: 'digest' } });
    await api('POST', '/api/collections/comments/records', { token: UT, body: { goalmap: mapaN.id, node_id: 'n1', text: 'A přidej i patičku.' } });
    maily.length = 0;
    await api('POST', '/api/kb/run-email-digests', { token: ST });
    zachyceno.push({ soubor: 'denni-souhrn.html', popis: 'Denní souhrn notifikací', raw: await mailPro('kolega@firma.cz') });
    maily.length = 0;
    await api('POST', '/api/kb/share', { token: UT, body: { action: 'share', mapId: mapaN.id, email: 'grafik@externi.cz', permission: 'read' } });
    zachyceno.push({ soubor: 'sdileni-bez-uctu.html', popis: 'Pozvánka ke sdílení pro adresu bez účtu', raw: await mailPro('grafik@externi.cz') });

    // Návratové maily (navratMaily.js): kolega má rozdělanou práci (po termínu, dnes,
    // blokuje šéfku) a „nepřihlásí se" 3 / 7 / 14 / 30 dní — každé zpětné datování
    // je nový cyklus, takže odejde vždy jen ten nejvyšší stupeň.
    const dnes = (o) => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Prague' })); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10); };
    await api('POST', '/api/collections/goalmaps/records', { token: KT, body: {
      title: 'Zakázka Dvořák — kuchyň',
      nodes: [
        { id: 'root', type: 'apexNode', position: { x: 0, y: 0 }, data: { apexText: 'Kuchyň hotová do konce měsíce', title: 'Kuchyň hotová do konce měsíce', status: 'todo' } },
        { id: 'n1', type: 'goalNode', position: { x: 0, y: 1 }, data: { title: 'Poslat cenovou nabídku Dvořákovi', status: 'todo', owner: 'kolega@firma.cz', deadline: dnes(-4) } },
        { id: 'n2', type: 'goalNode', position: { x: 0, y: 2 }, data: { title: 'Objednat dvířka u dodavatele', status: 'in_progress', owner: 'kolega@firma.cz', deadline: dnes(0) } },
        { id: 'n3', type: 'goalNode', position: { x: 0, y: 3 }, data: { title: 'Změřit stěnu u zákazníka', status: 'todo', owner: 'kolega@firma.cz', deadline: dnes(5) } },
        { id: 'n4', type: 'goalNode', position: { x: 0, y: 4 }, data: { title: 'Vyfakturovat zálohu', status: 'todo', owner: 'kolega@firma.cz' } },
        { id: 'n5', type: 'goalNode', position: { x: 0, y: 5 }, data: { title: 'Montáž u zákazníka', status: 'todo', owner: 'sefka@firma.cz', deadline: dnes(12), waitForChildren: true } },
        { id: 'n6', type: 'goalNode', position: { x: 1, y: 6 }, data: { title: 'Vyzvednout kování', status: 'todo', owner: 'kolega@firma.cz', deadline: dnes(-1) } },
      ],
      edges: [1, 2, 3, 4, 5].map((i) => ({ id: `e${i}`, source: 'root', target: `n${i}` })).concat([{ id: 'e6', source: 'n5', target: 'n6' }]),
    } });
    for (const dnu of [3, 7, 14, 30]) {
      maily.length = 0;
      await api('PATCH', `/api/collections/users/records/${kolegaId}`, { token: ST, body: { last_login: new Date(Date.now() - (dnu * 24 + 2) * 3600000).toISOString() } });
      const r = await api('POST', '/api/kb/run-navrat-maily', { token: ST });
      for (let i = 0; i < 20 && !maily.length; i++) await sleep(500);
      zachyceno.push({ soubor: `navrat-${dnu}.html`, popis: `Návratový mail — ${dnu} dní bez přihlášení (odesláno ${r.json && r.json.sent})`, raw: maily[0] || '' });
    }

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
<title>killBottleneck — odchozí maily</title>
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
 <h1>killBottleneck — odchozí maily: název organizace v předmětu i v hlavičce každé zprávy</h1>
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
