// Jmeniny (lib/nameDays.js) — ručně vypsaná tabulka nesmí mít díry: 366 klíčů
// (vč. 29.2.), každý den přestupného roku pokrytý, spot-checky známých dat.
// Čistý unit — žádný kontejner; ESM modul se načítá dynamickým importem.
const path = require('path');

(async () => {
  const mod = await import('file://' + path.resolve(__dirname, '../frontend/src/lib/nameDays.js'));
  const { NAME_DAYS, todayNameDay } = mod;
  let pass = 0, fail = 0;
  const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));

  expect(Object.keys(NAME_DAYS).length === 366, `tabulka má 366 klíčů (${Object.keys(NAME_DAYS).length})`);
  const missing = [];
  for (let m = 0; m < 12; m++) {
    const days = new Date(2024, m + 1, 0).getDate(); // 2024 = přestupný
    for (let d = 1; d <= days; d++) if (!(`${m + 1}-${d}` in NAME_DAYS)) missing.push(`${m + 1}-${d}`);
  }
  expect(missing.length === 0, `žádný den roku nechybí (${missing.join(', ') || 'OK'})`);
  const spots = [
    ['7-21', 'Vítězslav'], ['12-24', 'Adam a Eva'], ['9-28', 'Václav'],
    ['12-31', 'Silvestr'], ['5-1', ''], ['2-29', 'Horymír'], ['11-17', 'Mahulena'],
  ];
  for (const [k, v] of spots) expect(NAME_DAYS[k] === v, `${k} = „${v || '(bez jmeniny)'}" (je „${NAME_DAYS[k]}")`);
  expect(todayNameDay(new Date(2026, 6, 21)) === 'Vítězslav', 'todayNameDay(21.7.) = Vítězslav');
  expect(todayNameDay(new Date(2026, 0, 1)) === '', 'todayNameDay(1.1.) = prázdné (státní svátek)');
  const nonEmpty = Object.values(NAME_DAYS).filter(Boolean).length;
  expect(nonEmpty >= 350, `≥350 dní má jmeninu (${nonEmpty})`);

  console.log(`\n${pass} ✅ / ${fail} ❌`);
  process.exit(fail ? 1 : 0);
})();
