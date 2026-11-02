// Osnova prezentace = prostý text v Dokumentech (14. 10. 2026): `# Titul`, `## Nadpis snímku`, `- odrážka`,
// `> poznámka řečníka`. Tatáž pravidla hlídá server (chat-kancelar.js overOsnovu) — tady se z textu skládá
// struktura pro PPTX / PDF / Word. Čistá funkce bez knihoven (node testy, server-side nic neimportuje).
export const MAX_SNIMKU = 20;
export const MAX_ODRAZEK = 8;

// text → { titul, snimky: [{ nadpis, odrazky, poznamky }] }; řádky před prvním snímkem (kromě `# titulu`) = podtitul
export function parsujOsnovu(text) {
  const radky = String(text || '').replace(/\r/g, '').split('\n');
  let titul = ''; const uvod = []; const snimky = []; let akt = null;
  for (const raw of radky) {
    const r = raw.trim();
    if (!r) continue;
    const h1 = r.match(/^#\s+(.+)$/); const h2 = r.match(/^#{2,3}\s+(.+)$/);
    if (h1 && !akt && !titul) { titul = h1[1].trim(); continue; }
    if (h2 || h1) { akt = { nadpis: (h2 || h1)[1].trim(), odrazky: [], poznamky: [] }; snimky.push(akt); continue; }
    if (!akt) { uvod.push(r.replace(/^[-•*>]\s*/, '')); continue; }
    const b = r.match(/^[-•*]\s+(.+)$/); const n = r.match(/^>\s*(.+)$/);
    if (n) akt.poznamky.push(n[1].trim());
    else akt.odrazky.push((b ? b[1] : r).trim());
  }
  return { titul, podtitul: uvod.join(' '), snimky: snimky.slice(0, MAX_SNIMKU).map((s) => ({ ...s, odrazky: s.odrazky.slice(0, MAX_ODRAZEK) })) };
}

// Markdown-lite pro dokumenty (e-mail, zápis, sumář) → bloky pro PDF / Word: nadpis (#), odrážka (-), odstavec, mezera
export function parsujBloky(text) {
  const out = [];
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const r = raw.trimEnd();
    if (!r.trim()) { if (out.length && out[out.length - 1].typ !== 'mezera') out.push({ typ: 'mezera' }); continue; }
    const h = r.match(/^(#{1,3})\s+(.+)$/);
    if (h) { out.push({ typ: 'nadpis', uroven: h[1].length, text: h[2].trim() }); continue; }
    const b = r.match(/^\s*[-•*]\s+(.+)$/);
    if (b) { out.push({ typ: 'odrazka', text: b[1].trim() }); continue; }
    const sekce = /^[^-•\s].{0,58}:$/.test(r.trim()); // „Program:“ = nadpis sekce jako v panelu
    out.push({ typ: sekce ? 'nadpis' : 'odstavec', uroven: 3, text: r.trim() });
  }
  while (out.length && out[out.length - 1].typ === 'mezera') out.pop();
  return out;
}
