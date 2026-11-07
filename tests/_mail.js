// Shared MIME helpers for suites that read e-mails from the SMTP sink (_harness.smtpSink):
// headers are encoded-words (=?utf-8?B|Q?…?=) glued BY BYTES (a long Czech subject splits in the
// middle of a character), bodies are quoted-printable by bytes or base64; qp is never applied to
// headers (`?=` + CRLF would be taken for a soft line break). `_`-prefixed = not a suite.
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



module.exports = { qp, qBajty, dekoduj, proKoho };
