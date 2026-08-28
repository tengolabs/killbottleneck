import { toJpeg } from 'html-to-image';
import jsPDF from 'jspdf';
import i18next from 'i18next';
import { withDefaultLook } from '@/lib/theme';
import { savePdf, safeFilename, dateStamp, afterRepaint } from '@/lib/saveFile';

// Uložení dashboardu projektu do PDF — „stav projektu, který můžu poslat".
//
// Navazuje na hlavní nález rešerše konkurence: status se má dát vzít z nástroje
// a poslat dál, ne opisovat ručně. Dashboard teď kromě „kde stojíme" ukazuje
// i „co se změnilo", takže je to celý podklad na poradu v jednom souboru.
//
// Stejná cesta jako u exportu mapy (lib/mapExport.js): DOM → PNG → jsPDF.
// Žádná nová závislost, obojí už v balíku editoru je.

// Obrázek se vloží přes CELOU šířku stránky a mezi stránkami se posouvá
// o výšku strany — standardní postup jsPDF. Víc stran je záměr: obsah se snímá
// v šířce 1024 px a roztažením na 194 mm vyjde písmo o třetinu větší, než kdyby
// se snímalo celé okno. ⚠️ Řez může padnout doprostřed řádku; dělit po sekcích
// by znamenalo vlastní sazbu a tomu se vědomě vyhýbáme.
const A4 = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } };
const MARGIN = 8; // menší okraje = víc obsahu na stránce, pořád tisknutelné

export async function saveDashboardPdf(el, mapTitle) {
  if (!el) return;
  // PDF vždy ve výchozím světlém vzhledu (bez skinu i tmavého režimu) — sdílený
  // helper withDefaultLook nahradil dřívější ruční sundávání třídy `dark` tady.
  return withDefaultLook(() => saveDashboardPdfInner(el, mapTitle));
}

async function saveDashboardPdfInner(el, mapTitle) {
  // Element se scrolluje — pro snímek potřebujeme jeho CELOU výšku, ne jen
  // to, co je vidět v okně.
  const prevOverflow = el.style.overflow;
  const prevHeight = el.style.height;
  const prevWidth = el.style.width;
  const prevMaxWidth = el.style.maxWidth;
  el.style.overflow = 'visible';
  el.style.height = 'auto';
  // Šířku připínáme na SKUTEČNÉM prvku, ne přes `style` v options html-to-image.
  // Ten klonu šířku nedrží (ověřeno: obsah se rozlil do šířky okna a plátno ho
  // oříznulo zprava). Takhle se do klonu propíše už jako spočítaný styl.
  const pinned = el.getBoundingClientRect().width;
  el.style.width = `${pinned}px`;
  el.style.maxWidth = `${pinned}px`;
  // A vynulovat vodorovné okraje: obsah je na stránce vystředěný přes `mx-auto`,
  // což se do snímku propíše jako PEVNÝ levý okraj (u širokého okna ~164 px).
  // Obsah se pak v plátně posune doprava a zprava se ořízne.
  const prevMargin = el.style.margin;
  el.style.marginLeft = '0px';
  el.style.marginRight = '0px';

  try {
    await afterRepaint();
    const width = el.scrollWidth;
    const height = el.scrollHeight;
    // JPEG, ne PNG: dashboard je vysoká stránka a v PNG vycházel soubor přes
    // 20 MB — takový „stav k poslání" se nedá poslat. V JPEG je to jednotky MB
    // při stejné čitelnosti textu (pixelRatio 2 = ostré písmo).
    const dataUrl = await toJpeg(el, {
      width, height, pixelRatio: 2, quality: 0.92, backgroundColor: '#ffffff',
      filter: (node) => !(node.classList && node.classList.contains('export-ignore')),
    });

    const page = A4.portrait;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const availW = page.w - MARGIN * 2;
    const availH = page.h - MARGIN * 2;
    const imgH = (height * availW) / width; // výška po zmenšení na šířku stránky

    let offset = 0;
    let pageNo = 0;
    while (offset < imgH - 0.5) { // 0.5 mm tolerance na zaokrouhlení
      if (pageNo > 0) pdf.addPage();
      pdf.addImage(dataUrl, 'JPEG', MARGIN, MARGIN - offset, availW, imgH);
      // bílé pruhy nahoře a dole, ať přetékající obrázek nepřeleze okraje
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, page.w, MARGIN, 'F');
      pdf.rect(0, page.h - MARGIN, page.w, MARGIN, 'F');
      offset += availH;
      pageNo += 1;
    }

    // Pomlčka a podtržítko se v názvu souboru SMÍ — projekt „Vydání-2026" by
    // se jinak slepil na „Vydání2026". (Export mapy v lib/mapExport.js má tenhle
    // nedostatek pořád; měnit ho by lidem přejmenovalo dosavadní soubory.)
    const safe = safeFilename(mapTitle, i18next.t('common:export.mapFilename'), { mode: 'dash' });
    await savePdf(pdf, `${safe}-${dateStamp()}.pdf`);
  } finally {
    el.style.overflow = prevOverflow;
    el.style.height = prevHeight;
    el.style.width = prevWidth;
    el.style.maxWidth = prevMaxWidth;
    el.style.margin = prevMargin;
  }
}
