// Kancelář v PROHLÍŽEČI (14. 10. 2026): z DTO dokumentu (/chat/dokument/{id}) vyrobí soubor — PDF (pdf-lib + fonty
// Liberation), PPTX (pptxgenjs) nebo Word (docx). Server žádný soubor nedrží a nic se neukládá; totéž PDF jde vyrobit
// kdykoli znovu z textu + meta. Knihovny se načítají LÍNĚ (statický import je zakázaný — lite-bundle.js), komponenty
// importují i tento modul líně (import('@/lib/kancelar')). Čisté generátory (prezentacePdf, pranicko, dokumentPdf,
// pptx, dokumentDocx) dostávají knihovny injektované → tytéž funkce jedou v node testech.
import { getLib, nactiFont } from '@/lib/pdf';
import { parsujOsnovu } from './osnova.js';
import { sestavPrezentaciPdf } from './prezentacePdf.js';
import { sestavPranicko, SABLONY, rozmer } from './pranicko.js';
import { sestavDokumentPdf } from './dokumentPdf.js';

export { parsujOsnovu, SABLONY, rozmer };

// „primary“ skinu je HSL trojice („239 84% 67%“) → #rrggbb; bez hodnoty modrá
export function akcentSkinu(zaloha = '#2563eb') {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    const m = v.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
    if (!m) return zaloha;
    const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
    const f = (n) => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
    return `#${f(0)}${f(8)}${f(4)}`;
  } catch { return zaloha; }
}

// AI obrázky dokumentu (3. 11. 2026): DTO.obrazky [{slot, stav, url}] → { slot: bajty } jen hotové; chyba = bez obrázku
async function aiObrazky(data, zakladna = '') {
  const out = {};
  await Promise.all((data.obrazky || []).filter((o) => o && o.stav === 'hotovo' && o.url).map(async (o) => {
    const b = await obrazekBajty(String(zakladna || '').replace(/\/$/, '') + o.url);
    if (b) out[o.slot || ''] = b;
  }));
  return out;
}
async function obrazekBajty(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const typ = (r.headers.get('content-type') || '').toLowerCase();
    const b = new Uint8Array(await r.arrayBuffer());
    return rozpoznejObrazek(b, typ);
  } catch { return null; }
}
// png / jpg podle hlavičky (webp a jiné pdf-lib neumí → null)
export function rozpoznejObrazek(b, typ = '') {
  if (!b || !b.length) return null;
  if (/png/.test(typ) || (b[0] === 0x89 && b[1] === 0x50)) return { png: b };
  if (/jpe?g/.test(typ) || (b[0] === 0xff && b[1] === 0xd8)) return { jpg: b };
  return null;
}
async function vlozObrazek(doc, o) {
  if (!o) return null;
  try {
    const img = o.png ? await doc.embedPng(o.png) : await doc.embedJpg(o.jpg);
    return { image: img, w: img.width, h: img.height };
  } catch { return null; }
}
function dataUrl(o) {
  if (!o) return '';
  const b = o.png || o.jpg; let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return `data:image/${o.png ? 'png' : 'jpeg'};base64,${btoa(s)}`;
}
async function fontySans() {
  const [reg, bold, ital] = await Promise.all([nactiFont('LiberationSans-Regular'), nactiFont('LiberationSans-Bold'), nactiFont('LiberationSans-Italic')]);
  return { reg, bold, ital };
}
async function novyDoc(titul) {
  const { PDFLib, fontkit } = await getLib();
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(String(titul || ''));
  doc.setProducer('killBottleneck');
  const f = await fontySans();
  const fonty = { regular: await doc.embedFont(f.reg, { subset: true }), bold: await doc.embedFont(f.bold, { subset: true }), italic: await doc.embedFont(f.ital, { subset: true }) };
  return { PDFLib, doc, fonty };
}

// opts = { lang, barva, logoUrl, org: {name}, fotka: Uint8Array|null }
export async function prezentacePdf(data, opts = {}) {
  const { PDFLib, doc, fonty } = await novyDoc(data.title);
  const logo = await vlozObrazek(doc, opts.logo !== false ? await obrazekBajty(opts.logoUrl) : null);
  const os = parsujOsnovu(data.text); if (!os.titul) os.titul = data.title || ''; if (!os.podtitul && data.meta && data.meta.subtitle) os.podtitul = data.meta.subtitle;
  const obrazky = {};
  for (const [slot, b] of Object.entries(await aiObrazky(data, opts.zakladna))) { const o = await vlozObrazek(doc, b); if (o) obrazky[slot] = o; }
  sestavPrezentaciPdf({ doc, rgb: PDFLib.rgb, fonty, osnova: os, barva: opts.barva, logo, lang: opts.lang, obrazky, ops: PDFLib });
  return doc.save();
}
export async function prezentacePptx(data, opts = {}) {
  const [{ default: PptxGenJS }, { sestavPrezentaciPptx }] = await Promise.all([import('pptxgenjs'), import('./pptx.js')]);
  const os = parsujOsnovu(data.text); if (!os.titul) os.titul = data.title || ''; if (!os.podtitul && data.meta && data.meta.subtitle) os.podtitul = data.meta.subtitle;
  const logo = opts.logo !== false ? await obrazekBajty(opts.logoUrl) : null;
  const obrazky = Object.fromEntries(Object.entries(await aiObrazky(data, opts.zakladna)).map(([slot, b]) => [slot, dataUrl(b)]));
  const pptx = sestavPrezentaciPptx(PptxGenJS, { osnova: os, barva: opts.barva, logoDataUrl: dataUrl(logo), lang: opts.lang, autor: opts.org && opts.org.name, obrazky });
  return pptx.write({ outputType: 'blob' });
}
export async function pranickoPdf(data, opts = {}) {
  const { PDFLib, doc, fonty } = await novyDoc(data.title);
  const meta = { ...(data.meta || {}), color: opts.barva || (data.meta && data.meta.color), lang: opts.lang || (data.meta && data.meta.lang) };
  const [logo, fotka] = await Promise.all([vlozObrazek(doc, meta.logo !== false ? await obrazekBajty(opts.logoUrl) : null), vlozObrazek(doc, rozpoznejObrazek(opts.fotka))]);
  const obrazek = fotka ? null : await vlozObrazek(doc, (await aiObrazky(data, opts.zakladna))[''] || null);
  let qr = null; let kresliQr = null;
  if (meta.link) { const Q = await import('@/lib/faktura/qr.js'); qr = await Q.qrMatice(meta.link); kresliQr = Q.kresliQr; }
  sestavPranicko({ doc, rgb: PDFLib.rgb, fonty, data: { ...data, meta }, logo, fotka, qr, kresliQr, obrazek, ops: PDFLib });
  return doc.save();
}
export async function dokumentPdf(data, opts = {}) {
  const { PDFLib, doc, fonty } = await novyDoc(data.title);
  const logo = await vlozObrazek(doc, await obrazekBajty(opts.logoUrl));
  sestavDokumentPdf({ doc, rgb: PDFLib.rgb, fonty, data, org: opts.org || {}, logo, barva: opts.barva, lang: opts.lang });
  return doc.save();
}
export async function dokumentDocx(data, opts = {}) {
  const [D, { sestavDokumentDocx }] = await Promise.all([import('docx'), import('./dokumentDocx.js')]);
  const logo = await obrazekBajty(opts.logoUrl);
  const d = sestavDokumentDocx(D, { data, org: opts.org || {}, logoBytes: logo ? (logo.png || logo.jpg) : null, logoTyp: logo && logo.jpg ? 'jpg' : 'png', barva: opts.barva, lang: opts.lang });
  return D.Packer.toBlob(d);
}

export const MIME = { pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
// formáty, které dokument nabízí: prezentace PPTX + PDF + Word; přání jen PDF; ostatní PDF + Word
export function formaty(kind) {
  if (kind === 'presentation') return ['pptx', 'pdf', 'docx'];
  if (kind === 'card') return ['pdf'];
  return ['pdf', 'docx'];
}
// DTO + formát → Blob
export async function vyrobSoubor(data, format, opts = {}) {
  // barva: výslovná z panelu > uložená v meta (přání) > akcent skinu — z karty v chatu panel barvu neposílá (/checkup 2. 11. 2026)
  const o = { ...opts, barva: opts.barva || (data.meta && data.meta.color) || akcentSkinu() };
  if (format === 'pptx') return prezentacePptx(data, o);
  if (format === 'docx') return dokumentDocx(data, o);
  const bytes = data.kind === 'presentation' ? await prezentacePdf(data, o) : data.kind === 'card' ? await pranickoPdf(data, o) : await dokumentPdf(data, o);
  return new Blob([bytes], { type: MIME.pdf });
}
