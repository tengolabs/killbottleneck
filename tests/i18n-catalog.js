// i18n katalogy — unit kontrola bez dockeru/portů:
//  1) cs a en mají IDENTICKOU množinu klíčů (žádný klíč jen v jednom jazyce)
//  2) žádná prázdná hodnota
//  3) v EN katalozích není česká diakritika (nedopřeložený string)
//  4) interpolační {{tokeny}} sedí mezi cs a en (stejná sada proměnných na klíč)
// Zdroj i18n: product/frontend/src/i18n/{cs,en}/*.json
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'frontend', 'src', 'i18n');
// ⚠️ SEZNAM JE NATVRDO — nový namespace se sem musí dopsat RUČNĚ, jinak se
// jeho cs↔en drift nikdy neprojeví a sada svítí zeleně (tatáž past jako
// v tests/run-all.sh). Doplněno 19. 8. 2026: hromadne, historie.
const NS = ['common', 'nav', 'auth', 'home', 'editor', 'tasks', 'myday', 'notify', 'errors', 'lite', 'billing', 'rules', 'admin', 'popis', 'hromadne', 'historie'];
const CZ = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };

// ploché klíče (arrays projdou jako .0/.1…) + jejich hodnoty
function flat(obj, prefix, out) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flat(v, key, out);
    else out[key] = v;
  }
  return out;
}
const tokens = (s) => (String(s).match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g) || []).map((t) => t.replace(/\s/g, '')).sort();

console.log('== i18n katalogy: parita + úplnost ==');
for (const ns of NS) {
  let cs, en;
  try {
    cs = flat(JSON.parse(fs.readFileSync(path.join(DIR, 'cs', ns + '.json'), 'utf8')), '', {});
    en = flat(JSON.parse(fs.readFileSync(path.join(DIR, 'en', ns + '.json'), 'utf8')), '', {});
  } catch (e) {
    expect(false, `${ns}: nepodařilo se načíst katalog (${e.message})`);
    continue;
  }
  const csK = Object.keys(cs).sort(), enK = Object.keys(en).sort();
  const missEn = csK.filter((k) => !(k in en));
  const missCs = enK.filter((k) => !(k in cs));
  expect(missEn.length === 0 && missCs.length === 0,
    `${ns}: parita klíčů (${csK.length}) ${missEn.length || missCs.length ? 'chybí en=' + JSON.stringify(missEn) + ' cs=' + JSON.stringify(missCs) : ''}`);

  const emptyCs = csK.filter((k) => cs[k] === '' || cs[k] == null);
  const emptyEn = enK.filter((k) => en[k] === '' || en[k] == null);
  expect(emptyCs.length === 0 && emptyEn.length === 0,
    `${ns}: žádná prázdná hodnota ${emptyCs.length || emptyEn.length ? 'cs=' + JSON.stringify(emptyCs) + ' en=' + JSON.stringify(emptyEn) : ''}`);

  const czInEn = enK.filter((k) => typeof en[k] === 'string' && CZ.test(en[k]));
  expect(czInEn.length === 0, `${ns}: žádná čeština v en ${czInEn.length ? JSON.stringify(czInEn.slice(0, 5)) : ''}`);

  const tokMismatch = csK.filter((k) => (k in en) && JSON.stringify(tokens(cs[k])) !== JSON.stringify(tokens(en[k])));
  expect(tokMismatch.length === 0, `${ns}: {{tokeny}} sedí cs↔en ${tokMismatch.length ? JSON.stringify(tokMismatch.slice(0, 5)) : ''}`);
}

console.log(`\n${ok} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
