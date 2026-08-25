// i18n (cs + en) — react-i18next, katalog se načítá PO JAZYCÍCH (lite dieta:
// oba jazyky v bundlu = ~50 kB min navíc pro každého). Žádný Suspense/flash:
// main.jsx čeká s prvním renderem, až je aktivní jazyk načtený (boot-gate),
// takže důvod původního „vše staticky" zůstává splněný.
// Druhý jazyk se dotahuje až při přepnutí (setLang v lib/lang.js).
// Konvence klíčů: namespace:komponenta.vyznam (camelCase), plurály přes
// suffixy _one/_few/_many/_other (čeština má i _many pro desetinná čísla!).
// Fallback cs u EN uživatele nemá katalog v paměti — kompletnost EN klíčů
// hlídá tests/i18n-catalog.js (parita cs↔en), takže fallback není potřeba.
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { detectLang } from '@/lib/lang';

export const NAMESPACES = ['common', 'nav', 'auth', 'home', 'editor', 'tasks', 'myday', 'notify', 'errors', 'lite'];

// explicitní mapa (ne template import) — vite z ní udělá pojmenované chunky
const PACKS = {
  cs: () => import('./cs.js'),
  en: () => import('./en.js'),
};

// Donačte jazykový balík do běžící instance (idempotentní). Volá setLang.
export async function loadLanguage(lng) {
  if (!PACKS[lng] || i18n.hasResourceBundle(lng, 'common')) return;
  const pack = (await PACKS[lng]()).default;
  // Jen namespace, které balík opravdu má: líné ns (billing, admin, organizace…)
  // si react-i18next přidává do options.ns za běhu a v balíku nejsou —
  // addResourceBundle s undefined shodil celé přepnutí jazyka (nález 25. 8. 2026).
  for (const ns of NAMESPACES) if (pack[ns]) i18n.addResourceBundle(lng, ns, pack[ns], true, true);
}

// Init s JEDNÍM jazykem; main.jsx na výsledný promise čeká před renderem.
export const i18nReady = (async () => {
  const lng = detectLang();
  const pack = (await (PACKS[lng] || PACKS.cs)()).default;
  await i18n.use(initReactI18next).init({
    resources: { [lng]: pack },
    lng,
    fallbackLng: 'cs',
    // ⚠️ KOPIE, ne sdílená reference: react-i18next do options.ns za běhu
    // pushuje líné namespace (useTranslation('billing') apod.) — se sdíleným
    // polem by NAMESPACES rostlo a loadLanguage by pak vkládal undefined.
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false }, // React escapuje sám
    react: { useSuspense: false },
  });
  document.documentElement.lang = i18n.language;
})();

// <html lang> drží krok s aktivním jazykem (přístupnost, správné lámání slov).
i18n.on('languageChanged', (l) => {
  document.documentElement.lang = l;
});

export default i18n;
