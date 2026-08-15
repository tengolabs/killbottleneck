#!/usr/bin/env node
// PŘEHLED POŠKOZENÝCH MAP — jen ČTE a VYPÍŠE. Nic nemění, nic nemaže.
//
// Od 13. 8. 2026 aplikace nedovolí vyrobit mapu s kruhem nebo s cílem o víc
// rodičích (lib/mapStructure.js + goalmaps hooky). Mapy, které vznikly DŘÍV,
// v databázi zůstávají — server je schválně dál ukládá, aby se z nich uživatel
// dostal ven (opraví je tlačítkem v editoru). Tenhle skript řekne, kolika lidí
// se to týká, aby se dalo rozhodnout, jestli je potřeba je oslovit.
//
//   node product/audit-strom-map.js                       # lokální instance
//   KB_URL=https://... KB_ADMIN=… KB_HESLO=… node product/audit-strom-map.js
//
// Přihlašuje se superuserem (vidí všechny mapy). Bez přístupu skončí nenulově.

const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

const URL_ = process.env.KB_URL || 'http://127.0.0.1:8090';
const ADMIN = process.env.KB_ADMIN || '';
const HESLO = process.env.KB_HESLO || '';

// Pravidlo se NEKOPÍRUJE — bere se z téhož souboru, který používá server,
// jinak by audit časem tvrdil něco jiného než aplikace. (Stejný postup jako
// product/tests/cleanmap-parity.js.)
const HELPERS = fs.readFileSync(path.join(__dirname, 'server/pb_hooks/helpers.js'), 'utf8');
function zdrojFunkce(jmeno) {
  const start = HELPERS.indexOf('function ' + jmeno);
  if (start < 0) throw new Error('funkce nenalezena: ' + jmeno);
  let i = HELPERS.indexOf('{', start), depth = 0;
  for (; i < HELPERS.length; i++) {
    if (HELPERS[i] === '{') depth++;
    else if (HELPERS[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return HELPERS.slice(start, i);
}

(async () => {
  // ⚠️ eval MUSÍ být tady, ne v pomocné funkci: `poskozeneHrany` volá
  // `duvodOdmitnutiMapy` podle jména, takže obojí musí být v témže scope.
  // eslint-disable-next-line no-eval, no-unused-vars
  const jePredekMapy = eval('(' + zdrojFunkce('jePredekMapy') + ')');
  // eslint-disable-next-line no-eval, no-unused-vars
  const duvodOdmitnutiMapy = eval('(' + zdrojFunkce('duvodOdmitnutiMapy') + ')');
  // eslint-disable-next-line no-eval
  const poskozeneHrany = eval('(' + zdrojFunkce('poskozeneHrany') + ')');
  // ujištění, že se eval'ovaná funkce chová (kdyby se zdroj rozešel, ať to
  // spadne tady, ne až na tichém „0 poškozených map")
  const zkouska = poskozeneHrany(
    [{ id: 'a' }, { id: 'b' }],
    [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'a' }]);
  if (zkouska.edgeIds.length !== 1) throw new Error('sebekontrola selhala — pravidlo se nenačetlo správně');

  if (!ADMIN || !HESLO) {
    console.error('Chybí KB_ADMIN a KB_HESLO (superuser). Viz hlavička souboru.');
    process.exit(2);
  }
  const auth = await (await fetch(`${URL_}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: ADMIN, password: HESLO }),
  })).json();
  if (!auth.token) { console.error('Přihlášení superuserem selhalo:', JSON.stringify(auth).slice(0, 200)); process.exit(2); }

  let page = 1, celkem = 0, poskozenych = 0;
  const radky = [];
  for (;;) {
    const r = await (await fetch(`${URL_}/api/collections/goalmaps/records?perPage=200&page=${page}&fields=id,title,owner_email,nodes,edges`,
      { headers: { Authorization: auth.token } })).json();
    for (const m of r.items || []) {
      celkem++;
      const v = poskozeneHrany(m.nodes || [], m.edges || []);
      if (!v.edgeIds.length) continue;
      poskozenych++;
      radky.push({
        id: m.id,
        vlastnik: m.owner_email || '?',
        nazev: String(m.title || '').slice(0, 40),
        hran: v.edgeIds.length,
        druh: [v.viceRodicu.length ? `víc rodičů (${v.viceRodicu.length})` : '', v.vCyklu.length ? `kruh (${v.vCyklu.length})` : ''].filter(Boolean).join(' + '),
      });
    }
    if (!r.items || !r.items.length || page >= (r.totalPages || 1)) break;
    page++;
  }

  console.log(`\nMap celkem: ${celkem}   poškozených: ${poskozenych}\n`);
  if (radky.length) {
    console.log('id              vlastník                       hran  druh   název');
    for (const x of radky) {
      console.log(`${x.id.padEnd(16)}${x.vlastnik.padEnd(30)}${String(x.hran).padEnd(6)}${x.druh.padEnd(25)}${x.nazev}`);
    }
    console.log('\nOpravu udělá vlastník sám: otevře mapu a zmáčkne „Opravit" (jde vzít Zpět).');
  }
  process.exit(0);
})().catch((e) => { console.error('CHYBA:', e.message); process.exit(1); });
