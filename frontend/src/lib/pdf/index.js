// PDF v prohlížeči — veřejné API pro panel asistenta (záložka PDF + oprava textu).
// VŠECHNY knihovny (pdf.js ~0,5 MB + worker ~1,3 MB, pdf-lib, fontkit) se načítají
// líně až tady dynamickým importem — nikde v aplikaci nesmí být jejich statický
// import, jinak přitečou do hlavního balíku (a lite-bundle.js je zakazuje).
// Soubor uživatele nikdy neopouští prohlížeč; serveru jde jen text stran.
import * as J from './jadro.js';
import { ChybaPdf, KOD } from './chyby.js';

export { ChybaPdf, KOD };
export { parsujRozsahy, poJedne, popisRozsahu } from './rozsahy.js';

export const MAX_MB = 30; // nad to prohlížeč na telefonu dochází paměť

let pdfjsP = null;
async function getPdfjs() {
  if (!pdfjsP) {
    // legacy build: funguje i ve starším Android WebView (Capacitor) — standardní build
    // chce Promise.withResolvers (Chrome 119+); rozdíl je ~60 kB
    pdfjsP = Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
    ]).then(([pdfjs, w]) => { pdfjs.GlobalWorkerOptions.workerSrc = w.default; return pdfjs; });
  }
  return pdfjsP;
}
let libP = null;
const getLib = () => (libP ||= Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]).then(([PDFLib, fk]) => ({ PDFLib, fontkit: fk.default })));

const fontCache = new Map();
// řezy náhradního písma leží v public/fonts/pdf/ (Liberation, OFL, osekané na latinku)
async function nactiFont(rez) {
  if (!fontCache.has(rez)) {
    fontCache.set(rez, fetch(`${import.meta.env.BASE_URL || '/'}fonts/pdf/${rez}.ttf`).then(async (r) => {
      if (!r.ok) throw new Error(`font ${rez}: ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }).catch((e) => { fontCache.delete(rez); throw e; }));
  }
  return fontCache.get(rez);
}

export async function bajty(file) {
  if (file instanceof Uint8Array) return file;
  if (file && typeof file.size === 'number' && file.size > MAX_MB * 1048576) throw new ChybaPdf(KOD.MOC_VELKE, file.size);
  return new Uint8Array(await file.arrayBuffer());
}

// text stran pro asistenta + diagnostika (sken, nečitelný font)
export async function nactiPdf(file) {
  const bytes = await bajty(file);
  const pdfjs = await getPdfjs();
  const t = await J.nactiText({ pdfjs, bytes });
  return { ...t, bytes };
}

// Příloha do chatu: text stran + kontrola, že soubor půjde později i OPRAVIT (pdf-lib odmítá
// zamčená PDF, i ta „jen se zákazem úprav“ z účetních programů — lepší říct to hned než až na
// kartě). Strany bez textu (sken) a s nečitelným fontem se vynechají; když nezbude nic, chyba.
export async function prilohaPdf(file) {
  const v = await nactiPdf(file);
  const { PDFLib } = await getLib();
  await J.pocetStran({ PDFLib, bytes: v.bytes }); // hází SIFROVANO / POSKOZENO
  const vynechat = new Set([...v.stranyBezTextu, ...v.necitelne]);
  const strany = v.strany.filter((s) => !vynechat.has(s.page));
  if (!strany.length) throw new ChybaPdf(v.necitelne.length && v.necitelne.length >= v.stranyBezTextu.length ? KOD.TEXT_NECITELNY : KOD.BEZ_TEXTU);
  return { name: file.name, pages: v.pocetStran, strany, bytes: v.bytes, stranyBezTextu: v.stranyBezTextu, necitelne: v.necitelne };
}

export async function pocetStran(file) {
  const bytes = await bajty(file);
  const { PDFLib } = await getLib();
  return J.pocetStran({ PDFLib, bytes });
}

const blob = (b) => new Blob([b], { type: 'application/pdf' });

export async function sloucit(files) {
  const { PDFLib } = await getLib();
  const soubory = [];
  for (const f of files) soubory.push(await bajty(f));
  return blob(await J.sloucit({ PDFLib, soubory }));
}
export async function rozdelit(file, rozsahy) {
  const { PDFLib } = await getLib();
  return (await J.rozdelit({ PDFLib, bytes: await bajty(file), rozsahy })).map(blob);
}
export async function vyjmout(file, rozsahy) {
  const { PDFLib } = await getLib();
  return blob(await J.vyjmout({ PDFLib, bytes: await bajty(file), rozsahy }));
}
export async function odebrat(file, rozsahy) {
  const { PDFLib } = await getLib();
  return blob(await J.odebrat({ PDFLib, bytes: await bajty(file), rozsahy }));
}

// Náhled strany (PNG data URL) — pro kartu opravy a kontrolu před stažením.
export async function nahledStrany(file, page, { sirka = 480 } = {}) {
  const bytes = await bajty(file);
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  try {
    const pg = await doc.getPage(page);
    const v1 = pg.getViewport({ scale: 1 });
    const scale = sirka / v1.width;
    const vp = pg.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await pg.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas.toDataURL('image/png');
  } finally {
    await doc.destroy();
  }
}

// Oprava textu „přelepkou“: nahrady [{page, find, replace}] → {blob, bytes, provedeno, nenalezeno, strany}
export async function nahradText(file, nahrady) {
  const bytes = await bajty(file);
  const [pdfjs, { PDFLib, fontkit }] = await Promise.all([getPdfjs(), getLib()]);
  // vzorkování barev na plátně prohlížeče (jádro dostane továrnu na plátno — v node testu je to @napi-rs/canvas)
  const vz = typeof document !== 'undefined' ? J.vzorkovacBarev(pdfjs, bytes, (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }) : null;
  try {
    const vysledek = await J.nahradText({ pdfjs, PDFLib, fontkit, bytes, nahrady, nactiFont, vzorkujBarvy: vz });
    return { ...vysledek, blob: blob(vysledek.bytes) };
  } finally {
    if (vz) await vz.zavri();
  }
}
