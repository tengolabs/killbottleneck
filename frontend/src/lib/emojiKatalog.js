// Katalog ikon uzlu — emoji roztříděné do kategorií, s klíčovými slovy pro hledání.
//
// Proč vlastní soubor a ne knihovna: kterákoli hotová emoji knihovna veze
// desítky až stovky kB dat (celý Unicode + zkratky + skin tóny). My potřebujeme
// pár set ikon, které dávají smysl v pracovní mapě — kurátorovaný seznam je
// menší, česky pojmenovaný a nikdo ho nemusí udržovat kvůli bezpečnosti.
//
// ⚠️ Tenhle soubor se NAČÍTÁ AŽ DYNAMICKY, když člověk otevře výběr ikony
// (EmojiPicker). Nesmí se importovat staticky z komponenty, která je v hlavním
// balíku — lite režim má strop 495 kB a naměřeno má 494 (product/tests/lite-bundle.js).
//
// Názvy kategorií jsou tu ZÁMĚRNĚ přímo (ne přes i18n): i18n balík editor.json
// se veze do lite, kdežto tenhle soubor ne. Kdyby šly názvy přes i18n, úspora
// z líného načítání by se ztratila.
//
// Klíčová slova jsou česká I anglická v jednom řetězci — hledání je prosté
// `includes`, takže na dělení jazyků není důvod a je to menší.

export const KATEGORIE = [
  {
    id: 'prace',
    nazev: { cs: 'Práce a cíle', en: 'Work and goals' },
    ikony: [
      ['🎯', 'cíl terč goal target zaměření'],
      ['🚀', 'start raketa launch rocket rozjezd'],
      ['🏆', 'trofej výhra trophy win úspěch'],
      ['⭐', 'hvězda star priorita důležité'],
      ['🔥', 'oheň fire hoří urgentní'],
      ['💡', 'nápad žárovka idea light'],
      ['📈', 'růst graf growth chart nahoru'],
      ['📉', 'pokles graf decline chart dolů'],
      ['📊', 'graf statistika chart data přehled'],
      ['✅', 'hotovo done check splněno'],
      ['☑️', 'odškrtnuto checkbox splněno'],
      ['❌', 'zrušeno chyba cross error ne'],
      ['⏸️', 'pozastaveno pauza paused hold'],
      ['🚧', 'rozpracováno stavba wip construction'],
      ['🧩', 'dílek puzzle součást piece'],
      ['🗂️', 'složky rozdělovač files archiv'],
      ['📋', 'schránka seznam clipboard checklist'],
      ['📝', 'poznámka psaní note write zápis'],
      ['🏁', 'cíl vlajka finish milník'],
      ['🎬', 'akce klapka action start natáčení'],
    ],
  },
  {
    id: 'lide',
    nazev: { cs: 'Lidé a role', en: 'People and roles' },
    ikony: [
      ['👤', 'osoba člověk person user uživatel'],
      ['👥', 'lidé tým people team dvojice'],
      ['🧑‍💼', 'manažer kancelář manager úředník'],
      ['👔', 'vedení kravata management šéf'],
      ['🧑‍🏭', 'dělník výroba worker provoz'],
      ['🧑‍🔧', 'technik údržba technician mechanik'],
      ['🧑‍🍳', 'kuchař kitchen chef gastro'],
      ['🧑‍⚕️', 'lékař zdravotník doctor sestra'],
      ['🧑‍🏫', 'učitel lektor teacher školitel'],
      ['🧑‍💻', 'vývojář programátor developer it'],
      ['🧑‍⚖️', 'právník soud lawyer legal'],
      ['🤝', 'dohoda spolupráce handshake partner'],
      ['🙋', 'dobrovolník hlásí se volunteer dotaz'],
      ['👷', 'stavba bezpečnost worker helma'],
      ['🕵️', 'kontrola audit detective šetření'],
      ['👪', 'rodina zákazníci family skupina'],
    ],
  },
  {
    id: 'cas',
    nazev: { cs: 'Čas a plán', en: 'Time and planning' },
    ikony: [
      ['📅', 'kalendář datum calendar plán'],
      ['🗓️', 'kalendář měsíc calendar rozvrh'],
      ['⏰', 'budík termín alarm připomínka'],
      ['⏱️', 'stopky měření stopwatch čas'],
      ['⏳', 'přesýpací hodiny čeká waiting deadline'],
      ['🕐', 'hodiny čas clock hodina'],
      ['🔁', 'opakování cyklus repeat loop'],
      ['🔄', 'obnova synchronizace refresh sync'],
      ['📆', 'termín datum date plánování'],
      ['🚦', 'semafor stav priorita signal'],
      ['🔔', 'zvonek upozornění bell notifikace'],
      ['⌛', 'došel čas timeout prodlení'],
    ],
  },
  {
    id: 'komunikace',
    nazev: { cs: 'Komunikace', en: 'Communication' },
    ikony: [
      ['✉️', 'e-mail dopis mail zpráva'],
      ['📧', 'e-mail email pošta'],
      ['💬', 'zpráva chat comment diskuse'],
      ['🗨️', 'poznámka bublina speech komentář'],
      ['📞', 'telefon hovor phone volat'],
      ['📱', 'mobil telefon smartphone appka'],
      ['📢', 'oznámení megafon announce hlášení'],
      ['📣', 'kampaň marketing megaphone propagace'],
      ['🗣️', 'jednání mluvčí speaking prezentace'],
      ['📮', 'podání odeslat postbox pošta'],
      ['🤙', 'ozvat se kontakt call'],
      ['🌐', 'web internet globe stránky'],
    ],
  },
  {
    id: 'penize',
    nazev: { cs: 'Peníze a obchod', en: 'Money and business' },
    ikony: [
      ['💰', 'peníze rozpočet money budget'],
      ['💵', 'hotovost bankovky cash platba'],
      ['💳', 'karta platba card úhrada'],
      ['🧾', 'účtenka faktura receipt invoice'],
      ['🏦', 'banka bank financování účet'],
      ['💹', 'tržby růst revenue burza'],
      ['🛒', 'nákup košík cart objednávka'],
      ['🛍️', 'prodej nákupy shopping obchod'],
      ['📦', 'balík zásilka package sklad'],
      ['🏷️', 'cena štítek price tag kategorie'],
      ['🤑', 'zisk výdělek profit'],
      ['📑', 'smlouva dokumenty contract papíry'],
    ],
  },
  {
    id: 'technika',
    nazev: { cs: 'Technika a data', en: 'Technology and data' },
    ikony: [
      ['💻', 'počítač notebook computer laptop'],
      ['🖥️', 'server monitor desktop stanice'],
      ['⌨️', 'klávesnice psaní keyboard vstup'],
      ['🖨️', 'tiskárna tisk printer výstup'],
      ['💾', 'uložit záloha save disketa'],
      ['🗄️', 'archiv kartotéka database databáze'],
      ['🗃️', 'evidence kartotéka records záznamy'],
      ['📂', 'složka otevřená folder adresář'],
      ['📁', 'složka soubor folder dokumenty'],
      ['🔗', 'odkaz propojení link napojení'],
      ['⚙️', 'nastavení ozubené settings konfigurace'],
      ['🔌', 'integrace zásuvka plugin propojení'],
      ['🤖', 'robot automat bot ai automatizace'],
      ['🧠', 'ai myšlení brain analýza'],
      ['📡', 'přenos anténa signal monitoring'],
      ['☁️', 'cloud oblak hosting server'],
      ['🔒', 'zámek bezpečnost lock zabezpečeno'],
      ['🔑', 'klíč přístup key heslo'],
      ['🐛', 'chyba brouk bug závada'],
      ['🧪', 'test zkouška test experiment'],
    ],
  },
  {
    id: 'vyroba',
    nazev: { cs: 'Výroba a nástroje', en: 'Production and tools' },
    ikony: [
      ['🛠️', 'nástroje údržba tools opravy'],
      ['🔧', 'klíč oprava wrench servis'],
      ['🔨', 'kladivo stavba hammer práce'],
      ['⚒️', 'dílna nářadí workshop výroba'],
      ['🏭', 'továrna výroba factory provoz'],
      ['🏗️', 'stavba jeřáb construction budování'],
      ['⚗️', 'chemie laboratoř lab vývoj'],
      ['🧰', 'brašna nářadí toolbox vybavení'],
      ['🪛', 'šroubovák montáž screwdriver seřízení'],
      ['⛏️', 'těžba krumpáč mining'],
      ['🧱', 'cihla základ brick materiál'],
      ['♻️', 'recyklace obnova recycle ekologie'],
    ],
  },
  {
    id: 'doprava',
    nazev: { cs: 'Doprava a logistika', en: 'Transport and logistics' },
    ikony: [
      ['🚚', 'dodávka rozvoz truck doprava'],
      ['🚛', 'kamion nákladní lorry přeprava'],
      ['🚗', 'auto vůz car cesta'],
      ['✈️', 'letadlo let plane cesta'],
      ['🚆', 'vlak železnice train'],
      ['🚢', 'loď námořní ship kontejner'],
      ['🚲', 'kolo bike jízdní'],
      ['🛵', 'skútr rozvoz scooter kurýr'],
      ['🗺️', 'mapa trasa map plán'],
      ['📍', 'místo poloha pin lokalita'],
      ['🧭', 'směr kompas compass orientace'],
      ['🛣️', 'cesta silnice road trasa'],
    ],
  },
  {
    id: 'budovy',
    nazev: { cs: 'Místa a budovy', en: 'Places and buildings' },
    ikony: [
      ['🏢', 'firma budova office kancelář'],
      ['🏠', 'dům domov home'],
      ['🏬', 'obchod prodejna store pobočka'],
      ['🏥', 'nemocnice zdravotnictví hospital'],
      ['🏫', 'škola vzdělávání school'],
      ['🏛️', 'úřad instituce government banka'],
      ['🏪', 'prodejna nonstop shop'],
      ['🏨', 'hotel ubytování ubytovna'],
      ['🏚️', 'sklad opuštěné budova'],
      ['⛺', 'stan akce camp event'],
    ],
  },
  {
    id: 'zdravi',
    nazev: { cs: 'Zdraví a bezpečnost', en: 'Health and safety' },
    ikony: [
      ['⚠️', 'pozor varování warning riziko'],
      ['🚨', 'poplach havárie alarm incident'],
      ['🛡️', 'ochrana bezpečnost shield prevence'],
      ['🦺', 'bozp vesta safety ochrana'],
      ['🧯', 'hasicí požár extinguisher prevence'],
      ['🩺', 'zdraví lékař health prohlídka'],
      ['💊', 'léky medicine léčba'],
      ['🧼', 'hygiena čištění clean úklid'],
      ['♿', 'přístupnost bezbariérové accessibility'],
      ['🚫', 'zákaz nesmí forbidden stop'],
    ],
  },
  {
    id: 'vzdelavani',
    nazev: { cs: 'Vzdělávání', en: 'Education' },
    ikony: [
      ['📚', 'knihy studium books dokumentace'],
      ['📖', 'příručka návod manual čtení'],
      ['🎓', 'školení absolvent graduation kurz'],
      ['✏️', 'úprava tužka edit psaní'],
      ['🖊️', 'podpis pero pen zápis'],
      ['📐', 'návrh měřítko design plán'],
      ['🔬', 'výzkum mikroskop research analýza'],
      ['🧮', 'výpočet počty calculation kalkulace'],
      ['❓', 'otázka dotaz question nejasné'],
      ['❗', 'důležité pozor important'],
    ],
  },
  {
    id: 'priroda',
    nazev: { cs: 'Příroda a prostředí', en: 'Nature and environment' },
    ikony: [
      ['🌱', 'růst klíček seedling začátek'],
      ['🌳', 'strom tree příroda'],
      ['🌍', 'svět zeměkoule world globální'],
      ['☀️', 'slunce počasí sun jasno'],
      ['🌧️', 'déšť počasí rain'],
      ['❄️', 'zima mráz snow chlazení'],
      ['⚡', 'energie blesk power rychlost'],
      ['🔋', 'baterie energie battery kapacita'],
      ['💧', 'voda kapka water'],
      ['🌊', 'vlna moře wave'],
      ['🐾', 'zvířata stopy pets'],
      ['🌾', 'zemědělství obilí farm sklizeň'],
    ],
  },
  {
    id: 'volno',
    nazev: { cs: 'Jídlo a volný čas', en: 'Food and leisure' },
    ikony: [
      ['☕', 'káva přestávka coffee pauza'],
      ['🍽️', 'jídlo stravování food oběd'],
      ['🥐', 'pekárna pečivo bakery'],
      ['🍰', 'cukrárna dort cake oslava'],
      ['🍺', 'pivo posezení beer'],
      ['🎉', 'oslava úspěch party hotovo'],
      ['🎁', 'dárek odměna gift bonus'],
      ['⚽', 'sport fotbal football'],
      ['🏋️', 'trénink posilovna gym kondice'],
      ['🧘', 'klid pohoda relax wellbeing'],
      ['🎵', 'hudba zvuk music audio'],
      ['🎨', 'design grafika art kreativa'],
      ['📷', 'foto snímek photo dokumentace'],
      ['🎮', 'hra herní game zábava'],
    ],
  },
  {
    id: 'symboly',
    nazev: { cs: 'Značky a stavy', en: 'Marks and states' },
    ikony: [
      ['🔴', 'červená stop kritické red'],
      ['🟠', 'oranžová pozor orange'],
      ['🟡', 'žlutá čeká yellow'],
      ['🟢', 'zelená ok běží green'],
      ['🔵', 'modrá info blue'],
      ['🟣', 'fialová purple'],
      ['⚫', 'černá uzavřeno black'],
      ['⚪', 'bílá prázdné white'],
      ['🔺', 'růst nahoru up trojúhelník'],
      ['🔻', 'pokles dolů down trojúhelník'],
      ['➡️', 'další doprava next arrow'],
      ['⬅️', 'zpět doleva back arrow'],
      ['⬆️', 'nahoru eskalace up'],
      ['⬇️', 'dolů delegace down'],
      ['🔀', 'větvení rozdělení split shuffle'],
      ['➕', 'přidat plus add'],
      ['➖', 'odebrat minus remove'],
      ['✳️', 'poznámka hvězdička note'],
      ['♾️', 'průběžné nekonečno infinite trvalé'],
      ['🆕', 'nové new novinka'],
      ['🆓', 'zdarma free'],
      ['🔝', 'priorita nahoru top'],
      ['💯', 'sto procent complete hotovo'],
      ['👍', 'schváleno palec approved ok'],
      ['👎', 'zamítnuto palec rejected'],
      ['🙏', 'prosba díky please thanks'],
      ['👀', 'ke kontrole review sledovat'],
    ],
  },
];

// Plochý seznam pro hledání — {e, k, kat}
export const VSECHNY = KATEGORIE.flatMap((kat) =>
  kat.ikony.map(([e, k]) => ({ e, k, kat: kat.id })),
);

/**
 * Hledání podle klíčových slov. Prázdný dotaz = null (volající ukáže kategorie).
 * Diakritika se srovnává, ať „cil" najde „cíl" — lidé ji při hledání vynechávají.
 */
export function hledejIkony(dotaz) {
  const q = bezDiakritiky(String(dotaz || '').trim().toLowerCase());
  if (!q) return null;
  return VSECHNY.filter((i) => bezDiakritiky(i.k).includes(q)).map((i) => i.e);
}

export function bezDiakritiky(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Texty výběru ikon. Bydlí ZÁMĚRNĚ tady, ne v i18n balíku: editor.json se veze
// do lite (strop 495 kB, naměřeno 494), kdežto tenhle soubor se načte až při
// otevření nabídky. Jeden líný zdroj pro jednu komponentu — názvy kategorií
// výše mají stejný důvod.
export const TEXTY = {
  cs: {
    hledat: 'Hledat ikonu…',
    oblibene: 'Naposledy použité',
    vlastni: 'Vlastní znak',
    vlastniPopis: 'Emoji z klávesnice nebo kód U+1F436',
    pouzit: 'Použít',
    bezIkony: 'Bez ikony',
    nenalezeno: 'Nic nenalezeno',
    vybrat: 'Vybrat ikonu',
    neniIkona: 'To není znak, který by šel použít jako ikona.',
    odebrat: 'Odebrat z naposledy použitých',
  },
  en: {
    hledat: 'Search icons…',
    oblibene: 'Recently used',
    vlastni: 'Custom character',
    vlastniPopis: 'Emoji from your keyboard, or a code like U+1F436',
    pouzit: 'Use',
    bezIkony: 'No icon',
    nenalezeno: 'Nothing found',
    vybrat: 'Choose icon',
    neniIkona: 'That is not a character that can be used as an icon.',
    odebrat: 'Remove from recently used',
  },
};

/**
 * Z toho, co člověk vloží do „Vlastní znak", udělá skutečnou ikonu.
 *
 * Richard 18. 8. 2026 tam vložil `U+1F436` a v uzlu mu zůstal ten kód. Je to
 * pochopitelné: kód je přesně to, co člověk najde, když emoji hledá na webu.
 * Bereme proto obojí — hotové emoji i zápis kódem (`U+1F436`, `1F436`,
 * `U+1F1E8 U+1F1FF` pro vlajky složené ze dvou bodů).
 *
 * Vrací '' pro vstup, který ikona být nemůže (běžný text, prázdno) — volající
 * pak nic neuloží. Bez téhle brzdy skončí v mapě jako ikona slovo.
 */
export function naIkonu(vstup) {
  const text = String(vstup || '').trim();
  if (!text) return '';

  // Zápis kódem: U+1F436, 1F436, u+1f436, „U+1F1E8 U+1F1FF" (vlajky mají body dva).
  // ⚠️ NEdělit na „+", jinak se z „U+1F436" stane „U" a „1F436".
  // Bez prefixu U+ se vyžadují aspoň ČTYŘI číslice: „123" má být text, ne znak
  // U+0123 (ģ) — nikdo nezadává ikonu třemi číslicemi.
  const kody = text.split(/[\s,]+/).filter(Boolean);
  const jenKody = kody.length > 0 && kody.length <= 4
    && kody.every((k) => /^U\+[0-9A-Fa-f]{2,6}$/i.test(k) || /^[0-9A-Fa-f]{4,6}$/.test(k));
  if (jenKody) {
    try {
      const znaky = kody.map((k) => {
        const cislo = parseInt(k.replace(/^U\+/i, ''), 16);
        // Pod U+2000 je běžné písmo (latinka, řečtina, cyrilice). Ikona z něj
        // nebude a překlep v kódu by jinak tiše vyrobil písmeno s háčkem.
        if (!Number.isFinite(cislo) || cislo < 0x2000 || cislo > 0x10ffff) throw new Error('mimo rozsah');
        return String.fromCodePoint(cislo);
      }).join('');
      return jeIkona(znaky) ? znaky : '';
    } catch { return ''; }   // nesmyslný kód se má chovat jako nepovedený vstup, ne spadnout
  }

  return jeIkona(text) ? text : '';
}

/**
 * Je to znak, který dává smysl jako ikona? Záměrně velkoryse: cokoli mimo
 * běžné písmo (emoji, symboly, piktogramy), ale ne text a ne holá čísla —
 * jinak by se do mapy dala uložit věta.
 */
export function jeIkona(znak) {
  const s = String(znak || '');
  if (!s || s.length > MAX_IKONA) return false;
  // samá ASCII písmena/číslice = text nebo neproběhlý kód, ne ikona
  if (/^[\x20-\x7e]+$/.test(s)) return false;
  return true;
}

export const MAX_IKONA = 16;

const KLIC_OBLIBENE = 'kb-emoji-oblibene';
// Richard 18. 8. 2026: „nebo poslední a tam třeba 10 ikonek."
const MAX_OBLIBENE = 10;

// Oblíbené = posledně použité, drží se v prohlížeči. Je to preference
// zobrazení, ne obsah mapy — proto localStorage a ne účet: žádná migrace,
// žádný zápis na server. ⚠️ Nepřenáší se mezi zařízeními (vědomé, 18. 8. 2026).
export function nactiOblibene() {
  try {
    const raw = JSON.parse(localStorage.getItem(KLIC_OBLIBENE) || '[]');
    if (!Array.isArray(raw)) return [];
    // jeIkona tu dělá i úklid: než se vstup uměl přeložit z kódu, mohl se do
    // seznamu dostat text („1F436"). Takový záznam se sem už nevrátí.
    return raw.filter((x) => typeof x === 'string' && jeIkona(x)).slice(0, MAX_OBLIBENE);
  } catch { return []; }   // poškozený nebo nedostupný localStorage nesmí shodit výběr ikon
}

export function zapamatujOblibenou(emoji) {
  if (!jeIkona(emoji)) return nactiOblibene();
  const dalsi = [emoji, ...nactiOblibene().filter((x) => x !== emoji)].slice(0, MAX_OBLIBENE);
  uloz(dalsi);
  return dalsi;
}

/** Odebrání z naposledy použitých — ať se dá seznam probrat. */
export function zapomenOblibenou(emoji) {
  const dalsi = nactiOblibene().filter((x) => x !== emoji);
  uloz(dalsi);
  return dalsi;
}

function uloz(seznam) {
  try { localStorage.setItem(KLIC_OBLIBENE, JSON.stringify(seznam)); } catch { /* soukromý režim */ }
}
