// Kancelář (14. 10. 2026) — soubory bez prohlížeče: tytéž čisté generátory jako v aplikaci (lib/kancelar/*) nad
// injektovanými knihovnami (pdf-lib + fonty Liberation z public/, pptxgenjs, docx, qrcode-generator).
//  · parser osnovy (titul, podtitul, snímky, odrážky, poznámky; stropy 20 / 8),
//  · PDF prezentace: strany 16:9, titul + každý snímek, text přečtený pdf.js s diakritikou, patička s čísly,
//  · 4 šablony přání: rozměry (A5 šířka / A5 výška / A4 / A4 šířka), text, Kdy/Kde, QR DEKÓDOVANÝ jsqr == odkaz,
//    podpis, bez loga a bez fotky nepadá, fotka a logo se vloží,
//  · dokument na hlavičce: organizace, Komu/Předmět, odrážky, víc stran s číslováním,
//  · PPTX: zip se snímky (titulní + N), text odrážek v XML, poznámky řečníka v notesSlide, počet snímků,
//  · DOCX: hlavička s organizací + logem, text, odrážky; prezentace jako osnova s poznámkami,
//  · mutace: parser bez stropu snímků → sada červená (kontrola níže).
// Bez dockeru: node product/tests/kancelar-soubory.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const FE = path.join(__dirname, '../frontend');
const mod = (p) => import(pathToFileURL(path.join(FE, p)).href);
const balik = (p) => import(pathToFileURL(path.join(FE, 'node_modules', p)).href);
const FONTY = path.join(FE, 'public/fonts/pdf');

// 1×1 PNG a 4×3 JPEG — logo a fotka. ⚠️ Kopie do Uint8Array: malé Buffery sdílí pool (byteOffset ≠ 0) a pdf-lib
// čte DataView od začátku .buffer → „SOI not found in JPEG“ (chytilo 14. 10. 2026)
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
const JPG = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAADAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCaiiivPPUP/9k=', 'base64'));

(async () => {
  try {
    const PDFLib = await balik('pdf-lib/dist/pdf-lib.esm.js');
    const fk = (await balik('@pdf-lib/fontkit/dist/fontkit.es.js')).default;
    const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
    const qrcode = (await balik('qrcode-generator/qrcode.js')).default;
    const jsQR = (await balik('jsqr/dist/jsQR.js')).default;
    const D = await balik('docx/dist/index.mjs');
    const JSZip = (await balik('jszip/dist/jszip.min.js')).default;
    const PptxGenJS = (await balik('pptxgenjs/dist/pptxgen.es.js')).default;
    const { parsujOsnovu, parsujBloky, MAX_SNIMKU, MAX_ODRAZEK } = await mod('src/lib/kancelar/osnova.js');
    const { sestavPrezentaciPdf } = await mod('src/lib/kancelar/prezentacePdf.js');
    const { sestavPranicko, rozmer, SABLONY } = await mod('src/lib/kancelar/pranicko.js');
    const { sestavDokumentPdf } = await mod('src/lib/kancelar/dokumentPdf.js');
    const { sestavDokumentDocx } = await mod('src/lib/kancelar/dokumentDocx.js');
    const { sestavPrezentaciPptx } = await mod('src/lib/kancelar/pptx.js');
    const { qrMaticeZ, kresliQr } = await mod('src/lib/faktura/qr.js');
    const { hexRgb, tmava, zalom } = await mod('src/lib/kancelar/textPdf.js');

    const novyDoc = async () => {
      const doc = await PDFLib.PDFDocument.create(); doc.registerFontkit(fk);
      const f = async (n) => doc.embedFont(fs.readFileSync(path.join(FONTY, n + '.ttf')), { subset: true });
      return { doc, fonty: { regular: await f('LiberationSans-Regular'), bold: await f('LiberationSans-Bold'), italic: await f('LiberationSans-Italic') } };
    };
    const obr = async (doc, bytes, png) => { const img = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes); return { image: img, w: img.width, h: img.height }; };
    const textPdf = async (bytes) => {
      const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      const strany = [];
      for (let i = 1; i <= d.numPages; i++) { const tc = await (await d.getPage(i)).getTextContent(); strany.push(tc.items.map((x) => x.str).join(' ')); }
      const sz = (await d.getPage(1)).getViewport({ scale: 1 });
      return { strany, w: Math.round(sz.width), h: Math.round(sz.height) };
    };
    const dekoduj = (matice) => {
      const sc = 4; const zona = 4; const n = matice.n + 2 * zona; const w = n * sc;
      const px = new Uint8ClampedArray(w * w * 4).fill(255);
      for (let r = 0; r < matice.n; r++) for (let c = 0; c < matice.n; c++) {
        if (!matice.dark(r, c)) continue;
        for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const i = (((zona + r) * sc + dy) * w + (zona + c) * sc + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
      }
      const v = jsQR(px, w, w); return v ? v.data : null;
    };

    console.log('== parser osnovy ==');
    const OSNOVA = '# Kuchyň pro Nováky\nStav zakázky, říjen 2026\n## Cíl zakázky\n- Linka do 30. 11. 2026\n• Dub masiv\n* Rozpočet 180 000 Kč\n> Cena bez spotřebičů.\n## Kde jsme\nřádek bez pomlčky\n- Materiál objednán\n\n## Prázdný snímek\n';
    const os = parsujOsnovu(OSNOVA);
    expect(os.titul === 'Kuchyň pro Nováky' && os.podtitul === 'Stav zakázky, říjen 2026', `titul + podtitul z řádků před prvním snímkem (${os.titul} / ${os.podtitul})`);
    expect(os.snimky.length === 3 && os.snimky[0].odrazky.length === 3 && os.snimky[0].odrazky[1] === 'Dub masiv' && os.snimky[0].poznamky[0] === 'Cena bez spotřebičů.', '3 snímky; odrážky -, •, *; poznámka >');
    expect(os.snimky[1].odrazky[0] === 'řádek bez pomlčky' && os.snimky[2].odrazky.length === 0, 'řádek bez pomlčky = odrážka; prázdný snímek povolen');
    const moc = parsujOsnovu('# T\n' + Array.from({ length: 25 }, (_, i) => `## S${i}\n` + Array.from({ length: 12 }, (_, j) => `- o${j}`).join('\n')).join('\n'));
    expect(moc.snimky.length === MAX_SNIMKU && moc.snimky[0].odrazky.length === MAX_ODRAZEK, `klient ořízne na stropy ${MAX_SNIMKU} snímků / ${MAX_ODRAZEK} odrážek (server to odmítá dřív)`);
    expect(parsujOsnovu('').snimky.length === 0 && parsujOsnovu('jen text').snimky.length === 0, 'bez „##“ žádný snímek');
    const bloky = parsujBloky('# Nadpis\n\nOdstavec.\n- a\n- b\nProgram:\n\n\n');
    expect(bloky.map((b) => b.typ).join(',') === 'nadpis,mezera,odstavec,odrazka,odrazka,nadpis' && bloky[5].text === 'Program:', `bloky dokumentu (${bloky.map((b) => b.typ).join(',')})`);
    expect(tmava('#2563eb') && !tmava('#fde68a') && JSON.stringify(hexRgb('#ff0000', (r, g, b) => [r, g, b])) === '[1,0,0]' && JSON.stringify(hexRgb('zelená', (r, g, b) => [r, g, b].map((x) => Math.round(x * 255)))) === '[37,99,235]', 'barvy: tmavá/světlá, hex → rgb, neplatná → modrá');

    console.log('== PDF prezentace ==');
    {
      const { doc, fonty } = await novyDoc();
      const os2 = parsujOsnovu(OSNOVA);
      sestavPrezentaciPdf({ doc, rgb: PDFLib.rgb, fonty, osnova: os2, barva: '#b91c1c', logo: await obr(doc, PNG, true), lang: 'cs' });
      const t = await textPdf(await doc.save());
      expect(t.strany.length === 4 && t.w === 960 && t.h === 540, `titulní + 3 snímky, 16:9 (${t.strany.length} stran, ${t.w}×${t.h})`);
      expect(/Kuchyň pro Nováky/.test(t.strany[0]) && /Stav zakázky, říjen 2026/.test(t.strany[0]), 'titulní strana: titul + podtitul s diakritikou');
      expect(/Cíl zakázky/.test(t.strany[1]) && /Linka do 30\. 11\. 2026/.test(t.strany[1]) && /Rozpočet 180 000 Kč/.test(t.strany[1]), 'snímek 1: nadpis + odrážky');
      expect(!/Cena bez spotřebičů/.test(t.strany.join(' ')), 'poznámky řečníka v PDF nejsou (jen v PPTX)');
      expect(/1 \/ 3/.test(t.strany[1]) && /3 \/ 3/.test(t.strany[3]), 'patička: číslo snímku / počet');
      const dlouhy = parsujOsnovu('# T\n## Hodně textu\n' + Array.from({ length: 8 }, (_, i) => `- Dlouhá odrážka číslo ${i + 1}, která se musí zalomit na víc řádků, protože má opravdu hodně slov a vět`).join('\n'));
      const d2 = await novyDoc();
      sestavPrezentaciPdf({ doc: d2.doc, rgb: PDFLib.rgb, fonty: d2.fonty, osnova: dlouhy, lang: 'en' });
      const t2 = await textPdf(await d2.doc.save());
      expect(t2.strany.length === 2 && /Dlouhá odrážka číslo 8/.test(t2.strany[1]), '8 dlouhých odrážek se zmenší, aby se vešly (poslední je na straně)');
    }

    console.log('== přání: 4 šablony ==');
    const KARTY = {
      greeting: { title: 'PF 2027', text: 'Děkujeme Vám za důvěru.\nPřejeme klidné Vánoce.', meta: { template: 'greeting', color: '#b91c1c', signature: 'Tým Truhlářství Novák', lang: 'cs' } },
      invitation: { title: 'Pozvánka na večírek', text: 'Srdečně Vás zveme.', meta: { template: 'invitation', color: '#0f766e', date: '12. 12. 2026 v 18:00', place: 'Dílna, Dlouhá 12', link: 'https://example.com/vecirek?x=1', signature: 'Jan Novák', lang: 'cs' } },
      poster: { title: 'Open day', text: 'Come and see how furniture is made.', meta: { template: 'poster', color: '#7c3aed', date: 'Saturday 7 Nov, 9–16', place: 'Dlouhá 12', link: 'https://example.com/day', lang: 'en' } },
      certificate: { title: 'Poděkování', text: 'Karel Dvořák\nza dlouholetou spolupráci.', meta: { template: 'certificate', color: '#1d4ed8', date: '14. 10. 2026', signature: 'Jan Novák, jednatel', lang: 'cs' } },
    };
    const ocek = { greeting: [595, 420], invitation: [420, 595], poster: [595, 842], certificate: [842, 595] };
    for (const k of SABLONY) {
      const data = KARTY[k];
      const { doc, fonty } = await novyDoc();
      const qr = data.meta.link ? qrMaticeZ(qrcode, data.meta.link, 'M') : null;
      sestavPranicko({ doc, rgb: PDFLib.rgb, fonty, data, logo: await obr(doc, PNG, true), fotka: k === 'greeting' ? await obr(doc, JPG, false) : null, qr, kresliQr });
      const t = await textPdf(await doc.save());
      const r = rozmer(k);
      expect(t.strany.length === 1 && t.w === ocek[k][0] && t.h === ocek[k][1] && Math.round(r[0]) === ocek[k][0], `${k}: 1 strana ${t.w}×${t.h}`);
      expect(new RegExp(data.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(t.strany[0]) && new RegExp(data.text.split('\n')[0].slice(0, 12)).test(t.strany[0]), `${k}: nadpis a text s diakritikou v PDF`);
      if (data.meta.date) { const lab = k === 'certificate' ? (data.meta.lang === 'en' ? 'Date' : 'Datum') : (data.meta.lang === 'en' ? 'When' : 'Kdy'); expect(t.strany[0].includes(data.meta.date) && t.strany[0].includes(lab), `${k}: ${lab} s datem`); }
      if (data.meta.place) expect(t.strany[0].includes(data.meta.place) && t.strany[0].includes(data.meta.lang === 'en' ? 'Where' : 'Kde'), `${k}: Kde/Where s místem`);
      if (data.meta.signature) expect(t.strany[0].includes(data.meta.signature), `${k}: podpis`);
      if (qr) expect(dekoduj(qr) === data.meta.link && t.strany[0].includes(data.meta.lang === 'en' ? 'Scan the link' : 'Odkaz načtete telefonem'), `${k}: QR dekódovaný jsqr == odkaz + popisek`);
    }
    {
      const { doc, fonty } = await novyDoc();
      sestavPranicko({ doc, rgb: PDFLib.rgb, fonty, data: { title: 'Bez ničeho', text: 'Jen text.', meta: { template: 'leták' } } });
      const t = await textPdf(await doc.save());
      expect(t.strany.length === 1 && t.w === 595 && t.h === 420 && /Bez ničeho/.test(t.strany[0]), 'bez loga, fotky, QR a s neznámou šablonou = přání A5 (nepadá)');
      expect(t.strany[0].includes('Podpis') === false, 'greeting bez podpisu nic nedomýšlí');
    }

    console.log('== dokument na hlavičkovém papíře (PDF) ==');
    {
      const EMAIL = { kind: 'email', title: 'Poptávka spárovek', email_to: 'drevo@example.com', email_subject: 'Poptávka – spárovky dub', text: 'Dobrý den,\n\nPoložky:\n- 12 ks spárovka dub\n- 6 ks spárovka dub\n\n' + Array.from({ length: 60 }, (_, i) => `Odstavec ${i + 1}: Lorem ipsum žluťoučký kůň úpěl ďábelské ódy, dlouhý řádek, který se zalomí.`).join('\n\n') + '\n\nS pozdravem\nJan Novák' };
      const { doc, fonty } = await novyDoc();
      sestavDokumentPdf({ doc, rgb: PDFLib.rgb, fonty, data: EMAIL, org: { name: 'Truhlářství Novák' }, logo: await obr(doc, PNG, true), barva: '#2563eb', lang: 'cs' });
      const t = await textPdf(await doc.save());
      expect(t.strany.length >= 2 && t.w === 595 && t.h === 842, `A4, víc stran (${t.strany.length})`);
      expect(t.strany.every((s) => /Truhlářství Novák/.test(s)), 'hlavička s organizací na každé straně');
      expect(/Komu: drevo@example\.com/.test(t.strany[0].replace(/\s+/g, ' ')) && /Předmět: Poptávka – spárovky dub/.test(t.strany[0].replace(/\s+/g, ' ')), 'e-mail: Komu + Předmět');
      expect(/12 ks spárovka dub/.test(t.strany[0]) && /Odstavec 60/.test(t.strany[t.strany.length - 1]) && /Jan Novák/.test(t.strany[t.strany.length - 1]), 'odrážky i poslední odstavec a podpis');
      expect(new RegExp(`Strana 1 / ${t.strany.length}`).test(t.strany[0]) && new RegExp(`Strana ${t.strany.length} / ${t.strany.length}`).test(t.strany[t.strany.length - 1]), 'číslování stran');
    }

    console.log('== PPTX ==');
    {
      const os3 = parsujOsnovu(OSNOVA);
      const pptx = sestavPrezentaciPptx(PptxGenJS, { osnova: os3, barva: '#2563eb', logoDataUrl: 'data:image/png;base64,' + Buffer.from(PNG).toString('base64'), lang: 'cs', autor: 'Tengo' });
      const buf = await pptx.write({ outputType: 'nodebuffer' });
      const zip = await JSZip.loadAsync(buf);
      const soubory = Object.keys(zip.files);
      const snimky = soubory.filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
      expect(buf.length > 10000 && snimky.length === 4, `PPTX zip: titulní + 3 snímky (${snimky.length})`);
      const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
      const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
      expect(/Kuchyň pro Nováky/.test(s1) && /Stav zakázky/.test(s1), 'titulní snímek: titul + podtitul');
      expect(/Cíl zakázky/.test(s2) && /Linka do 30\. 11\. 2026/.test(s2) && /Rozpočet 180 000 Kč/.test(s2) && /buChar/.test(s2), 'snímek 1: nadpis + odrážky (buChar)');
      const pozn = soubory.filter((f) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(f));
      const poznText = (await Promise.all(pozn.map((f) => zip.file(f).async('string')))).join(' ');
      expect(/Cena bez spotřebičů\./.test(poznText), 'poznámky řečníka v notesSlide');
      expect(soubory.some((f) => /^ppt\/media\/.*\.png$/.test(f)), 'logo v médiích');
      const core = await zip.file('docProps/core.xml').async('string');
      expect(/Tengo/.test(core) && /Kuchyň pro Nováky/.test(core), 'autor + název v docProps');
      const pres = await zip.file('ppt/presentation.xml').async('string');
      expect(/sldSz cx="9144000" cy="5143500"/.test(pres), 'rozměr 16:9');
    }

    console.log('== AI obrázky (3. 11. 2026): titulní pruh, panel snímku, přání / pozvánka / plakát; diplom bez ==');
    {
      // počet obrázků (XObject) na každé straně — logo je jeden, AI obrázek druhý
      const xobjekty = async (bytes) => (await PDFLib.PDFDocument.load(bytes)).getPages().map((pg) => {
        const x = pg.node.Resources() && pg.node.Resources().lookup(PDFLib.PDFName.of('XObject'));
        return x ? x.keys().length : 0;
      });
      const { doc, fonty } = await novyDoc();
      const os4 = parsujOsnovu(OSNOVA);
      const ai = await obr(doc, JPG, false);
      sestavPrezentaciPdf({ doc, rgb: PDFLib.rgb, fonty, osnova: os4, logo: await obr(doc, PNG, true), lang: 'cs', obrazky: { '': ai, 'Cíl zakázky': ai }, ops: PDFLib });
      const b4 = await doc.save();
      const x4 = await xobjekty(b4);
      expect(JSON.stringify(x4) === '[2,2,1,1]', `PDF prezentace: obrázek na titulní straně a u snímku „Cíl zakázky“, jinde jen logo (${JSON.stringify(x4)})`);
      const t4 = await textPdf(b4);
      expect(/Linka do 30\. 11\. 2026/.test(t4.strany[1]) && /Rozpočet 180 000 Kč/.test(t4.strany[1]) && /Kuchyň pro Nováky/.test(t4.strany[0]), 'odrážky vedle obrázku i titul zůstaly celé');
      const d5 = await novyDoc();
      sestavPrezentaciPdf({ doc: d5.doc, rgb: PDFLib.rgb, fonty: d5.fonty, osnova: os4, lang: 'cs', obrazky: { '': await obr(d5.doc, JPG, false) } });
      expect(JSON.stringify(await xobjekty(await d5.doc.save())) === '[1,0,0,0]', 'bez ops (starší volající) se obrázek vepíše a nepadá');

      const dataJpg = 'data:image/jpeg;base64,' + Buffer.from(JPG).toString('base64');
      const pptx = sestavPrezentaciPptx(PptxGenJS, { osnova: os4, lang: 'cs', obrazky: { '': dataJpg, 'Kde jsme': dataJpg } });
      const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
      const pic = async (n) => ((await zip.file(`ppt/slides/slide${n}.xml`).async('string')).match(/<p:pic>/g) || []).length;
      const pics = [await pic(1), await pic(2), await pic(3), await pic(4)];
      expect(JSON.stringify(pics) === '[1,0,1,0]' && Object.keys(zip.files).some((f) => /^ppt\/media\/.*\.jpe?g$/.test(f)), `PPTX: obrázek na titulním snímku a u „Kde jsme“ (${JSON.stringify(pics)})`);
      const s3 = await zip.file('ppt/slides/slide3.xml').async('string');
      expect(/Materiál objednán/.test(s3), 'PPTX: odrážky vedle obrázku zůstaly');

      for (const k of SABLONY) {
        const data = KARTY[k];
        const d = await novyDoc();
        sestavPranicko({ doc: d.doc, rgb: PDFLib.rgb, fonty: d.fonty, data, logo: await obr(d.doc, PNG, true), obrazek: await obr(d.doc, JPG, false), ops: PDFLib });
        const b = await d.doc.save();
        const x = (await xobjekty(b))[0];
        const tk = await textPdf(b);
        if (k === 'certificate') expect(x === 1, `${k}: AI obrázek se nekreslí (jen logo) (${x})`);
        else expect(x === 2 && new RegExp(data.title).test(tk.strany[0]) && new RegExp(data.text.split('\n')[0].slice(0, 12)).test(tk.strany[0]), `${k}: AI obrázek + logo, nadpis a text zůstaly (${x})`);
      }
      const dF = await novyDoc();
      sestavPranicko({ doc: dF.doc, rgb: PDFLib.rgb, fonty: dF.fonty, data: KARTY.greeting, fotka: await obr(dF.doc, PNG, true), obrazek: await obr(dF.doc, JPG, false), ops: PDFLib });
      expect((await xobjekty(await dF.doc.save()))[0] === 1, 'fotka uživatele má před AI obrázkem přednost (kreslí se jen jedna)');
    }

    console.log('== DOCX ==');
    {
      const EMAIL = { kind: 'email', title: 'Poptávka spárovek', email_to: 'drevo@example.com', email_subject: 'Poptávka – spárovky', text: '# Položky\n- 12 ks spárovka dub\n\nS pozdravem\nJan Novák' };
      const d = sestavDokumentDocx(D, { data: EMAIL, org: { name: 'Truhlářství Novák' }, logoBytes: PNG, barva: '#2563eb', lang: 'cs' });
      const buf = await D.Packer.toBuffer(d);
      const zip = await JSZip.loadAsync(buf);
      const doc = await zip.file('word/document.xml').async('string');
      const hl = (await Promise.all(Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f)).map((f) => zip.file(f).async('string')))).join(' ');
      expect(/Poptávka spárovek/.test(doc) && /Komu: /.test(doc) && /drevo@example\.com/.test(doc) && /12 ks spárovka dub/.test(doc) && /Jan Novák/.test(doc), 'document.xml: název, Komu, odrážka, podpis');
      expect(/Truhlářství Novák/.test(hl) && Object.keys(zip.files).some((f) => /^word\/media\//.test(f)), 'hlavička: organizace + logo v médiích');
      expect(/w:numPr/.test(doc) && /Položky/.test(doc), 'odrážka je skutečný seznam (numPr), nadpis vložen');
      const dp = sestavDokumentDocx(D, { data: { kind: 'presentation', title: 'Kuchyň', text: OSNOVA }, org: {}, lang: 'en' });
      const docP = await (await JSZip.loadAsync(await D.Packer.toBuffer(dp))).file('word/document.xml').async('string');
      expect(/1\. Cíl zakázky/.test(docP) && /Speaker notes: /.test(docP) && /Cena bez spotřebičů/.test(docP), 'prezentace ve Wordu = osnova s číslovanými snímky a poznámkami řečníka');
    }

    console.log('== zalomení ==');
    {
      const { fonty } = await novyDoc();
      const r = zalom('Slovo slovo slovo slovo slovo', fonty.regular, 12, 80);
      expect(r.length >= 2 && r.every((x) => fonty.regular.widthOfTextAtSize(x, 12) <= 80), 'zalomení po slovech drží šířku');
      const d = zalom('Supercalifragilisticexpialidocious', fonty.regular, 12, 60);
      expect(d.length >= 2 && d.every((x) => fonty.regular.widthOfTextAtSize(x, 12) <= 60), 'předlouhé slovo se rozseká');
    }
  } catch (e) {
    fail++; console.log(`  ❌ výjimka: ${e && e.stack ? e.stack.split('\n').slice(0, 12).join(' | ') : e}`);
  }
  console.log(`\n${fail ? '🔴' : '🟢'} KANCELAR-SOUBORY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
