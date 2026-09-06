// „Uspořádat podle…" — řazení SOUROZENCŮ v mapě podle kritéria (Richard 5. 9. 2026).
//
// Pořadí uzlů v řadě dnes nese výhradně příčná souřadnice: layoutTree řadí
// děti podle position.x (svisle) / position.y (vodorovně) a nic sémantického
// o pořadí neví. Tenhle modul proto neřeší layout — jen SPOČÍTÁ pořadí dětí
// pod každým rodičem a zapíše ho do příčné souřadnice jako pořadový index
// (přesně jako buildPersonalMap v personalMap.js: `position = { x: i, y: 0 }`).
// Layout pak pořadí sám zachová, takže Zarovnat (3 vzhledy) ho už nerozhází.
//
// Struktura (hrany) se NEMĚNÍ — kořeny/vrchol se neřadí, poznámky (`note`)
// se nedotýkají. Uzel se DVĚMA rodiči (poškozená mapa — editor druhého rodiče
// nepustí, mapStructure.js takové hrany opravuje) dostane index podle
// posledního rodiče v pořadí hran; víc se pro něj neřeší. Termín a plán se berou z NEJBLIŽŠÍHO data v celém podstromu
// (větev s brzkým vnukem jde dopředu, vzor subMin z Mojí mapy); bez hodnoty
// vždy na konec. Sekundárně termín podstromu, pak název, pak PŮVODNÍ pořadí
// (stabilní — co má shodné hodnoty, zůstane, jak leželo).
//
// Čistý modul bez Reactu a i18n (relativní importy žádné), aby ho šlo pustit
// v node unit testu (product/tests/usporadani-uzlu.js). Porovnání textů si
// nechá vstříknout (`compare` = compareLocale z lib/locale.js), stejně jméno
// řešitele (`labelOf` = labelForEmail) — karta ukazuje jméno, ne e-mail, tak
// se má i řadit podle jména.

export const KRITERIA = ['deadline', 'plannedOn', 'owner', 'status'];
// klíč localStorage per mapa (+ mapId) — jen pro zvýraznění položky v nabídce,
// při otevření mapy se NIC nepřerovnává (zápis do cizí mapy, viz zámek Zarovnat)
export const KLIC_USPORADANI = 'kb-usporadat:';
// rozpracované → nezačaté → hotové na konec; neznámý stav jako nezačaté
export const PORADI_STAVU = { in_progress: 0, todo: 1, done: 2 };
// odstup pořadových indexů v příčné ose — sourozenci se srovnávají jen mezi
// sebou, ale velký krok drží pořadí čitelné i pro `measured` šířky karet
export const KROK_PORADI = 1000;

const PRAZDNE_DATUM = '9999-99-99';
const vychoziCompare = (a, b) => String(a ?? '').localeCompare(String(b ?? ''));

export function platneKriterium(v) {
  return KRITERIA.includes(v) ? v : '';
}

// Nejbližší datum v podstromu (pole = 'deadline' | 'plannedOn'):
// Map<id, 'YYYY-MM-DD' | ''>. Pojistka proti cyklu v hranách jako u subMin.
export function nejblizsiVPodstromu(nodesById, childrenMap, pole) {
  const cache = Object.create(null);
  const rek = (id) => {
    if (cache[id] !== undefined) return cache[id];
    cache[id] = PRAZDNE_DATUM; // cyklus → větev se do minima nepočítá dvakrát
    let m = String(nodesById[id]?.data?.[pole] || '') || PRAZDNE_DATUM;
    for (const c of (childrenMap[id] || [])) { const cm = rek(c); if (cm < m) m = cm; }
    cache[id] = m;
    return m;
  };
  const out = new Map();
  for (const id of Object.keys(nodesById)) { const v = rek(id); out.set(id, v === PRAZDNE_DATUM ? '' : v); }
  return out;
}

// prázdné datum na konec, jinak ISO řetězce srovnat přímo (sdílí i Moje mapa)
export const porovnejDatum = (a, b) => (a || PRAZDNE_DATUM) < (b || PRAZDNE_DATUM) ? -1 : (a || PRAZDNE_DATUM) > (b || PRAZDNE_DATUM) ? 1 : 0;

// Komparátor dvou uzlů (id) pro dané kritérium. `ctx`: nodesById, childrenMap,
// labelOf (e-mail → jméno), compare (řazení textů). Vrací (a, b) => number;
// poslední klíč (původní pořadí) dodává volající, komparátor je „čistý".
export function komparator(kriterium, { nodesById, childrenMap, labelOf = (x) => x, compare = vychoziCompare }) {
  const k = platneKriterium(kriterium);
  const terminy = nejblizsiVPodstromu(nodesById, childrenMap, 'deadline');
  const plany = k === 'plannedOn' ? nejblizsiVPodstromu(nodesById, childrenMap, 'plannedOn') : null;
  const data = (id) => nodesById[id]?.data || {};
  const nazev = (id) => String(data(id).title || data(id).apexText || '');
  const jmeno = (id) => (data(id).owner ? String(labelOf(String(data(id).owner)) || data(id).owner) : '');
  // hasOwn: stav „constructor"/„toString" (import, stará data) by z obyčejného
  // objektu vytáhl zděděnou funkci a `stav(a) - stav(b)` bylo NaN (panel /checkup 6. 9.)
  const stav = (id) => {
    const s = data(id).status;
    return Object.prototype.hasOwnProperty.call(PORADI_STAVU, s) ? PORADI_STAVU[s] : PORADI_STAVU.todo;
  };

  const primarni = (a, b) => {
    switch (k) {
      case 'deadline': return porovnejDatum(terminy.get(a), terminy.get(b));
      case 'plannedOn': return porovnejDatum(plany.get(a), plany.get(b));
      case 'owner': {
        const ja = jmeno(a), jb = jmeno(b);
        if (!ja || !jb) return (ja ? 0 : 1) - (jb ? 0 : 1); // nepřiřazené na konec
        return compare(ja, jb);
      }
      case 'status': return stav(a) - stav(b);
      default: return 0;
    }
  };
  // sekundárně termín podstromu (u kritéria termín je to už primární klíč, tak
  // se nepočítá dvakrát), pak název; původní pořadí dodává volající
  const sekundarni = k === 'deadline' ? () => 0 : (a, b) => porovnejDatum(terminy.get(a), terminy.get(b));
  return (a, b) => primarni(a, b) || sekundarni(a, b) || compare(nazev(a), nazev(b));
}

// HLAVNÍ VSTUP: pro každého rodiče seřadí děti (kromě `note`), kořeny nechá.
// Vrací Map<id, pořadový index> jen pro uzly, které mají rodiče. Vstupní pořadí
// dětí = podle `pricna(node)` (aktuální příčná pozice v daném směru) → shodné
// hodnoty drží to, co uživatel vidí.
export function poradiSourozencu(nodes, edges, kriterium, { pricna, labelOf, compare } = {}) {
  const out = new Map();
  if (!platneKriterium(kriterium)) return out;
  // Object.create(null): uzel s id „__proto__" by u obyčejného objektu netrefil
  // vlastní klíč (stejná past jako v treeLayout.js)
  const nodesById = Object.create(null);
  for (const n of nodes) if (n && n.type !== 'note') nodesById[n.id] = n;
  const childrenMap = Object.create(null);
  for (const e of edges) {
    if (!nodesById[e.source] || !nodesById[e.target]) continue;
    (childrenMap[e.source] = childrenMap[e.source] || []).push(e.target);
  }
  const cmp = komparator(kriterium, { nodesById, childrenMap, labelOf, compare });
  const pricnaOf = pricna || ((n) => n?.position?.x ?? 0);
  for (const rodic of Object.keys(childrenMap)) {
    // vstupní pořadí = aktuální příčná pozice; druhý sort je stabilní (ES2019),
    // takže shodné hodnoty drží to, co uživatel vidí
    const vstup = [...new Set(childrenMap[rodic])]
      .sort((a, b) => pricnaOf(nodesById[a]) - pricnaOf(nodesById[b]));
    vstup.sort(cmp);
    vstup.forEach((id, i) => out.set(id, i));
  }
  return out;
}

// Promítne pořadí do uzlů pro layout: příčná souřadnice = index × KROK_PORADI,
// hlavní osa zůstává. Ve vodorovném view je příčná osa Y (layoutAllForView
// pak osy prohodí sám), svisle X. Vrací NOVÉ pole uzlů — vstup se nemění.
export function sPoradimVPricneOse(nodes, poradi, horizontal = false) {
  return nodes.map((n) => {
    const i = poradi.get(n.id);
    if (i === undefined || n.type === 'note' || !n.position) return n;
    const v = i * KROK_PORADI;
    return { ...n, position: horizontal ? { x: n.position.x, y: v } : { x: v, y: n.position.y } };
  });
}
