// Links in system mails (pb_hooks/mailTemplate.js) — pure functions, no docker.
// Finding S7-03 (code analysis 4): an address written in angle brackets or quotes ("<https://x.cz/a>",
// „"https://x.cz/a"“) led to a broken link — the text is escaped first, and the link swallowed the
// entity that follows (`…/a&gt`). Run: node product/tests/mail-odkazy.js
const path = require('path');
global.__hooks = path.join(__dirname, '..', 'server', 'pb_hooks');
const M = require(path.join(global.__hooks, 'mailTemplate.js'));
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const odkazy = (odstavec) => [...M.mailHtml({ nadpis: 'N', odstavce: [odstavec] }).matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
  .map((m) => ({ href: m[1], text: m[2] })).filter((o) => o.href.indexOf('x.cz') >= 0);
const jediny = (odstavec) => { const o = odkazy(odstavec); return o.length === 1 ? o[0] : { href: `(${o.length} odkazů)`, text: '' }; };

console.log('== adresa v závorkách a uvozovkách ==');
let o = jediny('Otevřete <https://x.cz/login> a přihlaste se.');
expect(o.href === 'https://x.cz/login' && o.text === 'x.cz/login', `ostré závorky: odkaz vede na adresu bez „&gt“ (${o.href})`);
o = jediny('Adresa je "https://x.cz/a/b" — uložte si ji.');
expect(o.href === 'https://x.cz/a/b', `uvozovky: odkaz bez „&quot“ (${o.href})`);
expect(/&lt;<a href="https:\/\/x\.cz\/login"[^>]*>x\.cz\/login<\/a>&gt;/.test(M.mailHtml({ nadpis: 'N', odstavce: ['<https://x.cz/login>'] })), 'závorky kolem odkazu v textu zůstaly (jako text)');

console.log('== co se nesmí rozbít ==');
o = jediny('Odkaz: https://x.cz/hledat?a=1&b=2 platí týden.');
expect(o.href === 'https://x.cz/hledat?a=1&amp;b=2', `„&“ v dotazu zůstává součástí adresy (${o.href})`);
o = jediny('Přihlaste se na https://x.cz/login.');
expect(o.href === 'https://x.cz/login', `tečka za větou do adresy nepatří (${o.href})`);
o = jediny('Viz (https://x.cz/napoveda), tam je vše.');
expect(o.href === 'https://x.cz/napoveda', `závorka a čárka za adresou do ní nepatří (${o.href})`);
expect(odkazy('Dvě adresy: https://x.cz/a a <https://x.cz/b>.').map((x) => x.href).join(' ') === 'https://x.cz/a https://x.cz/b', 'dvě adresy v jednom odstavci');
expect(!/<script/.test(M.mailHtml({ nadpis: 'N', odstavce: ['<script>alert(1)</script> https://x.cz/a'] })), 'značky v textu zůstávají escapované');

console.log(`\n${fail ? '🔴' : '🟢'} MAIL-ODKAZY PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
