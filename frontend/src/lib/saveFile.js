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
