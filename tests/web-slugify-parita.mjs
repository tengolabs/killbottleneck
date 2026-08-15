// Parita slugify: web (docs/.vitepress/theme/slug.mjs) ↔ frontend
// (frontend/src/lib/signup.js) ↔ server (cloud/auto/signup.py).
// Slugify existuje ve třech JS/py kopiích, protože se importovat navzájem
// nemohou (build-cz kopíruje jen theme+data, orchestrátor tahá hcloud) —
// tenhle test je jediná pojistka, že se nerozjedou. Python se NEIMPORTUJE
// jako modul (module-level load_env čte secrets), místo toho se funkce
// slugify vytáhne ze zdrojáku doslovně a spustí — běží tedy skutečný
// serverový kód, ne další kopie.
// Spuštění: node product/tests/web-slugify-parita.mjs (bez dockeru, ~1 s)

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const web = await import(join(ROOT, 'product/docs/.vitepress/theme/slug.mjs'))
const frontend = await import(join(ROOT, 'product/frontend/src/lib/signup.js'))

// Fixtures z ui-mobile-signup.js (vygenerované pythonem) + případy kryjící
// historické rozdíly webové kopie: o.p.s., dvojité pomlčky, pomlčka po
// oříznutí na 30 znaků, ne-ASCII mimo diakritiku, vstup pod minimem.
const CASES = [
  ['Šťastná Kavárna s.r.o.', 'stastna-kavarna'],
  ['Novák & Syn, spol. s r.o.', 'novak-syn'],
  ['Dlouhé Jméno Firmy Které Přeteče Třicet Znaků', 'dlouhe-jmeno-firmy-ktere-prete'],
  ['Železárny a.s.', 'zelezarny'],
  ['Nadace Dobro o.p.s.', 'nadace-dobro'],
  ['A -- B ---- C', 'a-b-c'],
  ['Tengo, s.r.o.', 'tengo'],
  ['Straße GmbH', 'strae-gmbh'],
  ['A1', 'a1'],
  ['', ''],
  ['ﬁrma', 'firma'],                 // NFKD rozloží ligaturu
  ['x'.repeat(29) + '-y', 'x'.repeat(29)], // pomlčka na 30. znaku se ořízne
]

const PY = `
import json, re, sys, unicodedata
src = open(${JSON.stringify(join(ROOT, 'cloud/auto/signup.py'))}, encoding='utf-8').read()
m = re.search(r'\\ndef slugify\\(text\\):.*?(?=\\n\\S)', src, re.S)
ns = {'re': re, 'unicodedata': unicodedata}
exec(m.group(0), ns)
print(json.dumps([ns['slugify'](t) for t in json.load(sys.stdin)]))
`
const pySlugs = JSON.parse(execFileSync('python3', ['-c', PY], {
  input: JSON.stringify(CASES.map(([vstup]) => vstup)), encoding: 'utf-8',
}))

let selhani = 0
const expect = (ok, popis) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${popis}`)
  if (!ok) selhani++
}

console.log('web-slugify-parita: web ↔ frontend ↔ signup.py')
CASES.forEach(([vstup, ocekavane], i) => {
  const w = web.slugifyCompany(vstup)
  const f = frontend.slugifyCompany(vstup)
  const p = pySlugs[i]
  expect(w === ocekavane && f === ocekavane && p === ocekavane,
    `„${vstup.slice(0, 40)}" → „${ocekavane}" (web: ${w} · frontend: ${f} · python: ${p})`)
})

expect(web.MIN_SLUG === frontend.MIN_SLUG, `MIN_SLUG shodné (${web.MIN_SLUG})`)
expect(web.CLOUD_SUFFIX === frontend.CLOUD_SUFFIX, `CLOUD_SUFFIX shodné (${web.CLOUD_SUFFIX})`)

if (selhani) {
  console.error(`SELHALO: ${selhani} případů — slugify se rozjelo, viz komentář v cloud/auto/signup.py`)
  process.exit(1)
}
console.log('OK — všechny kopie slugify se shodují')
