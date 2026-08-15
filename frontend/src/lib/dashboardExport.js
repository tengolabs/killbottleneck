import { toPng } from 'html-to-image';
import { withDefaultLook } from '@/lib/theme';
import { isNativeShell } from '@/lib/nativeShell';
import { saveDataUrl } from '@/lib/saveFile';

// PNG snímek DOM prvku (denní přehled) — mobilní formát na výšku.
// Prvek musí mít vynucené světlé barvy (viz ExportCard v MyDaySection),
// jinak by uživatel v tmavém režimu dostal tmavý obrázek. withDefaultLook navíc
// odpojí skin — fonty a proměnné, které ExportCard nevynucuje, by jinak
// exportovaly ve vkusu odesílatele.
async function capture(el) {
  return withDefaultLook(async () => {
    // double-rAF: počkat na repaint právě vyrenderovaného skrytého kontejneru
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return toPng(el, { pixelRatio: 2, backgroundColor: '#ffffff' });
  });
}

export async function captureElementPng(el, fileName) {
  const dataUrl = await capture(el);
  await saveDataUrl(dataUrl, fileName);
}

// Web Share API (nativní sdílení na mobilu — WhatsApp, Messenger…): žádná
// registrace ani externí služba, jen prohlížeč. Funguje pouze v secure
// kontextu (HTTPS / localhost) — jinde se tlačítka Sdílet vůbec nenabízí.
export function canShareImages() {
  // Nativní obal: WebView navigator.share nemá, sdílí se přes @capacitor/share
  // (saveDataUrl) — nabídka Sdílet tedy dává smysl vždy.
  if (isNativeShell()) return true;
  try {
    return typeof navigator !== 'undefined' && !!navigator.canShare
      && navigator.canShare({ files: [new File([''], 'test.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

export async function shareElementPng(el, fileName, title) {
  const dataUrl = await capture(el);
  if (isNativeShell()) {
    // systémový dialog obsahuje sdílení i uložení — jedna cesta pro obojí
    await saveDataUrl(dataUrl, fileName);
    return;
  }
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], fileName, { type: 'image/png' });
  await navigator.share({ files: [file], title });
}
