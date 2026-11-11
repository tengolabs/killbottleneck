// Asistent vlevo/vpravo — čisté moduly bez dockeru: skupiny rozhovorů přes změnu času, strana panelu přežije odhlášení.
// Hlídá: lib/conversationGroups.js počítá „Včera“ / „Tento týden“ po KALENDÁŘI (den změny času má 23 / 25 h),
// lib/storageKeys.js smazKliceAsistenta() nechá předvolbu strany kb-chat-side (checkup 11. 11. 2026).
// MUTAČNÍ DŮKAZ: s výpočtem přes −86400000 ms (dřívější verze) a bez výjimky kb-chat-side sada ČERVENÁ.
process.env.TZ = 'Europe/Prague';
const path = require('path');
const { pathToFileURL } = require('url');

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };
const lib = (f) => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', f)).href);
// local time → PocketBase UTC string "2026-10-25 00:30:00.000Z"
const pb = (d) => d.toISOString().replace('T', ' ');

(async () => {
  const G = await lib('conversationGroups.js');
  console.log('== skupiny rozhovorů ==');
  expect(new Date(2026, 9, 24, 12).getTimezoneOffset() !== new Date(2026, 9, 26, 12).getTimezoneOffset(), 'zóna Europe/Prague: 25. 10. 2026 končí letní čas (předpoklad sady)');
  const po = new Date(2026, 9, 26, 10, 0); // pondělí po konci letního času (neděle měla 25 h)
  expect(G.conversationGroup(pb(new Date(2026, 9, 26, 0, 5)), po) === 'today', 'pondělí 0:05 → Dnes');
  expect(G.conversationGroup(pb(new Date(2026, 9, 25, 0, 30)), po) === 'yesterday', 'po konci letního času: neděle 0:30 → Včera (ne Tento týden)');
  expect(G.conversationGroup(pb(new Date(2026, 9, 24, 23, 30)), po) === 'week', 'sobota 23:30 → Tento týden');
  const po2 = new Date(2026, 2, 30, 10, 0); // pondělí po začátku letního času (neděle měla 23 h)
  expect(G.conversationGroup(pb(new Date(2026, 2, 28, 23, 30)), po2) === 'week', 'po začátku letního času: sobota 23:30 → Tento týden (ne Včera)');
  expect(G.conversationGroup(pb(new Date(2026, 2, 29, 0, 10)), po2) === 'yesterday', 'neděle 0:10 → Včera');
  const ut = new Date(2026, 10, 10, 9, 0);
  expect(G.conversationGroup(pb(new Date(2026, 10, 4, 0, 1)), ut) === 'week' && G.conversationGroup(pb(new Date(2026, 10, 3, 23, 59)), ut) === 'older', 'Tento týden = dnes a 6 kalendářních dní zpět, dřív Starší');
  expect(G.conversationGroup('', ut) === 'older' && G.conversationGroup('nesmysl', ut) === 'older', 'neplatné datum → Starší');
  expect(G.GROUPS.join() === 'today,yesterday,week,older', 'pořadí skupin Dnes / Včera / Tento týden / Starší');

  console.log('== odhlášení nechá stranu panelu ==');
  const store = new Map();
  global.localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  for (const [k, v] of Object.entries({ 'kb-chat-side': 'left', 'kb-chat-width': '420', 'kb-chat-open': '1', 'kb-chat-id': 'abc', 'kb-chat-porada:u1': 'x' })) localStorage.setItem(k, v);
  const S = await lib('storageKeys.js');
  S.smazKliceAsistenta();
  expect(localStorage.getItem('kb-chat-side') === 'left', 'kb-chat-side (asistent vlevo) přežije odhlášení');
  expect(localStorage.getItem('kb-chat-width') === '420' && localStorage.getItem('kb-chat-open') === '1', 'šířka a otevřenost zůstávají jako dřív');
  expect(localStorage.getItem('kb-chat-id') === null, 'rozhovor účtu (kb-chat-id) se dál maže');

  console.log(`\n${fail ? '🔴' : '🟢'} ASISTENT-STRANA-UNIT PASS ${ok} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
