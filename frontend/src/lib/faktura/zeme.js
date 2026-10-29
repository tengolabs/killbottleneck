// Země, měny a popisky faktur (27. 10. 2026, „faktury pro kohokoli na světě“) — JEDNA pravda pro PDF (layout.js),
// seznam a detail (FakturaPohled) a formuláře (InvoicingSection, ClientsDialog). Čisté funkce bez Reactu a bez Intl
// (PDF musí vyjít stejně v prohlížeči i v node testu). Zrcadlí server pb_hooks/faktury.js (ZEME, SYMBOLY, castka).
// Pravidlo: jazyk faktury (cs/en) řídí popisky a styl čísel jako dosud; ZEMĚ dodavatele přidává symbol měny a jeho
// pozici, americké pořadí data, názvy identifikátorů (IČO/DIČ · EIN/Tax ID · Company No./VAT No.), název daně,
// platební blok (VS jen CZ/SK) a typ QR. Bez země = CZ (faktury z v0.86 vycházejí 1:1).
export const SYMBOLY = { CZK: 'Kč', EUR: '€', USD: '$', GBP: '£', PLN: 'zł', JPY: '¥' }; // CAD/AUD kódem (1,600.00 CAD), ať „$“ nesplývá s USD
export const MENY = ['CZK', 'EUR', 'USD', 'GBP', 'PLN', 'CHF', 'HUF', 'SEK', 'DKK', 'NOK', 'CAD', 'AUD', 'JPY'];
// [kód, česky, anglicky] — nabídka ve formuláři; jiná země se zadá kódem
export const ZEME_SEZNAM = [
  ['CZ', 'Česko', 'Czech Republic'], ['SK', 'Slovensko', 'Slovakia'], ['US', 'USA', 'United States'], ['GB', 'Spojené království', 'United Kingdom'],
  ['DE', 'Německo', 'Germany'], ['AT', 'Rakousko', 'Austria'], ['PL', 'Polsko', 'Poland'], ['NL', 'Nizozemsko', 'Netherlands'],
  ['FR', 'Francie', 'France'], ['IE', 'Irsko', 'Ireland'], ['CH', 'Švýcarsko', 'Switzerland'], ['CA', 'Kanada', 'Canada'], ['AU', 'Austrálie', 'Australia'],
];
// předvolby při změně země (zrcadlo serveru): měna a sazba; vše přepsatelné
export const PREDVOLBY = {
  CZ: { currency: 'CZK', vat_rate: 21 }, SK: { currency: 'EUR', vat_rate: 23 }, US: { currency: 'USD', vat_rate: 0 }, GB: { currency: 'GBP', vat_rate: 20 },
  DE: { currency: 'EUR', vat_rate: 19 }, AT: { currency: 'EUR', vat_rate: 20 }, PL: { currency: 'PLN', vat_rate: 23 }, NL: { currency: 'EUR', vat_rate: 21 },
  FR: { currency: 'EUR', vat_rate: 20 }, IE: { currency: 'EUR', vat_rate: 23 }, CH: { currency: 'CHF', vat_rate: 8.1 }, CA: { currency: 'CAD', vat_rate: 5 }, AU: { currency: 'AUD', vat_rate: 10 },
  EU: { currency: 'EUR', vat_rate: 20 },
};
export const normZeme = (c) => String(c || '').toUpperCase().trim();
export const predvolba = (country) => PREDVOLBY[normZeme(country) || 'CZ'] || PREDVOLBY.EU;
// skupina popisků: CZ (výchozí) · SK · US · GB · EU (vše ostatní)
export function skupina(country) {
  const z = normZeme(country);
  if (!z || z === 'CZ') return 'CZ';
  return ['SK', 'US', 'GB'].includes(z) ? z : 'EU';
}
// popisky podle země dodavatele a jazyka faktury; taxLabel = vlastní název daně z profilu (přebíjí předvolbu)
export function popiskyZeme(country, L, taxLabel) {
  const g = skupina(country);
  const cs = L !== 'en';
  const ico = { CZ: cs ? 'IČO' : 'Company ID', SK: cs ? 'IČO' : 'Company ID', US: 'EIN', GB: 'Company No.', EU: cs ? 'Reg. č.' : 'Company No.' }[g];
  const dic = { CZ: cs ? 'DIČ' : 'VAT ID', SK: cs ? 'DIČ' : 'VAT ID', US: 'Tax ID', GB: 'VAT No.', EU: cs ? 'DIČ' : 'VAT ID' }[g];
  const dan = taxLabel || (g === 'US' ? 'Sales tax' : (cs ? 'DPH' : 'VAT'));
  // bez daně: CZ/SK/EU „Neplátce DPH“, GB „Not VAT registered“, US nic (americká faktura bez daně nic nehlásí)
  const neplatce = g === 'US' ? '' : (cs ? `Neplátce ${dan}` : (g === 'GB' ? 'Not VAT registered' : `Not a ${dan} payer`));
  const danovyDoklad = g === 'CZ' || g === 'SK';
  return {
    skupina: g, ico, dic, dan, neplatce,
    duzp: danovyDoklad, vs: danovyDoklad, datumUS: g === 'US',
    titulDanovy: danovyDoklad ? (cs ? 'Faktura – daňový doklad' : 'Invoice – tax document') : (g === 'GB' ? (cs ? 'FAKTURA' : 'VAT INVOICE') : (cs ? 'FAKTURA' : 'INVOICE')),
  };
}
// 1 600,00 Kč · 1 600,00 € (cs) · $1,600.00 · €1,600.00 · 1,600.00 CZK (en) — symbol jen u známých měn, jinak kód
export function castka(n, L, mena) {
  const m = String(mena || 'CZK').toUpperCase();
  const sym = SYMBOLY[m] || m;
  const [cela, des] = Number(n || 0).toFixed(2).split('.');
  if (L === 'en') {
    const s = cela.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sym.length === 1 ? `${sym}${s}.${des}` : `${s}.${des} ${m}`;
  }
  return `${cela.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')},${des}\u00a0${sym}`;
}
// 23. 10. 2026 (cs) · 23/10/2026 (en) · 10/23/2026 (en, země US)
export function datum(ymd, L, country) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd || '');
  if (L === 'en') return normZeme(country) === 'US' ? `${m[2]}/${m[3]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
  return `${Number(m[3])}. ${Number(m[2])}. ${m[1]}`;
}
// součty po měnách → „1 950,00 Kč + 200,00 €“ (nikdy jedno číslo přes měny)
export function souctyPoMenach(seznam, L, kdyNic = 'CZK') {
  const o = {};
  for (const f of seznam || []) { const m = String(f.currency || 'CZK').toUpperCase(); o[m] = (o[m] || 0) + Number(f.total || 0); }
  const k = Object.keys(o).sort();
  return k.length ? k.map((m) => castka(o[m], L, m)).join(' + ') : castka(0, L, kdyNic);
}
