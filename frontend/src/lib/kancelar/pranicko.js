// Přání / pozvánka / plakát / diplom jako PDF — 4 VEKTOROVÉ šablony nad pdf-lib (žádné rastry v repu; v1 bez
// AI obrázků — KB generování nemá, FLUX neumí český text). Barva = akcent skinu nebo volba v panelu, logo
// organizace, volitelná fotka uživatele (png/jpg, neukládá se), QR z odkazu (pozvánka, plakát). Popisky cs/en tady,
// ne v i18n — PDF musí jít vyrobit i mimo React (node test). Čistá funkce: knihovny i QR matice injektované.
import { A4, A5, hexRgb, hexRgbSvetle, tmava, kresliBlok, kresliObrazek, vyskaBloku } from './textPdf.js';

export const SABLONY = ['greeting', 'invitation', 'poster', 'certificate'];
export const POPISKY = {
  cs: { kdy: 'Kdy', kde: 'Kde', datum: 'Datum', podpis: 'Podpis', qr: 'Odkaz načtete telefonem', udeleno: 'uděluje se' },
  en: { kdy: 'When', kde: 'Where', datum: 'Date', podpis: 'Signature', qr: 'Scan the link with your phone', udeleno: 'is awarded to' },
};
// rozměr strany podle šablony (pro náhled a test)
export function rozmer(template) {
  if (template === 'greeting') return [A5[1], A5[0]];
  if (template === 'invitation') return A5;
  if (template === 'certificate') return [A4[1], A4[0]];
  return A4; // poster
}

// data = { title, text, meta: { template, color, date, place, link, signature, lang } }, logo/fotka = { image, w, h }
export function sestavPranicko({ doc, rgb, fonty, data, logo = null, fotka = null, qr = null, kresliQr = null }) {
  const meta = data.meta || {};
  const template = SABLONY.includes(meta.template) ? meta.template : 'greeting';
  const L = meta.lang === 'en' ? 'en' : 'cs';
  const T = POPISKY[L];
  const barva = meta.color || '#2563eb';
  const akcent = hexRgb(barva, rgb);
  const svetla = hexRgbSvetle(barva, rgb, 0.88);
  const naAkcentu = tmava(barva) ? rgb(1, 1, 1) : rgb(0.13, 0.13, 0.15);
  const text = rgb(0.13, 0.13, 0.15);
  const seda = rgb(0.4, 0.4, 0.45);
  const [W, H] = rozmer(template);
  const page = doc.addPage([W, H]);
  const title = String(data.title || '');
  const telo = String(data.text || '');
  const podpis = String(meta.signature || '');
  const qrVelikost = 86;
  const kresliQrBlok = (x, y) => { // QR + popisek; vrací true když se kreslil
    if (!qr || !kresliQr) return false;
    kresliQr(page, qr, { x, y, velikost: qrVelikost, rgb });
    kresliBlok(page, { text: T.qr, font: fonty.regular, size: 7.5, x: x - 20, y: y - 4, sirka: qrVelikost + 40, barva: seda, zarovnani: 'center', max: 2 });
    return true;
  };

  if (template === 'greeting') {
    // A5 na šířku: levý pruh (fotka nebo dekor), vpravo nadpis, text, podpis, logo
    const pruh = W * 0.4;
    page.drawRectangle({ x: 0, y: 0, width: pruh, height: H, color: akcent });
    if (fotka) kresliObrazek(page, fotka, { x: 18, y: 18, w: pruh - 36, h: H - 36, zarovnani: 'center' });
    else {
      for (const [cx, cy, r] of [[pruh * 0.5, H * 0.55, 62], [pruh * 0.5, H * 0.55, 40], [pruh * 0.5, H * 0.55, 16]]) page.drawCircle({ x: cx, y: cy, size: r, borderColor: naAkcentu, borderWidth: 1.5, borderOpacity: 0.5 });
      page.drawCircle({ x: pruh * 0.5, y: H * 0.55, size: 7, color: naAkcentu, opacity: 0.8 });
    }
    const x = pruh + 30; const sirka = W - x - 30;
    let y = H - 44;
    y = kresliBlok(page, { text: title, font: fonty.bold, size: 24, x, y, sirka, barva: akcent, radkovani: 1.15, max: 3 });
    page.drawLine({ start: { x, y: y - 8 }, end: { x: x + 50, y: y - 8 }, thickness: 2, color: akcent });
    y -= 26;
    let size = 12.5;
    while (size > 9 && vyskaBloku(telo, fonty.regular, size, sirka, 1.4) > y - 70) size -= 0.5;
    kresliBlok(page, { text: telo, font: fonty.regular, size, x, y, sirka, barva: text, radkovani: 1.4 });
    if (podpis) kresliBlok(page, { text: podpis, font: fonty.italic || fonty.regular, size: 11, x, y: 58, sirka, barva: text, zarovnani: 'right', max: 2 });
    if (logo) kresliObrazek(page, logo, { x, y: 18, w: 90, h: 26, zarovnani: 'left' });
  } else if (template === 'invitation') {
    // A5 na výšku: horní pruh s nadpisem, fotka, text, blok Kdy / Kde, QR, podpis, logo
    const pruhH = fotka ? 120 : 150;
    page.drawRectangle({ x: 0, y: H - pruhH, width: W, height: pruhH, color: akcent });
    kresliBlok(page, { text: title, font: fonty.bold, size: fotka ? 22 : 26, x: 28, y: H - 34, sirka: W - 56, barva: naAkcentu, radkovani: 1.15, zarovnani: 'center', max: 3 });
    let y = H - pruhH - 22;
    if (fotka) { const r = kresliObrazek(page, fotka, { x: 28, y: y - 130, w: W - 56, h: 130, zarovnani: 'center' }); y = r ? r.y - 16 : y; }
    const sirka = W - 56;
    const blok = [meta.date ? `${T.kdy}: ${meta.date}` : '', meta.place ? `${T.kde}: ${meta.place}` : ''].filter(Boolean);
    const rezerva = 60 + (blok.length ? 30 + blok.length * 22 : 0) + (qr ? qrVelikost + 10 : 0);
    let size = 12.5;
    while (size > 9 && vyskaBloku(telo, fonty.regular, size, sirka, 1.4) > y - rezerva) size -= 0.5;
    y = kresliBlok(page, { text: telo, font: fonty.regular, size, x: 28, y, sirka, barva: text, radkovani: 1.4 });
    if (blok.length) {
      const h = 16 + blok.length * 22;
      y -= 14;
      page.drawRectangle({ x: 28, y: y - h, width: sirka, height: h, color: svetla });
      page.drawRectangle({ x: 28, y: y - h, width: 4, height: h, color: akcent });
      let yy = y - 8;
      for (const r of blok) { const i = r.indexOf(':'); page.drawText(r.slice(0, i + 1), { x: 44, y: yy - 13, size: 12, font: fonty.bold, color: akcent }); kresliBlok(page, { text: r.slice(i + 1).trim(), font: fonty.regular, size: 12, x: 44 + fonty.bold.widthOfTextAtSize(r.slice(0, i + 1), 12) + 6, y: yy, sirka: sirka - 90, barva: text, max: 1 }); yy -= 22; }
      y -= h;
    }
    kresliQrBlok(W - 28 - qrVelikost, 44);
    if (podpis) kresliBlok(page, { text: podpis, font: fonty.italic || fonty.regular, size: 11, x: 28, y: 64, sirka: qr ? sirka - qrVelikost - 20 : sirka, barva: text, max: 2 });
    if (logo) kresliObrazek(page, logo, { x: 28, y: 18, w: 90, h: 24, zarovnani: 'left' });
  } else if (template === 'poster') {
    // A4 na výšku: velký nadpis v horním pruhu, fotka, text uprostřed, kdy/kde velkým, QR dole
    const pruhH = 190;
    page.drawRectangle({ x: 0, y: H - pruhH, width: W, height: pruhH, color: akcent });
    kresliBlok(page, { text: title, font: fonty.bold, size: 40, x: 40, y: H - 52, sirka: W - 80, barva: naAkcentu, radkovani: 1.1, zarovnani: 'center', max: 3 });
    let y = H - pruhH - 30;
    if (fotka) { const r = kresliObrazek(page, fotka, { x: 40, y: y - 200, w: W - 80, h: 200, zarovnani: 'center' }); y = r ? r.y - 20 : y; }
    const sirka = W - 100;
    let size = 18;
    while (size > 12 && vyskaBloku(telo, fonty.regular, size, sirka, 1.35) > y - 230) size -= 1;
    y = kresliBlok(page, { text: telo, font: fonty.regular, size, x: 50, y, sirka, barva: text, radkovani: 1.35, zarovnani: 'center' });
    const blok = [meta.date ? `${T.kdy}: ${meta.date}` : '', meta.place ? `${T.kde}: ${meta.place}` : ''].filter(Boolean);
    if (blok.length) {
      y -= 24;
      for (const r of blok) y = kresliBlok(page, { text: r, font: fonty.bold, size: 20, x: 50, y, sirka, barva: akcent, zarovnani: 'center', max: 2 }) - 6;
    }
    kresliQrBlok((W - qrVelikost) / 2, 70);
    if (podpis) kresliBlok(page, { text: podpis, font: fonty.italic || fonty.regular, size: 12, x: 40, y: 48, sirka: W - 80, barva: seda, zarovnani: 'center', max: 1 });
    if (logo) kresliObrazek(page, logo, { x: 40, y: 20, w: 110, h: 30, zarovnani: 'left' });
    page.drawRectangle({ x: 0, y: 0, width: W, height: 8, color: akcent });
  } else {
    // certificate: A4 na šířku, dvojitý rámeček, logo nahoře, nadpis, „uděluje se“, jméno = text 1. řádek, zbytek textu, datum + podpis
    page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: akcent, borderWidth: 6 });
    page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: akcent, borderWidth: 1 });
    const sirka = W - 160;
    let y = H - 60;
    if (logo) { kresliObrazek(page, logo, { x: 80, y: y - 50, w: sirka, h: 50, zarovnani: 'center' }); y -= 66; }
    y = kresliBlok(page, { text: title, font: fonty.bold, size: 36, x: 80, y, sirka, barva: akcent, radkovani: 1.1, zarovnani: 'center', max: 2 });
    const radky = telo.split('\n').map((r) => r.trim()).filter(Boolean);
    const jmeno = radky.length > 1 ? radky[0] : '';
    const zbytek = (radky.length > 1 ? radky.slice(1) : radky).join('\n');
    y -= 18;
    if (jmeno) {
      y = kresliBlok(page, { text: T.udeleno, font: fonty.italic || fonty.regular, size: 13, x: 80, y, sirka, barva: seda, zarovnani: 'center', max: 1 }) - 6;
      y = kresliBlok(page, { text: jmeno, font: fonty.bold, size: 28, x: 80, y, sirka, barva: text, zarovnani: 'center', max: 2 }) - 10;
      page.drawLine({ start: { x: W / 2 - 90, y: y + 2 }, end: { x: W / 2 + 90, y: y + 2 }, thickness: 1, color: akcent });
      y -= 14;
    }
    let size = 16;
    while (size > 11 && vyskaBloku(zbytek, fonty.regular, size, sirka, 1.4) > y - 110) size -= 0.5;
    kresliBlok(page, { text: zbytek, font: fonty.regular, size, x: 80, y, sirka, barva: text, radkovani: 1.4, zarovnani: 'center' });
    // datum vlevo, podpis vpravo
    if (meta.date) { page.drawLine({ start: { x: 90, y: 86 }, end: { x: 270, y: 86 }, thickness: 0.8, color: seda }); page.drawText(`${T.datum}: ${meta.date}`, { x: 90, y: 70, size: 11, font: fonty.regular, color: text }); }
    page.drawLine({ start: { x: W - 270, y: 86 }, end: { x: W - 90, y: 86 }, thickness: 0.8, color: seda });
    kresliBlok(page, { text: podpis || T.podpis, font: fonty.italic || fonty.regular, size: 11, x: W - 270, y: 82, sirka: 180, barva: text, zarovnani: 'center', max: 2 });
    if (fotka) kresliObrazek(page, fotka, { x: W - 190, y: H - 150, w: 100, h: 80, zarovnani: 'right' });
  }
  return doc;
}
