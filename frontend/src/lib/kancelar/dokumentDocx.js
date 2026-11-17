// Dokument jako Word (.docx) — knihovna docx (MIT), injektovaná (node test). Hlavička = organizace + logo, u e-mailu
// Komu / Předmět, tělo markdown-lite (nadpisy, odrážky, odstavce). Prezentace = osnova (nadpisy snímků + odrážky +
// poznámky kurzívou) — ať jde text předat i tomu, kdo PowerPoint nemá. Písmo Calibri (má Word; LibreOffice nahradí).
import { parsujBloky, parsujOsnovu } from './osnova.js';

export const POPISKY = { cs: { komu: 'Komu', predmet: 'Předmět', poznamky: 'Poznámky řečníka' }, en: { komu: 'To', predmet: 'Subject', poznamky: 'Speaker notes' } };

// Width and height of a PNG / JPEG read from its header (no decoding, works in node and in the browser).
export function imageSize(b) {
  if (!b || b.length < 24) return null;
  if (b[0] === 0x89 && b[1] === 0x50) { // PNG: IHDR right after the signature
    const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0; const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
    return w && h ? { w, h } : null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG: walk the segments to the first start-of-frame
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i += 1; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const h = (b[i + 5] << 8) | b[i + 6]; const w = (b[i + 7] << 8) | b[i + 8];
        return w && h ? { w, h } : null;
      }
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}
// The logo in the header is fitted into 90 × 30 px with its own aspect ratio — it used to be forced to 3 : 1,
// so a square logo came out three times too wide (code analysis 4, F2-09). Unknown size → the old box.
export function logoBox(bytes, maxW = 90, maxH = 30) {
  const r = imageSize(bytes);
  if (!r) return { width: maxW, height: maxH };
  const k = Math.min(maxW / r.w, maxH / r.h);
  return { width: Math.max(1, Math.round(r.w * k)), height: Math.max(1, Math.round(r.h * k)) };
}

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
    hlava.push(new D.ImageRun({ type: logoTyp === 'jpg' ? 'jpg' : 'png', data: logoBytes, transformation: logoBox(logoBytes) }));
  }
  const header = new D.Header({ children: [new D.Paragraph({ children: hlava, border: { bottom: { color: AK, style: D.BorderStyle.SINGLE, size: 8, space: 4 } } })] });
  const footer = new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ children: [D.PageNumber.CURRENT], color: '73737F', size: 16 })] })] });
  return new D.Document({
    creator: 'killBottleneck', title: String(data.title || ''),
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ headers: { default: header }, footers: { default: footer }, children: deti }],
  });
}
