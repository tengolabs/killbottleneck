// LICENCE: tenhle soubor je výjimka. killBottleneck je fair-code (Sustainable
// Use License), ale validátor je uvolněný pod CC0-1.0 — public domain, bez
// podmínek. Důvod: editor skinů má být doopravdy open source (MIT) a bez
// validátoru nefunguje, takže by "open source" bylo jen na papíře. Kontroluje
// se tu formát dat, ne know-how produktu.
// Uvolnil držitel práv (Tengo s.r.o.) 8. 8. 2026.
//
// Validátor formátu kb-skin v1 — JEDINÁ autorita nad tím, co smí skin obsahovat.
// Skin je čistá data (JSON), NIKDY libovolné CSS: barvy jen jako holé HSL trojice,
// fonty jako pole názvů rodin (stack skládá klient), radius z omezené množiny.
// Nic z uživatelského vstupu se nedostane do CSS jako surový string.
//
// ⚠️ KOPIE: product/server/pb_hooks/skinValidator.js (CJS pro Goja).
// Drift obou kopií hlídá product/tests/skin-validator-parity.js — změny dělat v OBOU.

export const SKIN_SCHEMA_VERSION = 1;
export const SKIN_MAX_BYTES = 8192;

// Vestavěné skiny + 'custom' — sdílí users.skin_id (migrace) i sanitizace v hooku.
// ⚠️ Nový vestavěný skin = přidat SEM + do skins.js + MIGRACE rozšiřující SelectField
// values na users.skin_id a instance_settings.builtin_id + i18n název v common.json.
export const KNOWN_SKIN_IDS = ['indigo', 'contrast', 'terminal', 'sepia',
  'ocean', 'les', 'pulnoc', 'svestka', 'broskev', 'grafit', 'rubin', 'custom'];

// 1:1 s index.css :root/.dark (32 barev) + 5 canvas tokenů plátna mapy
// (neutrální hrana + hrana do hotového + hrana po termínu, tečky, uzel).
export const SKIN_COLOR_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground',
  'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'destructive', 'destructive-foreground', 'border', 'input', 'ring',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
  'sidebar-background', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
  'canvas-edge', 'canvas-edge-done', 'canvas-edge-late', 'canvas-dots', 'canvas-node',
];
export const SKIN_FONT_TOKENS = ['font-heading', 'font-body', 'font-display', 'font-mono'];
// Dekorativní malůvka v pozadí LITE režimu. Skin říká jen JMÉNO z výčtu —
// samotné SVG je součást aplikace (lite/LitePattern), do skinu nikdy nejde
// obrázek ani URL. Kreslí se barvou primary s nízkou průhledností.
export const SKIN_PATTERNS = ['leaves', 'wave', 'rings', 'stripes', 'prompt',
  'lines', 'stars', 'petals', 'arcs', 'grid', 'scope'];
// Poslední položka font stacku MUSÍ být generická — neznámá rodina pak neškodně
// spadne na ni (webfonty se nikdy nestahují, k dispozici jsou jen bundlené a systémové).
export const SKIN_FONT_GENERICS = ['sans-serif', 'serif', 'monospace', 'system-ui'];

const HSL_RE = /^\d{1,3}(\.\d+)?[ ]+\d{1,3}(\.\d+)?%[ ]+\d{1,3}(\.\d+)?%$/;
// Kontrolní znaky (vč. ANSI escape) nemají v meta polích co dělat — jinak jde
// záškodnickým name podvrhnout výstup CI logu galerie (falešné ✅).
const CTRL_RE = /[\u0000-\u001f\u007f]/;
const RADIUS_RE = /^(\d+(\.\d+)?)(rem|px)$/;
const FONT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,40}$/;
// CSS ident bez uvozovek (generika se NESMÍ uvozovat, jinak přestane být generikou)
const BARE_IDENT_RE = /^[A-Za-z][A-Za-z0-9\-]*$/;

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function validHsl(v) {
  if (typeof v !== 'string' || !HSL_RE.test(v.trim())) return false;
  const parts = v.trim().split(/ +/);
  const h = parseFloat(parts[0]);
  const s = parseFloat(parts[1]);
  const l = parseFloat(parts[2]);
  return h <= 360 && s <= 100 && l <= 100;
}

function validRadius(v) {
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (t === '0') return true;
  const m = RADIUS_RE.exec(t);
  if (!m) return false;
  const n = parseFloat(m[1]);
  return m[3] === 'rem' ? n <= 2 : n <= 32;
}

function validFontList(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 8) return false;
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string' || !FONT_NAME_RE.test(v[i].trim())) return false;
  }
  return SKIN_FONT_GENERICS.indexOf(v[v.length - 1].trim()) !== -1;
}

// Pole rodin → CSS hodnota. Uvozovky přidává výhradně tahle funkce (názvy dle
// FONT_NAME_RE uvozovky obsahovat nemohou) — surový string autora do CSS nejde.
export function fontStack(list) {
  return list
    .map((name) => name.trim())
    .map((name) => (BARE_IDENT_RE.test(name) ? name : "'" + name + "'"))
    .join(', ');
}

function metaString(input, key, maxLen, required, errors, clean) {
  const v = input[key];
  if (v === undefined || v === null || v === '') {
    if (required) errors.push('bad-' + key);
    return;
  }
  if (typeof v !== 'string' || v.trim().length === 0 || v.trim().length > maxLen || CTRL_RE.test(v)) {
    errors.push('bad-' + key);
    return;
  }
  clean[key] = v.trim();
}

// Sekce (light/dark): staví se iterací WHITELISTU, ne vstupu — druhá obranná linie.
// Neznámý klíč = warning + zahodit (dopředná kompatibilita: skin pro novější minor
// verzi formátu se aplikuje po tokenech, které tahle verze zná).
// Nevalidní HODNOTA známého tokenu = tvrdá chyba (autor má o překlepu vědět).
function cleanSection(section, label, errors, warnings) {
  if (!isPlainObject(section)) {
    errors.push('bad-section:' + label);
    return null;
  }
  const known = SKIN_COLOR_TOKENS.concat(SKIN_FONT_TOKENS, ['radius', 'pattern']);
  Object.keys(section).forEach((k) => {
    if (known.indexOf(k) === -1) warnings.push('unknown-token:' + label + '.' + k);
  });
  const out = {};
  SKIN_COLOR_TOKENS.forEach((k) => {
    if (section[k] === undefined) return;
    if (validHsl(section[k])) out[k] = section[k].trim();
    else errors.push('bad-color:' + label + '.' + k);
  });
  SKIN_FONT_TOKENS.forEach((k) => {
    if (section[k] === undefined) return;
    if (validFontList(section[k])) out[k] = section[k].map((f) => f.trim());
    else errors.push('bad-font:' + label + '.' + k);
  });
  if (section.radius !== undefined) {
    if (validRadius(section.radius)) out.radius = section.radius.trim();
    else errors.push('bad-radius:' + label);
  }
  if (section.pattern !== undefined) {
    if (typeof section.pattern === 'string' && SKIN_PATTERNS.indexOf(section.pattern.trim()) !== -1) {
      out.pattern = section.pattern.trim();
    } else {
      errors.push('bad-pattern:' + label);
    }
  }
  return out;
}

// → { ok, errors, warnings, clean }
// ok=false ⇒ clean=null (server v hooku ukládá clean, nevalidní tiše zahodí;
// klient chyby hlásí uživateli PŘED uložením). Warnings skin neblokují.
export function validateSkin(input) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['not-an-object'], warnings: warnings, clean: null };
  }
  let serialized = '';
  try { serialized = JSON.stringify(input); } catch (e) { serialized = null; }
  if (serialized === null || serialized.length > SKIN_MAX_BYTES) {
    return { ok: false, errors: ['too-big'], warnings: warnings, clean: null };
  }
  if (input.format !== 'kb-skin') errors.push('bad-format');
  if (input.version !== SKIN_SCHEMA_VERSION) errors.push('unsupported-version');

  const clean = { format: 'kb-skin', version: SKIN_SCHEMA_VERSION };
  metaString(input, 'name', 60, true, errors, clean);
  metaString(input, 'author', 80, false, errors, clean);
  metaString(input, 'description', 200, false, errors, clean);
  metaString(input, 'license', 40, false, errors, clean);

  if (input.light === undefined) {
    errors.push('missing-light');
  } else {
    const light = cleanSection(input.light, 'light', errors, warnings);
    if (light && Object.keys(light).length === 0) errors.push('missing-light');
    if (light) clean.light = light;
  }
  if (input.dark !== undefined) {
    const dark = cleanSection(input.dark, 'dark', errors, warnings);
    if (dark) clean.dark = dark;
  }

  const ok = errors.length === 0;
  return { ok: ok, errors: errors, warnings: warnings, clean: ok ? clean : null };
}
