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
  const { trojcestnyMerge, mergeKeepMine, stableJson } = await import(
    pathToFileURL(path.join(__dirname, '../frontend/src/lib/mergeMap.js')).href
  );
  const najdi = (r, id) => (r.nodes || []).find((n) => n.id === id);

  // ---------- 0. F1-11: an edge must never end in a node the other side deleted ----------
  {
    const zaklad = mapa([uzel('root', 'P', 'todo'), uzel('a', 'A', 'todo'), uzel('n1', 'Smazaný', 'todo')], [hrana('e1', 'root', 'a'), hrana('e2', 'root', 'n1')]);
    // I add a new step under n1; the server deletes n1 (untouched by me) with its edge
    const moje = mapa([...zaklad.nodes, uzel('x', 'Můj nový krok', 'todo')], [...zaklad.edges, hrana('e3', 'n1', 'x')]);
    const server = mapa([uzel('root', 'P', 'todo'), uzel('a', 'A', 'todo')], [hrana('e1', 'root', 'a')]);
    const r = trojcestnyMerge(zaklad, moje, server);
    const visi = r.ok ? (r.edges || []).filter((e) => !(r.nodes || []).some((n) => n.id === e.source) || !(r.nodes || []).some((n) => n.id === e.target)) : [];
    ok(r.ok === false && r.duvod === 'hrana', `nový krok pod uzlem, který druhá strana smazala = kolize, ne hrana do prázdna (${JSON.stringify({ ok: r.ok, duvod: r.duvod, visi: visi.map((e) => e.id) })})`);
    // the same without my edge merges quietly as before
    const r2 = trojcestnyMerge(zaklad, mapa([...zaklad.nodes.map((n) => (n.id === 'a' ? uzel('a', 'A přejmenované', 'todo') : n))], zaklad.edges), server);
    ok(r2.ok === true && !najdi(r2, 'n1') && najdi(r2, 'a').data.title === 'A přejmenované' && r2.edges.length === 1, 'smazání uzlu serverem bez mého zásahu do něj se dál slije potichu');
  }

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

  // ---------- 9b. pole plněné serverem (assignedBy) není moje úprava ----------
  // Krok s termínem založený v téže relaci: server do něj dopíše assignedBy
  // (základna je má), plátno ne. Pravidlo opakování ho pak vrátí na todo
  // s novým termínem — to se musí slít tiše, ne skončit pruhem (klik-test
  // stylu Proces 25. 10. 2026).
  {
    const zaklad = mapa([uzel('root', 'P', 'todo'), uzel('K', 'Vynést koše', 'done', 0, 120, { deadline: '2026-10-25', assignedBy: 'a@x.cz' })]);
    const moje = mapa([uzel('root', 'P', 'todo'), uzel('K', 'Vynést koše', 'done', 0, 120, { deadline: '2026-10-25' })]);
    const server = mapa([uzel('root', 'P', 'todo'), uzel('K', 'Vynést koše', 'todo', 0, 120, { deadline: '2026-10-27', assignedBy: 'a@x.cz' })]);
    const r = trojcestnyMerge(zaklad, moje, server);
    ok(r.ok && najdi(r, 'K').data.status === 'todo' && najdi(r, 'K').data.deadline === '2026-10-27' && najdi(r, 'K').data.assignedBy === 'a@x.cz',
      `chybějící assignedBy na plátně nebrání převzetí zásahu pravidla (${JSON.stringify(r).slice(0, 80)})`);
    const mojeJinak = mapa([uzel('root', 'P', 'todo'), uzel('K', 'Vynést koše přejmenováno', 'done', 0, 120, { deadline: '2026-10-25' })]);
    const r2 = trojcestnyMerge(zaklad, mojeJinak, server);
    ok(!r2.ok, 'skutečná moje úprava téhož uzlu dál končí kolizí');
  }

  // ---------- 11. mergeKeepMine: the merge for a save that met 409 (analysis 5, c5-1) ----------
  // Two people on one map: what does not cross is merged, what crosses is reported and carries
  // MY version — and every other change of the colleague stays.
  {
    const zaklad = mapa(
      [uzel('root', 'P', 'todo'), uzel('a', 'A', 'todo', 0, 100), uzel('b', 'B', 'todo', 200, 100), uzel('c', 'C', 'todo', 400, 100), uzel('d', 'D', 'todo', 600, 100)],
      [hrana('e1', 'root', 'a'), hrana('e2', 'root', 'b'), hrana('e3', 'root', 'c'), hrana('e4', 'root', 'd')],
    );
    const zmen = (m, id, fn) => mapa(m.nodes.map((n) => (n.id === id ? fn(n) : n)), m.edges, m.title, m.color);
    const nazev = (t) => (n) => ({ ...n, data: { ...n.data, title: t } });
    const ids = (list) => list.map((x) => x.id).sort().join(',');

    // different steps → no conflict, both kept
    let moje = zmen(zaklad, 'a', nazev('A MOJE'));
    let server = zmen(zmen(zaklad, 'b', nazev('B KOLEGA')), 'c', (n) => ({ ...n, data: { ...n.data, status: 'in_progress' } }));
    let r = mergeKeepMine(zaklad, moje, server);
    ok(r.conflicts.length === 0, `different steps edited by two people do not cross (${ids(r.conflicts)})`);
    ok(najdi(r, 'a').data.title === 'A MOJE' && najdi(r, 'b').data.title === 'B KOLEGA' && najdi(r, 'c').data.status === 'in_progress', 'the merge holds my rename and both changes of the colleague');
    ok(ids(r.foreign) === 'b,c' && r.mineExtra === true && r.statusOnly === false, `the colleague's steps are named, the result still has to be saved (${ids(r.foreign)})`);

    // the same step edited by both → conflict on that step only; mine wins there, the rest of the colleague's work stays
    moje = zmen(zaklad, 'a', nazev('A MOJE'));
    server = zmen(zmen(zaklad, 'a', nazev('A KOLEGA')), 'b', nazev('B KOLEGA'));
    r = mergeKeepMine(zaklad, moje, server);
    ok(ids(r.conflicts) === 'a' && r.conflicts[0].title === 'A MOJE', `the same step edited by both is the one conflict (${ids(r.conflicts)})`);
    ok(najdi(r, 'a').data.title === 'A MOJE' && najdi(r, 'b').data.title === 'B KOLEGA', 'my version at the disputed step, the colleague\'s other step kept');
    ok(ids(r.foreign) === 'a,b', `both steps the colleague changed are named (${ids(r.foreign)})`);
    ok(trojcestnyMerge(zaklad, moje, server).ok === false, 'the strict merge agrees that this one crosses');

    // position: moved by both → mine, no conflict; moved by the colleague only → theirs
    moje = zmen(zaklad, 'a', (n) => ({ ...n, position: { x: 50, y: 50 } }));
    server = zmen(zmen(zaklad, 'a', (n) => ({ ...n, position: { x: 90, y: 90 } })), 'b', (n) => ({ ...n, position: { x: 222, y: 111 } }));
    r = mergeKeepMine(zaklad, moje, server);
    ok(r.conflicts.length === 0 && najdi(r, 'a').position.x === 50 && najdi(r, 'b').position.x === 222, 'a node moved by both keeps MY position without a conflict; a node only the colleague moved follows them');
    ok(r.foreign.length === 0, 'mere positions are not listed as the colleague\'s changes');

    // status alone on both sides → mine, quietly (as since v0.27)
    moje = zmen(zaklad, 'a', (n) => ({ ...n, data: { ...n.data, status: 'done' } }));
    server = zmen(zaklad, 'a', (n) => ({ ...n, data: { ...n.data, status: 'in_progress' } }));
    r = mergeKeepMine(zaklad, moje, server);
    ok(r.conflicts.length === 0 && najdi(r, 'a').data.status === 'done' && r.overridden === 1, 'a status switched by both is mine, quietly');

    // deleted by the colleague × edited by me → conflict; mine = the step stays, with its connection
    moje = zmen(zaklad, 'a', nazev('A MOJE'));
    server = mapa(zaklad.nodes.filter((n) => n.id !== 'a'), zaklad.edges.filter((e) => e.id !== 'e1'));
    r = mergeKeepMine(zaklad, moje, server);
    ok(ids(r.conflicts) === 'a' && r.conflicts[0].kind === 'deleted' && !!najdi(r, 'a') && r.edges.some((e) => e.id === 'e1'), 'deleted by the colleague, edited by me: a conflict, my step stays connected');
    // deleted by the colleague, untouched by me → gone, no conflict
    r = mergeKeepMine(zaklad, zmen(zaklad, 'b', nazev('B MOJE')), server);
    ok(r.conflicts.length === 0 && !najdi(r, 'a') && !r.edges.some((e) => e.id === 'e1') && najdi(r, 'b').data.title === 'B MOJE', 'deleted by the colleague, untouched by me: the deletion is taken');
    // deleted by me × edited by the colleague → conflict; mine = stays deleted
    moje = mapa(zaklad.nodes.filter((n) => n.id !== 'a'), zaklad.edges.filter((e) => e.id !== 'e1'));
    server = zmen(zmen(zaklad, 'a', nazev('A KOLEGA')), 'b', nazev('B KOLEGA'));
    r = mergeKeepMine(zaklad, moje, server);
    ok(ids(r.conflicts) === 'a' && !najdi(r, 'a') && !r.edges.some((e) => e.id === 'e1') && najdi(r, 'b').data.title === 'B KOLEGA', 'deleted by me, edited by the colleague: a conflict, stays deleted, their other step kept');

    // my new step under a node the colleague deleted → conflict; the node comes back, nothing hangs
    moje = mapa([...zaklad.nodes, uzel('x', 'Můj nový', 'todo')], [...zaklad.edges, hrana('ex', 'a', 'x')]);
    server = mapa(zaklad.nodes.filter((n) => n.id !== 'a'), zaklad.edges.filter((e) => e.id !== 'e1'));
    r = mergeKeepMine(zaklad, moje, server);
    const visi = r.edges.filter((e) => !najdi(r, e.source) || !najdi(r, e.target));
    ok(ids(r.conflicts) === 'a' && !!najdi(r, 'a') && !!najdi(r, 'x') && visi.length === 0 && r.edges.some((e) => e.id === 'e1'), `my new step under a node the colleague deleted: a conflict, no connection into nothing (${visi.length})`);

    // the same step re-plugged under two different parents → conflict; my parent stays, one parent only
    const bez = (m, id) => m.edges.filter((e) => e.id !== id);
    moje = mapa(zaklad.nodes, [...bez(zaklad, 'e4'), hrana('m1', 'a', 'd')]);
    server = mapa(zmen(zaklad, 'c', nazev('C KOLEGA')).nodes, [...bez(zaklad, 'e4'), hrana('s1', 'b', 'd')]);
    r = mergeKeepMine(zaklad, moje, server);
    const doD = r.edges.filter((e) => e.target === 'd');
    ok(ids(r.conflicts) === 'd' && doD.length === 1 && doD[0].source === 'a' && najdi(r, 'c').data.title === 'C KOLEGA', `one step re-plugged by both: a conflict, my parent stays (${doD.map((e) => e.source).join(',')})`);
    // different steps re-plugged → no conflict
    server = mapa(zaklad.nodes, [...bez(zaklad, 'e3'), hrana('s2', 'b', 'c')]);
    r = mergeKeepMine(zaklad, moje, server);
    ok(r.conflicts.length === 0 && r.edges.some((e) => e.id === 'm1') && r.edges.some((e) => e.id === 's2') && !r.edges.some((e) => e.id === 'e3' || e.id === 'e4'), 'different steps re-plugged by two people merge');
    // a loop made of both sides' connections → conflict; the colleague's connection goes
    moje = mapa(zaklad.nodes, [...bez(zaklad, 'e1'), hrana('m2', 'b', 'a')]);
    server = mapa(zaklad.nodes, [...bez(zaklad, 'e2'), hrana('s3', 'a', 'b')]);
    r = mergeKeepMine(zaklad, moje, server);
    ok(r.conflicts.length >= 1 && r.edges.some((e) => e.id === 'm2') && !r.edges.some((e) => e.id === 's3'), `a loop closed by the two sides together: a conflict, my connection stays (${r.edges.map((e) => e.id).join(',')})`);

    // title and colour of the map: changed on one side → merged; on both → conflict, mine
    r = mergeKeepMine(zaklad, mapa(zaklad.nodes, zaklad.edges, 'M', '#111111'), mapa(zaklad.nodes, zaklad.edges, 'M KOLEGA', ''));
    ok(r.conflicts.length === 0 && r.title === 'M KOLEGA' && r.color === '#111111', 'the title changed by one and the colour by the other merge');
    r = mergeKeepMine(zaklad, mapa(zaklad.nodes, zaklad.edges, 'M MOJE'), mapa(zmen(zaklad, 'b', nazev('B KOLEGA')).nodes, zaklad.edges, 'M KOLEGA'));
    ok(r.conflicts.length === 1 && r.conflicts[0].kind === 'title' && r.title === 'M MOJE' && najdi(r, 'b').data.title === 'B KOLEGA', 'the title changed by both: a conflict, mine stays, their step kept');

    // nothing of mine on top → nothing to send
    r = mergeKeepMine(zaklad, zaklad, zmen(zaklad, 'b', nazev('B KOLEGA')));
    ok(r.conflicts.length === 0 && r.mineExtra === false && r.taken === 1, 'with nothing of mine on top the result equals the server (no save needed)');
    // a field only the server fills (assignedBy) is not my edit
    const zakladA = zmen(zaklad, 'a', (n) => ({ ...n, data: { ...n.data, assignedBy: 'sef@x.cz' } }));
    r = mergeKeepMine(zakladA, zaklad, zmen(zakladA, 'a', nazev('A KOLEGA')));
    ok(r.conflicts.length === 0 && najdi(r, 'a').data.title === 'A KOLEGA' && najdi(r, 'a').data.assignedBy === 'sef@x.cz', 'a server-filled field missing on the canvas does not make a conflict');
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
