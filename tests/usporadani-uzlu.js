// „Uspořádat podle…" (Richard 5. 9. 2026): řazení SOUROZENCŮ podle termínu /
// plánu / řešitele / stavu — čistý unit nad lib/nodeOrder.js + integrace
// s layoutTree (pořadí zapsané do příčné osy layout zachová, svisle i vodorovně).
// Bez dockeru. Hlídá: prázdné hodnoty na konec, nejbližší datum v PODSTROMU,
// stabilitu (shodné hodnoty drží pořadí podle aktuální pozice), že se `note`,
// kořen ani vrchol neřadí, cyklus v hranách nespadne, a že vstříknuté
// porovnání textů se skutečně používá (obrácený komparátor otočí pořadí).
const path = require('path');
const { pathToFileURL } = require('url');

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };

const uzel = (id, data = {}, x = 0, type = 'goalNode') => ({ id, type, position: { x, y: 0 }, data: { title: id, status: 'todo', ...data } });
const hrana = (s, t) => ({ id: `${s}-${t}`, source: s, target: t });
const D = (posun) => { const d = new Date(2026, 8, 5); d.setDate(d.getDate() + posun); return d.toISOString().slice(0, 10); };

(async () => {
const lib = (f) => import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', f)).href);
const { poradiSourozencu, sPoradimVPricneOse, nejblizsiVPodstromu, platneKriterium, KRITERIA } = await lib('nodeOrder.js');
const { layoutTree } = await lib('treeLayout.js');

// pořadí id podle mapy indexů (jen ty, co v mapě jsou), pro daného rodiče
const serazene = (poradi, ids) => ids.filter((i) => poradi.has(i)).sort((a, b) => poradi.get(a) - poradi.get(b)).join(' ');

console.log('== kritéria ==');
expect(KRITERIA.join(',') === 'deadline,plannedOn,owner,status', `čtyři kritéria (${KRITERIA.join(',')})`);
expect(platneKriterium('priority') === '' && platneKriterium('deadline') === 'deadline', 'neznámé kritérium se zahodí (priorita jako pole neexistuje)');
expect(poradiSourozencu([uzel('a')], [], 'priority').size === 0, 'neplatné kritérium → prázdná mapa');

console.log('== termín: nejbližší dopředu, bez termínu na konec ==');
{
  // pozice úmyslně opačně než termíny (c leží vlevo) — řazení musí pozice přebít
  const nodes = [uzel('apex', { nodeType: 'apex' }, 0, 'apexNode'), uzel('c', { deadline: D(30) }, 0), uzel('a', { deadline: D(1) }, 300), uzel('b', {}, 600)];
  const edges = [hrana('apex', 'c'), hrana('apex', 'a'), hrana('apex', 'b')];
  const p = poradiSourozencu(nodes, edges, 'deadline');
  expect(serazene(p, ['a', 'b', 'c']) === 'a c b', `termín: ${serazene(p, ['a', 'b', 'c'])} (čeká se a c b)`);
  expect(!p.has('apex'), 'vrchol (kořen) v pořadí není');
}

console.log('== podstrom: rodič bez termínu s brzkým vnukem předběhne ==');
{
  const nodes = [uzel('apex', {}, 0, 'apexNode'), uzel('k1', {}, 0), uzel('k2', { deadline: D(10) }, 300), uzel('v1', { deadline: D(2) }, 0)];
  const edges = [hrana('apex', 'k1'), hrana('apex', 'k2'), hrana('k1', 'v1')];
  const p = poradiSourozencu(nodes, edges, 'deadline');
  expect(serazene(p, ['k1', 'k2']) === 'k1 k2', `větev s brzkým vnukem jde první (${serazene(p, ['k1', 'k2'])})`);
  const nodesById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const t = nejblizsiVPodstromu(nodesById, { apex: ['k1', 'k2'], k1: ['v1'] }, 'deadline');
  expect(t.get('k1') === D(2) && t.get('apex') === D(2) && t.get('k2') === D(10), 'nejblizsiVPodstromu propaguje minimum nahoru');
}

console.log('== stav: rozpracované → nezačaté → hotové; shoda → termín, pak název ==');
{
  const nodes = [uzel('apex', {}, 0, 'apexNode'),
    uzel('h', { status: 'done' }, 0), uzel('n2', { status: 'todo', title: 'B' }, 100), uzel('r', { status: 'in_progress' }, 200),
    uzel('n1', { status: 'todo', title: 'A' }, 300), uzel('nt', { status: 'todo', title: 'C', deadline: D(3) }, 400), uzel('x', { status: 'divny' }, 500),
    // stav „constructor" = zděděný klíč obyčejného objektu; bez hasOwn dal NaN a
    // komparátor tiše propadl (panel /checkup 6. 9. 2026) — má se chovat jako nezačaté
    uzel('y', { status: 'constructor', title: 'D' }, 600)];
  const edges = ['h', 'n2', 'r', 'n1', 'nt', 'x', 'y'].map((i) => hrana('apex', i));
  const p = poradiSourozencu(nodes, edges, 'status');
  const v = serazene(p, ['h', 'n2', 'r', 'n1', 'nt', 'x', 'y']);
  expect(v === 'r nt n1 n2 y x h', `stav: ${v} (čeká se r nt n1 n2 y x h — s termínem před názvy, neznámý i „constructor" stav jako nezačaté)`);
}

console.log('== řešitel: podle JMÉNA (labelOf), nepřiřazené na konec, compare se používá ==');
{
  const jmena = { 'z@x.cz': 'Adam', 'a@x.cz': 'Zora' };
  const nodes = [uzel('apex', {}, 0, 'apexNode'), uzel('bez', {}, 0), uzel('pa', { owner: 'a@x.cz' }, 100), uzel('pz', { owner: 'z@x.cz' }, 200)];
  const edges = ['bez', 'pa', 'pz'].map((i) => hrana('apex', i));
  const labelOf = (e) => jmena[e] || e;
  const p = poradiSourozencu(nodes, edges, 'owner', { labelOf });
  expect(serazene(p, ['bez', 'pa', 'pz']) === 'pz pa bez', `řešitel dle jména: ${serazene(p, ['bez', 'pa', 'pz'])} (Adam=z@ před Zora=a@, bez na konec)`);
  const pMail = poradiSourozencu(nodes, edges, 'owner');
  expect(serazene(pMail, ['bez', 'pa', 'pz']) === 'pa pz bez', 'bez labelOf se řadí podle e-mailu (a@ před z@)');
  const pObr = poradiSourozencu(nodes, edges, 'owner', { labelOf, compare: (a, b) => -String(a).localeCompare(String(b)) });
  expect(serazene(pObr, ['bez', 'pa', 'pz']) === 'pa pz bez', 'obrácený compare otočí pořadí jmen (mutační důkaz, prázdné dál na konci)');
}

console.log('== plán: podle plannedOn v podstromu, termín se nebere ==');
{
  const nodes = [uzel('apex', {}, 0, 'apexNode'), uzel('p3', { plannedOn: D(3), deadline: D(1) }, 0), uzel('p1', { plannedOn: D(1), deadline: D(9) }, 100), uzel('p0', { deadline: D(0) }, 200)];
  const edges = ['p3', 'p1', 'p0'].map((i) => hrana('apex', i));
  const p = poradiSourozencu(nodes, edges, 'plannedOn');
  expect(serazene(p, ['p3', 'p1', 'p0']) === 'p1 p3 p0', `plán: ${serazene(p, ['p3', 'p1', 'p0'])} (bez plánu na konec i s dnešním termínem)`);
}

console.log('== stabilita: shodné hodnoty drží pořadí podle příčné pozice ==');
{
  const nodes = [uzel('apex', {}, 0, 'apexNode'), uzel('s1', { title: 'stejné' }, 200), uzel('s2', { title: 'stejné' }, 0), uzel('s3', { title: 'stejné' }, 100)];
  const edges = ['s1', 's2', 's3'].map((i) => hrana('apex', i));
  const p = poradiSourozencu(nodes, edges, 'deadline');
  expect(serazene(p, ['s1', 's2', 's3']) === 's2 s3 s1', `bez hodnot podle pozice x: ${serazene(p, ['s1', 's2', 's3'])}`);
  const pObr = poradiSourozencu(nodes, edges, 'deadline', { pricna: (n) => -n.position.x });
  expect(serazene(pObr, ['s1', 's2', 's3']) === 's1 s3 s2', 'obrácená příčná osa → obrácené pořadí (pricna se používá)');
}

console.log('== note, více kořenů, cyklus ==');
{
  const nodes = [uzel('r1', {}, 0), uzel('r2', {}, 300), uzel('d', { deadline: D(1) }, 0), uzel('pozn', {}, 100, 'note'), uzel('e', {}, 200)];
  const edges = [hrana('r1', 'd'), hrana('r1', 'pozn'), hrana('r1', 'e'), hrana('e', 'r1')]; // e→r1 = cyklus
  let p; let chyba = null; const t0 = Date.now();
  try { p = poradiSourozencu(nodes, edges, 'deadline'); } catch (err) { chyba = err; }
  expect(!chyba, `cyklus v hranách nespadne (${chyba ? chyba.message : 'OK'}, ${Date.now() - t0} ms)`);
  expect(p && !p.has('pozn'), 'poznámka (note) se neřadí');
  expect(p && !p.has('r2'), 'druhý kořen bez rodiče v pořadí není');
  expect(p && serazene(p, ['d', 'e']) === 'd e', 'děti kořene seřazené i vedle cyklu');
  const bezNote = sPoradimVPricneOse(nodes, p, false);
  expect(bezNote.find((n) => n.id === 'pozn').position.x === 100 && nodes.find((n) => n.id === 'd').position.x === 0, 'note drží pozici; vstupní pole se nemění');
}

console.log('== integrace s layoutTree: svisle i vodorovně vyjde pořadí podle termínu, druhý běh nic nepřehodí ==');
{
  // apex → A, B; pod A tři listy s termíny (+10, +1, bez) v „špatném" pořadí pozic
  const nodes = [uzel('apex', {}, 400, 'apexNode'), uzel('A', {}, 200), uzel('B', {}, 600),
    uzel('a10', { deadline: D(10) }, 0), uzel('a1', { deadline: D(1) }, 250), uzel('a0', {}, 500), uzel('b1', {}, 600)];
  const edges = [hrana('apex', 'A'), hrana('apex', 'B'), hrana('A', 'a10'), hrana('A', 'a1'), hrana('A', 'a0'), hrana('B', 'b1')];
  const poradiPodle = (pos, ids, osa) => ids.sort((x, y) => pos[x][osa] - pos[y][osa]).join(' ');

  const p = poradiSourozencu(nodes, edges, 'deadline');
  expect(serazene(p, ['A', 'B']) === 'A B', 'kategorie A (má brzký vnuk) před B');
  const sv = layoutTree(sPoradimVPricneOse(nodes, p, false), edges, 'vertical', {});
  expect(poradiPodle(sv, ['a10', 'a1', 'a0'], 'x') === 'a1 a10 a0', `svisle zleva: ${poradiPodle(sv, ['a10', 'a1', 'a0'], 'x')}`);
  // idempotence: nad výstupem layoutu znovu → stejné pořadí
  const znovu = nodes.map((n) => ({ ...n, position: sv[n.id] }));
  const p2 = poradiSourozencu(znovu, edges, 'deadline');
  const sv2 = layoutTree(sPoradimVPricneOse(znovu, p2, false), edges, 'vertical', {});
  expect(poradiPodle(sv2, ['a10', 'a1', 'a0'], 'x') === 'a1 a10 a0', 'druhý běh pořadí drží (idempotence)');
  // Zarovnat jiným stylem nad výstupem pořadí nerozhází
  const kompakt = layoutTree(znovu, edges, 'vertical', { stagger: 2 });
  expect(poradiPodle(kompakt, ['a10', 'a1', 'a0'], 'x') === 'a1 a10 a0', 'kompaktní styl nad seřazenou mapou pořadí drží');

  // vodorovně: příčná osa je Y; hook přepíše Y a layoutAllForView pak osy prohodí —
  // tady se prohození simuluje stejně (x↔y) a spočítá svislý kanon i vodorovný obraz
  const vodor = nodes.map((n) => ({ ...n, position: { x: 0, y: n.position.x } }));
  const ph = poradiSourozencu(vodor, edges, 'deadline', { pricna: (n) => n.position.y });
  const vstupH = sPoradimVPricneOse(vodor, ph, true);
  expect(vstupH.find((n) => n.id === 'a1').position.y === 0 && vstupH.find((n) => n.id === 'a0').position.y === 2000, 'vodorovně se pořadí zapsalo do Y');
  const prohozene = vstupH.map((n) => ({ ...n, position: { x: n.position.y, y: n.position.x } }));
  const kanon = layoutTree(prohozene, edges, 'vertical', {});
  expect(poradiPodle(kanon, ['a10', 'a1', 'a0'], 'x') === 'a1 a10 a0', 'kanonický svislý průchod po prohození os drží pořadí');
  const obraz = layoutTree(vstupH, edges, 'horizontal', {});
  expect(poradiPodle(obraz, ['a10', 'a1', 'a0'], 'y') === 'a1 a10 a0', `vodorovný obraz shora: ${poradiPodle(obraz, ['a10', 'a1', 'a0'], 'y')}`);
}

console.log(`\n${ok} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
})();
