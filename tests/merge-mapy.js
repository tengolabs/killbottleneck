// Unit: tříčestný merge mapy (lib/mergeMap.js) — sémantika tichého slití
// zásahu automatizace do rozepsané práce. Bez dockeru, bez prohlížeče.
//
// Co se tu hlídá především: že merge NIKDY nespolkne moji rozepsanou změnu
// (negativní případy musí končit kolizí) a naopak že relayout pravidla
// nevyrábí kolizi tam, kde se nikdo nepotkal.
const path = require('path');
const { pathToFileURL } = require('url');

let pass = 0; let fail = 0;
const ok = (c, m) => (c ? (pass++, console.log('  ✅ ' + m)) : (fail++, console.log('  ❌ ' + m)));

const uzel = (id, title, status, x = 0, y = 0, extra = {}) => ({
  id, type: 'goalNode', position: { x, y }, data: { title, status, description: '', collapsed: false, ...extra },
});
const hrana = (id, source, target) => ({ id, source, target });
const mapa = (nodes, edges = [], title = 'M', color = '') => ({ title, color, nodes, edges });

(async () => {
 try {
  const { trojcestnyMerge, stableJson } = await import(
    pathToFileURL(path.join(__dirname, '../frontend/src/lib/mergeMap.js')).href
  );
  const najdi = (r, id) => (r.nodes || []).find((n) => n.id === id);

  // ---------- 1. Richardův případ: pravidlo posune kartu, já mezitím píšu ----------
  {
    const zaklad = mapa(
      [uzel('root', 'Proces', 'todo'), uzel('auto', 'Dělá to stroj', 'in_progress', 0, 120), uzel('muj', 'Můj krok', 'todo', 260, 120)],
      [hrana('e1', 'root', 'auto'), hrana('e2', 'root', 'muj')],
    );
    // server: pravidlo dalo 'auto' hotovo, přepojilo ho pod jiný uzel a přerovnalo
    const server = mapa(
      [uzel('root', 'Proces', 'todo'), uzel('auto', 'Dělá to stroj', 'done', 0, 240), uzel('muj', 'Můj krok', 'todo', 130, 120)],
      [hrana('e1', 'muj', 'auto'), hrana('e2', 'root', 'muj')],
    );
    // moje: rozepsané přejmenování JINÉHO uzlu, pozice ještě staré
    const moje = mapa(
      [uzel('root', 'Proces', 'todo'), uzel('auto', 'Dělá to stroj', 'in_progress', 0, 120), uzel('muj', 'Můj krok ROZEPSANÝ', 'todo', 260, 120)],
      [hrana('e1', 'root', 'auto'), hrana('e2', 'root', 'muj')],
    );
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok, 'kanban + rozepsané přejmenování jiného uzlu se slije bez kolize');
    ok(najdi(r, 'muj').data.title === 'Můj krok ROZEPSANÝ', 'moje rozepsaná změna v mergi zůstala');
    ok(najdi(r, 'auto').data.status === 'done', 'stav od pravidla se převzal');
    ok(najdi(r, 'auto').position.y === 240 && najdi(r, 'muj').position.x === 130, 'přerovnání pozic se převzalo ze serveru');
    ok((r.edges.find((e) => e.id === 'e1') || {}).source === 'muj', 'přepojená hrana se převzala');
    ok(r.jenStavy === false, 'přesun NENÍ pouhá změna stavu (chce doklad pravidla)');
    ok(r.mojeNavic === true, 'výsledek se liší od serveru → autosave ho musí odeslat');
  }

  // ---------- 2. Pouhý stav = režim, který v aplikaci běží od v0.27 ----------
  {
    const zaklad = mapa([uzel('a', 'A', 'todo'), uzel('b', 'B', 'todo', 200)]);
    const server = mapa([uzel('a', 'A', 'done'), uzel('b', 'B', 'todo', 200)]);
    const moje = mapa([uzel('a', 'A', 'todo'), uzel('b', 'B ROZEPSANÉ', 'todo', 200)]);
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok && r.jenStavy === true, 'změna jen data.status je označená jako „jenStavy"');
    ok(najdi(r, 'a').data.status === 'done' && najdi(r, 'b').data.title === 'B ROZEPSANÉ', 'stav převzat, moje práce zůstala');
  }

  // ---------- 3. NEGATIVNÍ: obě strany sáhly na TENTÝŽ uzel ----------
  {
    const zaklad = mapa([uzel('a', 'A', 'todo')]);
    const server = mapa([uzel('a', 'A od kolegy', 'todo')]);
    const moje = mapa([uzel('a', 'A ode mě', 'todo')]);
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok === false && r.duvod === 'uzel', 'kolize obsahu téhož uzlu → ok:false (pruh zůstává)');
  }

  // ---------- 4. NEGATIVNÍ: obě strany hnuly týmž uzlem ----------
  {
    const zaklad = mapa([uzel('a', 'A', 'todo', 0, 0)]);
    const server = mapa([uzel('a', 'A', 'todo', 100, 0)]);
    const moje = mapa([uzel('a', 'A', 'todo', 0, 100)]);
    ok(trojcestnyMerge(zaklad, moje, server).ok === false, 'kolize pozice téhož uzlu → ok:false');
  }

  // ---------- 5. Obsah a pozice se posuzují ZVLÁŠŤ ----------
  {
    const zaklad = mapa([uzel('a', 'A', 'todo', 0, 0)]);
    const server = mapa([uzel('a', 'A', 'todo', 100, 50)]);      // jen relayout
    const moje = mapa([uzel('a', 'A ROZEPSANÉ', 'todo', 0, 0)]); // jen text
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok, 'relayout serveru + moje přejmenování téhož uzlu NENÍ kolize');
    ok(najdi(r, 'a').data.title === 'A ROZEPSANÉ' && najdi(r, 'a').position.x === 100,
      'vezme se můj text a serverová pozice');
  }

  // ---------- 6. Pravidlo založí pod-uzly (create_subnodes) ----------
  {
    const zaklad = mapa([uzel('a', 'A', 'todo')], []);
    const server = mapa(
      [uzel('a', 'A', 'done'), uzel('p1', 'Podkrok 1', 'todo', 0, 120), uzel('p2', 'Podkrok 2', 'todo', 200, 120)],
      [hrana('ep1', 'a', 'p1'), hrana('ep2', 'a', 'p2')],
    );
    const moje = mapa([uzel('a', 'A', 'todo')], []);
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok && r.nodes.length === 3 && r.edges.length === 2, 'pod-uzly a hrany založené pravidlem se převezmou');
    ok(r.jenStavy === false, 'přibylé uzly nejsou pouhá změna stavu');
    ok(r.mojeNavic === false, 'nemám nic navíc → není co odesílat zpět');
  }

  // ---------- 7. Mazání ----------
  {
    const zaklad = mapa([uzel('a', 'A', 'todo'), uzel('b', 'B', 'todo', 200)]);
    // server smazal 'b', do 'a' nesáhl
    const server = mapa([uzel('a', 'A', 'todo')]);
    const moje = mapa([uzel('a', 'A ROZEPSANÉ', 'todo'), uzel('b', 'B', 'todo', 200)]);
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok && !najdi(r, 'b'), 'smazání na serveru se převezme, když jsem do uzlu nesáhl');

    const moje2 = mapa([uzel('a', 'A', 'todo'), uzel('b', 'B ROZEPSANÉ', 'todo', 200)]);
    ok(trojcestnyMerge(zaklad, moje2, server).ok === false, 'server smazal uzel, který mám rozepsaný → kolize');
  }

  // ---------- 8. Verze se rozešly, obsah je shodný ----------
  {
    const z = mapa([uzel('a', 'A', 'todo')]);
    const r = trojcestnyMerge(z, mapa([uzel('a', 'A', 'todo')]), mapa([uzel('a', 'A', 'todo')]));
    ok(r.ok && r.prevzato === 0 && r.mojeNavic === false,
      'shodný obsah → není co přebírat ani odesílat (jen se posune verze)');
  }

  // ---------- 9. Název mapy ----------
  {
    const z = mapa([], [], 'Stará');
    ok(trojcestnyMerge(z, mapa([], [], 'Stará'), mapa([], [], 'Serverová')).title === 'Serverová',
      'přejmenování mapy jen na serveru se převezme');
    ok(trojcestnyMerge(z, mapa([], [], 'Moje'), mapa([], [], 'Serverová')).ok === false,
      'přejmenování mapy na obou stranách → kolize');
  }

  // ---------- 11. Rozpor POUZE ve stavu: moje volba vyhrává (chování od v0.27) ----------
  {
    const zaklad = mapa([uzel('a', 'A', 'todo')]);
    const server = mapa([uzel('a', 'A', 'blocked')]);
    const moje = mapa([uzel('a', 'A', 'done')]);
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok, 'tři různé STAVY téhož uzlu nejsou kolize');
    ok(najdi(r, 'a').data.status === 'done', 'moje volba stavu má přednost (nic se neukazuje)');
  }
  {
    // …ale jakmile se rozejde i něco jiného než stav, je to zase kolize
    const zaklad = mapa([uzel('a', 'A', 'todo')]);
    const server = mapa([uzel('a', 'A od kolegy', 'blocked')]);
    const moje = mapa([uzel('a', 'A ode mě', 'done')]);
    ok(trojcestnyMerge(zaklad, moje, server).ok === false, 'stav + text naráz → kolize zůstává');
  }

  // ---------- 12. Seznam převzatých uzlů (podklad pro doklad pravidla) ----------
  {
    const zaklad = mapa([uzel('D1', 'D1', 'todo'), uzel('K', 'Karta', 'todo')], [hrana('e', 'D1', 'K')]);
    const server = mapa([uzel('D1', 'D1', 'todo'), uzel('K', 'Karta', 'todo', 300)], [hrana('e', 'D2', 'K')]);
    const moje = mapa([uzel('D1', 'D1', 'todo'), uzel('K', 'Karta', 'todo')], [hrana('e', 'D1', 'K')]);
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok && r.prevzateUzly.includes('K'),
      `přepojená hrana se doloží přes svůj cíl (${JSON.stringify(r.prevzateUzly)})`);
    ok(!r.prevzateUzly.includes('D1'), 'pouhé přerovnání pozic se do seznamu nepočítá');
  }

  // ---------- 10. stableJson: pořadí klíčů a prázdné hodnoty ----------
  {
    ok(stableJson({ b: 1, a: '' }) === stableJson({ a: null, b: 1 }),
      'stableJson srovná pořadí klíčů i null≡\'\'');
  }

 } catch (err) {
  fail++;
  console.log('  ❌ výjimka: ' + (err && err.stack ? err.stack : err));
 }
 console.log(`\n${fail === 0 ? '🟢' : '🔴'} MERGE MAPY PASS ${pass} / FAIL ${fail}`);
 process.exit(fail === 0 ? 0 : 1);
})();
