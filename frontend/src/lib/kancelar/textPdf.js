// Kreslení textu do pdf-lib — sdílené pomocníky pro prezentaci, přání i dokumenty: zalomení na šířku (po slovech,
// předlouhé slovo se rozseká), blok textu s řádkováním a zarovnáním, barvy z #rrggbb. Čisté funkce nad fonty
// pdf-lib (widthOfTextAtSize) — jedou i v node testu.
export const A4 = [595.28, 841.89];
export const A5 = [419.53, 595.28];
export const SNIMEK = [960, 540]; // 16:9 v bodech (10 × 5,625 in)

export function hexRgb(hex, rgb, zaloha = '#2563eb') {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()) || /^#?([0-9a-f]{6})$/i.exec(zaloha);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
// světlá verze barvy (pro podklady): mísí s bílou
export function hexRgbSvetle(hex, rgb, podil = 0.85) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim()) || /^#?([0-9a-f]{6})$/i.exec('#2563eb');
  const n = parseInt(m[1], 16);
  const f = (v) => v / 255 + (1 - v / 255) * podil;
  return rgb(f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255));
}
// je barva tmavá? (text na ní bílý) — relativní jas
export function tmava(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}

// ---- characters the embedded font cannot draw (code analysis 4, F2-06) ----
// KB Sans is a Latin subset on purpose. pdf-lib writes a character outside it as an empty
// glyph and reports nothing, so "A → B" came out as "A   B" and a name in Cyrillic as blank
// space. Before drawing: common symbols are rewritten with what the font has, emoji and
// invisible marks are left out (with the one space after them), anything else becomes "?"
// — a visible sign that something is missing. Text inside the font is returned unchanged.
const SUBSTITUTES = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>', '➜': '->', '➔': '->', '➡': '->', '⬅': '<-',
  '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '∞': 'inf', '√': 'sqrt',
  '✓': '[x]', '✔': '[x]', '✅': '[x]', '☑': '[x]', '☐': '[ ]', '❌': '×', '✗': '×', '✘': '×', '❎': '×',
  '★': '*', '☆': '*', '⭐': '*', '■': '•', '□': '•', '▪': '•', '▫': '•', '●': '•', '○': '•', '◦': '•', '►': '>', '▶': '>', '◄': '<', '◀': '<',
  '⚠': '(!)', 'ℹ': '(i)', '№': 'No.', '\t': ' ', '\u2011': '-', '\u2010': '-', '\u2212': '-',
  '\u2009': ' ', '\u200a': ' ', '\u2002': ' ', '\u2003': ' ', '\u2007': ' ', '\u202f': ' ', '\u00a0': ' ',
};
// left out without a trace: emoji with their modifiers (and the one space that followed them), zero-width marks, CR
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const isEmoji = (ch, cp) => PICTOGRAPH.test(ch) || (cp >= 0x1f1e6 && cp <= 0x1f1ff) || (cp >= 0x1f3fb && cp <= 0x1f3ff); // + flag letters, skin tones
// zero-width and direction marks, variation selectors, keycap, BOM, CR, emoji tag letters
const INVISIBLE_POINTS = new Set([0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2060, 0xfe0e, 0xfe0f, 0x20e3, 0xfeff, 0x0d]);
const isInvisible = (cp) => INVISIBLE_POINTS.has(cp) || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || (cp >= 0xe0020 && cp <= 0xe007f);
const charSets = new WeakMap();
function charSetOf(font) {
  let set = charSets.get(font);
  if (!set) { set = new Set(font.getCharacterSet()); charSets.set(font, set); }
  return set;
}
export function drawableText(text, font) {
  const src = String(text == null ? '' : text);
  if (/^[\x20-\x7e\n]*$/.test(src) || !font || !font.getCharacterSet) return src;
  const set = charSetOf(font);
  const lines = [];
  for (const line of src.normalize('NFC').split('\n')) {
    let out = ''; let emoji = false;
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      if (isInvisible(cp)) continue;
      if (set.has(cp)) out += ch;
      else if (SUBSTITUTES[ch] !== undefined) out += SUBSTITUTES[ch];
      else if (isEmoji(ch, cp)) emoji = true;
      else out += '?';
    }
    if (emoji) {
      // the spaces that stood around the emoji go with it: "A 🎯 B" → "A B", "Done 🎉" → "Done";
      // the indentation of the line stays
      const indent = /^ */.exec(line)[0];
      out = indent + out.replace(/^ +/, '').replace(/ {2,}/g, ' ').replace(/ +$/, '');
      // a line that was nothing but emoji (also behind a list or heading mark: "# 🎯") is left
      // out, so that no empty heading or bullet is drawn
      if (src.includes('\n') && /^\s*([#>*•-]+)?\s*$/.test(out)) continue;
    }
    lines.push(out);
  }
  return lines.join('\n');
}
// the same for every string inside plain data (invoice DTO, document, outline); other values pass through
export function drawableData(value, font) {
  if (typeof value === 'string') return drawableText(value, font);
  if (Array.isArray(value)) return value.map((v) => drawableData(v, font));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, drawableData(v, font)]));
  }
  return value;
}

export function zalom(text, font, size, sirka) {
  const out = [];
  for (const odst of String(text || '').split('\n')) {
    let radek = '';
    for (const slovo of odst.split(/\s+/).filter(Boolean)) {
      let s = slovo;
      while (font.widthOfTextAtSize(s, size) > sirka) {
        // the longest beginning that fits, by halving: stepping back one character at a time measured the
        // whole rest again and again — a long "word" without spaces froze the tab (finding F2-05)
        let i = 1;
        for (let hi = s.length; i < hi;) {
          const mid = Math.ceil((i + hi) / 2);
          if (font.widthOfTextAtSize(s.slice(0, mid), size) <= sirka) i = mid; else hi = mid - 1;
        }
        if (radek) { out.push(radek); radek = ''; }
        out.push(s.slice(0, i)); s = s.slice(i);
      }
      const zk = radek ? `${radek} ${s}` : s;
      if (font.widthOfTextAtSize(zk, size) <= sirka) radek = zk;
      else { out.push(radek); radek = s; }
    }
    out.push(radek);
  }
  return out;
}
// Vykreslí zalomený blok od horní hrany y dolů; vrací y pod poslední řádkou. `max` = nejvýš řádků (zbytek se
// zahodí s „…“), `zarovnani` left|center|right, `odsazeni` = x posun dalších řádků (odrážky).
export function kresliBlok(page, { text, font, size, x, y, sirka, barva, radkovani = 1.3, zarovnani = 'left', max = 0, odsazeni = 0 }) {
  let radky = zalom(text, font, size, sirka);
  if (max && radky.length > max) { radky = radky.slice(0, max); radky[max - 1] = radky[max - 1].replace(/\s*\S*$/, '') + ' …'; }
  const krok = size * radkovani;
  let yy = y - size;
  radky.forEach((r, i) => {
    const w = font.widthOfTextAtSize(r, size);
    const xx = zarovnani === 'center' ? x + (sirka - w) / 2 : zarovnani === 'right' ? x + sirka - w : x + (i ? odsazeni : 0);
    page.drawText(r, { x: xx, y: yy, size, font, color: barva });
    yy -= krok;
  });
  return yy + krok - size * (radkovani - 1); // horní hrana dalšího bloku
}
// výška bloku bez kreslení (plánování rozložení)
export function vyskaBloku(text, font, size, sirka, radkovani = 1.3) {
  return zalom(text, font, size, sirka).length * size * radkovani;
}
// obrázek vepsaný do obdélníku (contain), zarovnaný; vrací vykreslený rozměr
export function kresliObrazek(page, obr, { x, y, w, h, zarovnani = 'left' }) {
  if (!obr) return null;
  const k = Math.min(w / obr.w, h / obr.h, 1e9);
  const dw = obr.w * k, dh = obr.h * k;
  const xx = zarovnani === 'center' ? x + (w - dw) / 2 : zarovnani === 'right' ? x + w - dw : x;
  page.drawImage(obr.image, { x: xx, y: y + (h - dh) / 2, width: dw, height: dh });
  return { x: xx, y: y + (h - dh) / 2, w: dw, h: dh };
}
// obrázek přes celý obdélník (cover) — přebytek ořízne ořezová cesta; `ops` = PDFLib (pushGraphicsState, rectangle,
// clip, endPath, popGraphicsState). AI obrázky Kanceláře (3. 11. 2026) mají poměr stran podle místa v šabloně,
// ořez je jen pár procent. Bez `ops` (starší volající) vepsat (contain).
export function kresliObrazekPres(page, obr, { x, y, w, h }, ops) {
  if (!obr) return null;
  if (!ops || !ops.pushGraphicsState) return kresliObrazek(page, obr, { x, y, w, h, zarovnani: 'center' });
  const k = Math.max(w / obr.w, h / obr.h);
  const dw = obr.w * k, dh = obr.h * k;
  page.pushOperators(ops.pushGraphicsState(), ops.rectangle(x, y, w, h), ops.clip(), ops.endPath());
  page.drawImage(obr.image, { x: x + (w - dw) / 2, y: y + (h - dh) / 2, width: dw, height: dh });
  page.pushOperators(ops.popGraphicsState());
  return { x, y, w, h };
}
