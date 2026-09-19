// Operace nad PDF v prohlížeči — sloučit, rozdělit, vyjmout, odebrat, přečíst
// text, opravit text „přelepkou“. Knihovny (pdf.js, pdf-lib, fontkit) a
// prostředí (načtení fontu, vzorkování barev) dostává jako parametry, takže
// totéž jádro běží v prohlížeči (index.js) i v node unit testu bez DOMu.
import { ChybaPdf, KOD } from './chyby.js';
import { indexyStran } from './rozsahy.js';
import { sestavRadky, textStranky, najdiText, bboxFragmentu, konecTextu, zuzNahradu } from './textLayout.js';

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
export function jePdf(bytes) {
  const b = new Uint8Array(bytes);
  // některé generátory dají před hlavičku pár bajtů — pdf.js toleruje do 1024
  const n = Math.min(b.length - 5, 1024);
  for (let i = 0; i <= n; i++) { let ok = true; for (let k = 0; k < 5; k++) if (b[i + k] !== MAGIC[k]) { ok = false; break; } if (ok) return true; }
  return false;
}

// pdf-lib: načíst dokument; šifrované odmítnout (s ignoreEncryption by se uložil rozbitý soubor)
async function nactiLib(PDFLib, bytes) {
  try {
    return await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    if (/encrypt/i.test(String(err && err.message)) || (err && err.constructor && /Encrypted/.test(err.constructor.name))) throw new ChybaPdf(KOD.SIFROVANO);
    throw new ChybaPdf(KOD.POSKOZENO, String(err && err.message));
  }
}

async function nactiJs(pdfjs, bytes) {
  try {
    // pdf.js si buffer přenese do workeru (odpojí ho) → vždy kopie
    return await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(0), isEvalSupported: false }).promise;
  } catch (err) {
    const n = String(err && err.name);
    if (n === 'PasswordException') throw new ChybaPdf(KOD.SIFROVANO);
    throw new ChybaPdf(KOD.POSKOZENO, String(err && err.message));
  }
}

const PUA = /[\ue000-\uf8ff]/g;

// Text všech stran (pro model) + diagnostika skenu / nečitelného fontu.
// Vrací { pocetStran, strany:[{page, text}], stranyBezTextu:[], necitelne:[] } — sken = strana skoro bez
// znaků; nečitelná = font bez převodu na znaky (PUA), model by dostal paskvil
export async function nactiText({ pdfjs, bytes }) {
  if (!jePdf(bytes)) throw new ChybaPdf(KOD.NENI_PDF);
  const doc = await nactiJs(pdfjs, bytes);
  const strany = [];
  const stranyBezTextu = [];
  const necitelne = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent({ disableNormalization: true });
      const { radky } = sestavRadky(tc.items, tc.styles);
      const text = textStranky(radky);
      const znaku = text.replace(/\s/g, '').length;
      if (znaku < 5) stranyBezTextu.push(p); // i strana jen s nadpisem je „s textem“ (20 bylo moc)
      else if ((text.match(PUA) || []).length > 0.3 * znaku) necitelne.push(p);
      strany.push({ page: p, text });
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return { pocetStran: strany.length, strany, stranyBezTextu, necitelne };
}

// sloučit víc PDF v daném pořadí
export async function sloucit({ PDFLib, soubory }) {
  const out = await PDFLib.PDFDocument.create();
  for (const bytes of soubory) {
    if (!jePdf(bytes)) throw new ChybaPdf(KOD.NENI_PDF);
    const src = await nactiLib(PDFLib, bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const pg of pages) out.addPage(pg);
  }
  return out.save({ useObjectStreams: true });
}

// jeden nový dokument z vybraných indexů stran (od nuly)
async function vyberStran(PDFLib, src, indexy) {
  const out = await PDFLib.PDFDocument.create();
  const pages = await out.copyPages(src, indexy);
  for (const pg of pages) out.addPage(pg);
  return out.save({ useObjectStreams: true });
}

// rozdělit podle rozsahů → jeden soubor na rozsah
export async function rozdelit({ PDFLib, bytes, rozsahy }) {
  if (!jePdf(bytes)) throw new ChybaPdf(KOD.NENI_PDF);
  const src = await nactiLib(PDFLib, bytes);
  const out = [];
  for (const r of rozsahy) out.push(await vyberStran(PDFLib, src, indexyStran([r])));
  return out;
}

// vyjmout vybrané strany do jednoho souboru
export async function vyjmout({ PDFLib, bytes, rozsahy }) {
  if (!jePdf(bytes)) throw new ChybaPdf(KOD.NENI_PDF);
  const src = await nactiLib(PDFLib, bytes);
  return vyberStran(PDFLib, src, indexyStran(rozsahy));
}

// odebrat vybrané strany (zbytek zůstane v pořadí)
export async function odebrat({ PDFLib, bytes, rozsahy }) {
  if (!jePdf(bytes)) throw new ChybaPdf(KOD.NENI_PDF);
  const src = await nactiLib(PDFLib, bytes);
  const pryc = new Set(indexyStran(rozsahy));
  const zbytek = src.getPageIndices().filter((i) => !pryc.has(i));
  if (!zbytek.length) throw new ChybaPdf(KOD.ROZSAH, 'vse');
  return vyberStran(PDFLib, src, zbytek);
}

export async function pocetStran({ PDFLib, bytes }) {
  if (!jePdf(bytes)) throw new ChybaPdf(KOD.NENI_PDF);
  const src = await nactiLib(PDFLib, bytes);
  return src.getPageCount();
}

// ---------- oprava textu (přelepka) ----------
// Výběr řezu náhradního písma podle fontu v PDF: patkové (Times, Georgia,
// Cambria, Garamond, Book…) → Liberation Serif, jinak Liberation Sans;
// Bold/Italic z názvu fontu (pdf.js dává jen interní jméno g_d0_f1, ale
// `fontFamily` ze styles a u některých PDF i skutečný název).
export function vyberRez(fontName, fontFamily) {
  const s = `${fontName || ''} ${fontFamily || ''}`.toLowerCase();
  const serif = /serif(?!\s*sans)|times|georgia|cambria|garamond|book|palatino|minion|century|roman/.test(s) && !/sans/.test(s);
  const bold = /bold|black|heavy|semibold|demi/.test(s);
  const italic = /italic|oblique/.test(s);
  return `Liberation${serif ? 'Serif' : 'Sans'}-${bold && italic ? 'BoldItalic' : bold ? 'Bold' : italic ? 'Italic' : 'Regular'}`;
}

// Barva textu a pozadí pod nalezeným textem: vyrenderovat stranu a vzorkovat —
// pdf.js barvu v getTextContent nedává. Pozadí = medián úzkého pásu nad a pod
// obdélníkem; text = pixel v obdélníku NEJVZDÁLENĚJŠÍ od pozadí (ne „nejtmavší“ —
// světlé písmo na tmavém pruhu, typicky „CELKEM K ÚHRADĚ“, by jinak zmizelo).
// Souřadnice přes viewport (CropBox s posunem, otočená strana). Na obrázku/gradientu
// je to jen odhad. Jeden otevřený dokument pro všechny strany opravy; `vytvorCanvas(w, h)`
// dodá plátno (prohlížeč: <canvas>, node test: @napi-rs/canvas).
export function vzorkovacBarev(pdfjs, bytes, vytvorCanvas) {
  const cache = new Map();
  let docP = null;
  const dokument = () => (docP ||= pdfjs.getDocument({ data: new Uint8Array(bytes).slice(0), isEvalSupported: false }).promise);
  const render = async (page) => {
    if (cache.has(page)) return cache.get(page);
    const pg = await (await dokument()).getPage(page);
    const vp = pg.getViewport({ scale: 2 });
    const canvas = vytvorCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const r = { ctx, vp, sirka: canvas.width, vyska: canvas.height };
    cache.set(page, r);
    return r;
  };
  // pixely obdélníku (jen uvnitř plátna; průhledné = mimo stranu se vynechají)
  const pixely = (r, x, y, w, h) => {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(r.sirka, Math.round(x + w)), y1 = Math.min(r.vyska, Math.round(y + h));
    if (x1 <= x0 || y1 <= y0) return [];
    const d = r.ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const out = [];
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  };
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const kontrastni = (poz) => (poz[0] + poz[1] + poz[2] > 384 ? [0, 0, 0] : [255, 255, 255]);
  const vzorkuj = async (page, boxy) => {
    try {
      const r = await render(page);
      // obdélník v souřadnicích PDF (y nahoru) → plátno (y dolů), i s posunem/otočením strany
      const b = boxy[0];
      const [ax, ay] = r.vp.convertToViewportPoint(b.x0, b.y1);
      const [bx, by] = r.vp.convertToViewportPoint(b.x1, b.y0);
      const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay);
      const pas = 6;
      const okolo = [...pixely(r, x - pas, y - pas, w + 2 * pas, pas), ...pixely(r, x - pas, y + h, w + 2 * pas, pas)];
      const pozadi = okolo.length ? [median(okolo.map((p) => p[0])), median(okolo.map((p) => p[1])), median(okolo.map((p) => p[2]))] : [255, 255, 255];
      let text = kontrastni(pozadi);
      let max = -1;
      for (const p of pixely(r, x, y, w, h)) {
        const d = Math.abs(p[0] - pozadi[0]) + Math.abs(p[1] - pozadi[1]) + Math.abs(p[2] - pozadi[2]);
        if (d > max) { max = d; text = p; }
      }
      if (max < 60) text = kontrastni(pozadi); // v obdélníku není nic → kontrastní výchozí
      return { text: text.map((c) => c / 255), pozadi: pozadi.map((c) => c / 255) };
    } catch {
      return null; // bez vzorkování: černá na bílé
    }
  };
  vzorkuj.zavri = async () => { try { if (docP) await (await docP).destroy(); } catch { /* už zavřeno */ } };
  return vzorkuj;
}

const MIN_ZMENSENI = 0.85;
const jeCislo = (s) => /\d/.test(s);

// Nahradí text v PDF. nahrady: [{page, find, replace, klic?}] — přelepí se PRVNÍ výskyt (u duplicit má model použít ask_user)
// nactiFont(rez) → Uint8Array TTF; vzorkujBarvy?(pageIndex, bbox) → {text:[r,g,b], pozadi:[r,g,b]} (0–1)
// Vrací { bytes, provedeno:[{page, find, replace, zmenseno}], nenalezeno:[{page, find, kod}] , strany:[dotčené] }
export async function nahradText({ pdfjs, PDFLib, fontkit, bytes, nahrady, nactiFont, vzorkujBarvy }) {
  if (!jePdf(bytes)) throw new ChybaPdf(KOD.NENI_PDF);
  const lib = await nactiLib(PDFLib, bytes);
  const js = await nactiJs(pdfjs, bytes);
  lib.registerFontkit(fontkit);
  const fonty = new Map();
  const font = async (rez) => {
    if (!fonty.has(rez)) fonty.set(rez, await lib.embedFont(await nactiFont(rez), { subset: true }));
    return fonty.get(rez);
  };
  const radkyStran = new Map();
  const radky = async (p) => {
    if (!radkyStran.has(p)) {
      const page = await js.getPage(p);
      const tc = await page.getTextContent({ disableNormalization: true });
      // skutečná jména fontů (řez Bold/Italic, patky) zná pdf.js až po rozboru stránky
      const styles = Object.assign({}, tc.styles || {});
      try {
        await page.getOperatorList();
        for (const it of tc.items) {
          const fn = it && it.fontName;
          if (fn && !(styles[fn] && styles[fn].nazev) && page.commonObjs.has(fn)) {
            const o = page.commonObjs.get(fn);
            if (o && o.name) styles[fn] = Object.assign({}, styles[fn] || {}, { nazev: String(o.name) });
          }
        }
      } catch { /* bez jmen fontů: řez podle fontFamily */ }
      radkyStran.set(p, sestavRadky(tc.items, styles).radky);
      page.cleanup();
    }
    return radkyStran.get(p);
  };
  const provedeno = [];
  const nenalezeno = [];
  const strany = new Set();
  try {
    // 1) najít výskyty; `klic` = průchozí označení volajícího (karta jím odliší náhrady z dřívějších karet)
    const polozky = [];
    for (const n of nahrady || []) {
      const p = Number(n.page);
      const find = String(n.find || '');
      const replace = String(n.replace ?? '');
      const znacka = n && n.klic !== undefined ? { klic: n.klic } : {};
      const zaklad = { page: p, find, replace, ...znacka };
      if (!(p >= 1 && p <= lib.getPageCount()) || !find) { nenalezeno.push({ ...zaklad, kod: KOD.NENALEZENO }); continue; }
      const r = await radky(p);
      const vysk = najdiText(r, find);
      if (!vysk.length) { nenalezeno.push({ ...zaklad, kod: KOD.NENALEZENO }); continue; }
      polozky.push({ p, r, fragmenty: vysk[0].fragmenty, replace, casti: [zaklad] });
    }
    // 2) víc náhrad na TÉMŽE řádku (např. jméno z první karty a město z druhé) se slije do jedné
    //    — jinak by druhá přelepka malovala přes zbytek řádku, který první už překreslila posunutý
    const sloucene = [];
    const skupiny = new Map();
    for (const it of polozky) {
      if (it.fragmenty.length !== 1) { sloucene.push(it); continue; }
      const k = it.p + ':' + it.fragmenty[0].radek;
      if (!skupiny.has(k)) { skupiny.set(k, []); }
      skupiny.get(k).push(it);
    }
    for (const sk of skupiny.values()) {
      if (sk.length === 1) { sloucene.push(sk[0]); continue; }
      sk.sort((a, b) => a.fragmenty[0].od - b.fragmenty[0].od);
      const radek = sk[0].r[sk[0].fragmenty[0].radek];
      const platne = [];
      let konecPred = -1;
      for (const it of sk) {
        const fr = it.fragmenty[0];
        if (fr.od < konecPred) { nenalezeno.push({ ...it.casti[0], kod: KOD.NENALEZENO }); continue; } // překrývá se s předchozí → nejde obojí
        platne.push(it); konecPred = fr.do;
      }
      const od = platne[0].fragmenty[0].od;
      const doo = platne[platne.length - 1].fragmenty[0].do;
      let text = '';
      let poz = od;
      for (const it of platne) { const fr = it.fragmenty[0]; text += radek.text.slice(poz, fr.od) + it.replace; poz = fr.do; }
      text += radek.text.slice(poz, doo);
      sloucene.push({ p: sk[0].p, r: sk[0].r, fragmenty: [{ radek: sk[0].fragmenty[0].radek, od, do: doo }], replace: text, casti: platne.map((x) => x.casti[0]) });
    }
    // 3) přelepky
    for (const it0 of sloucene) {
      const { p, r, casti } = it0;
      const replace = it0.replace;
      const page = lib.getPage(p - 1);
      const nenal = (kod) => { for (const c of casti) nenalezeno.push({ ...c, kod }); };
      {
        // přelepit jen změněnou část (celý řádek od modelu → jen částka / jméno)
        const zuz = zuzNahradu(r, { fragmenty: it0.fragmenty }, replace);
        const v = { fragmenty: zuz.fragmenty };
        const replaceJadro = zuz.replace;
        const prvniFr = v.fragmenty[0];
        const prvniRadek = r[prvniFr.radek];
        const prvniZnak = prvniRadek.znaky.slice(prvniFr.od, prvniFr.do).find((z) => z.item >= 0);
        const it = prvniZnak ? prvniRadek.items[prvniZnak.item] : prvniRadek.items[0];
        const f = await font(vyberRez(it.fontName, it.fontFamily));
        const sirka = (text, size) => f.widthOfTextAtSize(text, size);
        // rozdělit nový text do fragmentů (slova) podle místa; poslední fragment smí
        // růst doprava až k dalšímu znaku / kousku textu / okraji stránky
        const okraj = page.getWidth() - 12;
        const spocitej = (fragmenty, text) => {
          const boxy = fragmenty.map((fr) => bboxFragmentu(r[fr.radek], fr.od, fr.do, sirka)).filter(Boolean);
          if (!boxy.length) return null;
          const kapacita = boxy.map((b, i) => (i === boxy.length - 1 ? Math.min(b.volnoDo, okraj) - 1 : b.x1) - b.x0);
          const rozlozeni = rozlozSlova(text, boxy, kapacita, sirka);
          return { boxy, rozlozeni };
        };
        let textNahrady = replaceJadro;
        let vysl = spocitej(v.fragmenty, textNahrady);
        if (!vysl) { nenal(KOD.NENALEZENO); continue; }
        let prekreslenZbytek = false;
        if (!vysl.rozlozeni) {
          // delší text uprostřed řádku: překreslit i ZBYTEK řádku (posune se doprava), ať nový
          // text nepřepíše sousední slova — zbytek je náhradním písmem, ale zůstane čitelný
          const posl = v.fragmenty[v.fragmenty.length - 1];
          const rad = r[posl.radek];
          const konec = konecTextu(rad);
          if (konec > posl.do) {
            const fragmenty = v.fragmenty.slice(0, -1).concat([{ radek: posl.radek, od: posl.od, do: konec }]);
            const zbytek = rad.text.slice(posl.do, konec);
            const kandidat = spocitej(fragmenty, replaceJadro + zbytek);
            if (kandidat && kandidat.rozlozeni) { vysl = kandidat; textNahrady = replaceJadro + zbytek; prekreslenZbytek = true; }
          }
        }
        if (!vysl.rozlozeni) { nenal(KOD.NEVEJDE_SE); continue; }
        const { boxy, rozlozeni } = vysl;
        const barvy = vzorkujBarvy ? await vzorkujBarvy(p, boxy) : null;
        const textRgb = PDFLib.rgb(...(barvy && barvy.text ? barvy.text : [0, 0, 0]));
        const pozadiRgb = PDFLib.rgb(...(barvy && barvy.pozadi ? barvy.pozadi : [1, 1, 1]));
        boxy.forEach((b, i) => {
          const size = b.size * rozlozeni.zmenseni;
          const text = rozlozeni.casti[i] || '';
          const w = sirka(text, size);
          // zarovnání: číslo na konci řádku (částka v tabulce) doprava, jinak doleva
          const doprava = jeCislo(r[v.fragmenty[0].radek].text.slice(v.fragmenty[0].od, v.fragmenty[0].do)) && b.posledniNaRadku && boxy.length === 1;
          const x = doprava ? Math.max(b.x0, b.x1 - w) : b.x0;
          const x1 = Math.max(b.x1, x + w);
          page.drawRectangle({ x: b.x0 - 0.6, y: b.y0 - 0.6, width: x1 - b.x0 + 1.2, height: b.y1 - b.y0 + 1.2, color: pozadiRgb, borderWidth: 0 });
          if (text) page.drawText(text, { x, y: b.baseline, size, font: f, color: textRgb });
        });
        strany.add(p);
        for (const c of casti) provedeno.push({ ...c, zmenseno: rozlozeni.zmenseni < 1 ? Math.round(rozlozeni.zmenseni * 100) : 0, zbytekRadku: prekreslenZbytek, zuzeno: zuz.zuzeno ? replaceJadro : '', slouceno: casti.length > 1 });
      }
    }
  } finally {
    await js.destroy();
  }
  const out = await lib.save({ useObjectStreams: true });
  return { bytes: out, provedeno, nenalezeno, strany: [...strany].sort((a, b) => a - b) };
}

// Slova nového textu do N fragmentů podle kapacity (v bodech při velikosti boxu);
// když se nevejdou, zkusit zmenšení až na 85 %. Vrací {casti[], zmenseni} nebo null.
function rozlozSlova(text, boxy, kapacita, sirka) {
  const slova = text.split(/\s+/).filter(Boolean);
  const zkus = (zm) => {
    const casti = [];
    let k = 0;
    for (let i = 0; i < boxy.length; i++) {
      const size = boxy[i].size * zm;
      let radek = '';
      while (k < slova.length) {
        const kand = radek ? radek + ' ' + slova[k] : slova[k];
        const w = sirka(kand, size);
        if (w > kapacita[i] && radek) break;      // další slovo se nevejde → do dalšího fragmentu
        radek = kand; k++;
        if (w > kapacita[i]) return null;          // jediné slovo se nevejde ani samo
      }
      casti.push(radek);
    }
    return k >= slova.length ? { casti, zmenseni: zm } : null;
  };
  if (!slova.length) return { casti: boxy.map(() => ''), zmenseni: 1 };
  const plne = zkus(1);
  if (plne) return plne;
  // potřebné zmenšení odhadem z celkové šířky, pak ověřit
  const celkem = sirka(slova.join(' '), boxy[0].size);
  const misto = kapacita.reduce((a, b) => a + Math.max(0, b), 0);
  const odhad = Math.min(0.995, misto / Math.max(celkem, 1));
  for (let zm = odhad; zm >= MIN_ZMENSENI - 1e-6; zm -= 0.01) { const r = zkus(zm); if (r) return r; }
  return null;
}
