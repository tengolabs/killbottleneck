// Code analysis 4, wave 4 — PDF from the browser (invoice, Office documents), without Docker:
//   F2-04  EPC payment QR (EUR): the supplier's name with diacritics is encoded as UTF-8
//   F2-06  characters outside the font's Latin subset are rewritten, not drawn as blank space
//   F2-08  a long supplier / customer / organization name wraps instead of overprinting its neighbour
// Real PDFs through pdf-lib + the KB Sans fonts from public/, text read back by pdf.js, the QR decoded by jsqr.
// Run: node product/tests/chyby4-pdf.js
// (KB_TEST_PRODUCT_DIR=<another checkout of product/> measures that tree instead — the mutation proof.)
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const ROOT = process.env.KB_TEST_PRODUCT_DIR || path.join(__dirname, '..');
const FE = path.join(ROOT, 'frontend');
const mod = (p) => import(pathToFileURL(path.join(FE, p)).href);
const balik = (p) => import(pathToFileURL(path.join(FE, 'node_modules', p)).href);
const FONTY = path.join(FE, 'public/fonts/pdf');
global.__hooks = path.join(ROOT, 'server', 'pb_hooks');
const F = require(path.join(global.__hooks, 'faktury.js'));

const DATA = {
  id: 'x1', cislo: '20260001', issued: '2026-10-09', due: '2026-10-23', currency: 'CZK', paid_on: '',
  supplier: { name: 'Jan Novák – konzultace', address: 'Dlouhá 12\n110 00 Praha 1', ico: '12345678', bank_account: '19-2000145399/0800', iban: 'CZ6508000000192000145399', email: 'jan@example.com', vat_payer: false },
  customer: { name: 'Karel Dvořák', address: 'Krátká 3\n602 00 Brno', ico: '87654321', email: 'karel@example.com' },
  items: [{ description: 'Konzultace', quantity: 2, unit: 'h', unit_price: 800, total: 1600 }],
  vat_payer: false, vat_rate: 0, subtotal: 1600, vat: 0, total: 1600, note: '',
};
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));

(async () => {
  try {
    const PDFLib = await balik('pdf-lib/dist/pdf-lib.esm.js');
    const fk = (await balik('@pdf-lib/fontkit/dist/fontkit.es.js')).default;
    const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
    const qrcode = (await balik('qrcode-generator/qrcode.js')).default;
    const jsQR = (await balik('jsqr/dist/jsQR.js')).default;
    const { sestavFakturu } = await mod('src/lib/faktura/layout.js');
    const { qrMaticeZ, kresliQr } = await mod('src/lib/faktura/qr.js');
    const { parsujOsnovu } = await mod('src/lib/kancelar/osnova.js');
    const { sestavPrezentaciPdf } = await mod('src/lib/kancelar/prezentacePdf.js');
    const { sestavPranicko } = await mod('src/lib/kancelar/pranicko.js');
    const { sestavDokumentPdf } = await mod('src/lib/kancelar/dokumentPdf.js');

    const novyDoc = async () => {
      const doc = await PDFLib.PDFDocument.create(); doc.registerFontkit(fk);
      const f = async (n) => doc.embedFont(fs.readFileSync(path.join(FONTY, n + '.ttf')), { subset: true });
      return { doc, fonty: { regular: await f('KBSans-Regular'), bold: await f('KBSans-Bold'), italic: await f('KBSans-Italic') } };
    };
    // text items of every page with position: { str, x, y, w, strana }
    const polozky = async (bytes) => {
      const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      const out = [];
      for (let i = 1; i <= d.numPages; i++) {
        const tc = await (await d.getPage(i)).getTextContent();
        for (const x of tc.items) out.push({ str: x.str, x: x.transform[4], y: x.transform[5], w: x.width, strana: i });
      }
      return out;
    };
    const textZ = (pol) => pol.map((p) => p.str).join(' ');
    // a glyph the font does not have ends up in the PDF as U+0000 (or is missing) — neither may happen
    const bezPrazdnych = (t) => !/\u0000/.test(t);
    const qrBajty = (matice) => {
      const sc = 4; const zona = 4; const n = matice.n + 2 * zona; const w = n * sc;
      const px = new Uint8ClampedArray(w * w * 4).fill(255);
      for (let r = 0; r < matice.n; r++) for (let c = 0; c < matice.n; c++) {
        if (!matice.dark(r, c)) continue;
        for (let dy = 0; dy < sc; dy++) for (let dx = 0; dx < sc; dx++) { const i = (((zona + r) * sc + dy) * w + (zona + c) * sc + dx) * 4; px[i] = px[i + 1] = px[i + 2] = 0; }
      }
      return jsQR(px, w, w);
    };
    const faktura = async (data, L = 'cs') => {
      const { doc, fonty } = await novyDoc();
      const qrText = data.spayd || data.epc || '';
      const matice = qrText ? qrMaticeZ(qrcode, qrText, 'M') : null;
      sestavFakturu({ doc, rgb: PDFLib.rgb, fonty, data, L, logo: null, qr: matice, kresliQr });
      return { bytes: await doc.save(), matice, stran: doc.getPageCount() };
    };

    console.log('== F2-04: EPC QR nese jméno dodavatele v UTF-8 ==');
    for (const jmeno of ['Jiří Šťastný – účetnictví s.r.o.', 'Železiarstvo Kováč, s.r.o.', 'Müller & Söhne GmbH']) {
      const E = Object.assign({}, DATA, { currency: 'EUR', supplier: { name: jmeno, address: 'Hlavná 1\n811 01 Bratislava', iban: 'SK3112000000198742637541', country: 'SK' } });
      E.spayd = F.spayd(E); E.epc = F.epcQr(E);
      expect(!E.spayd && E.epc.split('\n')[5] === jmeno && E.epc.split('\n')[2] === '1', `server: EPC s „${jmeno}“, znaková sada 1 = UTF-8`);
      const v = qrBajty(qrMaticeZ(qrcode, E.epc, 'M'));
      const bajty = v ? Buffer.from(v.binaryData) : Buffer.alloc(0);
      expect(!!v && bajty.equals(Buffer.from(E.epc, 'utf8')), `bajty v QR == UTF-8 řetězce EPC (${bajty.length} B, čekáno ${Buffer.byteLength(E.epc, 'utf8')} B)`);
      expect(!!v && v.data === E.epc && v.data.split('\n').length === 11 && v.data.split('\n')[6] === 'SK3112000000198742637541', 'dekódovaný text == EPC, 11 řádků, IBAN na 7. řádku');
    }
    {
      const C = Object.assign({}, DATA); C.vs = F.variabilni(C.cislo); C.spayd = F.spayd(C);
      const v = qrBajty(qrMaticeZ(qrcode, C.spayd, 'M'));
      expect(!!v && v.data === C.spayd, 'kontrola: český SPAYD (ASCII) se dekóduje stejně jako dřív');
      const u = qrBajty(qrMaticeZ(qrcode, 'https://example.com/pozvánka/žluťoučký', 'M'));
      expect(!!u && u.data === 'https://example.com/pozvánka/žluťoučký', 'odkaz s diakritikou (QR na přání) se dekóduje beze změny');
    }

    console.log('== F2-06: čištění textu měřené přímo (drawableText) ==');
    {
      const TP = await mod('src/lib/kancelar/textPdf.js');
      const { fonty } = await novyDoc();
      const dt = (x) => (typeof TP.drawableText === 'function' ? TP.drawableText(x, fonty.regular) : '(funkce drawableText není)');
      const je = (vstup, cekano, popis) => expect(dt(vstup) === cekano, `${popis}: ${JSON.stringify(vstup)} → ${JSON.stringify(dt(vstup))}${dt(vstup) === cekano ? '' : ` (čekáno ${JSON.stringify(cekano)})`}`);
      je('Sloupec\tdruhý', 'Sloupec druhý', 'tabulátor → jedna mezera');
      je('ne\u2011dělitelný', 'ne-dělitelný', 'nedělitelný spojovník → „-“');
      je('A 🎯 B', 'A B', 'emoji uprostřed: zmizí i s jednou mezerou');
      je('🎯 Cíle', 'Cíle', 'emoji na začátku: bez úvodní mezery');
      je('Hotovo 🎉', 'Hotovo', 'emoji na konci: bez koncové mezery');
      je('Hotovo🎯 dál', 'Hotovo dál', 'emoji nalepené na slovo: mezera mezi slovy zůstane');
      je('👍🏽 ok 🇨🇿 1️⃣', 'ok 1', 'odstín pleti, vlajka a klávesa nenechají zbytky');
      je('  - 🎯 odsazená odrážka', '  - odsazená odrážka', 'odsazení řádku zůstává');
      je('Tržby ↓ 10 %, zisk ↑', 'Tržby ? 10 %, zisk ?', 'šipky dolů/nahoru se NEpřepisují na písmena („Tržby v 10 %“ by změnilo význam)');
      je('A\u200eB\u202eC\u2066D\u{e0067}E\u200bF', 'ABCDEF', 'neviditelné značky (směr textu, tagy, nulová šířka) zmizí beze stopy');
      je('# 🎯\nText\n- 🚀\nKonec', 'Text\nKonec', 'řádek jen z emoji (i za # nebo odrážkou) se vynechá — žádný prázdný nadpis');
      je('e\u0301 a „úvozovky“ – … € × ½', 'é a „úvozovky“ – … € × ½', 'rozložené písmeno se složí, znaky uvnitř písma beze změny');
      je('Plain ASCII -> ok', 'Plain ASCII -> ok', 'ASCII beze změny');
      je('→ ≥ ✅ ❌ Ж', '-> >= [x] × ?', 'šipka, porovnání, fajfka, křížek, azbuka');
    }

    console.log('== F2-06: znaky mimo písmo se přepíší, nezmizí ==');
    {
      const { doc, fonty } = await novyDoc();
      sestavDokumentPdf({ doc, rgb: PDFLib.rgb, fonty, org: { name: 'Firma 🚀 s.r.o.' }, logo: null, lang: 'cs',
        data: { kind: 'document', title: 'Plán → Q1 ✅', text: '## 🎯 Cíle → Q1\n- ✅ Hotovo: web\n- Привет, мир\n- Tržby ≥ 1 mil. Kč\n- Sloupec\tdruhý a ne‑dělitelný\n- Příliš žluťoučký kůň „úpěl“ – … € × ½' } });
      const t = textZ(await polozky(await doc.save()));
      expect(bezPrazdnych(t), 'dokument: v textu PDF není žádný prázdný glyf (U+0000)');
      expect(/Plán -> Q1 \[x\]/.test(t) && /Cíle -> Q1/.test(t), `šipka → „->“, fajfka → „[x]“, emoji v nadpisu vynecháno (${JSON.stringify(t.slice(0, 80))})`);
      expect(/\[x\] Hotovo: web/.test(t) && /Tržby >= 1 mil\. Kč/.test(t), '„✅ Hotovo“ → „[x] Hotovo“, „≥“ → „>=“');
      expect(/\?{6}, \?{3}/.test(t), 'azbuka → otazníky (viditelná značka, ne prázdné místo)');
      expect(/Sloupec druhý a ne-dělitelný/.test(t), 'tabulátor → mezera, nedělitelný spojovník → „-“');
      expect(/Příliš žluťoučký kůň „úpěl“ – … € × ½/.test(t), 'text uvnitř písma (diakritika, uvozovky, pomlčka, €, ×, ½) beze změny');
      expect(/Firma s\.r\.o\./.test(t), 'název organizace v hlavičce: emoji vynecháno i s mezerou');
    }
    {
      const { doc, fonty } = await novyDoc();
      const img = await doc.embedPng(PNG);
      const obr = { image: img, w: 300, h: 400 };
      // pictures of slides are keyed by the RAW heading from the outline (lib/kancelar/index.js)
      sestavPrezentaciPdf({ doc, rgb: PDFLib.rgb, fonty, lang: 'cs', obrazky: { '📌 Kroky': obr }, ops: PDFLib,
        osnova: parsujOsnovu('# Strategie 🚀 2027\nRůst → zisk\n## 📌 Kroky\n- A → B\n- Marže ≥ 30 %\n> ⚠ pozor na ✓\n## 🎯\n- jen emoji v nadpisu\n## Bez obrázku\n- nic') });
      const bytes = await doc.save();
      const pol = await polozky(bytes);
      const t = textZ(pol);
      expect(bezPrazdnych(t) && /Strategie 2027/.test(t) && /Růst -> zisk/.test(t) && /Kroky/.test(t) && /A -> B/.test(t) && /Marže >= 30 %/.test(t), `prezentace: titul, podtitul, snímek i odrážky přepsané (${JSON.stringify(t.slice(0, 90))})`);
      // images painted per page (pdf.js operator list)
      const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
      const obrazku = [];
      for (let i = 1; i <= d.numPages; i++) { const ops = await (await d.getPage(i)).getOperatorList(); obrazku.push(ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintImageXObjectRepeat || f === pdfjs.OPS.paintInlineImageXObject).length); }
      expect(d.numPages === 4 && obrazku[1] === 1 && obrazku[2] === 0 && obrazku[3] === 0, `AI obrázek snímku „📌 Kroky“ je v PDF i po vyčištění nadpisu (obrázků na stranách: ${obrazku.join(', ')})`);
      const nadpis3 = pol.filter((p) => p.strana === 3 && p.str.trim()).sort((a, b) => b.y - a.y)[0];
      expect(!!nadpis3 && nadpis3.str.trim() === '2', `snímek s nadpisem jen z emoji má místo prázdného nadpisu své číslo (${nadpis3 && JSON.stringify(nadpis3.str)})`);
    }
    {
      const { doc, fonty } = await novyDoc();
      sestavPranicko({ doc, rgb: PDFLib.rgb, fonty, data: { kind: 'card', title: 'Vše nejlepší 🎉', text: 'Ať se daří → nahoru ❤', meta: { template: 'greeting', lang: 'cs', signature: 'Tým ✓' } } });
      const t = textZ(await polozky(await doc.save()));
      expect(bezPrazdnych(t) && /Vše nejlepší/.test(t) && /Ať se daří -> nahoru/.test(t), `přání: text přepsaný, bez prázdných glyfů (${JSON.stringify(t.slice(0, 90))})`);
    }
    {
      const G = Object.assign({}, DATA, { customer: { name: 'ООО Ромашка → Αθήνα', address: 'ул. Ленина 1' }, note: 'Dodáno ✓, sleva ≥ 5 %', items: [{ description: 'Služba 🛠 → balíček', quantity: 1, unit: 'ks', unit_price: 1600, total: 1600 }] });
      G.vs = F.variabilni(G.cislo); G.spayd = F.spayd(G);
      const g = await faktura(G);
      const t = textZ(await polozky(g.bytes));
      expect(bezPrazdnych(t), 'faktura: v textu PDF není žádný prázdný glyf');
      expect(/\?{3} \?{7} -> \?{5}/.test(t) && /Dodáno \[x\], sleva >= 5 %/.test(t) && /Služba -> balíček/.test(t), `faktura: odběratel v azbuce/řečtině jako otazníky, poznámka a položka přepsané (${JSON.stringify(t.slice(t.indexOf('?') - 5, t.indexOf('?') + 30))})`);
      expect(/Jan Novák – konzultace/.test(t) && /Dlouhá 12/.test(t) && /1\s?600,00\s?Kč/.test(t), 'faktura: latinské údaje beze změny');
      const v = g.matice ? qrBajty(g.matice) : null;
      expect(!!v && v.data === G.spayd, 'faktura: QR platba se kóduje ze surových dat (SPAYD beze změny)');
    }

    console.log('== F2-08: dlouhý název se zalomí ==');
    const DLOUHY = 'Základní škola a Mateřská škola Horní Dolní, příspěvková organizace';
    {
      const H = Object.assign({}, DATA, { supplier: Object.assign({}, DATA.supplier, { name: DLOUHY }), customer: Object.assign({}, DATA.customer, { name: 'Sdružení dobrovolných hasičů Čech, Moravy a Slezska – sbor Lhota pod Horou' }) });
      H.vs = F.variabilni(H.cislo); H.spayd = F.spayd(H);
      const h = await faktura(H);
      const pol = (await polozky(h.bytes)).filter((p) => p.strana === 1 && p.str.trim());
      const dod = pol.filter((p) => /Základní škola|příspěvková organizace|Horní Dolní/.test(p.str) && p.y > 600);
      const odb = pol.filter((p) => /Sdružení|hasičů|Lhota pod Horou/.test(p.str) && p.y > 600);
      const xOdb = 42 + (595.28 - 84) / 2 + 10; // the customer column starts here
      expect(dod.length >= 2 && new Set(dod.map((p) => Math.round(p.y))).size >= 2, `název dodavatele je na ${new Set(dod.map((p) => Math.round(p.y))).size} řádcích`);
      expect(dod.length > 0 && dod.every((p) => p.x + p.w <= xOdb - 5), `žádný řádek názvu dodavatele nezasahuje do sloupce odběratele (nejdál ${Math.round(Math.max(0, ...dod.map((p) => p.x + p.w)))} pt, sloupec od ${Math.round(xOdb)} pt)`);
      expect(odb.length >= 2 && odb.every((p) => p.x + p.w <= 595.28 - 42 + 1), `název odběratele zalomený a celý uvnitř okraje strany (nejdál ${Math.round(Math.max(0, ...odb.map((p) => p.x + p.w)))} pt)`);
      const t = textZ(pol);
      expect(/příspěvková organizace/.test(t) && /Lhota pod Horou/.test(t) && /Dlouhá 12/.test(t) && /Krátká 3/.test(t), 'oba názvy celé, adresy pod nimi');
      const adresaDod = pol.find((p) => /Dlouhá 12/.test(p.str)); const posledniDod = Math.min(...dod.map((p) => p.y));
      expect(!!adresaDod && adresaDod.y < posledniDod - 8, 'adresa dodavatele začíná až pod posledním řádkem názvu');
      expect(h.stran === 1, 'faktura zůstala na jedné straně');
    }
    {
      // a short name is drawn exactly where it was (fixture parity is in faktura-pdf.js; here position only)
      const k = await faktura(Object.assign({}, DATA, { spayd: '' }));
      const pol = await polozky(k.bytes);
      const jm = pol.find((p) => p.str === 'Jan Novák – konzultace'); const ad = pol.find((p) => /Dlouhá 12/.test(p.str));
      expect(!!jm && !!ad && Math.abs(jm.x - 42) < 0.5 && Math.abs((jm.y - ad.y) - 14) < 0.5, `krátký název: jeden řádek, adresa 14 pt pod ním (${jm && ad ? (jm.y - ad.y).toFixed(1) : '?'})`);
    }
    {
      const ORG = 'Základní škola a Mateřská škola Horní Dolní u Velkého Meziříčí, příspěvková organizace kraje Vysočina';
      const { doc, fonty } = await novyDoc();
      const img = await doc.embedPng(PNG);
      sestavDokumentPdf({ doc, rgb: PDFLib.rgb, fonty, org: { name: ORG }, logo: { image: img, w: 300, h: 80 }, lang: 'cs', data: { kind: 'document', title: 'Zápis', text: 'Text zápisu.' } });
      const pol = (await polozky(await doc.save())).filter((p) => p.str.trim());
      const hl = pol.filter((p) => p.y > 841.89 - 80);
      const logoX = 595.28 - 56 - 110; // the logo box starts here
      expect(hl.length >= 2 && new Set(hl.map((p) => Math.round(p.y))).size === 2, `hlavička dokumentu: název organizace na 2 řádcích (${new Set(hl.map((p) => Math.round(p.y))).size})`);
      expect(hl.length > 0 && hl.every((p) => p.x + p.w <= logoX - 5), `název organizace nezasahuje do loga (nejdál ${Math.round(Math.max(0, ...hl.map((p) => p.x + p.w)))} pt, logo od ${Math.round(logoX)} pt)`);
      expect(hl.every((p) => p.y > 841.89 - 40 - 40 + 4), 'oba řádky názvu jsou nad linkou hlavičky');
      expect(/Zápis/.test(textZ(pol)) && /Text zápisu/.test(textZ(pol)), 'titul a text dokumentu na místě');
      const d2 = await novyDoc();
      sestavDokumentPdf({ doc: d2.doc, rgb: PDFLib.rgb, fonty: d2.fonty, org: { name: 'Novák s.r.o.' }, logo: null, lang: 'cs', data: { kind: 'document', title: 'Zápis', text: 'Text.' } });
      const kr = (await polozky(await d2.doc.save())).find((p) => p.str === 'Novák s.r.o.');
      expect(!!kr && Math.abs(kr.x - 56) < 0.5 && Math.abs(kr.y - (841.89 - 40 - 12)) < 0.5, `krátký název organizace na původním místě (x ${kr && kr.x.toFixed(1)}, y ${kr && kr.y.toFixed(1)})`);
    }
  } catch (e) { fail++; console.log('  ❌ výjimka:', e && e.stack ? e.stack : e); }
  console.log(`\n${fail ? '🔴' : '🟢'} CHYBY4-PDF PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
