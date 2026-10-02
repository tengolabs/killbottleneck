// UI e2e: „Uspořádat podle…" v editoru mapy (Richard 5. 9. 2026).
//
// Rozbalovací nabídka vedle Zarovnat: termín / plán / řešitel / stav. Klik na
// položku seřadí SOUROZENCE pod každým rodičem, strukturu nechá, mapu uloží
// a jde vzít Zpět. Zarovnat (3 vzhledy) po uspořádání pořadí drží; ve
// vodorovném view řadí shora. Volba se pamatuje jen pro zvýraznění (po
// reloadu se nic nepřerovnává). Nabídka NENÍ v kanbanu ani pro čtenáře.
//
// Fixtura přes API: vrchol → Kategorie A (3 listy: termín +10 / +1 / bez,
// stavy todo / done / in_progress) a Kategorie B (2 listy s plánem +5 / +2).
// Pozice listů úmyslně v „špatném" pořadí, aby řazení mělo co dělat.
//
// MUTAČNÍ DŮKAZ: na image z main sada ČERVENÁ — tlačítko toolbar-usporadat neexistuje.
const H = require('./_harness');
const { expect, sleep } = H;

const UCET = 'poradi@e2e.cz';
const CTENAR = 'ctenar@e2e.cz';
const den = (posun) => { const d = new Date(); d.setDate(d.getDate() + posun); return d.toISOString().slice(0, 10); };
const N = { a10: 'Alfa deset', a1: 'Alfa jedna', a0: 'Alfa nula', b5: 'Beta pět', b2: 'Beta dva', A: 'Kategorie A', B: 'Kategorie B' };

H.beh(async () => {
  const inst = await H.startInstance({ slug: 'usporadani', env: { KB_UVODNI_MAPA: 0 } });
  expect((await inst.register(UCET)).status === 200, 'účet vlastníka založen');
  expect((await inst.register(CTENAR)).status === 200, 'účet čtenáře založen');
  const auth = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: UCET, password: H.PW } })).json;
  const T = auth.token;

  const fixtura = {
    title: 'Řazení sourozenců',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 400, y: 0 }, data: { nodeType: 'apex', apexText: 'ŘAZENÍ', title: 'ŘAZENÍ', status: 'todo' } },
      { id: 'A', type: 'goalNode', position: { x: 100, y: 380 }, data: { title: N.A, status: 'todo' } },
      { id: 'B', type: 'goalNode', position: { x: 900, y: 380 }, data: { title: N.B, status: 'todo' } },
      { id: 'a10', type: 'goalNode', position: { x: 0, y: 660 }, data: { title: N.a10, status: 'todo', deadline: den(10), owner: UCET } },
      { id: 'a1', type: 'goalNode', position: { x: 270, y: 660 }, data: { title: N.a1, status: 'done', deadline: den(1) } },
      { id: 'a0', type: 'goalNode', position: { x: 540, y: 660 }, data: { title: N.a0, status: 'in_progress' } },
      { id: 'b5', type: 'goalNode', position: { x: 810, y: 660 }, data: { title: N.b5, status: 'todo', plannedOn: den(5) } },
      { id: 'b2', type: 'goalNode', position: { x: 1080, y: 660 }, data: { title: N.b2, status: 'todo', plannedOn: den(2) } },
    ],
    edges: [
      { id: 'e1', source: 'apex', target: 'A' }, { id: 'e2', source: 'apex', target: 'B' },
      { id: 'e3', source: 'A', target: 'a10' }, { id: 'e4', source: 'A', target: 'a1' }, { id: 'e5', source: 'A', target: 'a0' },
      { id: 'e6', source: 'B', target: 'b5' }, { id: 'e7', source: 'B', target: 'b2' },
    ],
  };
  const mapa = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: fixtura })).json;
  expect(!!mapa.id, 'mapa s kategoriemi a listy založena');

  // 1920 px = ŠIROKÁ lišta (≥1850) s plným tlačítkem; úzká varianta je v DOM jen skrytá
  const { page, chyby } = await H.browser({ viewport: { width: 1920, height: 950 } });
  await page.evaluateOnNewDocument((t, r) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r }));
    localStorage.setItem('kb-lang', 'cs');
  }, auth.token, auth.record);

  const otevri = async (id, minUzlu) => {
    await page.goto(`${inst.base}/map/${id}`, { waitUntil: 'networkidle2' });
    await page.waitForFunction((n) => document.querySelectorAll('.react-flow__node').length >= n, { timeout: 45000 }, minUzlu).catch(() => {});
    await sleep(1500);
  };
  // pořadí zadaných listů podle příčné osy daného směru (svisle zleva, vodorovně shora)
  const poradi = (tituly, horiz) => page.evaluate((tituly, horiz) => {
    const found = [];
    for (const el of document.querySelectorAll('.react-flow__node')) {
      const tx = el.textContent || '';
      const t = tituly.find((x) => tx.includes(x));
      if (!t) continue;
      const r = el.getBoundingClientRect();
      found.push({ t, k: horiz ? r.top : r.left });
    }
    return found.sort((a, b) => a.k - b.k).map((f) => f.t).join(' | ');
  }, tituly, horiz);
  const pockejNaUlozeni = async () => {
    // ⚠️ pevných 1 200 ms = přesně debounce autosave (viz ui-zarovnani-smer)
    await sleep(1300);
    await page.waitForFunction(() => !(document.body.innerText || '').includes('Ukládání'), { timeout: 15000 }).catch(() => {});
    await sleep(400);
  };
  // radix nabídka: SKUTEČNÝ klik přes handle (syntetické el.click() ji neotevře)
  const klikHandle = async (sel) => { const h = await page.$(sel); if (!h) throw new Error(`není ${sel}`); await h.click(); };
  const usporadat = async (kriterium) => {
    await klikHandle('[data-testid="toolbar-usporadat"]');
    await page.waitForSelector('[role="menuitemradio"]', { timeout: 8000 });
    const polozky = await page.$$eval('[role="menuitemradio"]', (els) => els.map((e) => e.getAttribute('data-kriterium')));
    expect(polozky.join(',') === 'deadline,plannedOn,owner,status', `nabídka má 4 kritéria v pořadí termín, plán, řešitel, stav (${polozky.join(',')})`);
    await klikHandle(`[role="menuitemradio"][data-kriterium="${kriterium}"]`);
    await pockejNaUlozeni();
  };
  const stavTlacitka = () => page.evaluate(() => {
    const b = document.querySelector('[data-testid="toolbar-usporadat"]');
    return b ? { k: b.getAttribute('data-usporadani'), text: (b.textContent || '').replace(/\s+/g, ' ').trim(), title: b.title || '' } : null;
  });
  // levé okraje a šířky tlačítek lišty — od 1. 10. 2026 se volbou NESMÍ hnout
  // (Richard: „mění pořád velikost… pohnou se mi tlačítka a klikám jinam")
  const rozmeryListy = () => page.evaluate(() => {
    const ids = ['zarovnat', 'usporadat', 'citelnost', 'fit'];
    const out = {};
    // přepínač směru stojí VLEVO od indikátoru ukládání — na ikonové liště ho
    // text „Ukládání…" odsouval o ~65 px a původní měření to nevidělo (/checkup 2. 10.)
    const smer = document.querySelector('button[data-dir="vertical"]');
    if (smer && smer.offsetParent) { const r = smer.getBoundingClientRect(); out.smer = `${Math.round(r.left)}+${Math.round(r.width)}`; }
    for (const id of ids) {
      const b = [...document.querySelectorAll(`[data-testid="toolbar-${id}"],[data-testid="toolbar-${id}-narrow"]`)].find((x) => x.offsetParent);
      if (b) { const r = b.getBoundingClientRect(); out[id] = `${Math.round(r.left)}+${Math.round(r.width)}`; }
    }
    // nejbližší tlačítko VPRAVO od kostičky ve stejné řadě — na něm je
    // poskakování vidět nejvíc (sem Richard klikal a trefil jiné)
    const fit = [...document.querySelectorAll('[data-testid^="toolbar-fit"]')].find((x) => x.offsetParent)?.getBoundingClientRect();
    if (fit) {
      const vpravo = [...document.querySelectorAll('button')].filter((x) => x.offsetParent)
        .map((x) => x.getBoundingClientRect())
        .filter((r) => r.left >= fit.right && Math.abs(r.top - fit.top) < 12)
        .sort((p, q) => p.left - q.left)[0];
      if (vpravo) out.vpravo = Math.round(vpravo.left);
    }
    return JSON.stringify(out);
  });
  // která položka je v nabídce zaškrtnutá (otevřít skutečným klikem, přečíst, Escape)
  const zaskrtnuto = async (co) => {
    const id = await page.evaluate((c) => [...document.querySelectorAll(`[data-testid="toolbar-${c}"],[data-testid="toolbar-${c}-narrow"]`)].find((x) => x.offsetParent)?.getAttribute('data-testid'), co);
    await klikHandle(`[data-testid="${id}"]`);
    await page.waitForSelector('[role="menu"] [role="menuitemradio"]', { visible: true, timeout: 8000 });
    const v = await page.$eval('[role="menu"]', (m) => { const e = m.querySelector('[role="menuitemradio"][aria-checked="true"]'); return e ? (e.getAttribute('data-styl') || e.getAttribute('data-stupen') || e.getAttribute('data-kriterium')) : null; });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="menu"]'), { timeout: 5000 }).catch(() => {});
    return v;
  };
  const listyA = [N.a10, N.a1, N.a0];
  const listyB = [N.b5, N.b2];

  console.log('== tlačítko v liště vedle Zarovnat, výchozí bez volby ==');
  await otevri(mapa.id, 8);
  const pred = await poradi(listyA, false);
  expect(pred === `${N.a10} | ${N.a1} | ${N.a0}`, `výchozí pořadí listů A dle fixtury (${pred})`);
  let tl = await stavTlacitka();
  expect(!!tl && tl.k === 'none' && tl.text === 'Uspořádat', `tlačítko Uspořádat bez zvoleného kritéria (${JSON.stringify(tl)})`);
  expect(await page.$('[data-testid="toolbar-usporadat-narrow"]') !== null, 'úzká (ikonová) varianta je v DOM pro menší lišty');
  expect(await page.$('button[data-align-lock]') !== null, 'Zarovnat zůstává vedle (nenahrazuje se)');

  console.log('== podle termínu: +1, +10, bez termínu; kategorie drží; uloženo do DB ==');
  await usporadat('deadline');
  const poTerminu = await poradi(listyA, false);
  expect(poTerminu === `${N.a1} | ${N.a10} | ${N.a0}`, `listy A seřazené dle termínu (${poTerminu})`);
  expect((await poradi([N.A, N.B], false)) === `${N.A} | ${N.B}`, 'kategorie A (má brzký vnuk) zůstala před B');
  tl = await stavTlacitka();
  expect(tl.k === 'deadline' && /Termín/.test(tl.title), `tlačítko hlásí zvolené kritérium (ikonou + v tooltipu: ${tl.title})`);
  expect(tl.text === 'Uspořádat', `popisek zůstává pevný „Uspořádat" (${tl.text})`);
  const ulozena = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json;
  const hranyPred = fixtura.edges.map((e) => `${e.source}>${e.target}`).sort().join(',');
  const hranyPo = (ulozena.edges || []).map((e) => `${e.source}>${e.target}`).sort().join(',');
  expect(hranyPo === hranyPred, 'struktura (hrany) se v DB nezměnila');
  const posDB = Object.fromEntries((ulozena.nodes || []).map((n) => [n.id, n.position]));
  expect(posDB.a1 && posDB.a10 && posDB.a1.x < posDB.a10.x && posDB.a10.x < posDB.a0.x, `pořadí je ZAPSANÉ v DB (x: a1=${posDB.a1?.x}, a10=${posDB.a10?.x}, a0=${posDB.a0?.x})`);

  console.log('== Zpět vrátí původní rozmístění ==');
  await klikHandle('button[title="Vrátit zpět"]');
  await pockejNaUlozeni();
  const poZpet = await poradi(listyA, false);
  expect(poZpet === pred, `po Zpět je pořadí jako před (${poZpet})`);

  console.log('== Zarovnat po uspořádání pořadí drží (celý cyklus stylů) ==');
  await usporadat('deadline');
  for (const [i, styl] of [[1, 'classic'], [2, 'compact'], [3, 'bands']]) {
    expect(await H.vyberZListy(page, 'zarovnat', `[data-styl="${styl}"]`), `Zarovnat: vybrán styl ${styl}`);
    await pockejNaUlozeni();
    const ted = await poradi(listyA, false);
    expect(ted === poTerminu, `po Zarovnat ${i}× pořadí drží (${ted})`);
  }

  console.log('== podle plánu: B listy +2 před +5 ==');
  await usporadat('plannedOn');
  const poPlanu = await poradi(listyB, false);
  expect(poPlanu === `${N.b2} | ${N.b5}`, `listy B dle plánu (${poPlanu})`);

  console.log('== vodorovné view: podle stavu shora (rozpracované, nezačaté, hotové) ==');
  await page.evaluate(() => document.querySelector('button[data-dir="horizontal"]')?.click());
  await sleep(1500);
  await usporadat('status');
  const poStavuH = await poradi(listyA, true);
  expect(poStavuH === `${N.a0} | ${N.a10} | ${N.a1}`, `vodorovně shora dle stavu (${poStavuH})`);
  await page.evaluate(() => document.querySelector('button[data-dir="vertical"]')?.click());
  await sleep(1500);
  const poStavuV = await poradi(listyA, false);
  expect(poStavuV === `${N.a0} | ${N.a10} | ${N.a1}`, `svisle zleva totéž pořadí (${poStavuV})`);

  console.log('== podle řešitele: přiřazený před nepřiřazenými ==');
  await usporadat('owner');
  const poResiteli = await poradi(listyA, false);
  expect(poResiteli.startsWith(N.a10), `list s řešitelem je první (${poResiteli})`);

  console.log('== reload: volba se pamatuje jen pro zvýraznění, mapa se sama nepřerovná ==');
  const predReloadem = await poradi(listyA, false);
  // důkaz „nic se neuložilo" = razítko `updated` z API před a po otevření (text
  // „Ukládání…" mohl proběhnout a zmizet dřív, než se sada podívá — panel /checkup 6. 9.)
  const updatedPred = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json.updated;
  await otevri(mapa.id, 8);
  await sleep(2500);
  tl = await stavTlacitka();
  expect(tl.k === 'owner', `po reloadu je zvýrazněné poslední kritérium (${tl.k})`);
  expect((await poradi(listyA, false)) === predReloadem, 'pořadí po reloadu beze změny');
  const updatedPo = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json.updated;
  expect(updatedPo === updatedPred, `po otevření se nic neuložilo — updated beze změny (${updatedPred} → ${updatedPo})`);

  console.log('== lišta neposkakuje: volba v nabídkách nemění šířky ani pozice tlačítek ==');
  for (const [sirka, popis] of [[1920, 'široká lišta'], [1400, 'ikonová lišta']]) {
    await page.setViewport({ width: sirka, height: 950 });
    await sleep(800);
    const r0 = await rozmeryListy();
    expect(Object.keys(JSON.parse(r0)).length === 6, `${popis}: přepínač směru, tři nabídky, kostička i pravá skupina jsou vidět (${r0})`);
    for (const [co, polozka] of [['zarovnat', '[data-styl="compact"]'], ['zarovnat', '[data-styl="bands"]'], ['citelnost', '[data-stupen="titleOnly"]'],
      ['citelnost', '[data-stupen="normal"]'], ['usporadat', '[data-kriterium="plannedOn"]'], ['usporadat', '[data-kriterium="owner"]']]) {
      expect(await H.vyberZListy(page, co, polozka), `${popis}: ${co} ${polozka} vybráno`);
      await pockejNaUlozeni();
      const r = await rozmeryListy();
      expect(r === r0, `${popis}: po ${co} ${polozka} tlačítka na místě (${r === r0 ? 'beze změny' : r0 + ' → ' + r})`);
      // nabídka musí zvolenou hodnotu OZNAČIT (mutace s prázdným `value` jinak prošla)
      expect(await zaskrtnuto(co) === polozka.match(/"([^"]+)"/)[1], `${popis}: nabídka ${co} má zaškrtnuté ${polozka}`);
    }
    // i BĚHEM ukládání (indikátor svítí) — vyvolat zápis a měřit hned, ne až po uložení
    expect(await H.vyberZListy(page, 'zarovnat', '[data-styl="classic"]'), `${popis}: zarovnat classic (měření během ukládání)`);
    let behem = r0, stavy = '';
    for (let i = 0; i < 12; i++) {
      await sleep(250);
      const st = await page.evaluate(() => [...document.querySelectorAll('[data-testid="save-status"]')].find((x) => x.offsetParent)?.getAttribute('data-stav') || 'idle');
      if (!stavy.includes(st)) stavy += st + ' ';
      const r = await rozmeryListy();
      if (r !== r0) behem = r;
    }
    expect(/saving|saved/.test(stavy), `${popis}: indikátor ukládání se během měření opravdu ukázal (${stavy.trim()})`);
    expect(behem === r0, `${popis}: indikátor ukládání lištou nepohnul (${behem === r0 ? 'beze změny' : r0 + ' → ' + behem})`);
    await pockejNaUlozeni();
    expect(await H.vyberZListy(page, 'zarovnat', '[data-styl="bands"]'), `${popis}: zpět na kolem středu`);
    await pockejNaUlozeni();
  }
  await page.setViewport({ width: 1920, height: 950 });
  await sleep(800);

  // KOSTIČKA (Richard 1. 10. 2026: „tlačítko kostky… by mohlo zároveň zarovnat
  // dle všech nastavení") — ručně rozházené pořadí srovná podle Uspořádat
  // (teď „řešitel") ve stylu Zarovnat, zapíše a jde vzít Zpět.
  console.log('== kostička srovná mapu podle Zarovnat + Uspořádat a oddálí ==');
  const kosticka = async () => {
    const id = await page.evaluate(() => [...document.querySelectorAll('[data-testid="toolbar-fit"],[data-testid="toolbar-fit-narrow"]')].find((x) => x.offsetParent)?.getAttribute('data-testid'));
    await klikHandle(`[data-testid="${id}"]`);
    await pockejNaUlozeni();
  };
  expect(await page.$eval('[data-testid="toolbar-fit"]', (b) => b.getAttribute('data-srovna')) === 'ano', 'editor má kostičku, která srovnává');
  {
    const ulozeno = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json;
    const uzly = ulozeno.nodes.map((n) => ({ ...n, position: { ...n.position } }));
    const u10 = uzly.find((n) => n.id === 'a10'), u0 = uzly.find((n) => n.id === 'a0');
    [u10.position, u0.position] = [u0.position, u10.position];   // „ruční" prohození listů
    await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: T, body: { nodes: uzly } });
  }
  await otevri(mapa.id, 8);
  const rucne = await poradi(listyA, false);
  expect(!rucne.startsWith(N.a10), `ručně rozházené pořadí, řešitel není první (${rucne})`);
  await kosticka();
  const poKosticce = await poradi(listyA, false);
  expect(poKosticce.startsWith(N.a10), `kostička seřadila podle řešitele (${poKosticce})`);
  const posKost = Object.fromEntries((((await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json.nodes) || []).map((n) => [n.id, n.position]));
  expect(posKost.a10 && posKost.a0 && posKost.a10.x < posKost.a0.x, `a uložila to (x: a10=${posKost.a10?.x}, a0=${posKost.a0?.x})`);
  const updKost = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json.updated;
  await kosticka();
  const updKost2 = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json.updated;
  expect(updKost2 === updKost, `srovnaná mapa: další kostička nic nezapíše (updated ${updKost} → ${updKost2})`);
  await klikHandle('button[title="Vrátit zpět"]');
  await pockejNaUlozeni();
  expect((await poradi(listyA, false)) === rucne, `Zpět vrátí ruční pořadí před kostičkou (${await poradi(listyA, false)})`);

  console.log('== kostička na mapě, která nikdy nebyla zarovnaná: jen oddálí ==');
  {
    const volna = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
      title: 'Ručně rozmístěná',
      nodes: [
        { id: 'apex', type: 'apexNode', position: { x: 400, y: 0 }, data: { nodeType: 'apex', apexText: 'RUČNĚ', title: 'RUČNĚ', status: 'todo' } },
        { id: 'r1', type: 'goalNode', position: { x: -300, y: 500 }, data: { title: 'Vlevo dole', status: 'todo' } },
        { id: 'r2', type: 'goalNode', position: { x: 1200, y: 250 }, data: { title: 'Vpravo nahoře', status: 'todo' } },
      ],
      edges: [{ id: 'v1', source: 'apex', target: 'r1' }, { id: 'v2', source: 'apex', target: 'r2' }],
    } })).json;
    await otevri(volna.id, 3);
    const styl = await page.$eval('[data-testid="toolbar-zarovnat"]', (b) => b.getAttribute('data-align-style'));
    expect(styl === 'none', `nová mapa nemá zvolený styl (${styl})`);
    const updPred = (await inst.api('GET', `/api/collections/goalmaps/records/${volna.id}`, { token: T })).json.updated;
    await kosticka();
    const po = (await inst.api('GET', `/api/collections/goalmaps/records/${volna.id}`, { token: T })).json;
    const r1 = (po.nodes || []).find((n) => n.id === 'r1');
    expect(po.updated === updPred && r1 && r1.position.x === -300 && r1.position.y === 500, `ručně rozmístěné uzly zůstaly, nic se neuložilo (r1 ${JSON.stringify(r1?.position)})`);

    // PŘECHOD MEZI MAPAMI UVNITŘ APLIKACE (bez načtení stránky): editor se
    // nepřemontuje, takže mapa bez stylu dřív ZDĚDILA styl té předchozí — a
    // kostička ji pak přerovnala a uložila (/checkup 2. 10. 2026). `page.goto`
    // to nechytí, proto navigace přes historii prohlížeče.
    console.log('== přechod ze zarovnané mapy na nezarovnanou uvnitř aplikace: styl se nedědí ==');
    await otevri(mapa.id, 8);
    expect(await page.$eval('[data-testid="toolbar-zarovnat"]', (b) => b.getAttribute('data-align-style')) !== 'none', 'výchozí mapa styl má');
    await page.evaluate((id) => { window.history.pushState({}, '', `/map/${id}`); window.dispatchEvent(new PopStateEvent('popstate')); }, volna.id);
    await page.waitForFunction(() => [...document.querySelectorAll('.react-flow__node')].some((e) => (e.textContent || '').includes('Vlevo dole')), { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    expect(await page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].some((e) => (e.textContent || '').includes('Vlevo dole'))), 'druhá mapa se otevřela bez načtení stránky');
    const zdedeny = await page.$eval('[data-testid="toolbar-zarovnat"]', (b) => b.getAttribute('data-align-style'));
    const klicVolne = await page.evaluate((id) => localStorage.getItem('kb-zarovnat-styl:' + id), volna.id);
    expect(zdedeny === 'none' && !klicVolne, `nezarovnaná mapa styl předchozí mapy nezdědila (tlačítko ${zdedeny}, klíč ${klicVolne})`);
    await kosticka();
    const poPrechodu = (await inst.api('GET', `/api/collections/goalmaps/records/${volna.id}`, { token: T })).json;
    const r1b = (poPrechodu.nodes || []).find((n) => n.id === 'r1');
    expect(poPrechodu.updated === updPred && r1b && r1b.position.x === -300 && r1b.position.y === 500, `a kostička ji ani teď nepřerovnala (r1 ${JSON.stringify(r1b?.position)})`);
  }

  // KOSTIČKA NA ŠÍŘKU NESMÍ TIŠE PŘEPSAT ULOŽENÉ SVISLÉ ROZMÍSTĚNÍ (/checkup
  // 2. 10. 2026). Layout ve vodorovném směru jako vedlejší efekt přepisuje
  // kanonické (svislé) pozice; když se na plátně nic nehne, kostička nezapíše
  // krok Zpět — ale přerovnaný kanon by se uložil s nejbližší jinou úpravou.
  console.log('== kostička na šířku: když se plátno nehne, ruční svislé rozmístění zůstane i po další úpravě ==');
  {
    await otevri(mapa.id, 8);
    await kosticka();   // srovnat (pořadí + styl), ať je výchozí stav „uklizeno"
    const uklizena = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json;
    const uzly = uklizena.nodes.map((n) => ({ ...n, position: { ...n.position } }));
    const b5 = uzly.find((n) => n.id === 'b5');
    const rucne = { x: b5.position.x + 60, y: b5.position.y + 45 };   // ruční doladění ve svislém směru
    b5.position = rucne;
    await inst.api('PATCH', `/api/collections/goalmaps/records/${mapa.id}`, { token: T, body: { nodes: uzly } });
    await otevri(mapa.id, 8);
    await page.evaluate(() => document.querySelector('button[data-dir="horizontal"]')?.click());
    await sleep(1500);
    await kosticka();   // plátno na šířku je už rozložené → nic se nehne
    // jiná, nesouvisející úprava: přejmenování mapy → uloží se celá mapa
    await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => (x.textContent || '') === 'Řazení sourozenců')?.click());
    await sleep(600);
    expect(await page.evaluate(() => { const el = [...document.querySelectorAll('input')].find((i) => i.value === 'Řazení sourozenců'); if (!el) return false; el.focus(); el.setSelectionRange(0, el.value.length); return true; }), 'pole názvu mapy je vybrané');
    await page.keyboard.type('Řazení po kostičce');
    await page.keyboard.press('Enter');
    await pockejNaUlozeni();
    await sleep(1500);
    const poUprave = (await inst.api('GET', `/api/collections/goalmaps/records/${mapa.id}`, { token: T })).json;
    const b5po = (poUprave.nodes || []).find((n) => n.id === 'b5');
    expect(poUprave.title === 'Řazení po kostičce', `nesouvisející úprava se uložila (název „${poUprave.title}")`);
    expect(b5po && Math.abs(b5po.position.x - rucne.x) < 1 && Math.abs(b5po.position.y - rucne.y) < 1, `ruční svislá poloha uzlu přežila kostičku na šířku (${JSON.stringify(b5po?.position)} vs ${JSON.stringify(rucne)})`);
    await page.evaluate(() => document.querySelector('button[data-dir="vertical"]')?.click());
    await sleep(1500);
  }

  // KLIK MIMO OTEVŘENOU NABÍDKU ji jen zavře — nesmí zároveň zmáčknout tlačítko
  // na uzlu pod kurzorem (uzly mají pointer-events: all, zámek kliků od Radixu
  // na ně neplatí; /checkup 2. 10. 2026: 14 ze 14 pokusů založilo cíl).
  console.log('== klik mimo otevřenou nabídku jen zavře, nezmáčkne „Přidat podcíl" na uzlu ==');
  {
    const uzluPred = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
    const idZ = await page.evaluate(() => [...document.querySelectorAll('[data-testid="toolbar-zarovnat"],[data-testid="toolbar-zarovnat-narrow"]')].find((x) => x.offsetParent)?.getAttribute('data-testid'));
    await klikHandle(`[data-testid="${idZ}"]`);
    await page.waitForSelector('[role="menu"]', { visible: true, timeout: 8000 });
    const cil = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]').getBoundingClientRect();
      const b = [...document.querySelectorAll('.react-flow__node button')].filter((x) => (x.getAttribute('title') || '') === 'Přidat podcíl')
        .map((x) => x.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.top > 60 && r.bottom < window.innerHeight && (r.left > m.right + 10 || r.right < m.left - 10 || r.top > m.bottom + 10))[0];
      return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
    });
    expect(!!cil, 'na plátně je tlačítko „Přidat podcíl" mimo otevřenou nabídku');
    if (cil) await page.mouse.click(cil.x, cil.y);
    await sleep(900);
    const poKliku = await page.evaluate(() => ({ menu: !!document.querySelector('[role="menu"]'), dialog: !!document.querySelector('[role="dialog"]'), uzlu: document.querySelectorAll('.react-flow__node').length }));
    expect(!poKliku.menu, 'nabídka se klikem mimo zavřela');
    expect(!poKliku.dialog && poKliku.uzlu === uzluPred, `klik neprošel na uzel — žádný dialog ani nový cíl (dialog ${poKliku.dialog}, uzlů ${uzluPred} → ${poKliku.uzlu})`);
    if (poKliku.dialog) { await page.keyboard.press('Escape'); await sleep(400); }
  }

  console.log('== kanban: nabídka se schová, indikátor Kanban zůstává ==');
  const kanban = (await inst.api('POST', '/api/collections/goalmaps/records', { token: T, body: {
    title: 'Kanban deska',
    nodes: [
      { id: 'apex', type: 'apexNode', position: { x: 300, y: 0 }, data: { nodeType: 'apex', apexText: 'DESKA', title: 'DESKA', status: 'todo' } },
      { id: 'K1', type: 'goalNode', position: { x: 0, y: 380 }, data: { title: 'Řada 1', status: 'todo' } },
      { id: 'K2', type: 'goalNode', position: { x: 300, y: 380 }, data: { title: 'Řada 2', status: 'todo' } },
      { id: 'x1', type: 'goalNode', position: { x: 0, y: 660 }, data: { title: 'Karta', status: 'todo' } },
    ],
    edges: [{ id: 'k1', source: 'apex', target: 'K1' }, { id: 'k2', source: 'apex', target: 'K2' }, { id: 'k3', source: 'K1', target: 'x1' }],
  } })).json;
  const pravidlo = await inst.api('POST', '/api/kb/rules/save', { token: T, body: {
    map: kanban.id, name: 'Kanban: 1 → 2', trigger: { type: 'node_status_changed', status: 'done' },
    conditions: [{ field: 'parent', op: 'eq', value: 'K1' }], actions: [{ type: 'move_node', to: 'K2' }],
  } });
  expect(pravidlo.status === 200 && !!pravidlo.json?.rule?.id, `pravidlo posunu založeno (${pravidlo.status})`);
  await otevri(kanban.id, 4);
  await page.waitForSelector('[data-testid="toolbar-kanban-mode"]', { timeout: 10000 }).catch(() => {});
  expect(await page.$('[data-testid="toolbar-kanban-mode"]') !== null, 'indikátor Kanban je v liště');
  expect(await page.$('[data-testid="toolbar-usporadat"]') === null, 'nabídka Uspořádat v kanbanu není');
  // kostička v kanbanu jen oddálí — desku drží pravidla posunu (pojistka je na
  // `kanbanAktivni`, ne na donačtení textů indikátoru)
  expect(await page.$eval('[data-testid="toolbar-fit"]', (b) => b.getAttribute('data-srovna')) === 'ne', 'kostička v kanbanu mapu nesrovnává');
  const kanbanPred = (await inst.api('GET', `/api/collections/goalmaps/records/${kanban.id}`, { token: T })).json;
  await kosticka();
  const kanbanPo = (await inst.api('GET', `/api/collections/goalmaps/records/${kanban.id}`, { token: T })).json;
  expect(kanbanPo.updated === kanbanPred.updated && JSON.stringify((kanbanPo.nodes || []).map((n) => n.position)) === JSON.stringify((kanbanPred.nodes || []).map((n) => n.position)), 'klik na kostičku desku nepřerovnal ani neuložil');

  console.log('== čtenář (týmový přístup ke čtení): nabídka není ==');
  const sdil = await inst.api('POST', '/api/kb/share', { token: T, body: { mapId: mapa.id, action: 'set_team_access', access: 'read' } });
  expect(sdil.status === 200, `týmový přístup ke čtení nastaven (${sdil.status})`);
  const authC = (await inst.api('POST', '/api/collections/users/auth-with-password', { body: { identity: CTENAR, password: H.PW } })).json;
  await page.evaluate((t, r) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r })), authC.token, authC.record);
  await page.evaluateOnNewDocument((t, r) => localStorage.setItem('pocketbase_auth', JSON.stringify({ token: t, record: r })), authC.token, authC.record);
  await otevri(mapa.id, 8);
  const uzluCtenar = await page.evaluate(() => document.querySelectorAll('.react-flow__node').length);
  expect(uzluCtenar >= 8, `čtenář mapu vidí (${uzluCtenar} uzlů)`);
  expect(await page.$('[data-testid="toolbar-usporadat"]') === null && await page.$('[data-testid="toolbar-usporadat-narrow"]') === null, 'čtenář nabídku Uspořádat nemá');
  expect(await page.$eval('[data-testid="toolbar-fit"]', (b) => b.getAttribute('data-srovna')).catch(() => null) === 'ne', 'čtenáři kostička jen oddálí (mapu nesrovnává)');
  // a skutečným klikem: polohy uzlů v mapě (ne přiblížení) se nezmění
  const polohyUzlu = () => page.evaluate(() => [...document.querySelectorAll('.react-flow__node')].map((e) => `${e.getAttribute('data-id')}:${e.style.transform}`).sort().join('|'));
  const ctenarPred = await polohyUzlu();
  await klikHandle('[data-testid="toolbar-fit"]');
  await sleep(1200);
  expect((await polohyUzlu()) === ctenarPred, 'klik čtenáře na kostičku uzly nepohnul');

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-USPORADANI' });
