// Sdílená paleta pro vzhled projektu (mapy). Barva se ukládá jako hex do
// goalmaps.color (prázdné = bez barvy → výchozí primary akcent). Emoji žije
// přímo v názvu projektu (title), zvláštní pole nepotřebuje.
// name = getter, ať čte vždy aktuální jazyk (viz statusMeta.js).
import i18next from 'i18next';

const colorEntry = (key, value) => ({
  get name() { return i18next.t(`common:color.${key}`); },
  value,
});

export const PROJECT_COLORS = [
  colorEntry('blue', '#3b82f6'),
  colorEntry('cyan', '#06b6d4'),
  colorEntry('green', '#10b981'),
  colorEntry('lime', '#84cc16'),
  colorEntry('yellow', '#eab308'),
  colorEntry('orange', '#f97316'),
  colorEntry('red', '#ef4444'),
  colorEntry('pink', '#ec4899'),
  colorEntry('purple', '#8b5cf6'),
  colorEntry('slate', '#64748b'),
];

// Kurátorovaná sada emoji ikon projektu (žádná externí závislost).
export const PROJECT_EMOJIS = [
  '🚀', '🎯', '📈', '💡', '🏆', '🔥', '⭐', '📊',
  '💰', '🛠️', '🧩', '📅', '✅', '📝', '🎨', '🎬',
  '🎵', '📷', '🏗️', '🌱', '🌍', '🏠', '🏢', '🛒',
  '✈️', '🚗', '❤️', '🧠', '🔬', '⚙️', '📚', '💻',
  '📱', '🎓', '⚽', '🏋️', '🧘', '🐾', '🎉', '💼',
  '🔑', '🗂️', '📦', '🧭', '🎮', '🩺', '☕', '🎁',
];

const EMOJI_SET = new Set(PROJECT_EMOJIS);

// Vytáhne vedoucí emoji z názvu (jen z naší sady), jinak ''.
export function getTitleEmoji(title) {
  const first = (title || '').trim().split(/\s+/)[0];
  return EMOJI_SET.has(first) ? first : '';
}

// Vrátí název s daným vedoucím emoji (nebo bez, když emoji = '').
// Případné staré vedoucí emoji z naší sady nahradí.
export function setTitleEmoji(title, emoji) {
  const trimmed = (title || '').trim();
  const parts = trimmed.split(/\s+/);
  const rest = (parts.length && EMOJI_SET.has(parts[0])) ? parts.slice(1).join(' ') : trimmed;
  return emoji ? `${emoji} ${rest}`.trim() : rest;
}

// Poloprůhledný tint z hex barvy (8-místný hex s alfa) — pro jemná pozadí/rámečky.
export const colorTint = (hex, alpha = '22') => (hex ? `${hex}${alpha}` : undefined);

// Vrcholový (apex) uzel projektu — nositel ikony i stavu hlavního cíle.
export function apexNode(map) {
  const nodes = map?.nodes || [];
  return nodes.find((n) => n.type === 'apexNode' || n.data?.nodeType === 'apex') || nodes[0] || null;
}

// Ikona projektu = ikona vrcholového uzlu (`data.icon`); fallback = vedoucí emoji
// z názvu (kvůli starším projektům s emoji v title). JEDEN zdroj pravdy.
export function projectIcon(map) {
  return apexNode(map)?.data?.icon || getTitleEmoji(map?.title || '');
}

// Zobrazovaný název projektu = title bez vedoucího emoji (starší projekty).
export function projectName(map) {
  const t = map?.title || '';
  return setTitleEmoji(t, '') || t;
}
