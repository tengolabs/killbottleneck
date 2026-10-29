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
  const qrText = data.spayd || data.epc || ''; // jako lib/faktura/index.js: SPAYD (CZK) nebo EPC (EUR)
  const matice = qr && qrText ? qrMaticeZ(qrcode, qrText, 'M') : null;
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
// položky textu 1. strany s polohou (x, y, šířka) — důkaz zalomení a že nic nepřeteklo přes pravý okraj
async function polozkyPdf(bytes) {
  const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true }).promise;
  const tc = await (await doc.getPage(1)).getTextContent();
  return tc.items.map((x) => ({ str: x.str, x: x.transform[4], y: x.transform[5], w: x.width }));
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
    expect(castka(1600, 'cs') === '1\u00a0600,00\u00a0Kč' && castka(1600, 'en') === '1,600.00 CZK' && castka(0.5, 'cs') === '0,50\u00a0Kč', 'castka cs/en');
    expect(datum('2026-10-23', 'cs') === '23. 10. 2026' && datum('2026-10-23', 'en') === '23/10/2026' && datum('', 'cs') === '', 'datum cs/en');

    console.log('== faktury pro celý svět (27. 10. 2026): česká faktura 1:1 s v0.86, US, EUR (EPC QR), formáty ==');
    const V = require('./_faktura-vzorek.js');
    const vz = await V.vzorky();
    const fx = JSON.parse(fs.readFileSync(V.SOUBOR, 'utf8'));
    for (const k of Object.keys(fx)) expect(vz[k].text === fx[k].text && vz[k].spayd === fx[k].spayd, `česká faktura ${k}: text PDF i SPAYD shodné se schváleným vzorkem v0.86`);
    const US = Object.assign({}, DATA, { currency: 'USD', vat_payer: true, vat_rate: 8.25, subtotal: 1950, vat: 160.88, total: 2110.88, note: '',
      supplier: { name: 'Acme Consulting LLC', address: '1 Main St\nAustin, TX 78701', ico: '12-3456789', bank_account: 'Routing 021000021\nAccount 123456789', email: 'joe@acme.com', vat_payer: true, country: 'US' },
      customer: { name: 'Globex Corp', address: '5 Oak Ave\nDallas, TX 75201' } });
    US.spayd = F.spayd(US); US.epc = F.epcQr(US);
    const us = await vyrob(US, 'en');
    const tus = (await textPdf(us.bytes)).join('\n');
    expect(!US.spayd && !US.epc && !us.matice && !/QR payment/.test(tus), 'US: žádný QR (SPAYD jen CZK, EPC jen EUR)');
    expect(/INVOICE/.test(tus) && !/tax document/.test(tus) && /EIN: 12-3456789/.test(tus) && !/Not a VAT payer/.test(tus) && !/Date of taxable supply/.test(tus), 'US: INVOICE, EIN, bez „daňový doklad“, bez „Not a VAT payer“ a DUZP');
    expect(/10\/09\/2026/.test(tus) && /10\/23\/2026/.test(tus), 'US: datum MM/DD/YYYY');
    expect(/\$1,600\.00/.test(tus) && /Sales tax 8\.25 %\s+\$160\.88/.test(tus) && /Total due\s+\$2,110\.88/.test(tus), 'US: $1,600.00, Sales tax 8.25 %, total $2,110.88');
    expect(/Routing 021000021 Account 123456789/.test(tus) && /Payment reference:\s+20260001/.test(tus) && !/Variable symbol/.test(tus), 'US: účet volný text na 2 řádky, reference místo VS');
    // 29. 10.: volný účet 120 znaků na řádek se zalomí vedle QR (dřív přetekl stránku)
    const DL = Object.assign({}, DATA, { currency: 'EUR', note: '',
      supplier: { name: 'Hans Muster GmbH', address: 'Hauptstr. 1\n10115 Berlin', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', country: 'DE',
        bank_account: 'Commerzbank AG Filiale Berlin-Mitte Kontonummer 0532013000 Bankleitzahl 37040044 Verwendungszweck Rechnung ENDEUCTU' } });
    DL.spayd = F.spayd(DL); DL.epc = F.epcQr(DL);
    const dl = await vyrob(DL, 'en');
    const sdl = await textPdf(dl.bytes.slice()); const tdl = sdl.join('\n'); // slice: pdfjs buffer přenese (detach), čteme 2×
    const pol = await polozkyPdf(dl.bytes.slice());
    const prvni = pol.find((i) => /Commerzbank/.test(i.str)), posledni = pol.find((i) => /ENDEUCTU/.test(i.str));
    const qrX = 595.28 - 42 - 100 - 8; // levý okraj QR (A4 − OKRAJ 42 − velikost − 8), viz layout.js
    expect(dl.matice && prvni && posledni && prvni.y !== posledni.y && pol.filter((i) => i.str.trim() && i.y <= prvni.y + 1 && i.y >= posledni.y - 1).every((i) => i.x + i.w <= qrX + 1 || i.x >= qrX) && sdl.length === 1,
      `volný účet 120 zn. + EPC QR: zalomený na víc řádků (${prvni && posledni ? Math.round(prvni.y - posledni.y) : '?'} pt), žádný řádek nezasahuje do QR, 1 strana`);
    const DE = Object.assign({}, DATA, { currency: 'EUR', vat_payer: true, vat_rate: 19, subtotal: 1950, vat: 370.5, total: 2320.5,
      supplier: { name: 'Hans Muster GmbH', address: 'Hauptstr. 1\n10115 Berlin', ico: 'HRB 12345', dic: 'DE123456789', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', vat_payer: true, country: 'DE' } });
    DE.spayd = F.spayd(DE); DE.epc = F.epcQr(DE);
    const de = await vyrob(DE, 'en');
    const tde = (await textPdf(de.bytes)).join('\n');
    expect(!DE.spayd && !!DE.epc && !!de.matice && (await dekoduj(de.matice)) === DE.epc, `EUR: QR dekódované jsqr == EPC (${JSON.stringify((await dekoduj(de.matice)) || '').slice(0, 40)}…)`);
    expect(/Company No\.: HRB 12345/.test(tde) && /VAT ID: DE123456789/.test(tde) && /VAT 19 %\s+€370\.50/.test(tde) && /€2,320\.50/.test(tde) && /BIC \/ SWIFT:\s+COBADEFFXXX/.test(tde) && /DE89 3704 0044 0532 0130 00/.test(tde) && /QR payment/.test(tde), 'EUR: Company No., VAT ID, €, BIC, IBAN, QR platba');
    expect(/09\/10\/2026/.test(tde) && !/Date of taxable supply/.test(tde) && /Payment reference/.test(tde), 'EU: datum DD/MM/YYYY, bez DUZP, reference');
    const GBn = Object.assign({}, DATA, { currency: 'GBP', supplier: { name: 'Jane Smith', address: '1 High St\nLondon', bank_account: 'Sort code 12-34-56, account 12345678', country: 'GB' } });
    GBn.spayd = F.spayd(GBn); GBn.epc = F.epcQr(GBn);
    const tgb = (await textPdf((await vyrob(GBn, 'en')).bytes)).join('\n');
    expect(/Not VAT registered/.test(tgb) && /£1,950\.00/.test(tgb) && /Sort code 12-34-56, account 12345678/.test(tgb) && !/QR payment/.test(tgb), 'GB neplátce: Not VAT registered, £, sort code, bez QR');
    const CZeur = Object.assign({}, DATA, { currency: 'EUR' }); CZeur.spayd = F.spayd(CZeur); CZeur.epc = F.epcQr(CZeur);
    const tcz = (await textPdf((await vyrob(CZeur, 'cs')).bytes)).join('\n');
    expect(!CZeur.spayd && !!CZeur.epc && /1\s?600,00\s?€/.test(tcz) && /Variabilní symbol/.test(tcz) && /QR platba/.test(tcz), 'český dodavatel v EUR: 1 600,00 €, VS zůstává, EPC QR');
    expect(castka(1600, 'en', 'USD') === '$1,600.00' && castka(1600, 'cs', 'EUR') === '1\u00a0600,00\u00a0€' && castka(1600, 'en', 'PLN') === '1,600.00 PLN', 'castka se symboly');
    expect(datum('2026-10-23', 'en', 'US') === '10/23/2026' && datum('2026-10-23', 'en', 'DE') === '23/10/2026' && datum('2026-10-23', 'cs', 'US') === '23. 10. 2026', 'datum: US pořadí jen v en');
    const { souctyPoMenach } = await mod('src/lib/faktura/zeme.js');
    expect(souctyPoMenach([{ total: 100, currency: 'CZK' }, { total: 50, currency: 'EUR' }, { total: 1, currency: 'CZK' }], 'cs') === '101,00\u00a0Kč + 50,00\u00a0€' && souctyPoMenach([], 'cs') === '0,00\u00a0Kč', 'součty po měnách, nikdy přes měny');

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
    console.log('== předvolby zemí: server (faktury.js ZEME) == frontend (zeme.js PREDVOLBY) — jedna tabulka ==');
    {
      const Zf = await mod('src/lib/faktura/zeme.js');
      const klice = [...Zf.ZEME_SEZNAM.map(([k]) => k), 'EU', 'XX', ''];
      const rozdil = klice.filter((k) => { const a = F.predvolba(k), b = Zf.predvolba(k); return a.currency !== b.currency || a.vat_rate !== b.vat_rate; });
      expect(rozdil.length === 0, `měna a sazba shodné pro ${klice.length} klíčů${rozdil.length ? ` (liší se: ${rozdil.join(', ')})` : ''}`);
      expect(Object.keys(F.ZEME).sort().join() === Object.keys(Zf.PREDVOLBY).sort().join(), 'stejná množina zemí na serveru i ve frontendu');
      expect(JSON.stringify(F.SYMBOLY) === JSON.stringify(Zf.SYMBOLY) && F.MENY.join() === Zf.MENY.join(), 'symboly a nabídka měn shodné');
      const kombinace = [...Zf.ZEME_SEZNAM.map(([k]) => k), 'EU', 'XX', ''].flatMap((k) => ['cs', 'en'].flatMap((L) => ['', 'GST'].map((tl) => [k, L, tl])));
      const jine = kombinace.filter(([k, L, tl]) => { const a = F.popiskyZeme(k, L, tl), b = Zf.popiskyZeme(k, L, tl); return ['ico', 'dic', 'dan', 'neplatce'].some((x) => a[x] !== b[x]); });
      expect(jine.length === 0, `popisky ico/dic/daň/neplátce shodné server = frontend pro ${kombinace.length} kombinací${jine.length ? ` (liší se: ${jine.map((x) => x.join('/')).join(', ')})` : ''}`);
    }
  } catch (e) { fail++; console.log('  ❌ výjimka:', e && e.stack ? e.stack : e); }
  console.log(`\n${fail ? '🔴' : '🟢'} FAKTURA-PDF PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
