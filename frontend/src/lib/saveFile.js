// Uložení/stažení souboru vygenerovaného v aplikaci (export mapy, CSV, PNG, PDF).
// Web: neviditelný <a download> jako dřív. Nativní obal (Capacitor): Android
// WebView anchor-download NEUMÍ — tiše se nestane nic (zjištění z F2). Místo
// toho se blob zapíše do cache a otevře systémový dialog Sdílet/Uložit, kde si
// uživatel vybere cíl (Soubory, Disk, WhatsApp…). Capacitor moduly jdou přes
// dynamický import — web si je nikdy nestáhne.
// relativně kvůli node unit testům (řetěz mapPortable → saveFile → nativeShell)
import { isNativeShell } from './nativeShell.js';

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',', 2)[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const shareNative = async (base64, filename) => {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  });
  try {
    await Share.share({ files: [uri] });
  } catch (err) {
    // zavření dialogu bez výběru není chyba exportu
    if (!/cancel/i.test(String(err?.message))) throw err;
  }
};

export async function saveBlob(blob, filename) {
  if (isNativeShell()) {
    await shareNative(await blobToBase64(blob), filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function saveDataUrl(dataUrl, filename) {
  if (isNativeShell()) {
    await shareNative(String(dataUrl).split(',', 2)[1] || '', filename);
    return;
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

// ── Sdílené jádro exportů (analýza kódu 27. 8. 2026, F5-04: download, csvEscape,
// uložení PDF, název souboru a datum byly opsané 2–3× a už se rozešly — CSV
// úkolů neuvozovalo osamocený \r, datum bylo jednou UTC a jednou místní).

// Textový soubor ke stažení; `bom` jen pro CSV (Excel), Markdown ho nepotřebuje.
export function downloadText(filename, text, mime, { bom = false } = {}) {
  return saveBlob(new Blob([(bom ? '\uFEFF' : '') + text], { type: mime }), filename);
}

// Buňka CSV (oddělovač `;`). Formula injection: import z Asany/Trella umí do
// instance dostat cizí texty typu `=HYPERLINK(...)` — Excel by je při otevření
// exportu VYHODNOTIL; úvodní vzorcové znaky se neutralizují apostrofem.
export function csvEscape(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// jsPDF → soubor: nativní obal (Capacitor) neumí pdf.save, jde přes saveBlob
export async function savePdf(pdf, filename) {
  if (isNativeShell()) await saveBlob(pdf.output('blob'), filename);
  else pdf.save(filename);
}

// Název souboru z názvu projektu. `mode`:
//  'map'   = jen písmena/číslice/mezery (export mapy — historická politika; měnit
//            ji by lidem přejmenovalo dosavadní soubory, pozn. v dashboardPdf),
//  'dash'  = navíc pomlčka a podtržítko („Vydání-2026" zůstane),
//  'ascii' = bez diakritiky, mezery → pomlčky, malá písmena (přenosný .kb.json).
export function safeFilename(title, fallback, { mode = 'dash' } = {}) {
  const s = String(title || '');
  let out;
  if (mode === 'ascii') {
    out = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
  } else if (mode === 'map') {
    out = s.replace(/[^a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ ]/g, '').trim();
  } else {
    out = s.replace(/[^a-zA-Z0-9áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ _-]/g, '').trim();
  }
  return out || fallback;
}

// Datové razítko do názvu souboru = MÍSTNÍ den. Je to totéž co todayKey() v
// lib/taskActions.js — záměrně zvlášť: taskActions tahá datovou vrstvu (@/api) a
// tenhle soubor musí zůstat načitatelný z node (unit testy). Dřív část exportů
// brala UTC, takže po 22:00 SELČ nesl soubor včerejšek.
export function dateStamp(d = new Date()) {
  return d.toLocaleDateString('en-CA');
}

// Dvojité rAF: počkat na repaint právě upraveného DOMu před snímkem (html-to-image)
export function afterRepaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
