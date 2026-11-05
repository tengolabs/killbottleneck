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

export function zalom(text, font, size, sirka) {
  const out = [];
  for (const odst of String(text || '').split('\n')) {
    let radek = '';
    for (const slovo of odst.split(/\s+/).filter(Boolean)) {
      let s = slovo;
      while (font.widthOfTextAtSize(s, size) > sirka) {
        let i = s.length;
        while (i > 1 && font.widthOfTextAtSize(s.slice(0, i), size) > sirka) i--;
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
