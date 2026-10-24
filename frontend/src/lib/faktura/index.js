// PDF faktury v PROHLÍŽEČI (9. 10. 2026): z DTO faktury (/chat/faktura/{id}) vyrobí pdf-lib dokument — server
// soubor nikdy nedostane a nic se neukládá (Cloud Lite cizí soubory neukládá); PDF jde vyrobit kdykoli znovu 1:1,
// protože faktura nese snímky dodavatele i odběratele. Knihovny (pdf-lib, fontkit, qrcode-generator) a fonty
// Liberation Sans (OFL, public/fonts/pdf/) se načítají líně — statický import je zakázaný (lite-bundle.js).
import { getLib, nactiFont } from '@/lib/pdf';
import { sestavFakturu, POPISKY, castka, datum } from './layout.js';
import { qrMatice, kresliQr } from './qr.js';

export { POPISKY, castka, datum };

async function logoBajty(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const typ = (r.headers.get('content-type') || '').toLowerCase();
    const b = new Uint8Array(await r.arrayBuffer());
    if (/png/.test(typ) || (b[0] === 0x89 && b[1] === 0x50)) return { png: b };
    if (/jpe?g/.test(typ) || (b[0] === 0xff && b[1] === 0xd8)) return { jpg: b };
    return null; // webp a jiné pdf-lib neumí → bez loga
  } catch { return null; }
}

// data = DTO faktury; vrací Uint8Array (hotové PDF). Logo organizace je bonus: chyba načtení = bez loga.
export async function fakturaPdf(data, { lang = 'cs', logoUrl = '' } = {}) {
  const { PDFLib, fontkit } = await getLib();
  const [reg, bold, logo] = await Promise.all([nactiFont('LiberationSans-Regular'), nactiFont('LiberationSans-Bold'), logoBajty(logoUrl)]);
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${lang === 'en' ? 'Invoice' : 'Faktura'} ${data.cislo || ''}`);
  doc.setProducer('killBottleneck');
  const fonty = { regular: await doc.embedFont(reg, { subset: true }), bold: await doc.embedFont(bold, { subset: true }) };
  let obrazek = null;
  if (logo) {
    try {
      const img = logo.png ? await doc.embedPng(logo.png) : await doc.embedJpg(logo.jpg);
      obrazek = { image: img, w: img.width, h: img.height };
    } catch { obrazek = null; }
  }
  const qr = data.spayd ? await qrMatice(data.spayd) : null;
  sestavFakturu({ doc, rgb: PDFLib.rgb, fonty, data, L: lang === 'en' ? 'en' : 'cs', logo: obrazek, qr, kresliQr });
  return doc.save();
}
