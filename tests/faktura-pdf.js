// PDF faktury (9. 10. 2026) — rozvržení bez prohlížeče: skutečné PDF přes pdf-lib + fonty Liberation z public/,
// text přečtený pdf.js (číslo, jména, Neplátce DPH / DUZP, částky, strany), QR platba DEKÓDOVANÁ jsqr z nakreslené
// matice (== SPAYD), logo chybí → nepadá, 50 položek = víc stran s číslováním. Bez dockeru:
// node product/tests/faktura-pdf.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const FE = path.join(__dirname, '../frontend');
const mod = (p) => import(pathToFileURL(path.join(FE, p)).href);
const balik = (p) => import(pathToFileURL(path.join(FE, 'node_modules', p)).href);
const FONTY = path.join(FE, 'public/fonts/pdf');
global.__hooks = path.join(__dirname, '..', 'server', 'pb_hooks');
const F = require(path.join(global.__hooks, 'faktury.js'));

const DATA = {
  id: 'x1', cislo: '20260001', issued: '2026-10-09', due: '2026-10-23', currency: 'CZK', paid_on: '',
  supplier: { name: 'Jan Novák – konzultace', address: 'Dlouhá 12\n110 00 Praha 1', ico: '12345678', bank_account: '19-2000145399/0800', iban: 'CZ6508000000192000145399', email: 'jan@example.com', vat_payer: false },
  customer: { name: 'Karel Dvořák', address: 'Krátká 3\n602 00 Brno', ico: '87654321', email: 'karel@example.com' },
  items: [{ description: 'Konzultace – příprava kampaně', quantity: 2, unit: 'h', unit_price: 800, total: 1600 }, { description: 'Cestovné', quantity: 1, unit: '', unit_price: 350, total: 350 }],
  vat_payer: false, vat_rate: 0, subtotal: 1950, vat: 0, total: 1950, note: 'Děkuji za spolupráci.',
};
DATA.vs = F.variabilni(DATA.cislo); DATA.spayd = F.spayd(DATA);

async function vyrob(data, L, { qr = true, logo = null } = {}) {
  const PDFLib = await balik('pdf-lib/dist/pdf-lib.esm.js');
  const fk = (await balik('@pdf-lib/fontkit/dist/fontkit.es.js')).default;
  const { sestavFakturu } = await mod('src/lib/faktura/layout.js');
  const { qrMaticeZ, kresliQr } = await mod('src/lib/faktura/qr.js');
  const qrcode = (await balik('qrcode-generator/qrcode.js')).default;
  const doc = await PDFLib.PDFDocument.create();
  doc.registerFontkit(fk);
  const fonty = { regular: await doc.embedFont(fs.readFileSync(path.join(FONTY, 'LiberationSans-Regular.ttf')), { subset: true }), bold: await doc.embedFont(fs.readFileSync(path.join(FONTY, 'LiberationSans-Bold.ttf')), { subset: true }) };
  const matice = qr && data.spayd ? qrMaticeZ(qrcode, data.spayd, 'M') : null;
  sestavFakturu({ doc, rgb: PDFLib.rgb, fonty, data, L, logo, qr: matice, kresliQr });
  return { bytes: await doc.save(), matice, stran: doc.getPageCount() };
}
async function textPdf(bytes) {
  const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const strany = [];
  for (let i = 1; i <= doc.numPages; i++) { const tc = await (await doc.getPage(i)).getTextContent(); strany.push(tc.items.map((x) => x.str).join(' ')); }
  return strany;
}
// QR z matice → pixely → jsqr (nezávislý dekodér) — jediný poctivý důkaz, že se kód dá naskenovat
async function dekoduj(matice) {
  const jsQR = (await balik('jsqr/dist/jsQR.js')).default;
  const sc = 4; const zona = 4; const n = matice.n + 2 * zona; const w = n * sc;
  const px = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < matice.n; r++) for (let c = 0; c < matice.n; c++) {
    if (!matice.dark(r, c)) continue;
    for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const i = (((zona + r) * sc + dy) * w + (zona + c) * sc + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
  }
  const v = jsQR(px, w, w);
  return v ? v.data : null;
}

(async () => {
  try {
    console.log('== neplátce, cs ==');
    const a = await vyrob(DATA, 'cs');
    expect(a.bytes[0] === 0x25 && a.bytes[1] === 0x50 && a.bytes[2] === 0x44 && a.bytes[3] === 0x46, 'začíná %PDF');
    expect(a.stran === 1, `1 strana (je ${a.stran})`);
    const t = (await textPdf(a.bytes)).join('\n');
    expect(/FAKTURA/.test(t) && /20260001/.test(t), 'titulek FAKTURA + číslo');
    expect(/Jan Novák – konzultace/.test(t) && /Karel Dvořák/.test(t) && /Dlouhá 12/.test(t) && /602 00 Brno/.test(t), 'dodavatel a odběratel s adresami (diakritika)');
    expect(/Neplátce DPH/.test(t) && !/Základ daně/.test(t) && !/zdan\. plnění/.test(t), 'neplátce: „Neplátce DPH“, bez základu a DUZP');
    expect(/9\. 10\. 2026/.test(t) && /23\. 10\. 2026/.test(t), 'datumy česky');
    expect(/Konzultace – příprava kampaně/.test(t) && /Cestovné/.test(t) && /1\s?600,00\s?Kč/.test(t) && /1\s?950,00\s?Kč/.test(t), 'položky a částky 1 600,00 Kč / 1 950,00 Kč');
    expect(/19-2000145399\/0800/.test(t) && /CZ65 0800 0000 1920 0014 5399/.test(t) && /20260001/.test(t), 'platební blok: účet, IBAN po čtveřicích, VS');
    expect(/Děkuji za spolupráci/.test(t), 'poznámka');
    expect(/Strana 1 \/ 1/.test(t), 'patička se stranou');
    expect(!!a.matice && a.matice.n >= 21, `QR matice (${a.matice && a.matice.n} modulů)`);
    const dek = await dekoduj(a.matice);
    expect(dek === DATA.spayd, `QR dekódované jsqr == SPAYD (${dek})`);
    expect(/QR platba/.test(t), 'popisek QR platba');

    console.log('== plátce, en, zaplaceno, bez účtu ==');
    const B = Object.assign({}, DATA, { vat_payer: true, vat_rate: 21, subtotal: 1950, vat: 409.5, total: 2359.5, paid_on: '2026-10-15', supplier: Object.assign({}, DATA.supplier, { dic: 'CZ12345678', vat_payer: true, bank_account: '', iban: '' }) });
    B.spayd = F.spayd(B);
    const b = await vyrob(B, 'en');
    const tb = (await textPdf(b.bytes)).join('\n');
    expect(/Invoice – tax document/.test(tb) && /VAT ID: CZ12345678/.test(tb), 'plátce EN: daňový doklad + DIČ');
    expect(/Net amount/.test(tb) && /VAT 21 %/.test(tb) && /409\.50 CZK/.test(tb) && /2,359\.50 CZK/.test(tb) && /Date of taxable supply/.test(tb), 'základ, DPH 21 %, celkem 2,359.50 CZK, DUZP');
    expect(/Paid 15\/10\/2026/.test(tb), 'zaplaceno s datem (EN formát)');
    expect(!B.spayd && !b.matice && /Agree the payment with the supplier/.test(tb) && !/QR payment/.test(tb), 'bez účtu: žádný SPAYD/QR, věta o domluvě platby');
    expect(!/Not a VAT payer/.test(tb), 'plátce nemá „Not a VAT payer“');

    console.log('== 50 položek → víc stran, dlouhý popis se zalomí, logo chybí ==');
    const C = Object.assign({}, DATA, { items: Array.from({ length: 50 }, (_, i) => ({ description: i === 7 ? 'Velmi dlouhý popis položky, který se musí zalomit na více řádků, protože by se jinak do sloupce nevešel ani náhodou ' + 'x'.repeat(80) : `Položka ${i + 1}`, quantity: i + 1, unit: 'ks', unit_price: 10, total: (i + 1) * 10 })), subtotal: 12750, total: 12750 });
    C.spayd = F.spayd(C);
    const c = await vyrob(C, 'cs', { logo: { image: null, w: 0, h: 0 } });
    expect(c.stran >= 2, `50 položek = ${c.stran} strany`);
    const tc = await textPdf(c.bytes);
    expect(/Položka 1\b/.test(tc[0]) && /Položka 50/.test(tc.join('\n')) && new RegExp(`Strana ${c.stran} / ${c.stran}`).test(tc[tc.length - 1]), 'první položka na 1. straně, poslední na konci, číslování stran');
    expect(/Celkem k úhradě/.test(tc.join('\n')) && /12\s?750,00\s?Kč/.test(tc.join('\n')), 'součty na poslední straně');
    expect(tc.join('\n').includes('nevešel ani náhodou'), 'dlouhý popis zalomený a celý v PDF');
    expect(/FAKTURA č\. 20260001/.test(tc[1]), 'další strana nese číslo faktury v hlavičce');

    console.log('== formát částek a datumů ==');
    const { castka, datum } = await mod('src/lib/faktura/layout.js');
    expect(castka(1600, 'cs') === '1 600,00 Kč' && castka(1600, 'en') === '1,600.00 CZK' && castka(0.5, 'cs') === '0,50 Kč', 'castka cs/en');
    expect(datum('2026-10-23', 'cs') === '23. 10. 2026' && datum('2026-10-23', 'en') === '23/10/2026' && datum('', 'cs') === '', 'datum cs/en');

    // mutace poctivosti: jiný SPAYD → dekódování nesedí
    const m = await vyrob(Object.assign({}, DATA, { spayd: DATA.spayd.replace('AM:1950.00', 'AM:1951.00') }), 'cs');
    expect((await dekoduj(m.matice)) !== DATA.spayd, 'změněný řetězec se dekóduje jinak (test rozlišuje)');
    console.log('== ZIP všech faktur (lib/faktura/zip.sestavZip + fflate) ==');
    const { sestavZip } = await mod('src/lib/faktura/zip-jadro.js');
    const { unzipSync } = await balik('fflate/esm/browser.js');
    const za = await vyrob(DATA, 'cs'); const zb = await vyrob(Object.assign({}, DATA, { id: 'x2', cislo: '20260002' }), 'cs'); const zc = await vyrob(DATA, 'cs');
    const zip = sestavZip([{ dto: DATA, bytes: za.bytes }, { dto: Object.assign({}, DATA, { cislo: '20260002' }), bytes: zb.bytes }, { dto: DATA, bytes: zc.bytes }], (d) => `faktura-${d.cislo}`);
    expect(zip[0] === 0x50 && zip[1] === 0x4b, 'ZIP začíná PK');
    const obsah = unzipSync(zip);
    const jmena = Object.keys(obsah).sort();
    expect(jmena.join(',') === 'faktura-20260001-2.pdf,faktura-20260001.pdf,faktura-20260002.pdf', `3 soubory, duplicitní číslo dostane -2 (${jmena.join(',')})`);
    expect(Buffer.from(obsah['faktura-20260002.pdf'].slice(0, 5)).toString() === '%PDF-' && obsah['faktura-20260002.pdf'].length === zb.bytes.length, 'PDF v ZIPu je bajt po bajtu původní');
    expect(/20260002/.test(await textPdf(obsah['faktura-20260002.pdf'])), 'rozbalené PDF obsahuje své číslo');
  } catch (e) { fail++; console.log('  ❌ výjimka:', e && e.stack ? e.stack : e); }
  console.log(`\n${fail ? '🔴' : '🟢'} FAKTURA-PDF PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
