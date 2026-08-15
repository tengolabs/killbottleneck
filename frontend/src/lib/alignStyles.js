// Styly zarovnání mapy — jedno místo pro tlačítko Zarovnat, zámeček a zakládání
// nové mapy. Dřív žily jen v GoalMapEditor.jsx, takže nová mapa ze šablony
// layoutovala bez parametrů (tedy vždy „do šířky"), ačkoliv úvodní mapu server
// zakládal kompaktně — rozpor, který si Richard 11. 8. 2026 v noci všiml.
import { nactiKlic } from '@/lib/storageKeys';

export const ALIGN_STYLES = ['classic', 'compact', 'bands'];

export const ALIGN_OPTS = {
  classic: {},
  compact: { stagger: 2 },
  // „po kategoriích" (Richardův návrh 11. 8.): celé kategorie s cíli střídavě
  // ve dvou pásech; na mapě o jedné řadě karty obcházejí vrchol
  bands: { bands: 2 },
};

// Zamčený styl platí pro VŠECHNY mapy (Richard 11. 8.: „na jedné to prokliká,
// zjistí, že se mu to líbí, a pak dá zámeček"). Bez zámku vzniká nová mapa
// kompaktně — úzká se vejde na obrazovku bez oddalování.
export const KLIC_ZAMEK = 'kb-zarovnat-zamek';
export const VYCHOZI_STYL_NOVE_MAPY = 'compact';

// Hodnota z prohlížeče se NIKDY nesmí použít k indexování rovnou: styl
// „__proto__" by vrátil zděděnou vlastnost místo undefined a React by dostal
// místo ikony objekt (panel /checkup 12. 8.). Projde jen známý styl.
export function platnyStyl(v) {
  return ALIGN_STYLES.includes(v) ? v : '';
}

export function zamcenyStyl() {
  return platnyStyl(nactiKlic(KLIC_ZAMEK));
}

// styl, kterým se má vykreslit čerstvě zakládaná mapa
export function stylNoveMapy() {
  return zamcenyStyl() || VYCHOZI_STYL_NOVE_MAPY;
}

export function optsNoveMapy() {
  return ALIGN_OPTS[stylNoveMapy()] || {};
}
