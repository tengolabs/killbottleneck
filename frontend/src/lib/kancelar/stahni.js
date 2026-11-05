// Stažení souboru z karty / panelu: DTO ze serveru → soubor v prohlížeči → uložit (web: <a download>, Capacitor: Sdílet).
// Logo a název organizace jsou bonus (chyba načtení = bez loga). Komponenty tento modul importují LÍNĚ.
import { vyrobSoubor, formaty } from './index.js';
import { dokument as apiDokument } from '@/api/asistentApi';
import { base44 } from '@/api/base44Client';
import { pb } from '@/api/pb';
import { saveBlob, safeFilename } from '@/lib/saveFile';

async function organizace() {
  try { const o = await base44.org.get(); return { name: (o && o.name) || '', logoUrl: (o && o.logo_url) || '' }; } catch { return { name: '', logoUrl: '' }; }
}
// id nebo DTO → stáhne soubor ve formátu (pdf | pptx | docx); vrací DTO. Chyba se `status` (404 = cizí/smazaný).
export async function stahniDokument(idNeboDto, format, { lang = 'cs', barva = '', fotka = null } = {}) {
  const d = typeof idNeboDto === 'object' ? idNeboDto : (await apiDokument(idNeboDto)).dokument;
  const f = formaty(d.kind).includes(format) ? format : formaty(d.kind)[0];
  const org = await organizace();
  const blob = await vyrobSoubor(d, f, { lang, org: { name: org.name }, logoUrl: org.logoUrl, fotka, zakladna: pb.baseURL, ...(barva ? { barva } : {}) });
  await saveBlob(blob, `${safeFilename(d.title || '', 'dokument')}.${f}`);
  return d;
}
// náhled první strany PDF (data URL) pro panel — jen PDF formáty
export async function nahledDokumentu(dto, { lang = 'cs', barva = '', fotka = null, sirka = 480 } = {}) {
  const org = await organizace();
  const blob = await vyrobSoubor(dto, 'pdf', { lang, org: { name: org.name }, logoUrl: org.logoUrl, fotka, zakladna: pb.baseURL, ...(barva ? { barva } : {}) });
  const { nahledStrany } = await import('@/lib/pdf');
  return nahledStrany(new Uint8Array(await blob.arrayBuffer()), 1, { sirka });
}
// všechny strany / snímky dokumentu pro prohlížeč vlevo (ObrazekVrstva) — [{src, width, height}]
export async function nahledyDokumentu(dto, { lang = 'cs', barva = '', fotka = null, sirka = 1600 } = {}) {
  const org = await organizace();
  const blob = await vyrobSoubor(dto, 'pdf', { lang, org: { name: org.name }, logoUrl: org.logoUrl, fotka, zakladna: pb.baseURL, ...(barva ? { barva } : {}) });
  const { nahledyStran } = await import('@/lib/pdf');
  return nahledyStran(new Uint8Array(await blob.arrayBuffer()), { sirka });
}
