// Každý dokument z Dokumentů jako PDF na „hlavičkovém papíře“ (14. 10. 2026): A4, hlavička = název organizace + logo
// + linka v barvě, u e-mailu Komu / Předmět, tělo = markdown-lite (nadpisy #, odrážky -, odstavce), stránkování.
// Prezentace tudy jde jako osnova (nadpisy snímků + odrážky) — PDF snímků dělá prezentacePdf.js.
import { A4, hexRgb, kresliBlok, kresliObrazek, zalom } from './textPdf.js';
import { parsujBloky } from './osnova.js';

const [W, H] = A4;
const OKRAJ = 56;
const SPODEK = 60;
export const POPISKY = { cs: { komu: 'Komu', predmet: 'Předmět', strana: 'Strana' }, en: { komu: 'To', predmet: 'Subject', strana: 'Page' } };

export function sestavDokumentPdf({ doc, rgb, fonty, data, org = {}, logo = null, barva = '#2563eb', lang = 'cs' }) {
  const T = POPISKY[lang === 'en' ? 'en' : 'cs'];
  const akcent = hexRgb(barva, rgb);
  const text = rgb(0.13, 0.13, 0.15);
  const seda = rgb(0.45, 0.45, 0.5);
  const sirka = W - 2 * OKRAJ;
  const strany = [];
  let page = null; let y = 0;
  const hlavicka = () => {
    page = doc.addPage([W, H]); strany.push(page);
    let hy = H - 40;
    if (org.name) page.drawText(String(org.name), { x: OKRAJ, y: hy - 12, size: 11, font: fonty.bold, color: text });
    if (logo) kresliObrazek(page, logo, { x: W - OKRAJ - 110, y: hy - 30, w: 110, h: 32, zarovnani: 'right' });
    page.drawLine({ start: { x: OKRAJ, y: hy - 40 }, end: { x: W - OKRAJ, y: hy - 40 }, thickness: 1.2, color: akcent });
    y = hy - 64;
  };
  hlavicka();
  // název a (u e-mailu) adresát + předmět
  y = kresliBlok(page, { text: data.title || '', font: fonty.bold, size: 18, x: OKRAJ, y, sirka, barva: text, radkovani: 1.2 }) - 6;
  if (data.kind === 'email' && (data.email_to || data.email_subject)) {
    for (const [lab, val] of [[T.komu, data.email_to], [T.predmet, data.email_subject]]) {
      if (!val) continue;
      page.drawText(`${lab}:`, { x: OKRAJ, y: y - 10, size: 10, font: fonty.bold, color: seda });
      y = kresliBlok(page, { text: String(val), font: fonty.regular, size: 10, x: OKRAJ + 56, y, sirka: sirka - 56, barva: text, radkovani: 1.3 }) - 2;
    }
    y -= 6;
    page.drawLine({ start: { x: OKRAJ, y }, end: { x: W - OKRAJ, y }, thickness: 0.5, color: seda });
    y -= 14;
  } else y -= 8;
  for (const b of parsujBloky(data.text)) {
    if (b.typ === 'mezera') { y -= 8; continue; }
    const size = b.typ === 'nadpis' ? (b.uroven === 1 ? 15 : b.uroven === 2 ? 13 : 11.5) : 11;
    const font = b.typ === 'nadpis' ? fonty.bold : fonty.regular;
    const odsaz = b.typ === 'odrazka' ? 16 : 0;
    const radky = zalom(b.text, font, size, sirka - odsaz);
    // odstavec se nedělí přes stranu, když se vejde na novou; dlouhý se rozdělí po řádcích
    const vyska = radky.length * size * 1.4;
    if (y - Math.min(vyska, 3 * size * 1.4) < SPODEK) hlavicka();
    if (b.typ === 'nadpis') y -= 6;
    for (const r of radky) {
      if (y - size * 1.4 < SPODEK) hlavicka();
      if (b.typ === 'odrazka' && r === radky[0]) page.drawCircle({ x: OKRAJ + 5, y: y - size * 0.62, size: 1.8, color: akcent });
      page.drawText(r, { x: OKRAJ + odsaz, y: y - size, size, font, color: text });
      y -= size * 1.4;
    }
    y -= b.typ === 'nadpis' ? 2 : 4;
  }
  strany.forEach((p, i) => p.drawText(`${T.strana} ${i + 1} / ${strany.length}`, { x: W - OKRAJ - 60, y: 32, size: 8.5, font: fonty.regular, color: seda }));
  return doc;
}
