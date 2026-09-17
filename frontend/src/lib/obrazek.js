// Obrázek z prohlížeče pro server — zmenšit UŽ tady a poslat jako base64 v JSONu.
// Sdílí ho hlášení chyby (snímek obrazovky) i AI asistent (přepis obrázku), ať je
// zmenšování jedno a neliší se. Čisté funkce bez závislostí → nezvětšují hlavní balík.

// 4K screenshot má klidně 6 MB a routy berou 1,5–2 MB — po zmenšení zbývá ~250 kB.
export const zmensiObrazek = (soubor, { maxHrana = 1600, kvalita = 0.82, typ = 'image/jpeg' } = {}) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(soubor);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const pomer = Math.min(1, maxHrana / Math.max(img.width, img.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * pomer));
    canvas.height = Math.max(1, Math.round(img.height * pomer));
    const ctx = canvas.getContext('2d');
    // JPEG průhlednost neumí — bez podkladu by alfa z PNG skončila černá
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob'))), typ, kvalita);
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
  img.src = url;
});

export const doBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',', 2)[1] || '');
  r.onerror = () => reject(new Error('read'));
  r.readAsDataURL(blob);
});

// Pro asistenta: velký obrázek k přepisu (1600 px JPEG) + malý náhled do historie
// rozhovoru (200 px WebP; server bere max 16 kB, jinak náhled zahodí). Originál se na
// serveru po přepisu nikam neukládá — náhled je jediné, co z obrázku ve vlákně zůstane.
const MAX_NAHLED_B64 = 16 * 1024;
export async function pripravObrazek(soubor) {
  const velky = await zmensiObrazek(soubor);
  let nahled = await zmensiObrazek(soubor, { maxHrana: 200, kvalita: 0.6, typ: 'image/webp' });
  let nahledB64 = await doBase64(nahled);
  if (nahledB64.length > MAX_NAHLED_B64) {
    nahled = await zmensiObrazek(soubor, { maxHrana: 160, kvalita: 0.45 });
    nahledB64 = await doBase64(nahled);
  }
  return {
    base64: await doBase64(velky),
    nahled: nahledB64.length <= MAX_NAHLED_B64 ? nahledB64 : '',
    nahledMime: nahled.type || 'image/jpeg',
    url: URL.createObjectURL(velky),
  };
}

// Obrázek ze schránky (Ctrl+V) nebo z přetažení — první soubor typu image/*.
export const obrazekZeSchranky = (dataTransfer) => {
  const items = [...((dataTransfer && dataTransfer.items) || [])];
  const it = items.find((i) => i.kind === 'file' && String(i.type).startsWith('image/'));
  if (it) return it.getAsFile();
  return [...((dataTransfer && dataTransfer.files) || [])].find((f) => String(f.type).startsWith('image/')) || null;
};
