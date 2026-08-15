// Kategorie šablon — jediný zdroj pravdy (galerie i ukládání vlastní šablony).
// Labely přes gettery, ať čtou vždy aktuální jazyk (viz statusMeta.js).
import i18next from 'i18next';

const CATEGORY_KEYS = [
  'osobni', 'prace', 'byznys', 'skola', 'zdravi', 'finance',
  'cestovani', 'koniky', 'kvalita', 'strategie', 'procesy', 'kanban',
];

export const categoryLabels = {};
for (const k of CATEGORY_KEYS) {
  Object.defineProperty(categoryLabels, k, {
    // „Kanban" je jazykově neutrální → label NATVRDO, ne přes common.json —
    // jazykové balíky jedou i v lite a ten je PŘESNĚ na prahu 490 kB
    get() { return k === 'kanban' ? 'Kanban' : i18next.t(`common:category.${k}`); },
    enumerable: true,
  });
}

export function getCategoryLabel(cat) {
  if (categoryLabels[cat]) return categoryLabels[cat];
  return cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
}
