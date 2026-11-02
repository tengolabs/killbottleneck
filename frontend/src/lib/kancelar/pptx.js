// Prezentace jako PPTX (PowerPoint / LibreOffice / Google Slides) — pptxgenjs (MIT), injektované kvůli node testu.
// 16:9 (10 × 5,625 in). Titulní snímek s pruhem v barvě, obsahové snímky: nadpis, odrážky, poznámky řečníka
// (`> řádky` z osnovy), patička název · číslo. Logo organizace (data URL) vpravo nahoře. Písmo Calibri (má každý
// PowerPoint; LibreOffice nahradí Carlito) — text zůstává upravitelný, uživatel si vzhled doladí v PowerPointu.
import { tmava } from './textPdf.js';

const barvaHex = (b) => String(b || '#2563eb').replace('#', '').toUpperCase();

export function sestavPrezentaciPptx(PptxGenJS, { osnova, barva = '#2563eb', logoDataUrl = '', lang = 'cs', autor = '' }) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const titul = osnova.titul || (lang === 'en' ? 'Presentation' : 'Prezentace');
  pptx.title = titul;
  if (autor) pptx.author = autor;
  pptx.lang = lang === 'en' ? 'en-US' : 'cs-CZ';
  const AK = barvaHex(barva);
  const naAkcentu = tmava(barva) ? 'FFFFFF' : '222222';
  const TEXT = '222226'; const SEDA = '73737F';

  // titulní snímek
  {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 3.8, h: 5.625, fill: { color: AK }, line: { color: AK } });
    s.addShape(pptx.ShapeType.ellipse, { x: 1.2, y: 2.05, w: 1.5, h: 1.5, line: { color: naAkcentu, width: 1.5, transparency: 55 }, fill: { type: 'none' } });
    s.addShape(pptx.ShapeType.ellipse, { x: 1.5, y: 2.35, w: 0.9, h: 0.9, line: { color: naAkcentu, width: 1.5, transparency: 35 }, fill: { type: 'none' } });
    s.addShape(pptx.ShapeType.ellipse, { x: 1.76, y: 2.61, w: 0.38, h: 0.38, fill: { color: naAkcentu, transparency: 20 }, line: { color: naAkcentu, transparency: 20 } });
    s.addText(titul, { x: 4.3, y: 1.3, w: 5.3, h: 1.9, fontFace: 'Calibri', fontSize: 34, bold: true, color: TEXT, valign: 'bottom', fit: 'shrink' });
    if (osnova.podtitul) s.addText(osnova.podtitul, { x: 4.3, y: 3.25, w: 5.3, h: 0.9, fontFace: 'Calibri', fontSize: 18, color: SEDA, valign: 'top' });
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 4.3, y: 4.5, w: 1.6, h: 0.7, sizing: { type: 'contain', w: 1.6, h: 0.7 } });
  }
  osnova.snimky.forEach((sn, i) => {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 10, h: 0.1, fill: { color: AK }, line: { color: AK } });
    if (logoDataUrl) s.addImage({ data: logoDataUrl, x: 8.3, y: 0.25, w: 1.3, h: 0.5, sizing: { type: 'contain', w: 1.3, h: 0.5 } });
    s.addText(sn.nadpis, { x: 0.55, y: 0.3, w: logoDataUrl ? 7.5 : 8.9, h: 0.9, fontFace: 'Calibri', fontSize: 28, bold: true, color: TEXT, valign: 'middle', fit: 'shrink' });
    s.addShape(pptx.ShapeType.rect, { x: 0.55, y: 1.22, w: 0.75, h: 0.045, fill: { color: AK }, line: { color: AK } });
    if (sn.odrazky.length) {
      const velikost = sn.odrazky.length <= 3 ? 24 : sn.odrazky.length <= 5 ? 20 : 17;
      s.addText(sn.odrazky.map((o) => ({ text: o, options: { bullet: { code: '25CF', indent: 18 }, breakLine: true, paraSpaceAfter: 6 } })),
        { x: 0.55, y: 1.45, w: 8.9, h: 3.55, fontFace: 'Calibri', fontSize: velikost, color: TEXT, valign: 'top', fit: 'shrink' });
    }
    if (sn.poznamky.length) s.addNotes(sn.poznamky.join('\n'));
    s.addText(`${titul}  ·  ${i + 1} / ${osnova.snimky.length}`, { x: 0.55, y: 5.15, w: 8.9, h: 0.3, fontFace: 'Calibri', fontSize: 9, color: SEDA });
  });
  return pptx;
}
