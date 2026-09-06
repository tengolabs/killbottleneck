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
    return b ? { k: b.getAttribute('data-usporadani'), text: (b.textContent || '').replace(/\s+/g, ' ').trim() } : null;
  });
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
  expect(tl.k === 'deadline' && /Termín/.test(tl.text), `tlačítko ukazuje zvolené kritérium (${tl.text})`);
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
  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => document.querySelector('button[data-align-lock]')?.click());
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

  expect(chyby.length === 0, `konzole bez chyb (${chyby.length}${chyby.length ? ': ' + chyby[0].slice(0, 160) : ''})`);
}, { nazev: 'UI-USPORADANI' });
