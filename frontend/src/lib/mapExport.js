import i18next from 'i18next';
import { toPng } from 'html-to-image';
import { saveDataUrl, savePdf, safeFilename, afterRepaint } from '@/lib/saveFile';
import jsPDF from 'jspdf';

// Export mapy je WYSIWYG (Richard 31. 7.): snímá se PŘESNĚ to, co uživatel vidí —
// aktivní skin i světlý/tmavý režim, včetně barvy pozadí. Malůvka skinu v exportu
// není (leží mimo .react-flow__viewport). Dashboard PDF a obrázek „Můj den"
// zůstávají vynuceně světlé (starší schválené pravidlo, lib/dashboard*).
const appBg = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--background').trim();
  return v ? `hsl(${v})` : '#ffffff';
};
const appFg = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim();
  return v ? `hsl(${v})` : '#1e293b';
};

export async function captureAndSave(nodes, title, format) {
  const viewport = document.querySelector('.react-flow__viewport');
  if (!viewport || nodes.length === 0) return;

  // Calculate bounding box of all nodes
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const w = node.measured?.width || node.width || 220;
    const h = node.measured?.height || node.height || 150;
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + w);
    maxY = Math.max(maxY, node.position.y + h);
  }

  const padding = 40;
  const titleHeight = title ? 60 : 0;
  const mapWidth = maxX - minX;
  const mapHeight = maxY - minY;
  const captureWidth = mapWidth + padding * 2;
  const captureHeight = mapHeight + padding * 2 + titleHeight;

  // Save current transform, then reset to show all nodes at scale 1
  const currentTransform = viewport.style.transform;
  viewport.style.transform = `translate(${-minX + padding}px, ${-minY + padding + titleHeight}px) scale(1)`;

  // Insert title bar at the top of the capture area.
  // ⚠️ titleEl je DÍTĚ transformovaného viewportu — souřadnice jsou LOKÁLNÍ
  // (svět mapy), ne pixely snímku. Aby pruh skončil na ř. 0 snímku, musí ležet
  // na (minX−padding, minY−padding−titleHeight); top:0 ho kreslilo do světa
  // mapy PŘES vrchní uzel (Richardův screenshot 31. 7.).
  let titleEl = null;
  if (title) {
    titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.cssText = `position:absolute;top:${minY - padding - titleHeight}px;left:${minX - padding}px;width:${captureWidth}px;height:${titleHeight}px;padding:0 ${padding}px;display:flex;align-items:center;font-size:24px;font-weight:700;font-family:var(--font-heading,'Plus Jakarta Sans'),ui-sans-serif,sans-serif;color:${appFg()};background:${appBg()};box-sizing:border-box;z-index:1000;`;
    viewport.insertBefore(titleEl, viewport.firstChild);
  }

  await afterRepaint();

  try {
    const dataUrl = await toPng(viewport, {
      width: captureWidth,
      height: captureHeight,
      pixelRatio: 2,
      backgroundColor: appBg(),
      filter: (node) => {
        const cl = node.classList;
        if (cl && cl.contains('export-ignore')) return false;
        return true;
      },
    });

    // 'map' = historická politika názvu (bez pomlček) — měnit by lidem přejmenovalo soubory
    const fileName = safeFilename(title, i18next.t('common:export.mapFilename'), { mode: 'map' });

    if (format === 'png') {
      await saveDataUrl(dataUrl, `${fileName}.png`);
    } else {
      const orientation = mapWidth > mapHeight ? 'landscape' : 'portrait';
      const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const availW = pageW - margin * 2;
      const availH = pageH - margin * 2;
      const scale = Math.min(availW / captureWidth, availH / captureHeight);
      const imgW = captureWidth * scale;
      const imgH = captureHeight * scale;
      const offX = (pageW - imgW) / 2;
      const offY = (pageH - imgH) / 2;
      pdf.addImage(dataUrl, 'PNG', offX, offY, imgW, imgH);
      await savePdf(pdf, `${fileName}.pdf`);
    }
  } finally {
    if (titleEl) viewport.removeChild(titleEl);
    viewport.style.transform = currentTransform;
  }
}