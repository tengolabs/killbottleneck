// E-MAILY: jazyk příjemce a jednotný vzhled.
//
// Proč to má vlastní sadu: PocketBase má pro systémové zprávy (ověření adresy,
// reset hesla) JEDNU sadu šablon pro všechny, takže Čech dostával anglický mail
// („Verify your killBottleneck email" v české instanci — Richardův nález
// 4. 8. 2026). Přepisujeme je v mailer hoocích a tenhle test hlídá, že to platí
// dál — chyba by se totiž projevila až u zákazníka ve schránce, ne v UI.
//
// Zprávy se NEPOSÍLAJÍ ven: test si postaví vlastní SMTP jímku a čte, co jí
// instance opravdu předala (včetně předmětu a HTML). Kontroluje se OBOJÍ
// směr — česky i anglicky — jinak by test prošel i tehdy, kdyby vše chodilo
// jedním jazykem.
const { execSync } = require('child_process');
const net = require('net');

const NAME = 'flowmap-e2e-maily';
const PORT = 20523;
const SMTP_PORT = 20524;
const BASE = `http://127.0.0.1:${PORT}`;
const PW = 'testheslo123';
const SU = { email: 'su@example.com', pw: 'superheslo123' };

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

// minimální SMTP server: sbírá doručené zprávy (dekóduje quoted-printable/base64)
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
    sock.on('error', () => { /* klient odpojen, nevadí */ });
  });
}

// Dekódování těla: MIME hlavičky (=?utf-8?B?…?=), quoted-printable i base64.
// ⚠️ Quoted-printable se MUSÍ skládat po BAJTECH a teprve celek číst jako UTF-8 —
// převod po znacích (String.fromCharCode) rozbije diakritiku a test pak hlásí
// chybu v mailu, který je ve skutečnosti v pořádku (naraženo 4. 8. 2026).
const qp = (s) => Buffer.from(
  s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))),
  'binary').toString('utf8');

const dekoduj = (s) => {
  let out = s.replace(/=\?[Uu][Tt][Ff]-8\?[Bb]\?([^?]+)\?=/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));
  out = out.replace(/=\?[Uu][Tt][Ff]-8\?[Qq]\?([^?]+)\?=/g, (_, q) => qp(q.replace(/_/g, ' ')));
  out = qp(out);
  // části zakódované celé v base64
  for (const kus of out.split(/\r?\n\r?\n/)) {
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(kus.trim())) {
      try { out += '\n' + Buffer.from(kus.trim(), 'base64').toString('utf8'); } catch { /* nevadí */ }
    }
  }
  return out;
};

(async () => {
  const server = jimka();
  try {
    await new Promise((r) => server.listen(SMTP_PORT, '0.0.0.0', r));
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    execSync(`docker run -d --name ${NAME} --add-host=host.docker.internal:host-gateway -p 127.0.0.1:${PORT}:8090 ${process.env.KB_TEST_IMAGE || 'product-flowmap'}`, { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* startuje */ } await sleep(1000); }
    execSync(`docker exec ${NAME} /app/pocketbase superuser upsert ${SU.email} ${SU.pw}`, { stdio: 'ignore' });
    const ST = (await api('POST', '/api/collections/_superusers/auth-with-password', { body: { identity: SU.email, password: SU.pw } })).json.token;

    // instance posílá do jímky na hostu
    const nast = await api('PATCH', '/api/settings', { token: ST, body: {
      meta: { appName: 'killBottleneck', appURL: BASE, senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
      smtp: { enabled: true, host: 'host.docker.internal', port: SMTP_PORT, tls: false },
    } });
    expect(nast.status === 200, `instance nastavena na jímku (${nast.status})`);

    console.log('== registrace: jazyk se ukládá hned (ne až po přihlášení) ==');
    for (const [mail, jazyk] of [['cesky@example.com', 'cs'], ['english@example.com', 'en']]) {
      const r = await api('POST', '/api/collections/users/records', { body: { email: mail, password: PW, passwordConfirm: PW, language: jazyk } });
      expect(r.status === 200 && r.json.language === jazyk, `účet ${jazyk} založen s jazykem (${r.json && r.json.language})`);
    }

    console.log('== reset hesla chodí v jazyce příjemce ==');
    maily.length = 0;
    await api('POST', '/api/collections/users/request-password-reset', { body: { email: 'cesky@example.com' } });
    await sleep(2500);
    const cz = dekoduj(maily.join('\n---\n'));
    expect(maily.length === 1, `česká žádost vyrobila 1 zprávu (${maily.length})`);
    expect(/Obnovení hesla|Nastavení nového hesla/.test(cz), 'předmět i nadpis jsou ČESKY');
    expect(!/Reset your password|Set a new password/.test(cz), 'v české zprávě nezůstala angličtina');

    maily.length = 0;
    await api('POST', '/api/collections/users/request-password-reset', { body: { email: 'english@example.com' } });
    await sleep(2500);
    const en = dekoduj(maily.join('\n---\n'));
    expect(maily.length === 1, `anglická žádost vyrobila 1 zprávu (${maily.length})`);
    expect(/Password reset|Set a new password/.test(en), 'předmět i nadpis jsou ANGLICKY');
    expect(!/Obnovení hesla|Nastavení nového/.test(en), 'v anglické zprávě nezůstala čeština');

    console.log('== pozvánka je uvítací zpráva, ne „někdo vám mění heslo" ==');
    // Nález Richarda 6. 8. 2026: pozvaný kolega dostal reset hesla a lekl se.
    // Rozhoduje značka invited_by z /invite — samoregistrované účty výš
    // dokazují, že jejich reset zůstal resetem.
    const prihlaseni = await api('POST', '/api/collections/users/auth-with-password',
      { body: { identity: 'cesky@example.com', password: PW } });
    const UT = prihlaseni.json && prihlaseni.json.token;
    expect(!!UT, 'první účet (admin) se přihlásil');
    // Nález Richarda 8. 8.: pozvánka musí říct, KDO zve. Zvoucímu nastavíme
    // jméno, ať se ověří obě části (jméno + e-mail), ne jen fallback na e-mail.
    const zvouciId = prihlaseni.json && prihlaseni.json.record && prihlaseni.json.record.id;
    const jmeno = await api('PATCH', `/api/collections/users/records/${zvouciId}`,
      { token: UT, body: { full_name: 'Jana Zvoucí' } });
    expect(jmeno.status === 200, `zvoucí má nastavené jméno (${jmeno.status})`);
    maily.length = 0;
    const inv = await api('POST', '/api/kb/invite', { token: UT, body: { email: 'pozvany@example.com', role: 'user' } });
    expect(inv.status === 200 && inv.json && inv.json.invited_via_email === true,
      `pozvánka odešla e-mailem (${inv.status})`);
    await sleep(2500);
    const poz = dekoduj(maily.join('\n---\n'));
    expect(maily.length === 1, `pozvánka vyrobila 1 zprávu (${maily.length})`);
    expect(/Pozvánka do killBottlenecku|pozval/.test(poz), 'zpráva zve, nepředstírá reset');
    expect(/Do týmu vás zve/.test(poz), 'říká, KDO zve (úvodní věta)');
    expect(/Jana Zvoucí \(cesky@example\.com\)/.test(poz), '…se jménem I e-mailem zvoucího');
    expect(!/Obnovení hesla|Někdo \(nejspíš vy\)/.test(poz), 'nestraší „někdo žádal o obnovení hesla"');
    expect(/\/reset-password\?token=[A-Za-z0-9._-]+/.test(poz), 'nese odkaz pro nastavení hesla s tokenem');
    // Nález z ostrého provozu 8. 8. 2026: pozvaná kolegyně vypadla z aplikace a
    // zpátky netrefila — mail uměl JEN znovu nastavit heslo. Self-host instance
    // (tahle) jméno organizace nemá, ale TRVALOU adresu k přihlášení mít musí.
    expect(new RegExp(`Vaše adresa pro přihlášení je ${BASE.replace(/[.]/g, '\\.')}`).test(poz),
      'říká trvalou adresu pro přihlášení');
    expect(new RegExp(`${BASE.replace(/[.]/g, '\\.')}/login`).test(poz), 'nese odkaz na přihlašovací stránku');
    expect(/uložte si ji do záložek/i.test(poz), 'radí uložit adresu do záložek');
    expect(/Zapomenuté heslo/.test(poz), 'říká, co dělat, až jednorázový odkaz vyprší');
    expect(!/organizace tengo|Jméno vaší organizace/.test(poz),
      'self-host instance si NEvymýšlí jméno organizace');

    console.log('== hostovaná instance: pozvánka řekne JMÉNO ORGANIZACE ==');
    // Richard 8. 8. 2026: jméno organizace se bere VŽDY ze subdomény, protože
    // právě tohle slovo se zadává v rozcestníku na killbottleneck.com (a později
    // na první obrazovce mobilní appky) — název ze Správy organizace („Tengo
    // s.r.o.") by instanci nenašel.
    const naHosting = await api('PATCH', '/api/settings', { token: ST, body: {
      meta: { appName: 'killBottleneck', appURL: 'https://tengo.killbottleneck.com',
        senderName: 'killBottleneck', senderAddress: 'noreply@killbottleneck.com' },
    } });
    expect(naHosting.status === 200, `instance se tváří jako tengo.killbottleneck.com (${naHosting.status})`);
    maily.length = 0;
    const inv2 = await api('POST', '/api/kb/invite', { token: UT, body: { email: 'pozvany2@example.com', role: 'user' } });
    expect(inv2.status === 200, `druhá pozvánka odešla (${inv2.status})`);
    await sleep(2500);
    const hos = dekoduj(maily.join('\n---\n'));
    expect(/organizace tengo/.test(hos), 'předmět i nadpis jmenují organizaci');
    expect(/Jméno vaší organizace je „tengo“/.test(hos), 'pojmenuje to slovo, které se zadává při přihlášení');
    expect(/https:\/\/tengo\.killbottleneck\.com\/login/.test(hos), 'nese odkaz na přihlášení do své instance');
    expect(/killbottleneck\.com[\s\S]{0,120}Přihlásit se[\s\S]{0,160}zadejte „tengo“/.test(hos),
      'popisuje i cestu přes rozcestník na killbottleneck.com');
    // appka ještě není venku (Richard 8. 8.) — mail ji nesmí slibovat
    expect(!/mobilní aplikac|mobilní appc|Google Play/i.test(hos), 'neslibuje mobilní aplikaci, dokud není venku');

    console.log('== jednotný vzhled a použitelnost ==');
    expect(/killbottleneck\.com/.test(cz), 'patička odkazuje na web');
    expect(/support@killbottleneck\.com/.test(cz), 'patička říká, kam psát o pomoc');
    // odkaz s tokenem MUSÍ přežít přepis — bez něj je mail k ničemu
    // Odkaz musí (a) zůstat i s jednorázovým tokenem a (b) mířit na NAŠI
    // lokalizovanou stránku, ne do admin konzole PocketBase — ta je jen
    // anglicky, takže by český příjemce z českého mailu spadl do angličtiny
    // (nález ověření 4. 8. 2026).
    const odkaz = cz.match(/https?:\/\/[^"\s]*\/reset-password\?token=[A-Za-z0-9._-]+/);
    expect(!!odkaz, `odkaz vede na vlastní stránku /reset-password s tokenem (${odkaz ? odkaz[0].slice(0, 60) + '…' : 'CHYBÍ'})`);
    expect(!/\/_\/#\/auth\//.test(cz), 'mail NEposílá uživatele do admin konzole PocketBase');
    expect(/Nefunguje tlačítko/.test(cz), 'je tam i holý odkaz pro klienty, co nevykreslí tlačítko');
    expect(/<table/.test(cz) && /style="/.test(cz), 'zpráva má tabulkový layout s inline styly');
    // ZMĚNA PRAVIDLA 6. 8. 2026 (Richard: „e-maily dodělat s logem"): povolený je
    // PRÁVĚ JEDEN externí obrázek — logo z našeho webu. Gmail hostované obrázky
    // zobrazuje (proxuje si je), data: URI naopak zahazuje; při blokaci obrázků
    // hlavičku drží textová značka vedle ikony. Jiné externí obrázky dál zakázané.
    expect(/<img[^>]+src="https:\/\/killbottleneck\.com\/znacka\/mail-znak\.jpg"/.test(cz), 'hlavička nese plnou značku z killbottleneck.com');
    // Richard 6. 8. 2026: pod logem má být nápis jako v registračním mailu —
    // při blokovaných obrázcích jinak hlavička neříká, od koho zpráva je.
    expect(/<div[^>]*>killBottleneck<\/div>/.test(cz), 'pod logem je nápis killBottleneck');
    // Nález 8. 8. 2026: uživatelka na logo klikala a „nikam ji to nevedlo".
    expect(/<a href="[^"]+"[^>]*>\s*<img[^>]+mail-znak\.jpg/.test(hos), 'logo v hlavičce je klikací');
    expect(/<a href="https:\/\/tengo\.killbottleneck\.com"/.test(hos), '…a vede do vlastní instance');
    expect(/Vaše přihlašovací adresa:[\s\S]{0,120}tengo\.killbottleneck\.com/.test(hos),
      'adresa instance je i v patičce (jediné místo stejné ve všech mailech)');
    const bezLoga = cz.replace(/<img[^>]+mail-znak\.jpg[^>]*>/g, '');
    expect(!/<img[^>]+src="https?:/.test(bezLoga), 'kromě loga žádné jiné externí obrázky');
    expect(/Content-Type: text\/plain/i.test(maily.join('')), 'zpráva nese i textovou verzi');

  } finally {
    execSync(`docker rm -f ${NAME} 2>/dev/null; true`);
    server.close();
  }
  console.log(`\n📧 MAILY-JAZYK PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
