// Stažení VŠECH (vyfiltrovaných) faktur najednou: každé DTO → PDF v prohlížeči (fakturaPdf) → jeden ZIP (fflate).
// Líný import z FakturySeznam (přes index.js táhne pdf-lib — lite-bundle.js hlídá, že do statického stromu nejde).
// Richard 24. 10. 2026: u „Stáhnout všechna moje data“ čekal faktury; pro účetnictví je potřeba filtr po měsících.
import { sestavZip } from './zip-jadro.js';
import { fakturaPdf } from './index.js';
import { faktura as apiFaktura } from '@/api/asistentApi';
import { base44 } from '@/api/base44Client';
import { saveBlob, safeFilename, dateStamp } from '@/lib/saveFile';

async function logoUrl() {
  try { const o = await base44.org.get(); return (o && o.logo_url) || ''; } catch { return ''; }
}
// seznam DTO (ze seznamu faktur; detail se dotáhne) → stáhne faktury-<měsíc|den>.zip; onProgress(hotovo, celkem)
export async function stahniFakturyZip(seznam, { lang = 'cs', onProgress = null, nazev = '' } = {}) {
  const logo = await logoUrl();
  const polozky = [];
  for (let i = 0; i < seznam.length; i++) {
    const dto = (await apiFaktura(seznam[i].id)).faktura;
    polozky.push({ dto, bytes: await fakturaPdf(dto, { lang, logoUrl: logo }) });
    if (onProgress) onProgress(i + 1, seznam.length);
  }
  const zip = sestavZip(polozky, (d) => safeFilename(`faktura-${d.cislo || d.id}`, 'faktura'));
  const jmeno = `${safeFilename(nazev || `faktury-${dateStamp()}`, 'faktury')}.zip`;
  await saveBlob(new Blob([zip], { type: 'application/zip' }), jmeno);
  return { jmeno, pocet: polozky.length };
}
