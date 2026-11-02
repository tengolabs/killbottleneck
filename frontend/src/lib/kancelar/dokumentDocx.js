// Dokument jako Word (.docx) — knihovna docx (MIT), injektovaná (node test). Hlavička = organizace + logo, u e-mailu
// Komu / Předmět, tělo markdown-lite (nadpisy, odrážky, odstavce). Prezentace = osnova (nadpisy snímků + odrážky +
// poznámky kurzívou) — ať jde text předat i tomu, kdo PowerPoint nemá. Písmo Calibri (má Word; LibreOffice nahradí).
import { parsujBloky, parsujOsnovu } from './osnova.js';

export const POPISKY = { cs: { komu: 'Komu', predmet: 'Předmět', poznamky: 'Poznámky řečníka' }, en: { komu: 'To', predmet: 'Subject', poznamky: 'Speaker notes' } };

export function sestavDokumentDocx(D, { data, org = {}, logoBytes = null, logoTyp = 'png', barva = '#2563eb', lang = 'cs' }) {
  const T = POPISKY[lang === 'en' ? 'en' : 'cs'];
  const AK = String(barva || '#2563eb').replace('#', '');
  const P = (text, o = {}) => new D.Paragraph({ children: [new D.TextRun({ text, ...(o.run || {}) })], ...(o.para || {}) });
  const deti = [];
  deti.push(new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun({ text: String(data.title || ''), color: '222226' })] }));
  if (data.kind === 'email') {
    for (const [lab, val] of [[T.komu, data.email_to], [T.predmet, data.email_subject]]) if (val) deti.push(new D.Paragraph({ children: [new D.TextRun({ text: `${lab}: `, bold: true }), new D.TextRun({ text: String(val) })] }));
    if (data.email_to || data.email_subject) deti.push(P(''));
  }
  if (data.kind === 'presentation') {
    const os = parsujOsnovu(data.text);
    if (os.podtitul) deti.push(P(os.podtitul, { run: { italics: true, color: '73737F' } }));
    os.snimky.forEach((s, i) => {
      deti.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun({ text: `${i + 1}. ${s.nadpis}`, color: AK })] }));
      for (const o of s.odrazky) deti.push(new D.Paragraph({ children: [new D.TextRun({ text: o })], bullet: { level: 0 } }));
      if (s.poznamky.length) deti.push(new D.Paragraph({ children: [new D.TextRun({ text: `${T.poznamky}: `, bold: true, italics: true, color: '73737F' }), new D.TextRun({ text: s.poznamky.join(' '), italics: true, color: '73737F' })], spacing: { before: 80 } }));
    });
  } else {
    for (const b of parsujBloky(data.text)) {
      if (b.typ === 'mezera') { deti.push(P('')); continue; }
      if (b.typ === 'nadpis') { deti.push(new D.Paragraph({ heading: b.uroven === 1 ? D.HeadingLevel.HEADING_1 : b.uroven === 2 ? D.HeadingLevel.HEADING_2 : D.HeadingLevel.HEADING_3, children: [new D.TextRun({ text: b.text, color: AK })] })); continue; }
      if (b.typ === 'odrazka') { deti.push(new D.Paragraph({ children: [new D.TextRun({ text: b.text })], bullet: { level: 0 } })); continue; }
      deti.push(P(b.text));
    }
  }
  const hlava = [];
  if (org.name) hlava.push(new D.TextRun({ text: String(org.name), bold: true, color: '222226', size: 20 }));
  if (logoBytes) {
    if (hlava.length) hlava.push(new D.TextRun({ text: '   ' }));
    hlava.push(new D.ImageRun({ type: logoTyp === 'jpg' ? 'jpg' : 'png', data: logoBytes, transformation: { width: 90, height: 30 } }));
  }
  const header = new D.Header({ children: [new D.Paragraph({ children: hlava, border: { bottom: { color: AK, style: D.BorderStyle.SINGLE, size: 8, space: 4 } } })] });
  const footer = new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], color: '73737F', size: 16 })] })] });
  return new D.Document({
    creator: 'killBottleneck', title: String(data.title || ''),
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ headers: { default: header }, footers: { default: footer }, children: deti }],
  });
}
