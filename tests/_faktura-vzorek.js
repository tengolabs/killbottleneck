// Vzorek české faktury (v0.86-beta, Richardem schválená podoba 24. 10. 2026) — text PDF neplátce (cs) a plátce (en)
// z TÝCHŽ dat jako faktura-pdf.js. Po přestavbě na „faktury pro celý svět“ (27. 10. 2026) musí česká faktura vyjít
// 1:1 — faktura-pdf.js porovnává text s product/tests/fixtures/faktura-cz-v086.json. Znovu vyrobit JEN se
// svolením (změna schválené podoby): node product/tests/_faktura-vzorek.js --zapis
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const FE = path.join(__dirname, '../frontend');
const mod = (p) => import(pathToFileURL(path.join(FE, p)).href);
const balik = (p) => import(pathToFileURL(path.join(FE, 'node_modules', p)).href);
const FONTY = path.join(FE, 'public/fonts/pdf');
global.__hooks = path.join(__dirname, '..', 'server', 'pb_hooks');
const F = require(path.join(global.__hooks, 'faktury.js'));
const SOUBOR = path.join(__dirname, 'fixtures', 'faktura-cz-v086.json');

const DATA = {
  id: 'x1', cislo: '20260001', issued: '2026-10-09', due: '2026-10-23', currency: 'CZK', paid_on: '',
  supplier: { name: 'Jan Novák – konzultace', address: 'Dlouhá 12\n110 00 Praha 1', ico: '12345678', bank_account: '19-2000145399/0800', iban: 'CZ6508000000192000145399', email: 'jan@example.com', vat_payer: false },
  customer: { name: 'Karel Dvořák', address: 'Krátká 3\n602 00 Brno', ico: '87654321', email: 'karel@example.com' },
  items: [{ description: 'Konzultace – příprava kampaně', quantity: 2, unit: 'h', unit_price: 800, total: 1600 }, { description: 'Cestovné', quantity: 1, unit: '', unit_price: 350, total: 350 }],
  vat_payer: false, vat_rate: 0, subtotal: 1950, vat: 0, total: 1950, note: 'Děkuji za spolupráci.',
};
DATA.vs = F.variabilni(DATA.cislo); DATA.spayd = F.spayd(DATA);
const PLATCE = Object.assign({}, DATA, { vat_payer: true, vat_rate: 21, subtotal: 1950, vat: 409.5, total: 2359.5, paid_on: '2026-10-15', supplier: Object.assign({}, DATA.supplier, { dic: 'CZ12345678', vat_payer: true }) });
PLATCE.spayd = F.spayd(PLATCE);

async function vyrob(data, L) {
  const PDFLib = await balik('pdf-lib/dist/pdf-lib.esm.js');
  const fk = (await balik('@pdf-lib/fontkit/dist/fontkit.es.js')).default;
  const { sestavFakturu } = await mod('src/lib/faktura/layout.js');
  const { qrMaticeZ, kresliQr } = await mod('src/lib/faktura/qr.js');
  const qrcode = (await balik('qrcode-generator/qrcode.js')).default;
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fk);
  const fonty = { regular: await doc.embedFont(fs.readFileSync(path.join(FONTY, 'LiberationSans-Regular.ttf')), { subset: true }), bold: await doc.embedFont(fs.readFileSync(path.join(FONTY, 'LiberationSans-Bold.ttf')), { subset: true }) };
  const qrText = data.spayd || data.epc || '';
  const matice = qrText ? qrMaticeZ(qrcode, qrText, 'M') : null;
  sestavFakturu({ doc, rgb: PDFLib.rgb, fonty, data, L, logo: null, qr: matice, kresliQr });
  return doc.save();
}
async function textPdf(bytes) {
  const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const strany = [];
  for (let i = 1; i <= doc.numPages; i++) { const tc = await (await doc.getPage(i)).getTextContent(); strany.push(tc.items.map((x) => x.str).join(' ')); }
  return strany;
}
// 4 vzorky: neplátce cs/en, plátce cs/en (QR = SPAYD řetězec)
async function vzorky() {
  const out = {};
  for (const [k, d, L] of [['neplatce-cs', DATA, 'cs'], ['neplatce-en', DATA, 'en'], ['platce-cs', PLATCE, 'cs'], ['platce-en', PLATCE, 'en']]) {
    out[k] = { text: (await textPdf(await vyrob(d, L))).join('\n'), spayd: d.spayd };
  }
  return out;
}
module.exports = { DATA, PLATCE, vyrob, textPdf, vzorky, SOUBOR };
if (require.main === module) {
  (async () => {
    const v = await vzorky();
    if (process.argv.includes('--zapis')) { fs.writeFileSync(SOUBOR, JSON.stringify(v, null, 1)); console.log('zapsáno', SOUBOR); }
    else console.log(JSON.stringify(v, null, 1));
  })();
}
