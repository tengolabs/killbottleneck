// Skutečné výšky karty mapy pro jednotlivé stupně Čitelnosti — JEDNO místo,
// odkud je berou dvě sady, které by se jinak rozešly.
//
// PROČ TENHLE SOUBOR EXISTUJE (panel /checkup 13. 8. 2026):
// `layout-parity.js` si tahle čísla opisoval ručně. Byla tedy vymyšlená proti
// vymyšleným — mutace produkčního kódu (všechny stupně stejné písmo) sadu
// NECHALA ZELENOU 138/0, ačkoli skutečné karty spadly na 207/201 px. Sada
// o produktu nedokazovala nic.
//
// Nově platí dělba práce:
//  · `ui-citelnost.js` karty SKUTEČNĚ ZMĚŘÍ v prohlížeči a porovná je s těmito
//    čísly → když se karta změní (stačí přidat odznak), zčervená TAM;
//  · `layout-parity.js` jimi prožene layout a hledá překryv (unit, bez prohlížeče).
// Ručně se sem tedy sahá jen tehdy, když měření nahlásí jinou hodnotu — a to
// je vědomé rozhodnutí, ne tichý drift.
//
// Měřeno na mapě „8D report" s NEJHORŠÍ kartou, jaká vzniká: dlouhý název
// + garant + termín + „blokuje" + pruh pokroku.
// ⚠️ `titleOnly` vyskočilo 217 → 232 po Richardově připomínce 13. 8. („mezi
// druhým a třetím stupněm není extra rozdíl a karta je dokonce menší") —
// název je nově 24 px na TŘI řádky a pruh pokroku se v tomhle stupni skrývá.
// Drift chytila sada ui-citelnost.js sama, přesně kvůli tomu tenhle soubor je.
const VYSKY_KARET = {
  normal: 223,
  large: 227,
  titleOnly: 232,
};

// Rozpočet na výšku karty (odvozeno z konstant layoutu, ne odhadem):
//  · svisle:    STEP 280 − ELBOW 44 (DeletableEdge) = 236. Nad tím se hrany
//               přestanou lámat do společné sběrnice a vrátí se „schody".
//  · vodorovně: SLOT vodorovného směru = 250. Nad tím se řady překryjí.
const STROP_SVISLE = 236;
const STROP_VODOROVNE = 250;

// „MOJE MAPA" MÁ VLASTNÍ ROZPOČET — a je to nejtěsnější rozvržení v aplikaci.
// `PERSONAL_LAYOUT` (GoalMapEditor.jsx) má svisle `step 210` a vodorovně
// `slot 120`, takže stropy výš tam NEPLATÍ: svisle 210 − ELBOW 44 = 166 px,
// vodorovně rovných 120 px. Karty jsou kompaktní (název na 1 řádek, bez pruhu
// pokroku), proto jsou o hodně nižší než v běžné mapě.
// ⚠️ Nález panelu 13. 8. 2026: tohle rozvržení nikdo neměřil, ačkoli výchozí
// stupeň dostane každý. Naměřeno na /my-map s 24 kartami:
//   normal 108 · large 116 · titleOnly 120 px
// ⚠️ `titleOnly` sedí PŘESNĚ NA STROPU 120 a `large` (VÝCHOZÍ stupeň) má
// rezervu 4 px. Jakýkoli další řádek nebo odznak v kompaktní kartě to přetáhne.
const VYSKY_MOJE_MAPA = {
  normal: 108,
  large: 116,
  titleOnly: 120,
};
const STROP_MOJE_SVISLE = 166;
const STROP_MOJE_VODOROVNE = 120;

module.exports = {
  VYSKY_KARET, STROP_SVISLE, STROP_VODOROVNE,
  VYSKY_MOJE_MAPA, STROP_MOJE_SVISLE, STROP_MOJE_VODOROVNE,
};
