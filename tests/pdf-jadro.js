// PDF v asistentovi (18. 9. 2026) — jádro bez prohlížeče: rozsahy stran, skládání řádků
// z pdf.js items, hledání textu (rozdělené kousky, pevná mezera v ceně, přes řádek),
// sloučit/rozdělit/vyjmout/odebrat a „přelepka“ (nahradText) nad skutečným PDF
// vyrobeným pdf-lib a přečteným pdf.js. Bez dockeru: node product/tests/pdf-jadro.js
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const FE = path.join(__dirname, '../frontend');
const mod = (p) => import(pathToFileURL(path.join(FE, p)).href);
const balik = (p) => import(pathToFileURL(path.join(FE, 'node_modules', p)).href);
const FONTY = path.join(FE, 'public/fonts/pdf');
const nactiFont = async (rez) => new Uint8Array(fs.readFileSync(path.join(FONTY, `${rez}.ttf`)));

// item pdf.js: text na účaří y od x (velikost 12), šířka odhadem 0,5 em/znak
const item = (str, x, y, extra = {}) => ({ str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, height: 12, fontName: 'f1', hasEOL: false, ...extra });

(async () => {
  try {
    const { parsujRozsahy, indexyStran, poJedne } = await mod('src/lib/pdf/rozsahy.js');
    const { sestavRadky, najdiText, bboxFragmentu, textStranky, normalizuj } = await mod('src/lib/pdf/textLayout.js');
    const J = await mod('src/lib/pdf/jadro.js');
    const { KOD } = await mod('src/lib/pdf/chyby.js');

    console.log('== rozsahy stran ==');
    expect(JSON.stringify(parsujRozsahy('1-3, 5, 8-', 10)) === JSON.stringify([{ od: 1, do: 3 }, { od: 5, do: 5 }, { od: 8, do: 10 }]), '„1-3, 5, 8-“ na 10 stranách');
    expect(JSON.stringify(indexyStran(parsujRozsahy('3, 1-2, 2', 5))) === '[0,1,2]', 'indexy od nuly, bez duplicit, seřazené');
    expect(poJedne(3).length === 3 && poJedne(3)[2].od === 3, 'každá strana zvlášť');
    for (const spatne of ['', '0', '4-2', '7', 'a', '1-9', '3 5']) {
      let kod = '';
      try { parsujRozsahy(spatne, 6); } catch (e) { kod = e.kod; }
      expect(kod === KOD.ROZSAH, `odmítne „${spatne}“ (6 stran)`);
    }

    console.log('== řádky z items ==');
    const styles = { f1: { fontFamily: 'sans-serif', ascent: 0.9, descent: -0.2 } };
    const items = [
      item('Cena', 50, 700), item('celkem:', 76, 700), item('12', 200, 700), item('500', 214, 700), item('Kč', 236, 700),
      item('Dodavatel: Truhlářství Novák, Dlouhá 12,', 50, 680),
      item('Praha 4', 50, 664),
      item('Sleva 10\u00a0% platí do 31.\u00a012.', 50, 640),
      item('   ', 50, 620, { width: 0 }),                   // prázdný kousek bez šířky → pryč
      item('OTOČENO', 300, 300, { transform: [0, 12, -12, 0, 300, 300] }), // rotovaný → pryč
    ];
    const { radky } = sestavRadky(items, styles);
    expect(radky.length === 4, `4 řádky (je ${radky.length}), prázdný a rotovaný kousek vynechány`);
    expect(radky[0].text === 'Cena celkem: 12 500 Kč', `první řádek slepený s mezerami: „${radky[0].text}“`);
    expect(radky[0].znaky.length === radky[0].text.length && radky[0].znaky[4].item === -1, 'mapa znak→item, doplněná mezera = item -1');
    expect(textStranky(radky).split('\n').length === 4 && /Sleva 10 % platí do 31\. 12\./.test(textStranky(radky)), 'text pro model má obyčejné mezery místo pevných');
    expect(normalizuj('a\u00a0 \u202fb').text === 'a b', 'normalizace: pevné mezery + sbalení');

    console.log('== hledání ==');
    let v = najdiText(radky, '12 500 Kč');
    expect(v.length === 1 && v[0].fragmenty.length === 1 && v[0].fragmenty[0].radek === 0, 'cena přes tři kousky = jeden výskyt, jeden fragment');
    let b = bboxFragmentu(radky[0], v[0].fragmenty[0].od, v[0].fragmenty[0].do);
    expect(b && Math.abs(b.x0 - 200) < 0.01 && Math.abs(b.x1 - 248) < 0.01, `bbox ceny 200–248 (je ${b && b.x0}–${b && b.x1})`);
    expect(b.posledniNaRadku && b.volnoDo === Infinity && Math.abs(b.y1 - (700 + 0.9 * 12)) < 0.01 && Math.abs(b.y0 - (700 - 2.4)) < 0.01, 'poslední na řádku, výška z ascent/descent');
    v = najdiText(radky, 'celkem');
    b = bboxFragmentu(radky[0], v[0].fragmenty[0].od, v[0].fragmenty[0].do);
    expect(v.length === 1 && Math.abs(b.x0 - 76) < 0.01 && Math.abs(b.x1 - 112) < 0.01 && Math.abs(b.volnoDo - 112) < 0.01 && !b.posledniNaRadku, 'slovo uprostřed: bbox; volné místo končí u dvojtečky hned za ním');
    v = najdiText(radky, 'celkem:');
    b = bboxFragmentu(radky[0], v[0].fragmenty[0].od, v[0].fragmenty[0].do);
    expect(Math.abs(b.volnoDo - 200) < 0.01, 'za „celkem:“ je volno až k další ceně (200)');
    v = najdiText(radky, 'Dlouhá 12, Praha 4');
    expect(v.length === 1 && v[0].fragmenty.length === 2 && v[0].fragmenty[0].radek === 1 && v[0].fragmenty[1].radek === 2, 'věta přes konec řádku = dva fragmenty');
    expect(radky[1].text.slice(v[0].fragmenty[0].od, v[0].fragmenty[0].do) === 'Dlouhá 12,' && radky[2].text.slice(v[0].fragmenty[1].od, v[0].fragmenty[1].do) === 'Praha 4', 'fragmenty ukazují na správné kusy textu');
    v = najdiText(radky, 'platí do 31. 12.');
    expect(v.length === 1, 'hledání s obyčejnou mezerou najde text s pevnou mezerou');
    expect(najdiText(radky, 'CENA CELKEM').length === 1, 'bez rozlišení velikosti písmen jako záloha');
    expect(najdiText(radky, 'neexistuje').length === 0 && najdiText(radky, '').length === 0, 'nenalezeno / prázdné = nic');
    // částečný kousek: hledání „500“ uvnitř items → bbox jen části
    v = najdiText(radky, '500 Kč');
    b = bboxFragmentu(radky[0], v[0].fragmenty[0].od, v[0].fragmenty[0].do, (t, s) => t.length * s / 2);
    expect(Math.abs(b.x0 - 214) < 0.01, 'začátek bboxu na druhém kousku (214)');
    // spojovník na konci řádku
    const r2 = sestavRadky([item('Dlouhodobý pro-', 50, 700), item('dukt firmy', 50, 684)], styles).radky;
    expect(najdiText(r2, 'produkt firmy').length === 1, 'slovo rozdělené spojovníkem přes řádek');

    console.log('== skutečné PDF (pdf-lib → pdf.js) ==');
    const PDFLib = await balik('pdf-lib/dist/pdf-lib.esm.js');
    const fontkit = (await balik('@pdf-lib/fontkit/dist/fontkit.es.js')).default;
    const pdfjs = await balik('pdfjs-dist/legacy/build/pdf.mjs');
    // faktura: embedovaný TTF (jako z Wordu), věta přes dva řádky, částka vpravo
    const vyrob = async (radkyTextu) => {
      const doc = await PDFLib.PDFDocument.create();
      doc.registerFontkit(fontkit);
      const f = await doc.embedFont(await nactiFont('LiberationSans-Regular'), { subset: true });
      const p = doc.addPage([595, 842]);
      let y = 760;
      for (const t of radkyTextu) { p.drawText(t, { x: 50, y, size: 12, font: f }); y -= 18; }
      p.drawText('12 500 Kč', { x: 400, y: 760, size: 12, font: f });
      const p2 = doc.addPage([595, 842]);
      p2.drawText('Druhá strana — příloha k nabídce č. 2026/118', { x: 50, y: 760, size: 12, font: f });
      doc.addPage([595, 842]);
      return doc.save();
    };
    const pdf = await vyrob(['Cena celkem:', 'Dodavatel: Truhlářství Novák, Dlouhá 12,', 'Praha 4', 'Platnost nabídky do 31. 12. 2026.']);
    const t1 = await J.nactiText({ pdfjs, bytes: pdf });
    expect(t1.pocetStran === 3 && t1.strany[0].text.includes('Cena celkem: 12 500 Kč') && t1.strany[1].text.includes('Druhá strana'), `text stran přečten (${t1.strany[0].text.split('\n')[0]})`);
    expect(JSON.stringify(t1.stranyBezTextu) === '[3]', 'prázdná třetí strana = bez textu (sken)');
    expect(!('rotovanych' in t1), 'výstup nactiText bez mrtvých polí');
    expect(J.jePdf(pdf) && !J.jePdf(new Uint8Array([1, 2, 3, 4, 5, 6])), 'rozpoznání %PDF-');

    const slouceno = await J.sloucit({ PDFLib, soubory: [pdf, pdf] });
    expect(await J.pocetStran({ PDFLib, bytes: slouceno }) === 6, 'sloučení 3+3 = 6 stran');
    const kusy = await J.rozdelit({ PDFLib, bytes: pdf, rozsahy: parsujRozsahy('1, 2-3', 3) });
    expect(kusy.length === 2 && await J.pocetStran({ PDFLib, bytes: kusy[0] }) === 1 && await J.pocetStran({ PDFLib, bytes: kusy[1] }) === 2, 'rozdělení „1, 2-3“ → 1 + 2 strany');
    const vyjmuto = await J.vyjmout({ PDFLib, bytes: pdf, rozsahy: parsujRozsahy('2', 3) });
    const tv = await J.nactiText({ pdfjs, bytes: vyjmuto });
    expect(tv.pocetStran === 1 && tv.strany[0].text.includes('Druhá strana'), 'vyjmutí strany 2 nese její text');
    const bez = await J.odebrat({ PDFLib, bytes: pdf, rozsahy: parsujRozsahy('1', 3) });
    const tb = await J.nactiText({ pdfjs, bytes: bez });
    expect(tb.pocetStran === 2 && tb.strany[0].text.includes('Druhá strana'), 'odebrání strany 1 → zbylé dvě v pořadí');
    let kod = '';
    try { await J.odebrat({ PDFLib, bytes: pdf, rozsahy: parsujRozsahy('1-3', 3) }); } catch (e) { kod = e.kod; }
    expect(kod === KOD.ROZSAH, 'odebrat všechny strany = chyba');
    kod = '';
    try { await J.sloucit({ PDFLib, soubory: [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])] }); } catch (e) { kod = e.kod; }
    expect(kod === KOD.NENI_PDF, 'ne-PDF odmítnuto');

    console.log('== přelepka ==');
    const vys = await J.nahradText({
      pdfjs, PDFLib, fontkit, bytes: pdf, nactiFont,
      nahrady: [
        { page: 1, find: '12 500 Kč', replace: '13 200 Kč' },
        { page: 1, find: 'Truhlářství Novák', replace: 'Truhlářství Nováková' },
        { page: 1, find: 'Dlouhá 12, Praha 4', replace: 'Krátká 7, Brno' },
        { page: 1, find: 'tohle tam není', replace: 'x' },
        { page: 1, find: 'Platnost nabídky do 31. 12. 2026.', replace: 'Platnost nabídky do 31. 12. 2026 je omezena množstvím skladových zásob a dalšími podmínkami uvedenými níže v této nabídce a jejích přílohách.' },
        { page: 9, find: 'Cena', replace: 'x' },
      ],
    });
    expect(vys.provedeno.length === 3 && vys.nenalezeno.length === 3, `3 provedené, 3 neprovedené (je ${vys.provedeno.length}/${vys.nenalezeno.length})`);
    expect(vys.nenalezeno.some((n) => n.find === 'tohle tam není' && n.kod === KOD.NENALEZENO), 'neexistující text = nenalezeno');
    expect(vys.nenalezeno.some((n) => n.kod === KOD.NEVEJDE_SE), 'moc dlouhý text = nevejde se (ani po zmenšení na 85 %)');
    expect(vys.nenalezeno.some((n) => n.page === 9), 'strana mimo rozsah = nenalezeno');
    expect(JSON.stringify(vys.strany) === '[1]', 'dotčené strany');
    const t2 = await J.nactiText({ pdfjs, bytes: vys.bytes });
    const txt = t2.strany[0].text;
    expect(txt.includes('13 200 Kč') && txt.includes('Nováková') && txt.includes('Krátká 7,') && txt.includes('Brno'), `nový text je v PDF čitelný: ${txt.replace(/\n/g, ' | ')}`);
    expect(t2.pocetStran === 3 && t2.strany[1].text.includes('Druhá strana'), 'ostatní strany beze změny');
    // poctivé omezení: původní text zůstává pod přelepkou
    expect(txt.includes('12 500 Kč'), 'původní text zůstává v souboru pod přelepkou (známé omezení v1)');
    // zmenšení: text o něco delší se zmenší, ne odmítne
    const vys2 = await J.nahradText({ pdfjs, PDFLib, fontkit, bytes: pdf, nactiFont, nahrady: [{ page: 1, find: 'Praha 4', replace: 'Praha 4 – Nusle' }] });
    expect(vys2.provedeno.length === 1 && vys2.provedeno[0].zmenseno === 0, 'delší text s volným místem vpravo se nezmenšuje');
    const vys3 = await J.nahradText({ pdfjs, PDFLib, fontkit, bytes: pdf, nactiFont, nahrady: [{ page: 1, find: 'Cena celkem:', replace: 'Cena celkem s DPH:' }] });
    expect(vys3.provedeno.length === 1 && !vys3.provedeno[0].zbytekRadku, 'delší text před částkou se vejde do volného místa');
    // delší jméno UVNITŘ řádku: nesmí přepsat „Dlouhá 12,“ → překreslí se zbytek řádku
    const t3 = await J.nactiText({ pdfjs, bytes: vys.bytes });
    expect(/Truhlářství Nováková Krátká 7,|Nováková, Dlouhá 12,/.test(t3.strany[0].text.replace(/\n/g, ' ')), 'zbytek řádku za delším jménem je v PDF znovu vykreslený (ne přepsaný)');
    expect(vys.provedeno.find((x) => x.find === 'Truhlářství Novák').zbytekRadku === true, 'náhrada hlásí překreslený zbytek řádku');
    expect(vys.provedeno.find((x) => x.find === '12 500 Kč').zbytekRadku === false, 'částka na konci řádku zbytek nepotřebuje');
    // model pošle celý řádek → přelepí se jen změněná část (částka vpravo zůstane zarovnaná)
    const { zuzNahradu } = await mod('src/lib/pdf/textLayout.js');
    const rz = sestavRadky([item('Kuchyňská linka dub, 4 m', 56, 640), item('12 500 Kč', 480, 640)], styles).radky;
    const vz = najdiText(rz, 'Kuchyňská linka dub, 4 m 12 500 Kč');
    const z = zuzNahradu(rz, vz[0], 'Kuchyňská linka dub, 4 m 13 200 Kč');
    expect(z.zuzeno && z.replace === '13 200 Kč' && rz[0].text.slice(z.fragmenty[0].od, z.fragmenty[0].do) === '12 500 Kč', `zúžení na změněnou část: „${rz[0].text.slice(z.fragmenty[0].od, z.fragmenty[0].do)}“ → „${z.replace}“`);
    const z2 = zuzNahradu(rz, vz[0], 'Úplně jiný text');
    expect(!z2.zuzeno && z2.replace === 'Úplně jiný text', 'bez společné části se nezužuje');
    const z3 = zuzNahradu(rz, vz[0], 'Kuchyňská linka buk, 4 m 12 500 Kč');
    expect(z3.zuzeno && z3.replace === 'buk,' && rz[0].text.slice(z3.fragmenty[0].od, z3.fragmenty[0].do) === 'dub,', 'změna uprostřed = jen to slovo');
    const vys4 = await J.nahradText({ pdfjs, PDFLib, fontkit, bytes: pdf, nactiFont, nahrady: [{ page: 1, find: 'Cena celkem: 12 500 Kč', replace: 'Cena celkem: 13 200 Kč' }] });
    expect(vys4.provedeno.length === 1 && vys4.provedeno[0].zuzeno === '13 200 Kč' && !vys4.provedeno[0].zbytekRadku, 'nahradText celý řádek → přelepí jen částku');
    // dvě náhrady na témž řádku (jméno z první karty + město z druhé) = jedno překreslení, ne dvě přes sebe
    const vys5 = await J.nahradText({ pdfjs, PDFLib, fontkit, bytes: pdf, nactiFont, nahrady: [{ page: 1, find: 'Truhlářství Novák', replace: 'Truhlářství Nováková', klic: 'drive' }, { page: 1, find: 'Dlouhá 12', replace: 'Krátká 7' }] });
    expect(vys5.provedeno.length === 2 && vys5.provedeno.every((x) => x.slouceno) && vys5.provedeno[0].klic === 'drive' && vys5.provedeno[1].klic === undefined, 'obě náhrady provedeny jako sloučené, klíč prošel');
    const t5 = (await J.nactiText({ pdfjs, bytes: vys5.bytes })).strany[0].text;
    expect(/Nováková, Krátká 7/.test(t5), `sloučený řádek je v PDF vcelku: ${t5.split('\n')[1]}`);
    const vys6 = await J.nahradText({ pdfjs, PDFLib, fontkit, bytes: pdf, nactiFont, nahrady: [{ page: 1, find: 'Truhlářství Novák, Dlouhá', replace: 'X' }, { page: 1, find: 'Novák, Dlouhá 12', replace: 'Y' }] });
    expect(vys6.provedeno.length === 1 && vys6.nenalezeno.length === 1, 'překrývající se náhrady na řádku: první projde, druhá se poctivě odmítne');
    // barvy: bílé písmo na tmavém pruhu — přelepka musí mít tmavé pozadí a světlý text (ne „nejtmavší pixel“)
    const { createCanvas } = await balik('@napi-rs/canvas/index.js');
    const docT = await PDFLib.PDFDocument.create(); docT.registerFontkit(fontkit);
    const fT = await docT.embedFont(await nactiFont('LiberationSans-Bold'), { subset: true });
    const pT = docT.addPage([595, 842]);
    pT.drawRectangle({ x: 40, y: 600, width: 515, height: 30, color: PDFLib.rgb(0.15, 0.2, 0.35) });
    pT.drawText('CELKEM K ÚHRADĚ', { x: 50, y: 610, size: 12, font: fT, color: PDFLib.rgb(1, 1, 1) });
    pT.drawText('14 500 Kč', { x: 470, y: 610, size: 12, font: fT, color: PDFLib.rgb(1, 1, 1) });
    pT.drawText('Poznámka pod pruhem', { x: 50, y: 560, size: 12, font: fT });
    const pdfT = await docT.save();
    const vzB = J.vzorkovacBarev(pdfjs, pdfT, (w, h) => createCanvas(w, h));
    const vysT = await J.nahradText({ pdfjs, PDFLib, fontkit, bytes: pdfT, nactiFont, vzorkujBarvy: vzB, nahrady: [{ page: 1, find: '14 500 Kč', replace: '15 200 Kč' }, { page: 1, find: 'Poznámka', replace: 'Dodatek' }] });
    await vzB.zavri();
    expect(vysT.provedeno.length === 2, 'obě náhrady na tmavém pruhu i pod ním provedeny');
    // vyrenderovat výsledek a změřit pixely v místě částky (pruh y 600–630 → plátno shora 212–242 při scale 1)
    const dT = await pdfjs.getDocument({ data: vysT.bytes.slice(0) }).promise;
    const pgT = await dT.getPage(1); const vpT = pgT.getViewport({ scale: 2 });
    const cT = createCanvas(Math.ceil(vpT.width), Math.ceil(vpT.height)); const ctxT = cT.getContext('2d');
    await pgT.render({ canvasContext: ctxT, viewport: vpT }).promise;
    const oblast = ctxT.getImageData(470 * 2, (842 - 626) * 2, 70 * 2, 20 * 2).data;
    let tmave = 0, svetle = 0;
    for (let i = 0; i < oblast.length; i += 4) { const s3 = oblast[i] + oblast[i + 1] + oblast[i + 2]; if (s3 < 300) tmave++; else if (s3 > 600) svetle++; }
    expect(tmave > svetle * 2 && svetle > 30, `přelepka částky: tmavé pozadí (${tmave} px) se světlým písmem (${svetle} px)`);
    const pod = ctxT.getImageData(50 * 2, (842 - 574) * 2, 60 * 2, 16 * 2).data;
    let bile = 0, cerne = 0;
    for (let i = 0; i < pod.length; i += 4) { const s3 = pod[i] + pod[i + 1] + pod[i + 2]; if (s3 > 700) bile++; else if (s3 < 200) cerne++; }
    expect(bile > cerne * 2 && cerne > 30, `přelepka pod pruhem: bílé pozadí (${bile} px) s tmavým písmem (${cerne} px)`);
    await dT.destroy();
    // zamčené PDF (jen heslo vlastníka = zákaz úprav, typický výstup účetních programů): pdf.js text přečte,
    // pdf-lib ho neuloží → přílohová cesta to musí říct hned (fixture: pypdf RC4, uživatelské heslo prázdné)
    const zamcene = new Uint8Array(Buffer.from('JVBERi0xLjcKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgPDUxYjgzMDg3YmI+Cj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9UeXBlIC9QYWdlcwovQ291bnQgMQovS2lkcyBbIDQgMCBSIF0KPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL0NhdGFsb2cKL1BhZ2VzIDIgMCBSCi9PdXRsaW5lcyA3IDAgUgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQovUmVzb3VyY2VzIDw8Ci9Gb250IDw8Ci9IZWx2ZXRpY2EtNzA5ODQ4MDc4OSA1IDAgUgo+PgovWE9iamVjdCA8PAo+PgovRXh0R1N0YXRlIDw8Cj4+Cj4+Ci9NZWRpYUJveCBbIDAgMCAzMDAgMjAwIF0KL0NvbnRlbnRzIFsgNiAwIFIgXQovUGFyZW50IDIgMCBSCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMQovQmFzZUZvbnQgL0hlbHZldGljYQovRW5jb2RpbmcgL1dpbkFuc2lFbmNvZGluZwo+PgplbmRvYmoKNiAwIG9iago8PAovRmlsdGVyIC9GbGF0ZURlY29kZQovTGVuZ3RoIDE1MQo+PgpzdHJlYW0KMILJJrA8GLf3gqd7LeMIfN58dsp9FUWLO10phNjlkPIh1CEIcg1NTSS+isMBSbSWcrl0viM0wWnKzFwt8NuSFJ7/2IVw7qseurD/yx++fdcLO8QMhABm4TizI3/n3iP58Xl7qncdB9V8FIOpxG3Q3d3+5JOQzeP+u1rE8z+S/fR8CaaBhlNawofLQEvEpq9HMhXQLfSc5QplbmRzdHJlYW0KZW5kb2JqCjcgMCBvYmoKPDwKPj4KZW5kb2JqCjggMCBvYmoKPDwKL1YgMgovUiAzCi9MZW5ndGggMTI4Ci9QIDQyOTQ5NjcyOTIKL0ZpbHRlciAvU3RhbmRhcmQKL08gPDA4OTkwNGY0OTFkMWJhOTA4YjUxYzM2OTJjYjNkYTcxNWUyNjdkOTc2OTg0YmFhZmM3Y2FlNGQyZDM2MjE0NTA+Ci9VIDwxZTJmODAwMDM0OTgyMGEyZDAxY2MyYzlmMGJhMjc5NjI4YmY0ZTVlNGU3NThhNDE2NDAwNGU1NmZmZmEwMTA4Pgo+PgplbmRvYmoKeHJlZgowIDkKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDAwNTkgMDAwMDAgbiAKMDAwMDAwMDExOCAwMDAwMCBuIAowMDAwMDAwMTgzIDAwMDAwIG4gCjAwMDAwMDAzNjUgMDAwMDAgbiAKMDAwMDAwMDQ2MiAwMDAwMCBuIAowMDAwMDAwNjg1IDAwMDAwIG4gCjAwMDAwMDA3MDYgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA5Ci9Sb290IDMgMCBSCi9JbmZvIDEgMCBSCi9JRCBbIDwzNTM5MzA2NDYyMzEzNjMxNjI2NDMyMzUzODY2NjYzOTY1Mzc2MzY2Mzk2NjY0MzMzMzY2NjE2NjY0NjIzNzM3PiA8MzUzOTMwNjQ2MjMxMzYzMTYyNjQzMjM1Mzg2NjY2Mzk2NTM3NjM2NjM5NjY2NDMzMzM2NjYxNjY2NDYyMzczNz4gXQovRW5jcnlwdCA4IDAgUgo+PgpzdGFydHhyZWYKOTIxCiUlRU9GCg==', 'base64'));
    const tz = await J.nactiText({ pdfjs, bytes: zamcene });
    expect(tz.pocetStran === 1 && /12 500 Kc/.test(tz.strany[0].text), 'zamčené PDF: pdf.js text přečte');
    kod = '';
    try { await J.pocetStran({ PDFLib, bytes: zamcene }); } catch (e) { kod = e.kod; }
    expect(kod === KOD.SIFROVANO, 'zamčené PDF: pdf-lib → kód sifrovano (příloha se odmítne hned, ne až na kartě)');
    kod = '';
    try { await J.sloucit({ PDFLib, soubory: [pdf, zamcene] }); } catch (e) { kod = e.kod; }
    expect(kod === KOD.SIFROVANO, 'sloučení se zamčeným PDF = sifrovano');
    expect(J.vyberRez('g_d0_f1', 'serif') === 'LiberationSerif-Regular' && J.vyberRez('ABCDEF+Calibri-Bold', 'sans-serif') === 'LiberationSans-Bold' && J.vyberRez('TimesNewRoman,BoldItalic', '') === 'LiberationSerif-BoldItalic', 'výběr řezu náhradního písma');
  } catch (err) {
    fail++;
    console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
  }
  console.log(`\n${fail === 0 ? '🟢' : '🔴'} PDF JÁDRO PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
