// Parita „Zadat adresu ručně“: aplikace pro Windows (desktop/lib/adresa.js, normalizujAdresu)
// ↔ výběr serveru v Android obalu (frontend/src/lib/serverUrl.js, normalizeServerUrl).
// Aplikace pravidla vědomě ROZŠIŘUJE o dvě věci: (1) http na jméno v místní síti (server.lan,
// intranet firmy) nezamítne hned, ale ověří přes DNS, že vede jen do privátní sítě
// (`overitPrivatni`); (2) zná privátní IPv6 (fd00::/8, fe80::, ::1), které Android neumí;
// (3) bere jako místní i celý loopback 127.0.0.0/8 a link-local 169.254.0.0/16 (Android jen 127.0.0.1).
// Všude jinde musí rozhodnout stejně — stejná chyba, stejná adresa.
// Spuštění: node product/tests/desktop-adresa-parita.mjs (bez dockeru, <1 s)

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const { normalizeServerUrl } = await import(join(ROOT, 'product/frontend/src/lib/serverUrl.js'))
const { normalizujAdresu } = await import(join(ROOT, 'product/desktop/lib/adresa.js'))

const CHYBY = { errorEmpty: 'prazdne', errorInvalid: 'neplatne', errorHttpPublic: 'httpVerejne' }
const PRIVATNI_IPV6 = /^http:\/\/\[(f[cd]|fe[89ab]|::1\])/i
const ROZSIRENE_IPV4 = /^http:\/\/(127\.\d+\.\d+\.\d+|169\.254\.\d+\.\d+)(:\d+)?$/

const VSTUPY = [
  '', '   ', 'tengo', 'Tengo', 'kb.firma.cz', 'kb.firma.cz/', 'https://kb.firma.cz', 'HTTPS://KB.Firma.cz:8443/',
  'https://kb.firma.cz/login', 'kb.firma.cz/?x=1', 'kb.firma.cz/#a', 'https://user:heslo@kb.firma.cz',
  'http://192.168.1.20:8090', 'http://10.1.2.3', 'http://172.20.0.1:2056', 'http://100.90.1.2:8090',
  'http://localhost:8090', 'http://127.0.0.1:8090', 'http://server.local', 'http://8.8.8.8',
  'http://kb.firma.cz', 'http://server.lan:8090', 'ftp://kb.firma.cz', 'https://', 'http://[fd00::5]:8090',
  'mojefirma', 'a', 'https://kb.firma.cz:99999', 'http://[2001:db8::1]:8090', 'http://[::1]:8090',
  'http://127.0.0.2:8090', 'http://169.254.1.1', 'http://169.255.1.1', 'http://128.0.0.1',
]

let selhani = 0
const expect = (ok, popis) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${popis}`)
  if (!ok) selhani++
}

console.log('desktop-adresa-parita: aplikace pro Windows ↔ Android výběr serveru')
for (const vstup of VSTUPY) {
  const a = normalizeServerUrl(vstup)
  const d = normalizujAdresu(vstup)
  const popis = `„${vstup}" → android ${a.ok ? a.url : a.error} · desktop ${d.ok ? d.url + (d.overitPrivatni ? ' (ověřit DNS)' : '') : d.chyba}`
  if (a.ok) {
    expect(d.ok && d.url === a.url && !d.overitPrivatni, popis)
  } else if (a.error === 'errorHttpPublic' && d.ok && d.overitPrivatni) {
    // rozšíření (1): http na jméno (ne IP) rozhodne až DNS
    expect(!/^http:\/\/(\[|[\d.]+(:\d+)?$)/.test(d.url), `${popis} [rozšíření jen pro jména, ne IP]`)
  } else if (a.error === 'errorHttpPublic' && d.ok && !d.overitPrivatni) {
    // rozšíření (2) a (3): privátní IPv6 literál, celý loopback a link-local IPv4
    expect(PRIVATNI_IPV6.test(d.url) || ROZSIRENE_IPV4.test(d.url), `${popis} [rozšíření jen pro privátní IPv6, 127/8 a 169.254/16]`)
  } else {
    expect(!d.ok && d.chyba === CHYBY[a.error], popis)
  }
}

if (selhani) {
  console.error(`SELHALO: ${selhani} případů — pravidla adres se rozjela (viz komentář nahoře)`)
  process.exit(1)
}
console.log('OK — ruční adresa rozhoduje v aplikaci stejně jako v Androidu')
