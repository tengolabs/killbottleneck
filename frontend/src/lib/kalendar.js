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
// Rozdíl dvou klíčů dne ve dnech (den − dnes); přes Date.UTC, takže změna letního
// času nedá 0,96 dne. Neplatný klíč → null.
export function rozdilDnu(den, dnes) {
  const a = parsujDen(den), b = parsujDen(dnes);
  if (!a || !b) return null;
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86400000);
}

// ---- horizont položky = ZRCADLO SERVERU (pb_hooks/helpers.js:dayMath.horizonOf) ----
// Dní do položky: 0 = dnes, 1 = zítra…, záporné = po termínu, null = bez termínu
// i plánu. ⭐ PLÁN ROZHODUJE, dokud sahá nejvýš do týdne (Richard 8. 8. 2026);
// dál než týden plán termín nezastíní (min). Plán v minulosti = žádný plán
// (server planOf). Podle toho server skládá sekce a počty chipů v Můj den —
// klientský filtr „Termín“ na Úkolech MUSÍ dávat tutéž množinu, jinak chip
// „Dnes 1“ po kliku ukáže prázdný seznam (analýza kódu 3, F3-03). Paritu hlídá
// product/tests/horizont-parity.js.
export function horizontDnu(plan, termin, dnes = dnesKlic()) {
  const pl = plan && String(plan) >= dnes ? rozdilDnu(plan, dnes) : null;
  const dl = termin ? rozdilDnu(termin, dnes) : null;
  if (pl === null) return dl;
  if (pl <= 7) return pl;
  return dl === null ? pl : Math.min(pl, dl);
}
// Filtr „Termín“ (overdue | today | week) = TATÁŽ množina jako serverové sekce
// bucketFor (helpers.js): po termínu h < 0, dnes h = 0, do týdne h = 2…7 (dnešek
// a zítřek mají na serveru vlastní sekce, chip „Do týdne“ je proto nepočítá).
// Jiný filtr → true (termín neomezuje). Hotové položky vyřazuje volající.
export function odpovidaTerminu(filtr, plan, termin, dnes) {
  if (filtr !== 'overdue' && filtr !== 'today' && filtr !== 'week') return true;
  const h = horizontDnu(plan, termin, dnes);
  if (h === null) return false;
  if (filtr === 'overdue') return h < 0;
  if (filtr === 'today') return h === 0;
  return h >= 2 && h <= 7;
}

// ---- ISO týden ----
// { rok, tyden } podle ISO 8601: týden patří roku svého ČTVRTKA. Klíč týdne
// z kalendářního roku (`${getFullYear()}-W${n}`) rozpadl týden 53/2026 na
// „2026-W53“ + „2027-W53“ — dva sousední bloky „53. týden“ v hlavičce osy
// (analýza kódu 3, F3-06; totéž skoro každý přelom roku, kdy 1. 1. není pondělí).
export function isoTyden(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const rok = date.getUTCFullYear();
  const zacatekRoku = new Date(Date.UTC(rok, 0, 1));
  return { rok, tyden: Math.ceil((((date - zacatekRoku) / 86400000) + 1) / 7) };
}
export function klicTydne(d) {
  const { rok, tyden } = isoTyden(d);
  return rok + '-W' + tyden;
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
  // událost (19. 9. 2026) nemá projekt: přesouvá ji jen ten, kdo ji založil;
  // pozvaný účastník dostane vysvětlení místo tichého ne
  if (it.kind === 'event') {
    // sdílený kalendář: přesouvá i správce/manažer, nepřítomnost i ten, koho se týká (can_edit ze serveru)
    if (!(it.can_edit !== undefined ? it.can_edit : it.mine)) return { akce: 'odmitnout', duvod: 'udalostCizi' };
    // vícedenní událost (dovolená) se v mřížce netáhne — posouvá se v detailu (konec by jinak zůstal viset)
    if (it.end_day) return { akce: 'odmitnout', duvod: 'vicedenni' };
    return { akce: 'udalost', pole: 'day', puvodni: stitek.den, nova: den };
  }
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
