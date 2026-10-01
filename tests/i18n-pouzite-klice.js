// i18n: každý klíč, který kód volá doslovně (t('klic'), t('ns:klic'), i18next.t(…), <Trans i18nKey>), EXISTUJE
// v katalogu cs i en — unit kontrola bez dockeru (fáze C plánu AI funkcí, 1. 10. 2026).
// Proč: syrový klíč místo textu („editor:aiChat.connectionError“ v souhrnu projektu) katalogová sada
// (i18n-catalog.js) nepozná — ta hlídá jen paritu cs/en, ne to, co kód opravdu volá. Stejně tak smazání
// starých klíčů (Poradce, 1. 10. 2026) nesmí nechat v kódu volání, které by ukázalo syrový klíč.
// Klíč bez `ns:` se hledá ve jmenných prostorech, které soubor otevírá přes useTranslation (výchozí
// `common`). Dynamické klíče (šablonové řetězce) se kontrolovat nedají — vynechány.
//
// Spuštění: node product/tests/i18n-pouzite-klice.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'frontend', 'src');
const DIR = path.join(SRC, 'i18n');
const NS = fs.readdirSync(path.join(DIR, 'cs')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const KAT = {};
for (const jazyk of ['cs', 'en']) {
  KAT[jazyk] = {};
  for (const ns of NS) KAT[jazyk][ns] = JSON.parse(fs.readFileSync(path.join(DIR, jazyk, `${ns}.json`), 'utf8'));
}
const najdi = (obj, klic) => klic.split('.').reduce((o, k) => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined), obj);
// plurálové tvary i18next (_one/_few/_many/_other) i kontext
const existuje = (jazyk, ns, klic) => !!KAT[jazyk][ns] && ['', '_one', '_few', '_many', '_other', '_zero'].some((s) => najdi(KAT[jazyk][ns], klic + s) !== undefined);

function soubory(d, out) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'i18n' && e.name !== 'node_modules') soubory(p, out); } else if (/\.(jsx?|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

// překladové funkce souboru: jméno → [{ ns, prefix }] — useTranslation (i s aliasem { t: tr } a keyPrefix)
// a místní obaly typu `const t = (key) => i18next.t(`common:export.${key}`)`
function vazby(kod) {
  const b = new Map();
  const pridej = (jm, ns, prefix) => { if (!b.has(jm)) b.set(jm, []); b.get(jm).push({ ns, prefix }); };
  for (const m of kod.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*useTranslation\(([^)]*)\)/g)) {
    const alias = m[1].match(/\bt\s*:\s*([A-Za-z_$][\w$]*)/);
    const jm = alias ? alias[1] : (/(^|[\s,{])t(\s*[,}]|\s*$)/.test(m[1]) ? 't' : null);
    if (!jm) continue;
    const kp = m[2].match(/keyPrefix\s*:\s*['"]([\w.]+)['"]/);
    const nss = [...m[2].replace(/\{[^}]*\}/g, '').matchAll(/['"]([a-z]+)['"]/g)].map((x) => x[1]);
    for (const ns of (nss.length ? nss : ['common'])) pridej(jm, ns, kp ? `${kp[1]}.` : '');
  }
  for (const m of kod.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\(\s*(\w+)[^)]*\)\s*=>\s*i18n(?:ext)?\.t\(\s*`([a-z]+):([\w.]*)\$\{\2\}`/g)) pridej(m[1], m[3], m[4]);
  // `t` předaná parametrem (lib/…) bez vlastního useTranslation: výchozí jmenný prostor + všechny ze souboru
  if (!b.has('t')) pridej('t', 'common', '');
  return b;
}

let ok = 0; let fail = 0;
const chybi = [];
let kontrolovano = 0;
const over = (soubor, klic, kandidati) => {
  kontrolovano += 1;
  const dvojtecka = klic.match(/^([a-z]+):(.+)$/);
  const moznosti = dvojtecka && NS.includes(dvojtecka[1])
    ? [{ ns: dvojtecka[1], klic: dvojtecka[2] }, ...kandidati.filter((k) => k.prefix).map((k) => ({ ns: dvojtecka[1], klic: k.prefix + dvojtecka[2] }))]
    : kandidati.map((k) => ({ ns: k.ns, klic: k.prefix + klic }));
  for (const jazyk of ['cs', 'en']) {
    if (!moznosti.some((x) => existuje(jazyk, x.ns, x.klic))) chybi.push(`${path.relative(SRC, soubor)}: ${[...new Set(moznosti.map((x) => `${x.ns}:${x.klic}`))].join(' | ')} (${jazyk})`);
  }
};
for (const soubor of soubory(SRC, [])) {
  const kod = fs.readFileSync(soubor, 'utf8');
  if (!/useTranslation|i18next|i18n\.t\(|<Trans/.test(kod)) continue;
  const b = vazby(kod);
  const vsechny = [...b.values()].flat();
  for (const [jm, kandidati] of b) {
    const rx = new RegExp(`(?<![\\w$.])${jm.replace(/\$/g, '\\$')}\\(\\s*(['"])([^'"\\n\`$]+)\\1`, 'g');
    // `t` bez vlastní vazby v komponentě (předaná zvenku) → jakýkoli jmenný prostor souboru
    const kand = jm === 't' ? [...kandidati, ...vsechny.filter((k) => !kandidati.includes(k))] : kandidati;
    for (const m of kod.matchAll(rx)) over(soubor, m[2], kand);
  }
  for (const m of kod.matchAll(/\bi18n(?:ext)?\.t\(\s*(['"])([^'"\n`$]+)\1/g)) over(soubor, m[2], [{ ns: 'common', prefix: '' }]);
  // <Trans i18nKey="…" ns="…" components={{ b: <strong /> }}> — atributy v libovolném pořadí (uvnitř jsou i „>“)
  for (const m of kod.matchAll(/<Trans\b/g)) {
    const tag = kod.slice(m.index, m.index + 400);
    const k = tag.match(/\bi18nKey=["']([^"']+)["']/);
    const n = tag.match(/\bns=["']([a-z]+)["']/);
    if (k) over(soubor, k[1], [{ ns: n ? n[1] : 'common', prefix: '' }]);
  }
}
console.log('== i18n: klíče volané v kódu existují v katalogu cs i en ==');
const unik = [...new Set(chybi)];
if (unik.length) { for (const c of unik.slice(0, process.env.VSE ? 99999 : 40)) console.log(`  ❌ chybí ${c}`); fail += unik.length; } else { console.log(`  ✅ všech ${kontrolovano} doslovných volání má klíč v cs i en`); ok += 1; }
console.log(`\n${fail ? '🔴' : '🟢'} I18N-POUZITE-KLICE PASS ${ok} / FAIL ${fail}`);
process.exitCode = fail ? 1 : 0;
