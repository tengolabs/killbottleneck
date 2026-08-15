// Serverový i18n slovník (pb_hooks/i18n.js) — unit kontrola bez dockeru:
//  1) každý STRINGS klíč má cs i en, žádná prázdná hodnota
//  2) v EN hodnotách není česká diakritika (nedopřeložený/zapomenutý string)
//  3) {param} tokeny sedí mezi cs a en (stejná sada proměnných na klíč)
//  4) PLURALS: cs = 3 tvary, en = 2 tvary
// Analogie frontendového i18n-catalog.js pro serverovou stranu (notify/chyby/AI).
const { STRINGS, PLURALS } = require('../server/pb_hooks/i18n.js');
const CZ = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;
const params = (s) => (String(s).match(/\{[a-zA-Z0-9_]+\}/g) || []).sort();

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };

console.log('== server STRINGS: parita cs/en + úplnost ==');
const missing = [], empty = [], czEn = [], tokBad = [];
for (const key of Object.keys(STRINGS)) {
  const e = STRINGS[key];
  if (!e || typeof e.cs !== 'string' || typeof e.en !== 'string') { missing.push(key); continue; }
  if (e.cs === '' || e.en === '') empty.push(key);
  if (CZ.test(e.en)) czEn.push(key);
  if (JSON.stringify(params(e.cs)) !== JSON.stringify(params(e.en))) tokBad.push(key);
}
expect(missing.length === 0, `každý klíč má cs i en (${Object.keys(STRINGS).length} klíčů) ${missing.length ? JSON.stringify(missing) : ''}`);
expect(empty.length === 0, `žádná prázdná hodnota ${empty.length ? JSON.stringify(empty) : ''}`);
expect(czEn.length === 0, `žádná čeština v en ${czEn.length ? JSON.stringify(czEn) : ''}`);
expect(tokBad.length === 0, `{param} tokeny sedí cs↔en ${tokBad.length ? JSON.stringify(tokBad) : ''}`);

console.log('== server PLURALS: cs 3 tvary / en 2 tvary ==');
const plBad = [];
for (const key of Object.keys(PLURALS)) {
  const p = PLURALS[key];
  if (!p || !Array.isArray(p.cs) || p.cs.length !== 3 || !Array.isArray(p.en) || p.en.length !== 2) plBad.push(key);
}
expect(plBad.length === 0, `pluralizace úplná (${Object.keys(PLURALS).length}) ${plBad.length ? JSON.stringify(plBad) : ''}`);

console.log(`\n${ok} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
