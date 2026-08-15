// Registrace nové organizace z nativního obalu — sdílené konstanty a slugify.
// Zdroj pravdy pro slugify je cloud/auto/signup.py (server si slug stejně
// počítá sám; tenhle port slouží jen pro NÁHLED adresy). Při kolizi jmen
// server přidá suffix `-xxxx`, takže náhled je vždy jen „pravděpodobná adresa"
// — UI to musí říkat a odkázat na uvítací e-mail.
export const SIGNUP_URL = 'https://api.killbottleneck.com/signup';
export { CLOUD_SUFFIX } from './serverUrl.js';

// Nejkratší jméno, které server pustí (signup.py: ^[a-z0-9][a-z0-9-]{2,29}$) —
// kratší náhled adresy neukazovat, registrace by stejně spadla na 400.
export const MIN_SLUG = 3;

// Port slugify() ze signup.py, krok za krokem stejné pořadí operací:
// NFKD + zahození ne-ASCII (ekvivalent encode('ascii','ignore') — kontrolní
// znaky PŘEŽIJÍ a další krok z nich udělá pomlčku, stejně jako v pythonu) →
// odstranění právních forem (s.r.o., a.s., spol., z.s., o.p.s.) →
// ne-alfanumerika na pomlčky → ořez a lowercase → kolaps pomlček → max 30 znaků.
export const slugifyCompany = (text) => {
  let t = String(text || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7f]/g, '');
  t = t.replace(/\b(s\.?\s?r\.?\s?o|a\.?\s?s|spol|z\.?\s?s|o\.?\s?p\.?\s?s)\b\.?/gi, ' ');
  t = t.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return t.replace(/-{2,}/g, '-').slice(0, 30).replace(/^-+|-+$/g, '');
};
