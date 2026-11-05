// Pozvaný do organizace dostane jazyk — a pozvánka jde v něm (S4-06, 3. kolo analýzy, 4. 11. 2026).
//
// Samoregistrace (i Google OAuth) bere `language` z těla; pozvání přes /invite ($app.save mimo hook)
// ho do 4. 11. 2026 nenastavilo vůbec → EN kolega měl `language: ""` a pozvánkový i uvítací mail
// dostal česky, bez ohledu na jazyk zvoucího. Teď: `language` z těla pozvánky (cs|en), jinak jazyk
// zvoucího; pozvánkový mail (PB reset → mailTemplate userLang) jde podle něj.
// Spuštění: KB_TEST_IMAGE=<image> node product/tests/pozvanka-jazyk.js
const H = require('./_harness');
const { expect } = H;

// dekódování MIME: hlavičky = encoded-words (=?utf-8?B|Q?…?=) slepené PO BAJTECH (dlouhý český předmět se dělí
// doprostřed znaku, viz maily-jazyk.js), tělo = quoted-printable po bajtech / base64; qp se na hlavičky NEpouští
// (`?=` + CRLF by vzalo za měkké zalomení)
const qp = (s) => Buffer.from(s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf8');
const qBajty = (q) => {
  const b = Buffer.from(q.replace(/_/g, ' '), 'utf8'); const out = [];
  for (let i = 0; i < b.length; i++) {
    const hex = b.slice(i + 1, i + 3).toString('latin1');
    if (b[i] === 0x3d && /^[0-9A-Fa-f]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; } else out.push(b[i]);
  }
  return Buffer.from(out);
};
const dekoduj = (s) => {
  const i = s.search(/\r?\n\r?\n/);
  const hlavicky = (i < 0 ? s : s.slice(0, i)).replace(/\r?\n[ \t]+/g, '').replace(/\?=\s+=\?/g, '?==?');
  const kusy = []; let konec = 0, m;
  const re = /=\?[Uu][Tt][Ff]-8\?([BbQq])\?([^?]*)\?=/g;
  while ((m = re.exec(hlavicky))) {
    if (m.index > konec) kusy.push(Buffer.from(hlavicky.slice(konec, m.index), 'utf8'));
    kusy.push(m[1].toLowerCase() === 'b' ? Buffer.from(m[2], 'base64') : qBajty(m[2]));
    konec = m.index + m[0].length;
  }
  kusy.push(Buffer.from(hlavicky.slice(konec), 'utf8'));
  let out = Buffer.concat(kusy).toString('utf8') + '\n' + (i < 0 ? '' : qp(s.slice(i)));
  for (const kus of out.split(/\r?\n\r?\n/)) {
    if (/^[A-Za-z0-9+/=\s]{200,}$/.test(kus.trim())) { try { out += '\n' + Buffer.from(kus.trim(), 'base64').toString('utf8'); } catch (e) { /* nevadí */ } }
  }
  return out;
};
const proKoho = (adresa) => (m) => new RegExp('^(To|RCPT TO):.*' + adresa.replace('.', '\\.'), 'mi').test(m) || m.includes(adresa);

H.beh(async () => {
  const sink = await H.smtpSink();
  const inst = await H.startInstance({ slug: 'pozvanka-jazyk', addHostGateway: true, env: { KB_UVODNI_MAPA: 0 } });
  const ST = await inst.superuser();
  const z = await sink.zapoj(inst, ST);
  expect(z.status === 200, `SMTP jímka zapojena (${z.status})`);
  const reg = await inst.register('admin@example.com', { language: 'en', full_name: 'Ann Admin' }); // první = admin, anglicky
  expect(reg.status === 200 && reg.json.language === 'en', `admin založen s language en (${reg.status} ${reg.json && reg.json.language})`);
  const A = await inst.login('admin@example.com');
  const ucet = async (email) => ((await inst.api('GET', `/api/collections/users/records?filter=email%3D%27${encodeURIComponent(email)}%27`, { token: ST })).json.items || [])[0] || {};

  console.log('== pozvánka bez jazyka → jazyk zvoucího (en) ==');
  let r = await inst.api('POST', '/api/kb/invite', { token: A, body: { email: 'kolega@example.com', role: 'user' } });
  expect(r.status === 200 && r.json.invited_via_email === true, `pozvánka odešla mailem (${r.status} ${JSON.stringify(r.json).slice(0, 80)})`);
  let u = await ucet('kolega@example.com');
  expect(u.language === 'en', `pozvaný má language zvoucího: en (${JSON.stringify(u.language)})`);
  let mail = dekoduj(await sink.cekejNaMail(proKoho('kolega@example.com'), 8000).catch(() => ''));
  expect(/invites you to killBottleneck/.test(mail), 'pozvánkový mail je ANGLICKY (předmět „invites you to killBottleneck“)');
  expect(!/vás zve do killBottlenecku|Do týmu vás zve/.test(mail), '…a není v něm čeština');

  console.log('== pozvánka s language: cs od anglického správce ==');
  sink.maily.length = 0;
  r = await inst.api('POST', '/api/kb/invite', { token: A, body: { email: 'cech@example.com', role: 'user', language: 'cs' } });
  expect(r.status === 200, `pozvánka s jazykem odešla (${r.status})`);
  u = await ucet('cech@example.com');
  expect(u.language === 'cs', `pozvaný má jazyk z pozvánky: cs (${JSON.stringify(u.language)})`);
  mail = dekoduj(await sink.cekejNaMail(proKoho('cech@example.com'), 8000).catch(() => ''));
  expect(/vás zve do killBottlenecku/.test(mail), `pozvánkový mail je ČESKY (${(mail.match(/^Subject:.*$/m) || [''])[0].slice(0, 90)})`);

  console.log('== neznámý jazyk → jazyk zvoucího, ne prázdno ==');
  r = await inst.api('POST', '/api/kb/invite', { token: A, body: { email: 'treti@example.com', role: 'user', language: 'xx' } });
  expect(r.status === 200, `pozvánka s neznámým jazykem projde (${r.status})`);
  u = await ucet('treti@example.com');
  expect(u.language === 'en', `neznámý jazyk spadne na jazyk zvoucího (${JSON.stringify(u.language)})`);
}, { nazev: 'POZVÁNKA JAZYK' });
