// Rozvržení PDF faktury — ČISTÁ funkce nad injektovaným pdf-lib (stejně jako lib/pdf/jadro.js): jde spustit
// v node bez prohlížeče (tests/faktura-pdf.js). Jedna šablona A4: hlavička (logo, číslo), dodavatel / odběratel,
// datumy, tabulka položek (přetéká na další strany), součty, poznámka, platební blok s QR (SPAYD), patička.
// Neplátce: „Faktura“ + „Neplátce DPH“; plátce: „Faktura – daňový doklad“, DIČ, DUZP, základ / DPH / celkem.
// Popisky cs/en tady (ne v i18n katalogu) — PDF musí jít vyrobit i mimo React (test) a text je jedna věc s rozvržením.
// Země dodavatele (data.supplier.country, 27. 10. 2026) mění jen to, co je v zeme.js: symbol a pozici měny, US datum,
// názvy identifikátorů a daně, „neplátce“, DUZP/VS jen CZ/SK, BIC a volný účet v platebním bloku, QR SPAYD/EPC.
// Bez země = CZ → faktura z v0.86 vychází 1:1 (tests/fixtures/faktura-cz-v086.json).
import { castka, datum, popiskyZeme } from './zeme.js';
export { castka, datum };
const A4 = [595.28, 841.89];
const OKRAJ = 42;
const SIRKA = A4[0] - 2 * OKRAJ;
const SPODEK = 60;

export const POPISKY = {
  cs: {
    titul: 'FAKTURA', cislo: 'č.', dodavatel: 'Dodavatel', odberatel: 'Odběratel',
    email: 'E-mail', vystaveni: 'Datum vystavení', splatnost: 'Datum splatnosti', duzp: 'Datum zdan. plnění',
    popis: 'Popis', mnozstvi: 'Množství', cenaJ: 'Cena / j.', castka: 'Částka', zaklad: 'Základ daně', dph: 'DPH', celkem: 'Celkem k úhradě',
    poznamka: 'Poznámka', platba: 'Platební údaje', ucet: 'Bankovní účet', iban: 'IBAN', bic: 'BIC / SWIFT', vs: 'Variabilní symbol', ref: 'Reference platby', qr: 'QR platba',
    zaplaceno: 'Zaplaceno', strana: 'Strana', bezUctu: 'Platbu domluvte s dodavatelem.',
  },
  en: {
    titul: 'INVOICE', cislo: 'No.', dodavatel: 'Supplier', odberatel: 'Customer',
    email: 'E-mail', vystaveni: 'Date of issue', splatnost: 'Due date', duzp: 'Date of taxable supply',
    popis: 'Description', mnozstvi: 'Quantity', cenaJ: 'Unit price', castka: 'Amount', zaklad: 'Net amount', dph: 'VAT', celkem: 'Total due',
    poznamka: 'Note', platba: 'Payment details', ucet: 'Bank account', iban: 'IBAN', bic: 'BIC / SWIFT', vs: 'Variable symbol', ref: 'Payment reference', qr: 'QR payment',
    zaplaceno: 'Paid', strana: 'Page', bezUctu: 'Agree the payment with the supplier.',
  },
};
function mnozstvi(q, L) {
  const s = String(Number(q || 0));
  return L === 'en' ? s : s.replace('.', ',');
}
// zalomení na šířku (po slovech; předlouhé slovo se rozseká)
function zalom(text, font, size, sirka) {
  const out = [];
  for (const odst of String(text || '').split('\n')) {
    let radek = '';
    for (const slovo of odst.split(/\s+/).filter(Boolean)) {
      let s = slovo;
      while (font.widthOfTextAtSize(s, size) > sirka) { // slovo delší než řádek
        let i = s.length;
        while (i > 1 && font.widthOfTextAtSize(s.slice(0, i), size) > sirka) i--;
        if (radek) { out.push(radek); radek = ''; }
        out.push(s.slice(0, i)); s = s.slice(i);
      }
      const zk = radek ? `${radek} ${s}` : s;
      if (font.widthOfTextAtSize(zk, size) <= sirka) radek = zk;
      else { out.push(radek); radek = s; }
    }
    out.push(radek);
  }
  return out.length ? out : [''];
}

// data = DTO faktury ze serveru (/chat/faktura/{id}); fonty = { regular, bold } (embedované pdf-lib fonty);
// logo = { image, w, h } (pdf-lib embedPng/embedJpg) nebo null; qr = matice z qr.js (null = bez QR); kresliQr z qr.js
export function sestavFakturu({ doc, rgb, fonty, data, L = 'cs', logo = null, qr = null, kresliQr = null }) {
  const T = POPISKY[L] || POPISKY.cs;
  const f = fonty.regular; const fb = fonty.bold;
  const seda = rgb(0.42, 0.45, 0.5); const cerna = rgb(0.1, 0.1, 0.12); const linka = rgb(0.82, 0.84, 0.87); const pozadi = rgb(0.95, 0.96, 0.97);
  const mena = data.currency || 'CZK';
  const platce = !!data.vat_payer;
  const dod = data.supplier || {};
  const Z = popiskyZeme(dod.country, L, dod.tax_label); // popisky podle země dodavatele (bez země = CZ)
  const dat = (ymd) => datum(ymd, L, dod.country);
  let page = doc.addPage(A4);
  let y = A4[1] - OKRAJ;
  const text = (s, x, yy, o = {}) => page.drawText(String(s == null ? '' : s), { x, y: yy, size: o.size || 9.5, font: o.bold ? fb : f, color: o.color || cerna });
  const sirkaT = (s, o = {}) => (o.bold ? fb : f).widthOfTextAtSize(String(s == null ? '' : s), o.size || 9.5);
  const vpravo = (s, xPrava, yy, o = {}) => text(s, xPrava - sirkaT(s, o), yy, o);
  const cara = (yy, x0 = OKRAJ, x1 = OKRAJ + SIRKA, barva = linka) => page.drawLine({ start: { x: x0, y: yy }, end: { x: x1, y: yy }, thickness: 0.6, color: barva });

  // ---- hlavička ----
  const titul = platce ? Z.titulDanovy : T.titul;
  let hlavaVyska = 0;
  if (logo && logo.image) {
    const max = { w: 150, h: 48 };
    const k = Math.min(max.w / logo.w, max.h / logo.h, 1);
    const w = logo.w * k; const h = logo.h * k;
    page.drawImage(logo.image, { x: OKRAJ, y: y - h, width: w, height: h });
    hlavaVyska = h;
  }
  vpravo(titul, OKRAJ + SIRKA, y - 16, { size: platce ? 16 : 20, bold: true });
  vpravo(`${T.cislo} ${data.cislo || ''}`, OKRAJ + SIRKA, y - 34, { size: 12, bold: true });
  y -= Math.max(hlavaVyska, 40) + 18;
  cara(y, OKRAJ, OKRAJ + SIRKA, rgb(0.3, 0.3, 0.33));
  y -= 16;

  // ---- dodavatel / odběratel ----
  const sloupec = (nadpis, s, x, sirka) => {
    let yy = y;
    text(nadpis.toUpperCase(), x, yy, { size: 8, color: seda, bold: true }); yy -= 14;
    text(s.name || '', x, yy, { size: 11, bold: true }); yy -= 14;
    for (const r of zalom(s.address || '', f, 9.5, sirka)) { if (r) { text(r, x, yy); yy -= 12; } }
    if (s.ico) { text(`${Z.ico}: ${s.ico}`, x, yy); yy -= 12; }
    if (s.dic) { text(`${Z.dic}: ${s.dic}`, x, yy); yy -= 12; }
    if (s.email) { text(`${T.email}: ${s.email}`, x, yy, { color: seda }); yy -= 12; }
    return yy;
  };
  const polovina = SIRKA / 2 - 10;
  const y1 = sloupec(T.dodavatel, data.supplier || {}, OKRAJ, polovina);
  const y2 = sloupec(T.odberatel, data.customer || {}, OKRAJ + SIRKA / 2 + 10, polovina);
  y = Math.min(y1, y2) - 6;
  if (!platce && Z.neplatce) { text(Z.neplatce, OKRAJ, y, { color: seda, size: 9 }); }
  y -= 14;

  // ---- datumy ----
  const datumy = [[T.vystaveni, dat(data.issued)], [T.splatnost, dat(data.due)]];
  if (platce && Z.duzp) datumy.push([T.duzp, dat(data.issued)]);
  page.drawRectangle({ x: OKRAJ, y: y - 22, width: SIRKA, height: 30, color: pozadi });
  let dx = OKRAJ + 10;
  for (const [n, v] of datumy) { text(n, dx, y - 4, { size: 8, color: seda }); text(v, dx, y - 16, { size: 10, bold: true }); dx += SIRKA / 3; }
  y -= 40;

  // ---- tabulka položek ----
  const sl = { popis: OKRAJ, mnozstvi: OKRAJ + SIRKA * 0.62, cenaJ: OKRAJ + SIRKA * 0.78, castka: OKRAJ + SIRKA };
  const hlavickaTabulky = () => {
    page.drawRectangle({ x: OKRAJ, y: y - 6, width: SIRKA, height: 18, color: pozadi });
    text(T.popis, sl.popis + 4, y - 1, { size: 8, color: seda, bold: true });
    vpravo(T.mnozstvi, sl.mnozstvi, y - 1, { size: 8, color: seda, bold: true });
    vpravo(T.cenaJ, sl.cenaJ, y - 1, { size: 8, color: seda, bold: true });
    vpravo(T.castka, sl.castka - 4, y - 1, { size: 8, color: seda, bold: true });
    y -= 22;
  };
  const novaStrana = () => { page = doc.addPage(A4); y = A4[1] - OKRAJ; text(`${T.titul} ${T.cislo} ${data.cislo || ''}`, OKRAJ, y - 10, { size: 10, bold: true }); y -= 30; hlavickaTabulky(); };
  hlavickaTabulky();
  const sirkaPopisu = sl.mnozstvi - sl.popis - 60;
  for (const it of data.items || []) {
    const radky = zalom(it.description, f, 9.5, sirkaPopisu);
    const vyska = radky.length * 12 + 6;
    if (y - vyska < SPODEK + 20) novaStrana();
    radky.forEach((r, i) => text(r, sl.popis + 4, y - i * 12));
    vpravo(`${mnozstvi(it.quantity, L)}${it.unit ? ` ${it.unit}` : ''}`, sl.mnozstvi, y);
    vpravo(castka(it.unit_price, L, mena), sl.cenaJ, y);
    vpravo(castka(it.total != null ? it.total : it.quantity * it.unit_price, L, mena), sl.castka - 4, y);
    y -= vyska;
    cara(y + 10); // mezi řádky (předchozí dolní dotah ~y+15, další horní ~y+7)
  }
  y -= 8;

  // ---- součty ----
  const souhrn = [];
  if (platce) { souhrn.push([T.zaklad, castka(data.subtotal, L, mena)]); souhrn.push([`${Z.dan} ${Number(data.vat_rate || 0)} %`, castka(data.vat, L, mena)]); }
  if (y - (souhrn.length + 1) * 16 - 30 < SPODEK) novaStrana();
  for (const [n, v] of souhrn) { vpravo(n, sl.cenaJ, y, { color: seda }); vpravo(v, sl.castka - 4, y); y -= 15; }
  if (souhrn.length) y -= 8; // rámeček celkem nesmí překrýt řádek DPH
  page.drawRectangle({ x: OKRAJ + SIRKA * 0.5, y: y - 8, width: SIRKA * 0.5, height: 24, color: pozadi });
  vpravo(T.celkem, sl.cenaJ, y, { bold: true, size: 10.5 });
  vpravo(castka(data.total, L, mena), sl.castka - 4, y, { bold: true, size: 12 });
  if (data.paid_on) { text(`${T.zaplaceno} ${dat(data.paid_on)}`, OKRAJ, y, { color: rgb(0.1, 0.5, 0.25), bold: true }); }
  y -= 34;

  // ---- poznámka ----
  if (data.note) {
    const radky = zalom(data.note, f, 9, SIRKA);
    if (y - radky.length * 11 - 16 < SPODEK) novaStrana();
    text(T.poznamka.toUpperCase(), OKRAJ, y, { size: 8, color: seda, bold: true }); y -= 12;
    for (const r of radky) { text(r, OKRAJ, y, { size: 9 }); y -= 11; }
    y -= 10;
  }

  // ---- platební blok + QR (SPAYD pro CZK, EPC/SEPA pro EUR; jinak jen údaje) ----
  const s = dod;
  const maUcet = !!(s.iban || s.bank_account);
  const qrVelikost = qr && (data.spayd || data.epc) ? 100 : 0;
  // řádky bloku: účet (i víceřádkový volný text: routing + account), IBAN, BIC, VS (CZ/SK) nebo reference, celkem
  // volný účet (až 120 zn. na řádek: routing + account, sort code…) se zalomí na šířku bloku vedle QR, ať nepřeteče stránku
  const sirkaUctu = SIRKA - 120 - 10 - (qrVelikost ? qrVelikost + 16 : 0);
  const radkyUctu = String(s.bank_account || '').split('\n').map((r) => r.trim()).filter(Boolean).flatMap((r) => zalom(r, fb, 9.5, sirkaUctu));
  const pocetRadku = radkyUctu.length + (s.iban ? 1 : 0) + (s.bic ? 1 : 0) + 1 + 1;
  const blokVyska = Math.max(qrVelikost + 10, 72, 22 + pocetRadku * 13 + 6);
  if (y - blokVyska < SPODEK) novaStrana();
  page.drawRectangle({ x: OKRAJ, y: y - blokVyska, width: SIRKA, height: blokVyska, borderColor: linka, borderWidth: 0.8 });
  let py = y - 14;
  text(T.platba.toUpperCase(), OKRAJ + 10, py, { size: 8, color: seda, bold: true }); py -= 14;
  if (maUcet) {
    const radek = (n, v, o) => { if (n) text(`${n}:`, OKRAJ + 10, py, { color: seda }); text(v, OKRAJ + 120, py, o || {}); py -= 13; };
    radkyUctu.forEach((r, i) => radek(i === 0 ? T.ucet : '', r, { bold: true }));
    if (s.iban) radek(T.iban, String(s.iban).replace(/(.{4})/g, '$1 ').trim());
    if (s.bic) radek(T.bic, String(s.bic));
    if (Z.vs) { if (data.vs) radek(T.vs, data.vs, { bold: true }); } else radek(T.ref, String(data.cislo || ''), { bold: true });
    radek(T.celkem, castka(data.total, L, mena), { bold: true });
  } else {
    text(T.bezUctu, OKRAJ + 10, py, { color: seda });
  }
  if (qrVelikost && kresliQr) {
    kresliQr(page, qr, { x: OKRAJ + SIRKA - qrVelikost - 8, y: y - blokVyska + 5, velikost: qrVelikost, rgb });
    vpravo(T.qr, OKRAJ + SIRKA - 8, y - blokVyska + 5 + qrVelikost + 2, { size: 7.5, color: seda });
  }
  y -= blokVyska + 10;

  // ---- patička: číslování stran ----
  const strany = doc.getPages();
  strany.forEach((p, i) => {
    const w = f.widthOfTextAtSize(`${T.strana} ${i + 1} / ${strany.length}`, 8);
    p.drawText(`${T.strana} ${i + 1} / ${strany.length}`, { x: A4[0] - OKRAJ - w, y: 28, size: 8, font: f, color: seda });
    const info = `${data.supplier && data.supplier.name ? data.supplier.name + ' · ' : ''}${T.titul.charAt(0) + T.titul.slice(1).toLowerCase()} ${data.cislo || ''}`;
    p.drawText(info, { x: OKRAJ, y: 28, size: 8, font: f, color: seda });
  });
  return doc;
}
