// Klíč týdne na časové ose (Gantt): ISO ROK + ISO týden (lib/kalendar.js:
// isoTyden / klicTydne). Hlídá přelomy roku 2026/27 (týden 53), 2027/28 (1. 1.
// je sobota → ještě týden 52/2027) a 2020/21 (týden 53). Bez dockeru.
//
// MUTAČNÍ DŮKAZ (analýza kódu 3, F3-06): na zdrojáku v0.98-beta sada ČERVENÁ —
// klicTydne v lib/kalendar.js neexistuje a TaskTimeline.jsx skládá klíč
// z `getFullYear()` → 28. 12. 2026 „2026-W53“, 1. 1. 2027 „2027-W53“ = týž ISO
// týden pod dvěma klíči → dva sousední bloky „53. týden“ v hlavičce.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));
const FE = path.join(__dirname, '../frontend/src');

(async () => {
  const K = await import(pathToFileURL(path.join(FE, 'lib/kalendar.js')).href);
  ok(typeof K.klicTydne === 'function' && typeof K.isoTyden === 'function', 'lib/kalendar.js exportuje klicTydne a isoTyden');
  const d = (y, m, dd) => new Date(y, m - 1, dd);

  console.log('== přelom 2026/27: ISO týden 53 roku 2026 sahá do 3. 1. 2027 ==');
  const PRIPADY = [
    [d(2026, 12, 28), '2026-W53', 'Po 28. 12. 2026'],
    [d(2026, 12, 31), '2026-W53', 'Čt 31. 12. 2026'],
    [d(2027, 1, 1), '2026-W53', 'Pá 1. 1. 2027 (kalendářní rok 2027, ISO rok 2026)'],
    [d(2027, 1, 3), '2026-W53', 'Ne 3. 1. 2027'],
    [d(2027, 1, 4), '2027-W1', 'Po 4. 1. 2027 = první týden 2027'],
    // 2027/28: 1. 1. 2028 je sobota → patří do 52. týdne 2027
    [d(2027, 12, 27), '2027-W52', 'Po 27. 12. 2027'],
    [d(2027, 12, 31), '2027-W52', 'Pá 31. 12. 2027'],
    [d(2028, 1, 1), '2027-W52', 'So 1. 1. 2028 (ISO rok 2027)'],
    [d(2028, 1, 2), '2027-W52', 'Ne 2. 1. 2028'],
    [d(2028, 1, 3), '2028-W1', 'Po 3. 1. 2028 = první týden 2028'],
    // 2020/21: rok s 53 týdny
    [d(2020, 12, 28), '2020-W53', 'Po 28. 12. 2020'],
    [d(2021, 1, 1), '2020-W53', 'Pá 1. 1. 2021 (ISO rok 2020)'],
    [d(2021, 1, 3), '2020-W53', 'Ne 3. 1. 2021'],
    [d(2021, 1, 4), '2021-W1', 'Po 4. 1. 2021'],
    // obráceně: 30. 12. 2024 (Po) už je 1. týden 2025
    [d(2024, 12, 30), '2025-W1', 'Po 30. 12. 2024 = 1. týden 2025 (ISO rok větší než kalendářní)'],
    [d(2026, 11, 4), '2026-W45', 'St 4. 11. 2026 = 45. týden (běžný den)'],
  ];
  for (const [den, cekano, popis] of PRIPADY) {
    const k = K.klicTydne(den);
    ok(k === cekano, `${popis} → ${k} (čeká se ${cekano})`);
  }

  console.log('== souvislá osa: každý ISO týden má na ose právě JEDEN klíč (žádný blok se nerozpadne) ==');
  {
    // 1. 12. 2026 – 31. 1. 2028: projde přelomy 2026/27 i 2027/28
    const klice = [];
    for (let t = d(2026, 12, 1); t <= d(2028, 1, 31); t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
      const k = K.klicTydne(t);
      if (klice[klice.length - 1] !== k) klice.push(k);
    }
    const unik = new Set(klice);
    ok(unik.size === klice.length, `sekvence klíčů bez opakování (${klice.length} bloků, ${unik.size} unikátních)`);
    const i53 = klice.indexOf('2026-W53');
    ok(i53 >= 0 && klice[i53 + 1] === '2027-W1', `po 2026-W53 následuje rovnou 2027-W1 (${klice.slice(i53, i53 + 2).join(' | ')})`);
    ok(klice.every((k) => /^\d{4}-W([1-9]|[1-4]\d|5[0-3])$/.test(k)), 'čísla týdnů 1…53, žádný týden 0 ani 54');
  }

  console.log('== osa používá klicTydne (ne kalendářní rok) ==');
  {
    const src = fs.readFileSync(path.join(FE, 'components/tasks/TaskTimeline.jsx'), 'utf8');
    ok(/klicTydne\(d\)/.test(src), 'TaskTimeline.jsx skládá wKey přes klicTydne');
    ok(!/getFullYear\(\)\}-W\$\{/.test(src), 'TaskTimeline.jsx už nemá `${getFullYear()}-W${…}`');
  }

  console.log(`\n${fail === 0 ? '🟢' : '🔴'} KLIC TYDNE PASS ${pass} / FAIL ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.log('  ❌ výjimka:', String(e && e.message || e)); console.log(`\n🔴 KLIC TYDNE PASS ${pass} / FAIL ${fail + 1}`); process.exit(1); });
