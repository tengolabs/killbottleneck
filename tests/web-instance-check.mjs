// Ověření existence instance (rozcestník přihlášení na webu) — čistá logika
// z product/docs/.vitepress/theme/instanceCheck.mjs s PODVRŽENÝM fetchem.
// Kryje hlavně větve, které z kódu nejsou zřejmé: Status 0 bez Answer →
// záložní dotek; timeout doteku → null (přesměrovat, ne lhát „nenalezeno").
// Spuštění: node product/tests/web-instance-check.mjs (bez sítě, <1 s)

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { overExistenci } = await import(join(ROOT, 'product/docs/.vitepress/theme/instanceCheck.mjs'))

const dohOdpoved = (telo) => ({ ok: true, json: async () => telo })
const chyba = (name) => { const e = new TypeError('failed'); if (name) e.name = name; return e }

// fetch se volá 1× pro DoH (cloudflare-dns.com) a případně 1× pro dotek instance
const fetchFake = (doh, dotek) => (url) => {
  if (String(url).includes('cloudflare-dns.com')) {
    return typeof doh === 'function' ? doh() : Promise.resolve(doh)
  }
  return typeof dotek === 'function' ? dotek() : Promise.resolve(dotek)
}

let selhani = 0
const expect = (ok, popis) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${popis}`)
  if (!ok) selhani++
}

console.log('web-instance-check: DoH + záložní dotek')

expect(await overExistenci('x.killbottleneck.com',
  fetchFake(dohOdpoved({ Status: 3 }))) === false,
  'DoH Status 3 (NXDOMAIN) → false, dotek se nezkouší')

expect(await overExistenci('x.killbottleneck.com',
  fetchFake(dohOdpoved({ Status: 0, Answer: [{ data: '1.2.3.4' }] }))) === true,
  'DoH Status 0 s Answer → true')

expect(await overExistenci('x.killbottleneck.com',
  fetchFake(dohOdpoved({ Status: 0 }), { ok: true })) === true,
  'DoH Status 0 BEZ Answer → nerozhodné → záložní dotek uspěje → true')

expect(await overExistenci('x.killbottleneck.com',
  fetchFake(() => Promise.reject(chyba()), { ok: true })) === true,
  'DoH nedostupné → dotek uspěje → true')

expect(await overExistenci('x.killbottleneck.com',
  fetchFake(() => Promise.reject(chyba()), () => Promise.reject(chyba()))) === false,
  'DoH nedostupné + dotek síťová chyba → false (neexistuje)')

expect(await overExistenci('x.killbottleneck.com',
  fetchFake(() => Promise.reject(chyba()), () => Promise.reject(chyba('AbortError')))) === null,
  'DoH nedostupné + dotek TIMEOUT → null (pomalé ≠ neexistuje, přesměrovat)')

expect(await overExistenci('x.killbottleneck.com',
  fetchFake({ ok: false }, { ok: true })) === true,
  'DoH HTTP chyba (ok=false) → záložní dotek rozhodne')

if (selhani) {
  console.error(`SELHALO: ${selhani} případů`)
  process.exit(1)
}
console.log('OK — všechny větve ověřovací logiky sedí')
