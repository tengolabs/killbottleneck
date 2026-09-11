// Kalendář na stránce Úkoly — ČISTÝ datový modul: štítky položek, práva
// k termínu a rozhodovací matice přesunu (přetažení mění termín po potvrzení,
// bez práva žádost). Mřížku a navigaci dnů má components/tasks/calendarDates.js
// (kalendář v2 z 10. 9. 2026); zdejší datum je jen to, co potřebuje matice.
// Plán (plannedOn) kalendář v2 nezobrazuje — větev 'plan' v matici zůstává
// jen jako pokrytá možnost, UI ji nevolá. Žádný React, žádné API.
// Testuje se bez dockeru (product/tests/kalendar-data.js) dynamickým importem,
// proto tu NESMÍ být alias `@/` ani date-fns (lite dieta, lib/locale.js:4-8).
//
// ⚠️ Klíč dne je VŽDY lokální 'YYYY-MM-DD' skládaný z getFullYear/getMonth/
// getDate — toISOString() by v CEST posunul den (stejná konvence jako
// taskActions.todayKey přes toLocaleDateString('en-CA')). Posuny dnů jdou
// přes setDate, takže přechod letního času (29. 3. / 25. 10.) neukousne hodinu.
import { jeZadavatelNeboVlastnik } from './nodePermissions.js';

export const DNU_PLANU = 7;         // plán jde jen dnes … +7 (UI hranice; server ji mimo v1 API nehlídá)

const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

// ---- datum ----
export function klicDne(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
export function parsujDen(k) {
  const [y, m, d] = String(k || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
export function posunDny(k, n) {
  const d = parsujDen(k);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return klicDne(d);
}
export function dnesKlic(now) {
  return klicDne(now || new Date());
}

// ---- položky → štítky ----
// items = calendarItems z hooks/useTaskTrees.js:
//   { key, title, deadline, plannedOn, status, kind:'task'|'node', map_id, node_id,
//     assignee_email, assignedBy, deadlineChangeWanted, deadlineChangeRequestedBy,
//     created_by, isApex, raw }
// Jedna položka dá až DVA štítky: termín (den = deadline) a plán (den = plannedOn).
// Propadlý plán (< dnes) je „žádný plán“ — stejná sémantika jako taskActions.planState.
export function slozStitky(items, { ukazPlan = true, dnes } = {}) {
  const out = [];
  for (const it of items || []) {
    if (!it) continue;
    const hotovo = it.status === 'done';
    if (it.deadline) {
      out.push({
        klic: it.key + ':termin', druh: 'termin', den: it.deadline, item: it, hotovo,
        poTerminu: !hotovo && !!dnes && it.deadline < dnes,
      });
    }
    if (ukazPlan && it.plannedOn && (!dnes || it.plannedOn >= dnes) && !hotovo) {
      out.push({ klic: it.key + ':plan', druh: 'plan', den: it.plannedOn, item: it, hotovo: false, poTerminu: false });
    }
  }
  return out;
}
// ---- barva projektu (uživatelská data, jediná ne-tokenová barva) ----
export function barvaProjektu(map) {
  const c = map && map.color ? String(map.color) : '';
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '';
}

// ---- práva a rozhodovací matice přesunu ----
export function rozsahPlanu(dnes) {
  return { od: dnes, do: posunDny(dnes, DNU_PLANU) };
}
export function jeVRozsahuPlanu(den, dnes) {
  const r = rozsahPlanu(dnes);
  return !!den && den >= r.od && den <= r.do;
}
// vlastník mapy podle DTO (created_by = owner_email; fáze 1 seznamu map nese owner_email)
export function vlastnikMapy(map) {
  return (map && (map.created_by || map.owner_email)) || '';
}
// Termín uzlu: stejný predikát jako detail uzlu (lib/nodePermissions.js);
// termín úkolu: zrcadlo TaskDialog.jsx (zadavatel = created_by, nebo vlastník mapy).
export function smiMenitTermin(item, { map, userEmail } = {}) {
  if (!item || !userEmail) return false;
  const owner = vlastnikMapy(map);
  if (item.kind === 'node') {
    return jeZadavatelNeboVlastnik(
      { data: { deadline: item.deadline, assignedBy: item.assignedBy } },
      { isMapOwner: !!owner && owner === userEmail, ownerEmail: owner, userEmail },
    );
  }
  if (!item.deadline) return true;
  return userEmail === item.created_by || (!!owner && owner === userEmail);
}
// { akce: 'nic'|'termin'|'zadost'|'plan'|'odmitnout', duvod?, pole?, puvodni?, nova? }
// Volá se PŘED jakýmkoli zápisem; komponenta podle `akce` otevře dialog, zapíše plán,
// nebo ukáže hlášku podle `duvod`. Nikdy nezapisuje naslepo do mapy, která není v paměti.
export function vyhodnotPresun(stitek, den, { dnes, userEmail, map } = {}) {
  if (!stitek || !stitek.den || !den || den === stitek.den) return { akce: 'nic', duvod: 'stejnyDen' };
  const it = stitek.item;
  if (stitek.hotovo) return { akce: 'odmitnout', duvod: 'hotovo' };
  if (!map || (it.kind === 'node' && !Array.isArray(map.nodes))) return { akce: 'odmitnout', duvod: 'mapaChybi' };
  if (stitek.druh === 'plan') {
    if (!jeVRozsahuPlanu(den, dnes)) return { akce: 'odmitnout', duvod: 'planMimoRozsah' };
    return { akce: 'plan', pole: it.kind === 'node' ? 'plannedOn' : 'planned_on', puvodni: it.plannedOn || '', nova: den };
  }
  if (smiMenitTermin(it, { map, userEmail })) {
    return { akce: 'termin', pole: 'deadline', puvodni: it.deadline, nova: den };
  }
  if (it.kind !== 'node') return { akce: 'odmitnout', duvod: 'ukolZadavatel' };
  // běžící žádost JINÉHO člověka server odmítne 409 — vlastní jde přepsat (parita se serverem)
  if (it.deadlineChangeWanted && it.deadlineChangeRequestedBy && it.deadlineChangeRequestedBy !== userEmail) {
    return { akce: 'odmitnout', duvod: 'ciziZadost' };
  }
  return { akce: 'zadost', pole: 'deadline', puvodni: it.deadline, nova: den };
}
