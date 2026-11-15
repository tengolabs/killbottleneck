// Code analysis 4, wave 7 — listAllPages (frontend/src/lib/listAll.js) on a listing that MOVES while
// its pages are being read. Pages are cut by offset: a record created, deleted or edited between two
// page requests shifts the rest and one record is never seen. Without Docker — a forged entity.
// Run: node product/tests/chyby4-strankovani.js
// (KB_TEST_PRODUCT_DIR=<another checkout of product/> measures that tree instead — the mutation proof.)
const path = require('path');
const { pathToFileURL } = require('url');
let pass = 0, fail = 0;
const expect = (c, m) => (c ? (pass++, console.log(`  ✅ ${m}`)) : (fail++, console.log(`  ❌ ${m}`)));
const ROOT = process.env.KB_TEST_PRODUCT_DIR || path.join(__dirname, '..');

// A listing kept sorted "newest change first"; `after[n]` runs once after the n-th page request.
function listing(count, after = {}) {
  let rows = Array.from({ length: count }, (_, i) => ({ id: `r${String(i + 1).padStart(3, '0')}`, v: 1 }));
  let requests = 0;
  const api = {
    get rows() { return rows; },
    get requests() { return requests; },
    remove: (id) => { rows = rows.filter((r) => r.id !== id); },
    touch: (id) => { const r = rows.find((x) => x.id === id); rows = [{ ...r, v: r.v + 1 }, ...rows.filter((x) => x.id !== id)]; },
    add: (id) => { rows = [{ id, v: 1 }, ...rows]; },
    listPage: async (sort, page, perPage) => {
      const res = { items: rows.slice((page - 1) * perPage, page * perPage), page, perPage, totalItems: rows.length, totalPages: Math.max(1, Math.ceil(rows.length / perPage)) };
      requests++;
      const f = after[requests]; if (f) { delete after[requests]; f(api); }
      return res;
    },
  };
  return api;
}
const ids = (list) => list.map((r) => r.id);
const same = (list, L) => { const a = new Set(ids(list)); return a.size === list.length && L.rows.every((r) => a.has(r.id)) && list.length === L.rows.length; };

(async () => {
  const { listAllPages } = await import(pathToFileURL(path.join(ROOT, 'frontend/src/lib/listAll.js')).href);

  console.log('== klidný seznam: jedno čtení, žádný dotaz navíc ==');
  let L = listing(120);
  let out = await listAllPages(L, '-updated_date,id', 50);
  expect(same(out, L), `120 záznamů po 50 → všech 120 (${out.length})`);
  expect(L.requests === 3, `tři stránky = tři dotazy (${L.requests})`);
  L = listing(30);
  out = await listAllPages(L, '-updated_date,id', 50);
  expect(out.length === 30 && L.requests === 1, `jedna stránka = jeden dotaz (${L.requests})`);
  L = listing(0);
  out = await listAllPages(L, '-updated_date,id', 50);
  expect(out.length === 0 && L.requests === 1, 'prázdný seznam = prázdný výsledek, jeden dotaz');

  console.log('== záznam upravený během čtení (skočí na začátek, na stránku už přečtenou) ==');
  L = listing(120, { 1: (a) => a.touch('r110') });
  out = await listAllPages(L, '-updated_date,id', 50);
  expect(ids(out).includes('r110'), 'upravený záznam ve výsledku nechybí');
  expect(same(out, L), `výsledek = celý seznam bez dvojic (${out.length} z ${L.rows.length})`);
  expect((out.find((r) => r.id === 'r110') || {}).v === 2, 'a nese novější podobu záznamu');

  console.log('== záznam smazaný během čtení (ostatní se posunou o jedno místo) ==');
  L = listing(120, { 1: (a) => a.remove('r010') });
  out = await listAllPages(L, '-updated_date,id', 50);
  expect(ids(out).includes('r051'), 'záznam, který se posunul na přečtenou stránku, nechybí (r051)');
  expect(same(out, L), `výsledek = celý seznam (${out.length} z ${L.rows.length})`);

  console.log('== záznam založený během čtení ==');
  L = listing(120, { 2: (a) => a.add('novy') });
  out = await listAllPages(L, '-updated_date,id', 50);
  expect(ids(out).includes('novy') && same(out, L), `nový záznam je ve výsledku (${out.length} z ${L.rows.length})`);

  console.log('== seznam, který se hýbe pořád: čtení skončí a nic viděného neztratí ==');
  let n = 0;
  const neklid = {}; for (let i = 1; i <= 40; i++) neklid[i] = (a) => a.touch(`r${String(120 - (n++ % 60)).padStart(3, '0')}`);
  L = listing(120, neklid);
  out = await listAllPages(L, '-updated_date,id', 50);
  expect(L.requests <= 9, `nejvýš tři čtení po třech stránkách (${L.requests} dotazů)`);
  expect(new Set(ids(out)).size === out.length, 'bez dvojic');
  expect(out.length === 120, `všech 120 záznamů (${out.length})`);

  console.log('== průběžné hlášení (onPage) se při opakovaném čtení nezmenšuje ==');
  const delky = [];
  L = listing(120, { 2: (a) => a.remove('r001') });
  out = await listAllPages(L, '-updated_date,id', 50, { onPage: (soFar) => delky.push(soFar.length) });
  expect(delky.length > 3, `seznam se četl znovu (${delky.join(',')})`);
  expect(delky.slice(3).every((d) => d >= delky[2] - 1), `po prvním čtení už volající nedostal kratší seznam (${delky.join(',')})`);
  expect(same(out, L), 'výsledek = celý seznam po smazání');

  console.log('== selhání stránky se neschová ==');
  L = listing(120);
  const puv = L.listPage; let k = 0;
  L.listPage = async (...a) => { if (++k === 2) throw new Error('503'); return puv(...a); };
  let chyba = null;
  try { await listAllPages(L, '-updated_date,id', 50); } catch (e) { chyba = e; }
  expect(chyba && chyba.message === '503', 'chyba druhé stránky doletí k volajícímu');

  console.log(`${fail ? '🔴' : '🟢'} CHYBY4-STRANKOVANI PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
