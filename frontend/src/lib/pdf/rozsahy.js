// Rozsahy stran zapsané člověkem: „1-3, 5, 8-“ → indexy stran (od nuly).
// Čisté funkce bez závislostí — unit test product/tests/pdf-jadro.js.
import { ChybaPdf, KOD } from './chyby.js';

// „1-3, 5, 8-“ → [{od:1, do:3}, {od:5, do:5}, {od:8, do:pocetStran}] (1-based, včetně)
// Chyba ROZSAH: prázdný zápis, nečíslo, 0, přes počet stran, od > do.
export function parsujRozsahy(zapis, pocetStran) {
  const casti = String(zapis || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (!casti.length) throw new ChybaPdf(KOD.ROZSAH, zapis);
  const out = [];
  for (const c of casti) {
    const m = /^(\d+)?\s*(?:-|–|—|\.\.)?\s*(\d+)?$/.exec(c);
    if (!m || (!m[1] && !m[2])) throw new ChybaPdf(KOD.ROZSAH, c);
    const jeRozsah = /[-–—]|\.\./.test(c);
    if (!jeRozsah && m[1] && m[2]) throw new ChybaPdf(KOD.ROZSAH, c); // „3 5“ bez pomlčky = nejasné
    const od = m[1] ? Number(m[1]) : 1;
    const doo = jeRozsah ? (m[2] ? Number(m[2]) : pocetStran) : od;
    if (od < 1 || doo < od || doo > pocetStran) throw new ChybaPdf(KOD.ROZSAH, c);
    out.push({ od, do: doo });
  }
  return out;
}

// rozsahy → seřazené indexy stran od nuly, bez duplicit
export function indexyStran(rozsahy) {
  const s = new Set();
  for (const r of rozsahy) for (let i = r.od; i <= r.do; i++) s.add(i - 1);
  return [...s].sort((a, b) => a - b);
}

// „každá strana zvlášť“ → jeden rozsah na stranu
export function poJedne(pocetStran) {
  return Array.from({ length: pocetStran }, (_, i) => ({ od: i + 1, do: i + 1 }));
}

// zápis rozsahu do názvu souboru: {od:1,do:3} → "1-3", {od:5,do:5} → "5"
export const popisRozsahu = (r) => (r.od === r.do ? String(r.od) : `${r.od}-${r.do}`);
