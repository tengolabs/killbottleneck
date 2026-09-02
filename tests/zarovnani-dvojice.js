// Zarovnání na malé mapě: ŽÁDNÝ STYL NESMÍ MLČET ani u skupin po DVOU.
//
// Nález vlastníka 2. 9. 2026: prahy „≥3 skupiny" / „≥3 listy v řadě" znamenaly,
// že na běžné mapě (kategorie po dvou podcílech) vyšly classic/compact/bands
// IDENTICKY — tlačítko Zarovnat viditelně nic nedělalo. Práh klesl na 2
// (v OBOU dvojčatech: lib/treeLayout.js i helpers.js:layoutTreeServer —
// jejich shodu hlídá layout-parity.js; tahle sada hlídá RŮZNOST stylů).
// Bez dockeru — čistý unit nad layoutTree.
const path = require('path');
const { pathToFileURL } = require('url');

let ok = 0, fail = 0;
const expect = (c, m) => { console.log(`  ${c ? '✅' : '❌'} ${m}`); c ? ok++ : fail++; };

const uzel = (id, apex) => ({ id, type: apex ? 'apexNode' : 'goalNode', position: { x: 0, y: 0 }, data: { title: id, status: 'todo' } });
const hrana = (s, t) => ({ id: `${s}-${t}`, source: s, target: t });

// apex → 2 kategorie, každá se 2 listy (typická malá mapa)
const nodes = [uzel('apex', true), uzel('A'), uzel('B'), uzel('a1'), uzel('a2'), uzel('b1'), uzel('b2')];
const edges = [hrana('apex', 'A'), hrana('apex', 'B'), hrana('A', 'a1'), hrana('A', 'a2'), hrana('B', 'b1'), hrana('B', 'b2')];

(async () => {
const { layoutTree } = await import(pathToFileURL(path.join(__dirname, '..', 'frontend', 'src', 'lib', 'treeLayout.js')).href);
const spocitej = (opts) => layoutTree(nodes, edges, 'vertical', opts);
const otisk = (p) => JSON.stringify(Object.keys(p).sort().map((k) => [k, Math.round(p[k].x), Math.round(p[k].y)]));

console.log('== styly na mapě se skupinami po dvou ==');
const classic = spocitej({});
const compact = spocitej({ stagger: 2 });
const bands = spocitej({ bands: 2 });
expect(Object.keys(classic).length === nodes.length, `classic rozmístil všechny uzly (${Object.keys(classic).length}/${nodes.length})`);
expect(otisk(classic) !== otisk(compact), 'KOMPAKT se liší od classic (dvojice skupin se střídá)');
expect(otisk(classic) !== otisk(bands), 'PÁSY se liší od classic');
expect(otisk(compact) !== otisk(bands), 'KOMPAKT a PÁSY se liší navzájem (parita střídání)');

// řada 2 listů přímo pod apexem — dvouřadé balení se taky nesmí odmlčet
const nodes2 = [uzel('apex', true), uzel('x1'), uzel('x2')];
const edges2 = [hrana('apex', 'x1'), hrana('apex', 'x2')];
const c2 = layoutTree(nodes2, edges2, 'vertical', {});
const k2 = layoutTree(nodes2, edges2, 'vertical', { stagger: 2 });
expect(otisk(c2) !== otisk(k2), 'dvouřadé balení zabírá i na řadě 2 listů');

console.log(`\n${ok} ✅ / ${fail} ❌`);
process.exit(fail ? 1 : 0);
})();
