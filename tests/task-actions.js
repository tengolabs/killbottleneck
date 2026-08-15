// Sémantika řádkových akcí (frontend/src/lib/taskActions.js) — unit, bez dockeru.
// Hlídá to, co se nedá poznat z UI a co se při úpravách nejsnáz rozbije:
// plán počítaný ode DNEŠKA (ne od propadlého termínu), jeho samovolné vypršení
// změnou dne, a rozpoznání cíle (úkol × uzel mapy × nápad) ze dvou různých
// tvarů položky, které v aplikaci existují.
//
// ⚠️ Klíčové: plánování se NESMÍ dotknout termínu (rozhodnutí Richarda
// 27. 7. 2026) — proto tu žádná akce nemapuje na pole `deadline`.
// Funkce se vytahují ze zdrojáku (vzor cleanmap-parity.js) — soubor importuje
// datovou vrstvu přes alias @/, který mimo Vite neexistuje.
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

function extractFn(src, name) {
  const start = src.search(new RegExp('(export )?function ' + name + '\\b'));
  if (start < 0) throw new Error('funkce nenalezena: ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i).replace(/^export /, '');
}

const src = fs.readFileSync(path.join(__dirname, '../frontend/src/lib/taskActions.js'), 'utf8');
// pořadí = závislosti: addDays a isPinned volají todayKey, availableActions volá toTarget
/* eslint-disable no-eval, no-unused-vars */
const todayKey = eval('(' + extractFn(src, 'todayKey') + ')');
const addDays = eval('(' + extractFn(src, 'addDays') + ')');
const planDate = eval('(' + extractFn(src, 'planDate') + ')');
const planState = eval('(' + extractFn(src, 'planState') + ')');
const toTarget = eval('(' + extractFn(src, 'toTarget') + ')');
const availableActions = eval('(' + extractFn(src, 'availableActions') + ')');
/* eslint-enable no-eval, no-unused-vars */

const dayKey = (offset) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA');
};

console.log('== plánování (kdy to chci řešit) ==');
{
  ok(/^\d{4}-\d{2}-\d{2}$/.test(planDate('tomorrow')), `formát YYYY-MM-DD (${planDate('tomorrow')})`);
  ok(planDate('today') === dayKey(0), 'dnes = dnešek');
  ok(planDate('tomorrow') === dayKey(1), 'zítra = dnešek + 1 den');

  const nw = planDate('nextWeek');
  const nwDate = new Date(nw + 'T00:00:00');
  ok(nwDate.getDay() === 1, `příští týden padne na pondělí (${nw}, den ${nwDate.getDay()})`);
  const daysAhead = Math.round((nwDate - new Date(dayKey(0) + 'T00:00:00')) / 86400000);
  ok(daysAhead >= 1 && daysAhead <= 7, `příští týden je 1–7 dní dopředu (${daysAhead})`);
  ok(daysAhead > 0, 'příští týden nikdy nevrátí dnešek');

  // JÁDRO: plán se počítá ode dneška. Propadlý úkol se naplánováním na zítra
  // musí dostat do budoucnosti, jinak tlačítko nic neřeší.
  ok(planDate('tomorrow') > dayKey(0), 'plán vždy míří do budoucnosti');

  let threw = false;
  try { planDate('sometime'); } catch { threw = true; }
  ok(threw, 'neznámé naplánování vyhodí chybu (nezapíše tiše nesmysl)');
}

console.log('== stav plánu (vyprší sám, bez úklidu) ==');
{
  ok(planState(dayKey(0)) === 'today', 'dnešní plán = today');
  ok(planState(dayKey(1)) === 'tomorrow', 'zítřejší plán = tomorrow');
  ok(planState(dayKey(5)) === 'later', 'vzdálenější plán = later');
  ok(planState(dayKey(-1)) === '', 'včerejší plán NEPLATÍ (vyprší sám, bez cronu)');
  ok(planState('') === '' && planState(undefined) === '' && planState(null) === '',
    'prázdná hodnota = žádný plán');
}

console.log('== rozpoznání cíle (dva tvary položky) ==');
{
  // tvar „Můj den"
  const mydayTask = { kind: 'task', id: 'T1', raw: {} };
  const mydayNode = { kind: 'node', id: 'n5', mapId: 'M1' };
  const mydayIdea = { kind: 'idea', id: 'B1' };
  ok(JSON.stringify(toTarget(mydayTask)) === JSON.stringify({ kind: 'task', id: 'T1', mapId: '', nodeId: '' }),
    'Můj den: úkol → cíl typu task');
  ok(JSON.stringify(toTarget(mydayNode)) === JSON.stringify({ kind: 'node', id: 'n5', mapId: 'M1', nodeId: 'n5' }),
    'Můj den: uzel → cíl typu node (id uzlu = id položky)');
  ok(toTarget(mydayIdea).kind === 'idea', 'Můj den: nápad → cíl typu idea');

  // tvar stránky Úkoly
  const tableTask = { id: 'T2', map_id: 'M1', node_id: 'n9' };
  const tableNode = { id: 'node-item-M1-n9', isNode: true, map_id: 'M1', node_id: 'n9' };
  ok(toTarget(tableTask).kind === 'task' && toTarget(tableTask).id === 'T2',
    'Úkoly: úkol pověšený na uzel je pořád ÚKOL (píše se do tasks, ne do mapy)');
  ok(toTarget(tableNode).kind === 'node' && toTarget(tableNode).nodeId === 'n9'
    && toTarget(tableNode).mapId === 'M1',
    'Úkoly: řádek uzlu → cíl typu node podle map_id/node_id, ne podle id řádku');

  ok(toTarget({ kind: 'node', id: 'n1' }) === null, 'uzel bez mapy → null (osiřelý řádek, nesahat)');
  ok(toTarget(null) === null, 'prázdná položka → null');
}

console.log('== nabídka akcí ==');
{
  ok(JSON.stringify(availableActions({ kind: 'task', id: 'T1' })) === JSON.stringify(['done', 'plan']),
    'úkol: hotovo + naplánovat (žádné „odložit termín" — termín je dohoda)');
  ok(JSON.stringify(availableActions({ kind: 'node', id: 'n1', mapId: 'M1' })) === JSON.stringify(['done', 'plan']),
    'uzel mapy umí totéž co úkol');
  ok(JSON.stringify(availableActions({ kind: 'idea', id: 'B1' })) === JSON.stringify(['plan']),
    'nápad ze zásobníku: jen naplánovat (hotovo u nápadu nedává smysl)');
  ok(availableActions({ kind: 'delegated', id: 'T3' }).length === 0,
    'delegovanou práci NEjde odbavit za druhého (řádek je jen hlídání termínu)');
  ok(availableActions({ kind: 'node', id: 'n1' }).length === 0, 'nerozpoznaný cíl → žádné akce');
}

console.log(`\n${fail === 0 ? '🟢' : '🔴'} TASK ACTIONS PASS ${pass} / FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
