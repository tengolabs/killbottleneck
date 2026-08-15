// Čitelnost mapy — tři stupně velikosti písma v uzlu (Richard 12. 8. 2026:
// „pro někoho už není možné přečíst názvy uzlů").
//
// ⚠️ PROČ SE NEZVĚTŠUJE CELÝ UZEL: mapa se po otevření i po zarovnání VŽDY
// oddálí na celou obrazovku (fitView). Kdyby s písmem rostla i karta a
// rozestupy, ohraničení mapy naroste stejně, fitView o tolik víc oddálí a na
// obrazovce je písmo přesně stejně velké — čistý zoom, nulový přínos.
// Čitelnost roste JEN z poměru písma vůči rozměrům mapy, proto:
//   · šířka karty zůstává 220 px (GoalNode.jsx) ve všech stupních,
//   · rozestupy v treeLayout.js se nemění,
//   · uzly se při přepnutí NEHÝBOU.
// ⚠️ Z toho ale NEPLYNE, že se nic neuloží — na tuhle úvahu jsem 13. 8. 2026
// naletěla a dva kontrolní agenti ji ode mě opsali jako fakt. Autosave visí
// na referenci `nodes`, kterou vyrobí i změna NAMĚŘENÝCH ROZMĚRŮ karty.
// Že se opravdu nic neuloží, drží porovnání otisku v `GoalMapEditor.jsx`
// (viz „PRÁZDNÉ ULOŽENÍ SE NEPOSÍLÁ"), ne tenhle fakt — a hlídá to sada
// ui-citelnost.js odchytem SÍTĚ, ne kontrolou pozic.
//
// ⚠️ ROZPOČET NA VÝŠKU KARTY (proč se s každým stupněm zároveň ubírá řádek):
//   · svisle:    ≤ 236 px = STEP 280 − ELBOW 44 (DeletableEdge). Nad tím se
//                hrany přestanou lámat do společné sběrnice a vrátí se „schody".
//   · vodorovně: ≤ 250 px = SLOT vodorovného směru. Nad tím se řady překryjí.
// Karta s odznaky a pruhem pokroku má dnes ~240 px, rezerva je tedy malá —
// proto „větší" zkracuje popisek na 1 řádek a „jen název" ho skrývá úplně.
// Hlídá to product/tests/ui-citelnost.js (měří skutečné karty v prohlížeči).
import { nactiKlic } from '@/lib/storageKeys';

// tokeny anglicky jako u stylů zarovnání (`classic|compact|bands`) — technická
// vrstva je EN, do češtiny je překládá i18n. Ukládají se do prohlížeče, takže
// pozdější přejmenování by chtělo migraci; radši hned správně.
export const CITELNOST_STUPNE = ['normal', 'large', 'titleOnly'];

export const KLIC_CITELNOST = 'kb-citelnost';

// Volba je PER ZAŘÍZENÍ (localStorage), ne na účtu — rozhodnutí Richarda
// 12. 8. 2026: na velkém monitoru chce jinou velikost než na telefonu.
//
// ⚠️ VÝCHOZÍ JE „VĚTŠÍ", NE „NORMÁLNÍ" (Richard 13. 8. 2026 po klik-testu:
// „nastavil bych velikost písma jako default variantu 2"). Funkce vznikla
// proto, že názvy uzlů nešly přečíst — nechat výchozí stav nečitelný a čekat,
// až si každý sám najde tlačítko, by ten problém neřešilo.
// Dopad: kdo si stupeň nikdy nenastavil, uvidí mapu v 18 px (název) a popisek
// na jeden řádek. Karta má 227 px, tedy pod stropem 236. Kdo si volbu už
// uložil, tomu se nic nemění — `nactiKlic` vrací uloženou hodnotu.
export const VYCHOZI_STUPEN = 'large';

// Tailwind třídy, ne pixely: velikosti musí zůstat v návrhovém systému, ať se
// s nimi hýbe jedním místem. Čísla v komentářích jsou výsledné px / řádkování.
export const CITELNOST = {
  // dnešní stav — beze změny, ať mapy stávajících lidí vypadají stejně
  normal: {
    nazev: 'text-sm',            // 14 / 20
    nazevRadky: 'line-clamp-2',
    popis: 'text-xs',            // 12 / 16
    popisRadky: 'line-clamp-2',
    skrytPopis: false,
  },
  // větší název i větší popisek; popisek platí za růst písma jedním řádkem,
  // aby karta zůstala stejně vysoká (rozhodnutí Richarda 12. 8.)
  large: {
    nazev: 'text-lg',            // 18 / 28
    nazevRadky: 'line-clamp-2',
    popis: 'text-sm',            // 14 / 20
    popisRadky: 'line-clamp-1',
    skrytPopis: false,           // popisek zůstává, jen kratší
  },
  // Velký název na úkor informace — popisek se skryje a MÍSTO PO NĚM SE
  // OPRAVDU VYUŽIJE. Richard 13. 8. 2026 nad uzlem „Den pod kontrolou":
  // „mezi druhým a třetím stupněm není extra rozdíl a celková velikost uzlu
  // je dokonce menší, takže nevyužíváme potenciál." První verze měla 20 px
  // (jen o 2 px víc než druhý stupeň) a karta se zmenšila z 227 na 217 px.
  // Nově 24 px na TŘI řádky s těsným řádkováním — uvolněné místo po popisku
  // a po pruhu pokroku spolkne vyšší řádkování názvu.
  // ⚠️ 30 px bylo ZKOUŠENO A ZAMÍTNUTO: písmo sice vyskočilo na 20,69 px,
  // ale při pevné šířce karty 220 px se 6 z 8 názvů uřízlo uprostřed slova
  // („D3 – Okamžitá…" × „D4 – Kořenová…" nešly rozeznat). Větší písmo za cenu
  // nečitelného názvu je proti smyslu funkce — nezvyšovat zpátky.
  titleOnly: {
    nazev: 'text-2xl',           // 24 / 32
    nazevRadky: 'line-clamp-3 leading-tight',
    popis: null,
    popisRadky: null,
    skrytPopis: true,
    // Pruh pokroku se v tomhle stupni skrývá — bez toho by karta měla 248 px
    // a čáry mezi patry by se rozpadly do „schodů" (strop 236). SCHVÁLENO
    // Richardem 13. 8. 2026: „ve třetí variantě bych nezobrazoval pokrok."
    skrytPokrok: true,
    // Totéž v kruhovém vrcholu: pryč odznaky „Projekt" a stav i blok
    // „0 % / Celkový pokrok" — Richard 13. 8. 2026. „Jen název" tedy platí
    // pro CELOU mapu, ne jen pro karty; v kruhu se tím navíc uvolní místo
    // pro větší nadpis.
    jenNazevVrcholu: true,
  },
};

// Vrchol mapy (kruh) se čitelnosti účastní taky — Richard 13. 8. 2026:
// „měníme pouze uzly, ale ne ten hlavní kruhový." Kruh má PEVNÝCH 260 px
// (mění se s ním rozestup APEX_STEP a šířka celé mapy), takže se nezvětšuje
// on, ale písmo v něm: žebříček se posune o stupeň, resp. o dva.
// ⚠️ Bez toho byl ve stupni „jen název" hlavní cíl s dlouhým textem vysázený
// 14 px, kdežto cíle POD ním 30 px — nejdůležitější text mapy byl nejmenší
// a hierarchie se obrátila.
export const APEX_ZEBRICEK = ['text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl'];
// ⚠️ „jen název" posouvá o TŘI stupně, ne o dva: v kruhu se v něm neukazují
// odznaky ani blok pokroku, takže je tam volné místo — a nechat ho prázdné
// je přesně ta výtka, kterou měl Richard u karet („nevyužíváme potenciál").
const APEX_POSUN = { normal: 0, large: 1, titleOnly: 3 };

// Základ podle DÉLKY textu zůstává (dlouhý název se do kruhu musí vejít),
// stupeň čitelnosti ho jen posune nahoru.
export function tridaVrcholu(delkaTextu, stupen) {
  const zaklad = delkaTextu > 60 ? 0 : delkaTextu > 30 ? 1 : 2;
  const i = Math.min(zaklad + (APEX_POSUN[platnyStupen(stupen)] || 0), APEX_ZEBRICEK.length - 1);
  return APEX_ZEBRICEK[i];
}

// Hodnota z prohlížeče se NIKDY nesmí použít k indexování rovnou: stupeň
// „__proto__" by vrátil zděděnou vlastnost místo undefined a React by dostal
// místo tříd objekt (táž past jako u stylů zarovnání, panel /checkup 12. 8.).
export function platnyStupen(v) {
  return CITELNOST_STUPNE.includes(v) ? v : VYCHOZI_STUPEN;
}

export function nactiStupen() {
  return platnyStupen(nactiKlic(KLIC_CITELNOST));
}

export function dalsiStupen(v) {
  const i = CITELNOST_STUPNE.indexOf(platnyStupen(v));
  return CITELNOST_STUPNE[(i + 1) % CITELNOST_STUPNE.length];
}

// třídy pro vykreslení uzlu; vždy vrátí platný objekt, i pro nesmysl na vstupu
export function tridyCitelnosti(v) {
  return CITELNOST[platnyStupen(v)];
}
