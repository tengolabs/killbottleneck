// Pravidla, které licence smí do produktu (jen komerčně použitelné, bez copyleftu).
// Sdílí generátor THIRD-PARTY-LICENSES.md a test licence-soubory.js.
// Žádná závorková větev: dřív `\(.*\)` pustilo i „(GPL-3.0 AND MIT)“ (audit 14. 10. 2026, L3b).
// Výraz se rozloží: „A OR B“ = stačí jedna povolená strana, „A AND B“ = každá strana zvlášť.
// Konzervativně: AND se dělí dřív než OR (víc odmítne, nikdy nepustí navíc); pole z package.json
// (`"license": ["MIT", "Apache-2.0"]`, starý tvar) má význam OR. Operátor bez obou mezer
// („MIT OR“) se nedělí → prostý test, žádná rekurze (/checkup 6. 11. 2026).
export const PERMISIVNI = /^(MIT\*?|ISC|0BSD|BSD-[23]-Clause|Apache-2\.0|Zlib|CC0-1\.0|Unlicense|BlueOak-1\.0\.0|Python-2\.0|WTFPL|CC-BY-4\.0)$/;

const bezZavorek = (v) => String(v).trim().replace(/^\((.*)\)$/, "$1").trim();

export function licencePovolena(vyraz) {
  if (Array.isArray(vyraz)) return vyraz.some(licencePovolena);
  const v = bezZavorek(vyraz);
  const aAnd = v.split(/\s+AND\s+/);
  if (aAnd.length > 1) return aAnd.every(licencePovolena);
  const aOr = v.split(/\s+OR\s+/);
  if (aOr.length > 1) return aOr.some(licencePovolena);
  return PERMISIVNI.test(v);
}

// Duál „(MIT OR GPL-3.0-or-later)“ (jszip): pro nás platí MIT — text GPL se do souboru
// nevkládá, jen se napíše, pod kterou stranou balíček používáme (L10). Jinak null.
export function zvolenaStrana(vyraz) {
  const v = Array.isArray(vyraz) ? vyraz.join(" OR ") : bezZavorek(vyraz);
  const aOr = v.split(/\s+OR\s+/);
  if (aOr.length < 2) return null;
  return aOr.find((s) => licencePovolena(s)) ?? null;
}

// „MIT*“ = license-checker licenci jen ODHADL z README (package.json ji nedeklaruje).
// Pouští se, ale generátor ji vypíše k ručnímu posouzení.
export const odhadnuta = (vyraz) => /\*$/.test(String(vyraz).trim());
