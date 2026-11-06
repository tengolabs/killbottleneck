// Prezentace jako PDF (16:9, jeden snímek = strana) — čistá funkce nad injektovaným pdf-lib (node test i prohlížeč).
// Vzhled: titulní strana s pruhem v barvě (akcent skinu nebo zvolená), obsahové strany s nadpisem, odrážkami
// s puntíkem a patičkou (název · číslo); logo organizace vpravo nahoře. Poznámky řečníka do PDF NEJDOU
// (jsou v PPTX) — PDF je k promítání a poslání. Písmo KB Sans (podmnožina Liberation Sans, OFL) — jediné, co v PDF máme.
// AI obrázky (3. 11. 2026): `obrazky` = { '': titulní, '<nadpis snímku>': obsahový } → { image, w, h }; titulní vyplní
// levý pruh místo kruhů, obsahový pravý panel (odrážky se zúží). `ops` = PDFLib kvůli ořezu (kresliObrazekPres).
import { SNIMEK, hexRgb, hexRgbSvetle, tmava, kresliBlok, kresliObrazek, kresliObrazekPres, vyskaBloku } from './textPdf.js';

const [W, H] = SNIMEK;
const OKRAJ = 56;

export function sestavPrezentaciPdf({ doc, rgb, fonty, osnova, barva = '#2563eb', logo = null, lang = 'cs', obrazky = {}, ops = null }) {
  const akcent = hexRgb(barva, rgb);
  const svetla = hexRgbSvetle(barva, rgb, 0.9);
  const bilaNaAkcentu = tmava(barva);
  const text = rgb(0.13, 0.13, 0.15);
  const sedá = rgb(0.45, 0.45, 0.5);
  const titul = osnova.titul || (lang === 'en' ? 'Presentation' : 'Prezentace');

  // titulní strana: levý pruh 38 % šířky v akcentu, vpravo titul + podtitul
  {
    const p = doc.addPage([W, H]);
    p.drawRectangle({ x: 0, y: 0, width: W * 0.38, height: H, color: akcent });
    p.drawRectangle({ x: W * 0.38, y: 0, width: 6, height: H, color: svetla });
    const x = W * 0.38 + 48; const sirka = W - x - OKRAJ;
    let y = H * 0.66;
    y = kresliBlok(p, { text: titul, font: fonty.bold, size: 40, x, y, sirka, barva: text, radkovani: 1.15, max: 4 });
    if (osnova.podtitul) kresliBlok(p, { text: osnova.podtitul, font: fonty.regular, size: 20, x, y: y - 14, sirka, barva: sedá, max: 3 });
    if (logo) kresliObrazek(p, logo, { x, y: 40, w: 160, h: 60, zarovnani: 'left' });
    if (obrazky['']) kresliObrazekPres(p, obrazky[''], { x: 0, y: 0, w: W * 0.38, h: H }, ops);
    else { // dekor v pruhu: tři světlé kruhy
      const k = bilaNaAkcentu ? rgb(1, 1, 1) : text;
      p.drawCircle({ x: W * 0.19, y: H * 0.5, size: 70, borderColor: k, borderWidth: 2, opacity: 0.35, borderOpacity: 0.35 });
      p.drawCircle({ x: W * 0.19, y: H * 0.5, size: 44, borderColor: k, borderWidth: 2, opacity: 0.5, borderOpacity: 0.5 });
      p.drawCircle({ x: W * 0.19, y: H * 0.5, size: 18, color: k, opacity: 0.7 });
    }
  }
  osnova.snimky.forEach((s, i) => {
    const p = doc.addPage([W, H]);
    const obr = obrazky[s.nadpis] || null;
    const panel = obr ? Math.round(W * 0.36) : 0; // pravý panel s obrázkem; logo a text se posunou vlevo
    if (obr) kresliObrazekPres(p, obr, { x: W - panel, y: 0, w: panel, h: H - 10 }, ops);
    p.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: akcent });
    if (logo) kresliObrazek(p, logo, { x: W - panel - OKRAJ - 120, y: H - 24 - 44, w: 120, h: 40, zarovnani: 'right' });
    const sirka = W - panel - 2 * OKRAJ - (logo ? 140 : 0);
    let y = H - 44;
    y = kresliBlok(p, { text: s.nadpis, font: fonty.bold, size: 30, x: OKRAJ, y, sirka, barva: text, radkovani: 1.15, max: 2 });
    p.drawLine({ start: { x: OKRAJ, y: y - 6 }, end: { x: OKRAJ + 72, y: y - 6 }, thickness: 3, color: akcent });
    y -= 30;
    // velikost odrážek podle množství textu, ať se vejdou (24 → 14)
    const sirkaOdr = W - panel - 2 * OKRAJ - 26;
    let size = 24;
    const dostupne = y - 50;
    while (size > 14 && s.odrazky.reduce((a, o) => a + vyskaBloku(o, fonty.regular, size, sirkaOdr, 1.3) + size * 0.5, 0) > dostupne) size -= 1;
    for (const o of s.odrazky) {
      p.drawCircle({ x: OKRAJ + 7, y: y - size * 0.62, size: size * 0.2, color: akcent });
      y = kresliBlok(p, { text: o, font: fonty.regular, size, x: OKRAJ + 26, y, sirka: sirkaOdr, barva: text, radkovani: 1.3 }) - size * 0.5;
      if (y < 40) break;
    }
    const pata = `${titul}  ·  ${i + 1} / ${osnova.snimky.length}`;
    p.drawText(pata, { x: OKRAJ, y: 22, size: 10, font: fonty.regular, color: sedá });
  });
  return doc;
}
