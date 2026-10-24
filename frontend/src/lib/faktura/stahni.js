// Stažení PDF faktury z panelu / karty: DTO ze serveru → PDF v prohlížeči → uložit (web: <a download>,
// Capacitor: Sdílet). Logo organizace je bonus. Komponenty tento modul importují LÍNĚ (import('@/lib/faktura/stahni'))
// — přes index.js táhne pdf-lib a qrcode-generator, které do statického stromu nesmí (lite-bundle.js).
import { fakturaPdf } from './index.js';
import { faktura as apiFaktura } from '@/api/asistentApi';
import { base44 } from '@/api/base44Client';
import { saveBlob, safeFilename } from '@/lib/saveFile';

async function logoUrl() {
  try { const o = await base44.org.get(); return (o && o.logo_url) || ''; } catch { return ''; }
}
// id → stáhne PDF; vrací DTO (pro případné zobrazení). Vyhodí chybu s `status` (404 = cizí/smazaná).
export async function stahniFakturu(id, { lang = 'cs', dto = null } = {}) {
  const d = dto || (await apiFaktura(id)).faktura;
  const bytes = await fakturaPdf(d, { lang, logoUrl: await logoUrl() });
  await saveBlob(new Blob([bytes], { type: 'application/pdf' }), `${safeFilename(`faktura-${d.cislo || d.id}`, 'faktura')}.pdf`);
  return d;
}
