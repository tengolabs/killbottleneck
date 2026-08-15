// Pravidlo „MAPA JE STROM" — JEDNO místo pro celou aplikaci.
//
// Uzel smí mít nejvýš JEDNOHO rodiče a žádná hrana nesmí vést zpátky k předkovi.
// Není to kosmetika: rozvržení (lib/treeLayout.js) je algoritmus pro STROM a na
// mapě s kruhem se zacyklí — karta prohlížeče zatuhne na 100 % procesoru
// (ověřeno na mapě o 4 uzlech). Strop kroků v `apportion` je od v0.25 jen
// pojistka, aby uživatel dostal radši křivý layout než zamrznutí; příčinu
// zavírá až tenhle soubor.
//
// ⚠️ SERVER MÁ RUČNÍ DVOJČE: pb_hooks/helpers.js (`poskozeneHrany`,
// `strukturaZhorsena`). Změna tady = změna tam. Paritu hlídá
// product/tests/cleanmap-parity.js, sekce „strukturální pravidlo FE == server".
//
// Pořadí hran je LOAD-BEARING: hrany se přidávají v pořadí, v jakém přišly, a
// první, která by pravidlo porušila, je ta vadná. Díky tomu obě strany vyberou
// tutéž hranu k zahození a výsledky se nerozejdou.

// Vystoupá od `id` ke kořeni a řekne, jestli cestou potká `hledany`.
// Počítadlo kroků je pojistka pro data, která už kruh obsahují.
function jePredek(parentOf, id, hledany, strop) {
  let cur = id, kroku = 0;
  while (cur) {
    if (cur === hledany) return true;
    cur = parentOf[cur];
    if (++kroku > strop) return true; // zamotaná data = ber to jako kruh
  }
  return false;
}

// Důvod, proč spojení source→target nejde povolit, nebo null když je v pořádku.
// `parentOf` je stav mapy PŘED přidáním hrany.
function duvodOdmitnuti(parentOf, source, target, strop) {
  if (!source || !target) return 'self';
  if (source === target) return 'self';
  if (parentOf[target]) return 'multiParent';
  if (jePredek(parentOf, source, target, strop)) return 'cycle';
  return null;
}

/** Mapa rodičů { dítě: rodič } z hran; při víc rodičích vyhrává PRVNÍ hrana. */
export function rodiceMapy(edges) {
  const parentOf = Object.create(null); // uzel „__proto__" by jinak trefil zděděnou vlastnost
  for (const e of edges || []) {
    if (!e || !e.source || !e.target) continue;
    if (!parentOf[e.target]) parentOf[e.target] = e.source;
  }
  return parentOf;
}

/**
 * Smí vzniknout spojení? Vrací null (ano) nebo důvod:
 * 'self' | 'multiParent' | 'cycle'. Používá `isValidConnection` v editoru.
 */
export function spojeniPovoleno(edges, spojeni) {
  const parentOf = rodiceMapy(edges);
  const strop = (edges || []).length + 1;
  return duvodOdmitnuti(parentOf, spojeni?.source, spojeni?.target, strop);
}

/**
 * Které hrany mapu lámou. Vrací { edgeIds, viceRodicu, vCyklu } — id hran
 * k odpojení a id uzlů, kterých se to týká (kvůli hlášce a serverovému
 * porovnání „zhoršilo se to?"). Uzly se NEMAŽOU, odpojují se jen hrany navíc.
 */
export function poskozeneHrany(nodes, edges) {
  const parentOf = Object.create(null);
  const strop = (nodes || []).length + 1;
  const edgeIds = [], viceRodicu = [], vCyklu = [];
  for (const e of edges || []) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string' || !e.source || !e.target) continue;
    const duvod = duvodOdmitnuti(parentOf, e.source, e.target, strop);
    if (!duvod) { parentOf[e.target] = e.source; continue; }
    edgeIds.push(e.id);
    if (duvod === 'multiParent') viceRodicu.push(e.target);
    else vCyklu.push(e.target);
  }
  return { edgeIds, viceRodicu, vCyklu };
}
