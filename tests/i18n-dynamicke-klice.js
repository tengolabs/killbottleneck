// Translation keys that the code composes at run time must exist in both languages — no docker.
// Finding F6-02 (code analysis 4): a clean-up of "unused" keys searched for literal strings only and removed
// `importMap.from_asana` / `from_trello`, which ImportMapDialog builds as `importMap.from_${source}`; after
// an import from Asana or Trello the sentence then began with the raw key.
// A new dynamic key = a new line in DYNAMIC below. Run: node product/tests/i18n-dynamicke-klice.js
const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..', 'frontend', 'src');
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const DYNAMIC = [
  { file: 'components/shared/ImportMapDialog.jsx', pattern: 'importMap.from_${source}', ns: 'editor', keys: ['importMap.from_asana', 'importMap.from_trello'] },
];
const get = (obj, key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
for (const d of DYNAMIC) {
  const code = fs.readFileSync(path.join(SRC, d.file), 'utf8');
  expect(code.includes(d.pattern), `${d.file} skládá klíč „${d.pattern}“ (seznam v této sadě odpovídá kódu)`);
  for (const lang of ['cs', 'en']) {
    const cat = JSON.parse(fs.readFileSync(path.join(SRC, 'i18n', lang, `${d.ns}.json`), 'utf8'));
    for (const k of d.keys) {
      const v = get(cat, k);
      expect(typeof v === 'string' && v.trim().length > 3, `${lang}/${d.ns}.json má „${k}“ („${v}“)`);
    }
  }
}
console.log(`\n${fail ? '🔴' : '🟢'} I18N-DYNAMICKE-KLICE PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
