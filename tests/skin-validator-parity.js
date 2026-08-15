// Parita validátoru skinů: frontend lib/skinValidator.js (ESM, import v UI)
// MUSÍ vracet bit-shodné výsledky jako pb_hooks/skinValidator.js (CJS, users hook
// + /instance-skin). Chrání proti tichému driftu dvou kopií (vzor cleanmap-parity).
// + vestavěné skiny (lib/skins.js) musí validátorem projít beze změny
// + VÝCHOZÍ skin MUSÍ být 1:1 s index.css :root/.dark. Prohlížeč vykreslí
//   stránku z index.css DŘÍV, než se JS dostane ke skinu — když se rozejdou,
//   každé načtení blikne cizími barvami. Do 6. 8. 2026 byl výchozí indigo;
//   po přepnutí na „les" (Richard) se index.css srovnal s ním, jinak by
//   parita padala právem. Bez dockeru.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

const VALID = {
  format: 'kb-skin', version: 1, name: 'Test', author: 'A', license: 'CC0-1.0',
  description: 'popis',
  light: {
    background: '40 30% 96%', primary: '25 60% 35%', radius: '0.75rem',
    'font-heading': ['Georgia', 'serif'], 'canvas-dots': '38 22% 84%',
  },
  dark: { background: '30 10% 12%' },
};

// [název, vstup] — projede se oběma kopiemi, výsledky se porovnají bit po bitu
const FIXTURES = [
  ['validní skin', VALID],
  ['minimální skin (jen name + 1 token)', { format: 'kb-skin', version: 1, name: 'X', light: { primary: '1 2% 3%' } }],
  ['neznámý token → warning + strip', { ...VALID, light: { ...VALID.light, 'status-todo': '1 2% 3%', __proto: 'x' } }],
  ['url() ve fontu → chyba', { ...VALID, light: { ...VALID.light, 'font-body': ['x;url(evil)', 'sans-serif'] } }],
  ['font bez generiky na konci → chyba', { ...VALID, light: { ...VALID.light, 'font-body': ['Georgia'] } }],
  ['hex místo HSL → chyba', { ...VALID, light: { ...VALID.light, primary: '#ff0000' } }],
  ['hsl() obálka → chyba', { ...VALID, light: { ...VALID.light, primary: 'hsl(25 60% 35%)' } }],
  ['H přes 360 → chyba', { ...VALID, light: { ...VALID.light, primary: '361 50% 50%' } }],
  ['radius mimo rozsah → chyba', { ...VALID, light: { ...VALID.light, radius: '99rem' } }],
  ['radius se smetím → chyba', { ...VALID, light: { ...VALID.light, radius: '1rem; color:red' } }],
  ['pattern z výčtu → projde', { ...VALID, light: { ...VALID.light, pattern: 'wave' } }],
  ['pattern mimo výčet → chyba', { ...VALID, light: { ...VALID.light, pattern: 'kytky' } }],
  ['version 2 → chyba (novější formát)', { ...VALID, version: 2 }],
  ['chybí format → chyba', { name: 'X', version: 1, light: { primary: '1 2% 3%' } }],
  ['chybí light → chyba', { format: 'kb-skin', version: 1, name: 'X' }],
  ['light prázdný objekt → chyba', { format: 'kb-skin', version: 1, name: 'X', light: {} }],
  ['light jen z neznámých tokenů → chyba', { format: 'kb-skin', version: 1, name: 'X', light: { foo: '1 2% 3%' } }],
  ['name přes 60 znaků → chyba', { ...VALID, name: 'x'.repeat(61) }],
  ['name chybí → chyba', { format: 'kb-skin', version: 1, light: { primary: '1 2% 3%' } }],
  ['pole místo objektu → chyba', ['kb-skin']],
  ['null → chyba', null],
  ['dark nevalidní typ → chyba', { ...VALID, dark: 'tma' }],
  ['přetečení velikosti → chyba', { ...VALID, description: 'x'.repeat(9000) }],
  // kontrolní znaky v meta: ANSI escape v name umí podvrhnout CI log galerie
  ['ANSI escape v name → chyba', { ...VALID, name: '[32m✅ fake[0m' }],
  ['newline v description → chyba', { ...VALID, description: 'a\nb' }],
  ['newline uvnitř HSL → chyba', { ...VALID, light: { ...VALID.light, primary: '25\n60%\n35%' } }],
  ['tab uvnitř HSL → chyba', { ...VALID, light: { ...VALID.light, primary: '25\t60% 35%' } }],
];

(async () => {
  const fe = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/skinValidator.js')).href);
  const be = require(path.join(__dirname, '../server/pb_hooks/skinValidator.js'));
  const skinsMod = await import(pathToFileURL(path.join(__dirname, '../frontend/src/lib/skins.js')).href);

  console.log('== PARITA FE(ESM) ↔ server(CJS) na matici fixtur ==');
  for (const [name, input] of FIXTURES) {
    const a = fe.validateSkin(input);
    const b = be.validateSkin(input);
    ok(JSON.stringify(a) === JSON.stringify(b), `shoda: ${name}`);
  }
  ok(JSON.stringify(fe.SKIN_COLOR_TOKENS) === JSON.stringify(be.SKIN_COLOR_TOKENS)
    && JSON.stringify(fe.SKIN_FONT_TOKENS) === JSON.stringify(be.SKIN_FONT_TOKENS)
    && JSON.stringify(fe.KNOWN_SKIN_IDS) === JSON.stringify(be.KNOWN_SKIN_IDS)
    && fe.SKIN_MAX_BYTES === be.SKIN_MAX_BYTES
    && fe.SKIN_SCHEMA_VERSION === be.SKIN_SCHEMA_VERSION,
  'konstanty (tokeny, id, limity, verze) shodné');
  ok(fe.fontStack(['Plus Jakarta Sans', 'ui-sans-serif', 'sans-serif'])
      === be.fontStack(['Plus Jakarta Sans', 'ui-sans-serif', 'sans-serif'])
    && fe.fontStack(['Plus Jakarta Sans', 'sans-serif']) === "'Plus Jakarta Sans', sans-serif"
    && fe.fontStack(['123Font', 'serif']) === "'123Font', serif",
  'fontStack: shodné skládání + uvozovky jen kde CSS ident nestačí');

  console.log('== sémantika (MUTACE — výsledek, ne jen shoda kopií) ==');
  {
    const r = fe.validateSkin(VALID);
    ok(r.ok && r.errors.length === 0, 'validní skin projde');
    ok(r.clean.light.primary === '25 60% 35%' && r.clean.dark.background === '30 10% 12%',
      'clean nese hodnoty obou sekcí');
    const smuggled = fe.validateSkin({ ...VALID, light: { ...VALID.light, 'status-todo': '1 2% 3%' } });
    ok(smuggled.ok && smuggled.clean.light['status-todo'] === undefined
      && smuggled.warnings.some((w) => w.includes('status-todo')),
    'neznámý token: skin projde, token ZMIZÍ z clean, warning ho jmenuje');
    const evil = fe.validateSkin({ ...VALID, light: { ...VALID.light, 'font-body': ['x;url(evil)', 'sans-serif'] } });
    ok(!evil.ok && evil.clean === null, 'url() ve fontu: ok=false a clean=null (nic k uložení)');
    const v2 = fe.validateSkin({ ...VALID, version: 2 });
    ok(!v2.ok && v2.errors.includes('unsupported-version'), 'version 2 → unsupported-version');
    const pat = fe.validateSkin({ ...VALID, light: { ...VALID.light, pattern: 'wave' } });
    ok(pat.ok && pat.clean.light.pattern === 'wave', 'pattern z výčtu přežije do clean');
  }

  console.log('== vestavěné skiny projdou vlastním validátorem ==');
  for (const skin of skinsMod.BUILTIN_SKINS) {
    const r = fe.validateSkin(skin);
    ok(r.ok, `${skin.id}: validní (${r.errors.join(', ') || 'ok'})`);
    ok(fe.KNOWN_SKIN_IDS.includes(skin.id), `${skin.id}: id je ve výčtu KNOWN_SKIN_IDS`);
  }
  ok(!!skinsMod.getBuiltinSkin(skinsMod.DEFAULT_SKIN_ID),
    `výchozí skin „${skinsMod.DEFAULT_SKIN_ID}" existuje`);

  console.log('== výchozí skin je 1:1 s index.css (:root = light, .dark = dark) ==');
  {
    const css = fs.readFileSync(path.join(__dirname, '../frontend/src/index.css'), 'utf8');
    // vytáhne { --token: hodnota } z prvního bloku daného selektoru
    const cssBlock = (sel) => {
      const m = css.match(new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}'));
      const out = {};
      for (const line of (m ? m[1] : '').split('\n')) {
        const mm = line.match(/--([a-z0-9-]+):\s*([^;]+);/i);
        if (mm) out[mm[1]] = mm[2].trim();
      }
      return out;
    };
    // uvozovky jsou věc zápisu, ne hodnoty ('Inter' ≡ Inter) — porovnáváme obsah
    const norm = (v) => v.replace(/["']/g, '');
    const vychozi = skinsMod.getBuiltinSkin(skinsMod.DEFAULT_SKIN_ID);
    const compare = (section, blockSel, label) => {
      const block = cssBlock(blockSel);
      const bad = [];
      for (const k of fe.SKIN_COLOR_TOKENS) {
        if (section[k] === undefined && block[k] === undefined) continue;
        if (section[k] !== block[k]) bad.push(`${k}: skin=${section[k]} css=${block[k]}`);
      }
      for (const k of fe.SKIN_FONT_TOKENS) {
        if (section[k] === undefined && block[k] === undefined) continue;
        if (norm(fe.fontStack(section[k] || [])) !== norm(block[k] || '')) bad.push(`${k}: font drift`);
      }
      if ((section.radius || block.radius) && section.radius !== block.radius) bad.push('radius drift');
      ok(bad.length === 0, `${label} shodné (${bad.length ? bad.slice(0, 2).join(' | ') : 'ok'})`);
    };
    compare(vychozi.light, ':root', 'light sekce ↔ :root');
    compare(vychozi.dark, '.dark', 'dark sekce ↔ .dark');
  }

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} SKIN VALIDATOR PARITY PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})();
